//! Opt-in native updater transport rehearsal against already verified artifacts.
//! No installation, production feed writes, or production endpoint override.
//! Run with SCROLLR_REHEARSAL_DIR=<finalizer verification directory> and
//! cargo test --test update_transport -- --ignored --nocapture.
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread;
use std::time::Duration;
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri_plugin_updater::UpdaterExt;

struct Server {
    address: std::net::SocketAddr,
    stop: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
}

impl Server {
    fn start(manifest: Value, package: Arc<Vec<u8>>, mode: &'static str) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        let worker = thread::spawn(move || {
            while !stopped.load(Ordering::Relaxed) {
                let Ok((mut stream, _)) = listener.accept() else {
                    thread::sleep(Duration::from_millis(5));
                    continue;
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                stream
                    .set_write_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                // TCP may split even a tiny HTTP header across reads. Drain the
                // complete request before responding/closing to avoid Windows RSTs.
                let mut request = Vec::new();
                let mut chunk = [0; 2048];
                while !request.ends_with(b"\r\n\r\n") && request.len() < 16384 {
                    match stream.read(&mut chunk) {
                        Ok(0) | Err(_) => break,
                        Ok(size) => request.extend_from_slice(&chunk[..size]),
                    }
                }
                if !request.ends_with(b"\r\n\r\n") {
                    continue;
                }
                let request = String::from_utf8_lossy(&request);
                let is_package = request.starts_with("GET /package ");
                let body = if is_package {
                    package.as_ref().clone()
                } else {
                    let mut value = manifest.clone();
                    if let Some(platforms) = value["platforms"].as_object_mut() {
                        for entry in platforms.values_mut() {
                            entry["url"] = json!(format!("http://{address}/package"));
                        }
                    }
                    if mode == "missing-target" {
                        value["platforms"] = json!({});
                    }
                    if mode == "malformed" {
                        b"not json".to_vec()
                    } else {
                        serde_json::to_vec(&value).unwrap()
                    }
                };
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                if is_package && mode == "interrupted" {
                    let _ = stream.write_all(&body[..body.len() / 2]);
                } else if is_package && mode == "corrupt" {
                    let mut changed = body;
                    changed[0] ^= 1;
                    let _ = stream.write_all(&changed);
                } else if is_package && mode == "stall" {
                    // Bounded independently of the updater timeout and test cleanup.
                    for _ in 0..100 {
                        if stopped.load(Ordering::Relaxed) {
                            break;
                        }
                        thread::sleep(Duration::from_millis(10));
                    }
                } else {
                    let _ = stream.write_all(&body);
                }
                let _ = stream.shutdown(std::net::Shutdown::Write);
            }
        });
        Self {
            address,
            stop,
            worker: Some(worker),
        }
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        self.worker.take().unwrap().join().unwrap();
    }
}

#[test]
#[ignore = "requires finalizer-verified signed packages; performs loopback downloads only"]
fn signed_native_transport() {
    assert!(
        cfg!(debug_assertions),
        "Rehearsal is test-only, never a release binary"
    );
    let directory = PathBuf::from(
        std::env::var("SCROLLR_REHEARSAL_DIR")
            .expect("Set SCROLLR_REHEARSAL_DIR to the finalizer verification directory"),
    );
    let manifest: Value =
        serde_json::from_slice(&std::fs::read(directory.join("latest.json")).unwrap()).unwrap();
    let evidence: Value =
        serde_json::from_slice(&std::fs::read(directory.join("verification.json")).unwrap())
            .unwrap();
    assert_eq!(manifest["version"], evidence["version"]);
    let target = if cfg!(target_os = "windows") {
        "windows-x86_64-nsis"
    } else if cfg!(target_os = "macos") {
        "darwin-aarch64"
    } else {
        "linux-x86_64"
    };
    let url = url::Url::parse(manifest["platforms"][target]["url"].as_str().unwrap()).unwrap();
    let name = url.path_segments().unwrap().next_back().unwrap();
    assert!(!name.contains(['/', '\\']) && name != "." && name != "..");
    assert!(
        evidence["assets"][name].is_string(),
        "Package must occur in finalizer proof"
    );
    let package = Arc::new(std::fs::read(directory.join(name)).unwrap());
    assert!(!package.is_empty());
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let current =
        std::env::var("SCROLLR_REHEARSAL_FROM_VERSION").unwrap_or_else(|_| "1.7.2".into());
    let mut context = mock_context(noop_assets());
    context.package_info_mut().version = current.parse().unwrap();
    context.config_mut().identifier = "com.scrollr.updater-transport-test".into();
    context.config_mut().plugins.0.insert(
        "updater".into(),
        json!({
            "pubkey": config["plugins"]["updater"]["pubkey"],
            "allowDowngrades": false
        }),
    );
    let app = mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap();
    tauri::async_runtime::block_on(async {
        for mode in [
            "valid",
            "corrupt",
            "interrupted",
            "stall",
            "missing-target",
            "malformed",
        ] {
            let server = Server::start(manifest.clone(), package.clone(), mode);
            let updater = app
                .updater_builder()
                .target(target)
                .no_proxy()
                .endpoints(vec![format!("http://{}/manifest", server.address)
                    .parse()
                    .unwrap()])
                .unwrap()
                .timeout(Duration::from_secs(5))
                .build()
                .unwrap();
            let result = updater.check().await;
            if ["missing-target", "malformed"].contains(&mode) {
                assert!(result.is_err(), "{mode} must fail the real native check");
            } else {
                let mut update = result
                    .unwrap()
                    .expect("Target must be newer than the test source version");
                if mode == "stall" {
                    update.timeout = Some(Duration::from_millis(150));
                }
                let downloaded = update.download(|_, _| {}, || {}).await;
                if mode == "valid" {
                    assert_eq!(downloaded.unwrap(), *package);
                } else {
                    let error =
                        downloaded.expect_err("Invalid download must fail before installation");
                    match (mode, &error) {
                        ("corrupt", tauri_plugin_updater::Error::Minisign(_)) => {}
                        ("interrupted", tauri_plugin_updater::Error::Reqwest(_)) => {}
                        ("stall", tauri_plugin_updater::Error::Reqwest(cause))
                            if cause.is_timeout() => {}
                        _ => panic!("Unexpected {mode} rejection: {error}"),
                    }
                }
            }
            println!(
                "PASS native transport {mode}: {target} -> {}",
                manifest["version"]
            );
        }
        // Real plugin SemVer handling: no same-version reinstall or downgrade.
        for version in [&current, "0.0.1"] {
            let mut older = manifest.clone();
            older["version"] = json!(version);
            let server = Server::start(older, package.clone(), "valid");
            let updater = app
                .updater_builder()
                .target(target)
                .no_proxy()
                .endpoints(vec![format!("http://{}/manifest", server.address)
                    .parse()
                    .unwrap()])
                .unwrap()
                .timeout(Duration::from_secs(5))
                .build()
                .unwrap();
            assert!(updater.check().await.unwrap().is_none());
        }
    });
    println!("PASS signed download and rejection checks. No installation, relaunch or public-feed claim.");
}
