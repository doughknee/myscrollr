//! The main window selects a channel, never an arbitrary endpoint or version comparator.
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Manager, Webview};
use tauri_plugin_updater::UpdaterExt;

#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum UpdateChannel {
    Stable,
    Beta,
}

impl UpdateChannel {
    fn endpoint(self) -> &'static str {
        match self {
            Self::Stable => {
                "https://raw.githubusercontent.com/doughknee/myscrollr/desktop-updates/stable.json"
            }
            Self::Beta => {
                "https://raw.githubusercontent.com/doughknee/myscrollr/desktop-updates/beta.json"
            }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: tauri::ResourceId,
    current_version: String,
    version: String,
    body: Option<String>,
    raw_json: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelCheck {
    feed_version: String,
    update: Option<UpdateMetadata>,
}

#[tauri::command]
pub async fn check_update_channel(
    webview: Webview,
    channel: UpdateChannel,
) -> Result<ChannelCheck, String> {
    if webview.label() != "main" {
        return Err("Updates are only available in the main window".into());
    }
    let seen = Arc::new(Mutex::new(None));
    let observed = seen.clone();
    let updater = webview
        .updater_builder()
        .endpoints(vec![channel
            .endpoint()
            .parse()
            .map_err(|_| "Invalid channel endpoint")?])
        .map_err(|_| "Invalid channel endpoint")?
        .timeout(Duration::from_secs(20))
        .version_comparator(move |current, release| {
            *observed.lock().unwrap_or_else(|e| e.into_inner()) = Some(release.version.clone());
            release.version > current
                && (channel == UpdateChannel::Beta || release.version.pre.is_empty())
        })
        .build()
        .map_err(|_| "Could not initialize updates")?;
    // Cancel the native network operation before the controller releases its lock.
    let update = tokio::time::timeout(Duration::from_secs(25), updater.check()).await
        .map_err(|_| "Update check timed out. Check your connection and retry.")?
        .map_err(|_| "The update feed is unavailable or does not support this installation. Please retry later.")?;
    let version = seen
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .ok_or("The update feed returned no release metadata. Please retry later.")?;
    if channel == UpdateChannel::Stable && !version.pre.is_empty() {
        return Err("The Stable feed returned a prerelease. No update was accepted.".into());
    }
    if let Some(ref update) = update {
        let expected = format!(
            "/doughknee/myscrollr/releases/download/desktop-v{}/",
            update.version
        );
        let url = &update.download_url;
        if url.scheme() != "https"
            || url.host_str() != Some("github.com")
            || !url.path().starts_with(&expected)
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("The update feed contains an unexpected download URL.".into());
        }
    }
    Ok(ChannelCheck {
        feed_version: version.to_string(),
        update: update.map(|update| {
            let metadata = UpdateMetadata {
                rid: 0,
                current_version: update.current_version.clone(),
                version: update.version.clone(),
                body: update.body.clone(),
                raw_json: update.raw_json.clone(),
            };
            UpdateMetadata {
                rid: webview.resources_table().add(update),
                ..metadata
            }
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn channels_are_closed_and_endpoints_are_separate() {
        assert!(serde_json::from_str::<UpdateChannel>("\"nightly\"").is_err());
        assert!(serde_json::from_str::<UpdateChannel>("\"https://example.com\"").is_err());
        assert!(UpdateChannel::Stable.endpoint().ends_with("/stable.json"));
        assert!(UpdateChannel::Beta.endpoint().ends_with("/beta.json"));
    }
}
