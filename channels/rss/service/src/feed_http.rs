use std::{
    io,
    net::{IpAddr, SocketAddr},
    sync::Arc,
    time::Duration,
};

use reqwest::{
    Client, ClientBuilder, Response, Url,
    dns::{Addrs, Name, Resolve, Resolving},
    header::{ACCEPT, HeaderMap, HeaderValue},
    redirect,
};

fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, d] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192
                    && ((b == 0 && (c == 0 || c == 2)) || (b == 88 && c == 99) || b == 168))
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                || (a == 203 && b == 0 && c == 113)
                || [a, b, c, d] == [168, 63, 129, 16])
        }
        IpAddr::V6(ip) => {
            let s = ip.segments();
            // Only global unicast; exclude special-purpose, documentation and transition ranges.
            (s[0] & 0xe000) == 0x2000
                && !(s[0] == 0x2001 && (s[1] < 0x200 || s[1] == 0xdb8))
                && s[0] != 0x2002
                && !(s[0] == 0x3fff && s[1] < 0x1000)
        }
    }
}

fn validate_url(url: &Url) -> anyhow::Result<()> {
    anyhow::ensure!(
        matches!(url.scheme(), "http" | "https"),
        "RSS feeds require HTTP or HTTPS"
    );
    anyhow::ensure!(
        url.username().is_empty() && url.password().is_none(),
        "RSS feed credentials are not allowed"
    );
    let host = url
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("RSS feed host is missing"))?;
    let host = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim_end_matches('.');
    if let Ok(ip) = host.parse::<IpAddr>() {
        anyhow::ensure!(public_ip(ip), "RSS feed destination is not public");
    } else {
        anyhow::ensure!(
            host.contains('.')
                && !["localhost", "local", "internal", "svc", "cluster.local"]
                    .iter()
                    .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}"))),
            "RSS feed destination is not public"
        );
    }
    Ok(())
}

fn public_addresses(addresses: Vec<SocketAddr>) -> io::Result<Addrs> {
    if addresses.is_empty() || addresses.iter().any(|address| !public_ip(address.ip())) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "RSS DNS destination is not public",
        ));
    }
    Ok(Box::new(addresses.into_iter()))
}

#[derive(Debug)]
struct PublicResolver;

impl Resolve for PublicResolver {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let addresses = tokio::net::lookup_host((name.as_str(), 0)).await?.collect();
            // Return the checked sockets to the connector: never resolve again after checking.
            Ok(public_addresses(addresses)?)
        })
    }
}

fn client_builder() -> ClientBuilder {
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static(
        "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
    ));
    Client::builder()
        .default_headers(headers)
        .user_agent("Scrollr/1.0 RSS Fetcher (+https://myscrollr.com)")
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(5))
        .gzip(true)
        .no_proxy()
        .referer(false)
        .dns_resolver(Arc::new(PublicResolver))
        .redirect(redirect::Policy::custom(|attempt| {
            if let Err(error) = validate_url(attempt.url()) {
                return attempt.error(error.to_string());
            }
            if attempt.previous().len() >= 10 {
                return attempt.error("RSS redirect limit exceeded");
            }
            attempt.follow()
        }))
}

pub fn build_client() -> reqwest::Result<Client> {
    client_builder().build()
}

pub async fn get(client: &Client, raw_url: &str) -> anyhow::Result<Response> {
    let url = Url::parse(raw_url)?;
    validate_url(&url)?;
    Ok(client.get(url).send().await?.error_for_status()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn rejects_non_public_and_obfuscated_destinations() {
        for url in [
            "file:///etc/passwd",
            "ftp://example.com/rss",
            "http://127.1/",
            "http://2130706433/",
            "http://0x7f000001/",
            "http://0177.0.0.1/",
            "http://[::1]/",
            "http://[::ffff:127.0.0.1]/",
            "http://[64:ff9b::a9fe:a9fe]/",
            "http://169.254.169.254/metadata/v1/",
            "http://100.100.100.200/",
            "http://192.168.1.1/",
            "http://10.0.0.1/",
            "http://172.16.0.1/",
            "http://0.0.0.0/",
            "http://168.63.129.16/",
            "http://localhost/",
            "http://LOCALHOST./",
            "http://core-api:8080/",
            "http://metadata.google.internal/",
            "http://kubernetes.default.svc/",
            "http://user:pass@example.com/",
            "http://[2001:db8::1]/",
            "http://[2002:7f00:1::]/",
            "http://[3fff::1]/",
            "http://224.0.0.1/",
        ] {
            assert!(
                validate_url(&Url::parse(url).unwrap()).is_err(),
                "accepted {url}"
            );
        }
        for url in [
            "https://feeds.npr.org/1001/rss.xml",
            "https://example.com./rss",
            "http://8.8.8.8/rss",
            "https://[2606:4700:4700::1111]/rss",
        ] {
            assert!(
                validate_url(&Url::parse(url).unwrap()).is_ok(),
                "rejected {url}"
            );
        }
    }

    #[test]
    fn dns_checks_every_answer_and_returns_only_the_checked_sockets() {
        let public: SocketAddr = "8.8.8.8:0".parse().unwrap();
        let private: SocketAddr = "10.0.0.1:0".parse().unwrap();
        assert_eq!(
            public_addresses(vec![public]).unwrap().collect::<Vec<_>>(),
            vec![public]
        );
        assert!(public_addresses(vec![public, private]).is_err());
        assert!(public_addresses(vec![private]).is_err()); // A later, rebound answer is checked afresh.
        assert!(public_addresses(vec![]).is_err());
    }

    #[tokio::test]
    async fn refuses_private_dns_answers() {
        let name: Name = "localhost".parse().unwrap();
        assert!(PublicResolver.resolve(name).await.is_err());
    }

    #[tokio::test]
    async fn public_feed_works_but_redirect_cannot_reach_private_listener() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        // Test-only DNS override makes the public fixture host reachable without internet access.
        let client = client_builder()
            .resolve("feed.example", address)
            .build()
            .unwrap();
        let server = tokio::spawn(async move {
            for response in [
                "HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\nfeed".to_string(),
                format!(
                    "HTTP/1.1 302 Found\r\nLocation: http://{address}/secret\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                ),
            ] {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = [0; 2048];
                socket.read(&mut request).await.unwrap();
                socket.write_all(response.as_bytes()).await.unwrap();
            }
            assert!(
                tokio::time::timeout(Duration::from_millis(100), listener.accept())
                    .await
                    .is_err()
            );
        });
        let url = format!("http://feed.example:{}/rss", address.port());
        assert_eq!(
            get(&client, &url).await.unwrap().text().await.unwrap(),
            "feed"
        );
        assert!(get(&client, &url).await.is_err());
        server.await.unwrap();
    }
}
