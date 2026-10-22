use std::{sync::Arc, fs};
use bytes::BytesMut;
use reqwest::Client;
use tokio::sync::Mutex;
use crate::log::{error, info, warn};
use crate::database::{
    PgPool, get_tracked_feeds, get_quarantined_feeds, seed_tracked_feeds,
    batch_upsert_rss_items, cleanup_old_articles,
    batch_record_feed_successes, batch_record_feed_failures,
    FeedConfig, TrackedFeed, ParsedArticle,
};
pub use crate::types::RssHealth;

pub mod log;
pub mod database;
pub mod init;
pub mod types;
pub mod feed_http;

/// Upper bound on a single feed HTTP body. Anything larger is almost certainly
/// either a misconfigured source streaming logs, a CDN serving us an error
/// page as HTML, or an outright denial-of-service attempt. We cap streaming
/// rather than reject late to avoid buffering hundreds of MB into memory.
const MAX_FEED_BODY_BYTES: usize = 8 * 1024 * 1024; // 8 MiB

pub async fn start_rss_service(pool: Arc<PgPool>, health_state: Arc<Mutex<RssHealth>>, client: &Client, cycle: u64) {
    info!("Starting RSS service (cycle {})...", cycle);

    // Seed default feeds from config on first cycle (ON CONFLICT updates
    // category and name so renames propagate; user customizations are unaffected)
    if cycle == 0 {
        match fs::read_to_string("./configs/feeds.json") {
            Ok(file_contents) => match serde_json::from_str::<Vec<FeedConfig>>(&file_contents) {
                Ok(config) => {
                    info!("Upserting {} default feeds from configs/feeds.json...", config.len());
                    if let Err(e) = seed_tracked_feeds(pool.clone(), config).await {
                        error!("Failed to seed default feeds: {}", e);
                    }
                }
                Err(e) => error!("Failed to parse configs/feeds.json: {}", e),
            },
            Err(e) => warn!("configs/feeds.json not found: {}", e),
        }
    }

    let mut feeds = get_tracked_feeds(pool.clone()).await;

    // On cycle 0 (startup) and every 288 cycles (~24 hours) afterwards, retry
    // quarantined feeds to see if they've recovered. Retrying at cycle 0 is
    // important because a pod restart shouldn't strand feeds that would
    // otherwise wait another full day before being touched again.
    if cycle == 0 || cycle.is_multiple_of(288) {
        let quarantined = get_quarantined_feeds(pool.clone()).await;
        if !quarantined.is_empty() {
            info!("Retrying {} quarantined feeds...", quarantined.len());
            feeds.extend(quarantined);
        }
    }

    if feeds.is_empty() {
        error!("No feeds to track. RSS service idling.");
        return;
    }

    // Reset per-cycle counters
    health_state.lock().await.reset_cycle();

    info!("Polling {} RSS feeds concurrently...", feeds.len());

    // Limit concurrency to avoid overwhelming the network/DB connection pool
    let semaphore = Arc::new(tokio::sync::Semaphore::new(20));
    let mut join_set = tokio::task::JoinSet::new();

    for feed in feeds {
        let client = client.clone();
        let pool = pool.clone();
        let sem = semaphore.clone();
        let feed_name = feed.name.clone();
        let feed_url = feed.url.clone();

        join_set.spawn(async move {
            let _permit = sem.acquire().await.expect("semaphore closed");
            let result = poll_feed(&client, &pool, &feed).await;
            (feed_name, feed_url, feed.consecutive_failures, result)
        });
    }

    // Collect results, then batch-update the DB in two queries instead of 97
    let mut success_urls: Vec<String> = Vec::new();
    let mut failure_urls: Vec<String> = Vec::new();
    let mut failure_errors: Vec<String> = Vec::new();

    while let Some(join_result) = join_set.join_next().await {
        match join_result {
            Ok((feed_name, feed_url, prev_failures, Ok(count))) => {
                success_urls.push(feed_url.clone());
                if prev_failures >= 3 {
                    info!("Feed {} ({}) recovered after {} consecutive failures", feed_name, feed_url, prev_failures);
                }
                health_state.lock().await.record_success(count as u64);
            }
            Ok((feed_name, feed_url, prev_failures, Err(e))) => {
                let err_msg = format!("{}", e);
                failure_urls.push(feed_url.clone());
                failure_errors.push(err_msg);
                let new_failures = prev_failures + 1;
                if new_failures == 3 {
                    warn!("Feed {} ({}) hidden from catalog after 3 consecutive failures", feed_name, feed_url);
                } else if new_failures == 288 {
                    warn!("Feed {} ({}) quarantined after 288 consecutive failures (24h)", feed_name, feed_url);
                }
                error!("Error polling feed {} ({}): {}", feed_name, feed_url, e);
                health_state.lock().await.record_error(format!("{}: {}", feed_name, e));
            }
            Err(panic_err) => {
                error!("PANIC in feed poll task: {}", panic_err);
                health_state.lock().await.record_error(format!("PANIC: {}", panic_err));
            }
        }
    }

    // Batch-update feed statuses (2 queries instead of ~97 sequential ones)
    batch_record_feed_successes(&pool, &success_urls).await;
    batch_record_feed_failures(&pool, &failure_urls, &failure_errors).await;

    // Cleanup old articles (older than 7 days)
    match cleanup_old_articles(&pool).await {
        Ok(deleted) if deleted > 0 => {
            info!("Cleaned up {} old RSS articles", deleted);
        }
        Ok(_) => {} // Nothing to clean
        Err(e) => {
            warn!("Failed to cleanup old articles: {}", e);
        }
    }

    let health = health_state.lock().await;
    info!(
        "RSS poll cycle complete: {} feeds polled, {} items ingested, {} errors",
        health.feeds_polled, health.items_ingested, health.error_count
    );
}

async fn poll_feed(client: &Client, pool: &Arc<PgPool>, feed: &TrackedFeed) -> anyhow::Result<usize> {
    // Stream the body into a bounded buffer so a hostile or misbehaving feed
    // can't OOM the pod. `.error_for_status()?` also surfaces 4xx/5xx as
    // errors up front so we don't try to parse an HTML error page as RSS.
    let mut response = feed_http::get(client, &feed.url).await?;
    let mut buf = BytesMut::with_capacity(64 * 1024);
    while let Some(chunk) = response.chunk().await? {
        if buf.len() + chunk.len() > MAX_FEED_BODY_BYTES {
            anyhow::bail!(
                "feed body exceeded {}MiB cap",
                MAX_FEED_BODY_BYTES / 1024 / 1024
            );
        }
        buf.extend_from_slice(&chunk);
    }
    let bytes = buf.freeze();

    let parsed = feed_rs::parser::parse(&bytes[..])?;

    // Hoist source_name derivation outside the entry loop (avoids cloning per entry)
    let source_name = parsed.title
        .as_ref()
        .map(|t| t.content.clone())
        .unwrap_or_else(|| feed.name.clone());

    let cutoff = chrono::Utc::now() - chrono::Duration::days(7);
    let mut articles = Vec::with_capacity(parsed.entries.len());

    for entry in parsed.entries {
        let guid = entry.id.clone();
        if guid.is_empty() {
            continue;
        }

        let title = entry.title
            .map(|t| t.content)
            .unwrap_or_default();

        if title.is_empty() {
            continue;
        }

        let link = entry.links
            .first()
            .map(|l| l.href.clone())
            .unwrap_or_default();

        let description = entry.summary
            .map(|s| s.content)
            .or_else(|| entry.content.and_then(|c| c.body))
            .unwrap_or_default();

        // Truncate description to 500 characters (char-based to avoid
        // panicking on multi-byte UTF-8 sequences like smart quotes)
        let description = if description.chars().count() > 500 {
            let mut truncated: String = description.chars().take(500).collect();
            truncated.push_str("...");
            truncated
        } else {
            description
        };

        let description = strip_html_tags(&description);

        let published_at = entry.published
            .or(entry.updated)
            .map(|dt| dt.with_timezone(&chrono::Utc));

        // Skip articles older than the cleanup threshold (7 days) so we never
        // re-insert rows that cleanup already deleted — avoids a CDC
        // INSERT→DELETE storm every poll cycle.
        if let Some(pub_date) = &published_at
            && *pub_date < cutoff
        {
            continue;
        }

        articles.push(ParsedArticle {
            feed_url: feed.url.clone(),
            guid,
            title,
            link,
            description,
            source_name: source_name.clone(),
            published_at,
        });
    }

    if articles.is_empty() {
        return Ok(0);
    }

    let count = articles.len();
    if let Err(e) = batch_upsert_rss_items(pool, articles).await {
        warn!("Failed to batch upsert RSS items from {}: {}", feed.name, e);
        return Ok(0);
    }

    Ok(count)
}

/// Basic HTML tag stripper — removes angle-bracketed tags.
fn strip_html_tags(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut in_tag = false;

    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }

    // Collapse multiple whitespace and trim
    let collapsed: String = result.split_whitespace().collect::<Vec<&str>>().join(" ");
    collapsed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_html_tags_simple() {
        assert_eq!(strip_html_tags("<p>Hello World</p>"), "Hello World");
        assert_eq!(strip_html_tags("<b>Bold</b> and <i>italic</i>"), "Bold and italic");
    }

    #[test]
    fn test_strip_html_tags_nested() {
        let input = "<div><p><strong>Nested</strong> text</p></div>";
        assert_eq!(strip_html_tags(input), "Nested text");
    }

    #[test]
    fn test_strip_html_tags_whitespace_collapsed() {
        let input = "Hello    World\n\nMore   Text";
        assert_eq!(strip_html_tags(input), "Hello World More Text");
    }

    #[test]
    fn test_strip_html_tags_leading_trailing_whitespace() {
        let input = "   <p>  Text  </p>   ";
        assert_eq!(strip_html_tags(input), "Text");
    }

    #[test]
    fn test_strip_html_tags_no_tags() {
        assert_eq!(strip_html_tags("Plain text"), "Plain text");
    }

    #[test]
    fn test_strip_html_tags_empty() {
        assert_eq!(strip_html_tags(""), "");
        assert_eq!(strip_html_tags("<><><>"), "");
    }

    #[test]
    fn test_strip_html_tags_unclosed_tag() {
        // Unclosed tag at end: "<p>Hello" → "Hello"
        assert_eq!(strip_html_tags("<p>Hello"), "Hello");
        // Unclosed tag at start: "Hello</p>" → "Hello"
        assert_eq!(strip_html_tags("Hello</p>"), "Hello");
    }

    #[test]
    fn test_strip_html_tags_entity_like() {
        // &lt; and &gt; are NOT HTML entities here — they remain as chars
        assert_eq!(strip_html_tags("a &lt; b"), "a &lt; b");
        assert_eq!(strip_html_tags("a &gt; b"), "a &gt; b");
        assert_eq!(strip_html_tags("a &amp; b"), "a &amp; b");
    }

    #[test]
    fn test_strip_html_tags_multiline() {
        let input = "<html>\n<body>\n<p>Line1\nLine2</p>\n</body>\n</html>";
        assert_eq!(strip_html_tags(input), "Line1 Line2");
    }

    #[test]
    fn test_strip_html_tags_with_attributes() {
        let input = r#"<a href="https://example.com" title="Link">Click</a>"#;
        assert_eq!(strip_html_tags(input), "Click");
    }

    #[test]
    fn test_strip_html_tags_script_style() {
        let input = "<script>alert('xss')</script>Safe text";
        assert_eq!(strip_html_tags(input), "alert('xss')Safe text");
        let input2 = "<style>body{color:red}</style>Visible";
        assert_eq!(strip_html_tags(input2), "body{color:red}Visible");
    }

    #[test]
    fn test_strip_html_tags_unicode() {
        assert_eq!(strip_html_tags("<p>こんにちは</p>"), "こんにちは");
        assert_eq!(strip_html_tags("<span>日本語</span>"), "日本語");
    }
}
