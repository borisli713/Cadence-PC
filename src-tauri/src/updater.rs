use serde::Deserialize;

use crate::models::{RemoteReleaseInfo, UpdateCheckResult};

pub const DEFAULT_GITHUB_REPO: &str = "borisli713/Cadence-PC";

pub fn github_repo_slug() -> &'static str {
    option_env!("CADENCE_GITHUB_REPO").unwrap_or(DEFAULT_GITHUB_REPO)
}

pub fn github_releases_api_url() -> String {
    format!(
        "https://api.github.com/repos/{}/releases?per_page=30",
        github_repo_slug()
    )
}

pub fn github_releases_page_url() -> String {
    format!("https://github.com/{}/releases", github_repo_slug())
}

#[derive(Debug, Clone, Deserialize)]
pub struct GitHubReleaseAsset {
    pub name: String,
    pub browser_download_url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GitHubReleaseEntry {
    pub tag_name: String,
    pub html_url: Option<String>,
    pub body: Option<String>,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub prerelease: bool,
    #[serde(default)]
    pub assets: Vec<GitHubReleaseAsset>,
}

pub fn normalize_version_name(raw: &str) -> String {
    let mut trimmed = raw.trim();
    for prefix in [
        "windows-v",
        "windows-V",
        "windows-",
        "win-v",
        "win-V",
        "win-",
        "v",
        "V",
    ] {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            trimmed = rest;
            break;
        }
    }
    if trimmed.chars().any(|c| c.is_ascii_digit()) {
        trimmed.to_string()
    } else {
        String::new()
    }
}

pub fn parse_version_parts(version: &str) -> Vec<u64> {
    let norm = normalize_version_name(version);
    let core = norm.split(['-', '+']).next().unwrap_or("").trim();
    if core.is_empty() {
        return Vec::new();
    }
    core.split('.')
        .map(|seg| {
            let digits: String = seg.chars().take_while(|c| c.is_ascii_digit()).collect();
            digits.parse::<u64>().unwrap_or(0)
        })
        .collect()
}

pub fn compare_version_names(version_a: &str, version_b: &str) -> std::cmp::Ordering {
    let parts_a = parse_version_parts(version_a);
    let parts_b = parse_version_parts(version_b);
    let max_len = parts_a.len().max(parts_b.len());
    for i in 0..max_len {
        let a = parts_a.get(i).copied().unwrap_or(0);
        let b = parts_b.get(i).copied().unwrap_or(0);
        if a != b {
            return a.cmp(&b);
        }
    }
    std::cmp::Ordering::Equal
}

pub fn is_windows_release(release: &GitHubReleaseEntry) -> bool {
    if release.draft || release.prerelease {
        return false;
    }
    let tag_lower = release.tag_name.trim().to_ascii_lowercase();
    let has_win_tag = tag_lower.starts_with("windows-") || tag_lower.starts_with("win-");
    let has_win_asset = release.assets.iter().any(|a| {
        let lower = a.name.to_ascii_lowercase();
        lower.ends_with(".exe") || lower.ends_with(".msi")
    });
    let has_android_only_asset = !has_win_asset
        && release
            .assets
            .iter()
            .any(|a| a.name.to_ascii_lowercase().ends_with(".apk"));

    if has_android_only_asset {
        return false;
    }
    has_win_tag || has_win_asset
}

pub fn select_latest_windows_release(releases: &[GitHubReleaseEntry]) -> Option<GitHubReleaseEntry> {
    releases
        .iter()
        .filter(|r| is_windows_release(r))
        .max_by(|a, b| compare_version_names(&a.tag_name, &b.tag_name))
        .cloned()
}

pub fn pick_preferred_windows_asset(assets: &[GitHubReleaseAsset]) -> Option<&GitHubReleaseAsset> {
    assets
        .iter()
        .find(|a| a.name.to_ascii_lowercase().ends_with("-setup.exe"))
        .or_else(|| {
            assets
                .iter()
                .find(|a| a.name.to_ascii_lowercase().ends_with(".msi"))
        })
        .or_else(|| {
            assets.iter().find(|a| {
                let lower = a.name.to_ascii_lowercase();
                lower.ends_with(".exe") || lower.contains("windows")
            })
        })
}

pub fn clean_release_notes(raw: &str) -> String {
    if raw.trim().is_empty() {
        return String::new();
    }
    let lines: Vec<String> = raw
        .lines()
        .map(|l| l.trim())
        .filter(|l| {
            !l.is_empty()
                && !l.starts_with("## ")
                && !l.starts_with("### ")
                && !l.starts_with("**Full Changelog**")
        })
        .map(|l| {
            l.trim_start_matches("- ")
                .trim_start_matches("* ")
                .trim_start_matches("• ")
                .trim()
                .to_string()
        })
        .filter(|l| !l.is_empty())
        .take(5)
        .collect();
    let joined = if lines.is_empty() {
        String::new()
    } else {
        format!("• {}", lines.join("\n• "))
    };
    if joined.len() > 300 {
        format!("{}…", joined.chars().take(297).collect::<String>().trim_end())
    } else {
        joined
    }
}

pub async fn check_for_github_update(current_version: &str) -> Result<UpdateCheckResult, String> {
    let norm_current = normalize_version_name(current_version);
    let releases_api_url = github_releases_api_url();
    let releases_page_url = github_releases_page_url();

    let client = reqwest::Client::builder()
        .user_agent("Cadence-Windows-Desktop")
        .build()
        .map_err(|e| format!("Failed to initialize HTTP client: {e}"))?;

    let resp = client
        .get(&releases_api_url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Network request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API returned status {}", resp.status()));
    }

    let releases: Vec<GitHubReleaseEntry> = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse GitHub releases JSON: {e}"))?;

    let Some(release) = select_latest_windows_release(&releases) else {
        return Ok(UpdateCheckResult {
            current_version: norm_current.clone(),
            latest: RemoteReleaseInfo {
                version_name: norm_current,
                release_notes: "No newer Windows desktop release published yet.".to_string(),
                download_page_url: releases_page_url,
                windows_asset_url: None,
                windows_asset_name: None,
            },
            update_available: false,
        });
    };

    let clean_ver = normalize_version_name(&release.tag_name);
    if clean_ver.is_empty() {
        return Err("Windows release tag did not contain a semantic version.".to_string());
    }

    let win_asset = pick_preferred_windows_asset(&release.assets);

    let download_page_url = release
        .html_url
        .filter(|u| !u.trim().is_empty())
        .unwrap_or(releases_page_url);

    let latest = RemoteReleaseInfo {
        version_name: clean_ver.clone(),
        release_notes: clean_release_notes(release.body.as_deref().unwrap_or("")),
        download_page_url,
        windows_asset_url: win_asset.map(|a| a.browser_download_url.clone()),
        windows_asset_name: win_asset.map(|a| a.name.clone()),
    };

    let update_available =
        compare_version_names(&latest.version_name, &norm_current) == std::cmp::Ordering::Greater;

    Ok(UpdateCheckResult {
        current_version: norm_current,
        latest,
        update_available,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_release(tag: &str, asset_names: &[&str]) -> GitHubReleaseEntry {
        GitHubReleaseEntry {
            tag_name: tag.to_string(),
            html_url: None,
            body: Some("- Fixed Windows desktop build".to_string()),
            draft: false,
            prerelease: false,
            assets: asset_names
                .iter()
                .map(|n| GitHubReleaseAsset {
                    name: (*n).to_string(),
                    browser_download_url: format!("https://example.com/{}", n),
                })
                .collect(),
        }
    }

    #[test]
    fn compares_windows_and_plain_tags_accurately() {
        assert_eq!(normalize_version_name("windows-v1.0.3"), "1.0.3");
        assert_eq!(
            compare_version_names("windows-v1.0.1", "1.0.0"),
            std::cmp::Ordering::Greater
        );
        assert_eq!(
            compare_version_names("v1.0.2", "windows-v1.0.2"),
            std::cmp::Ordering::Equal
        );
    }

    #[test]
    fn ignores_android_apk_releases_even_if_version_is_higher() {
        let releases = vec![
            mk_release("v1.1.9", &["app-release.apk"]),
            mk_release("windows-v1.0.0", &["Cadence-windows-v1.0.0-setup.exe"]),
        ];
        let picked = select_latest_windows_release(&releases).unwrap();
        assert_eq!(normalize_version_name(&picked.tag_name), "1.0.0");

        let only_android = vec![mk_release("v1.1.9", &["Cadence-Mobile.apk"])];
        assert!(select_latest_windows_release(&only_android).is_none());
    }

    #[test]
    fn prefers_setup_installer_and_uses_windows_repo() {
        let rel = mk_release(
            "windows-v1.0.2",
            &[
                "Cadence-windows-v1.0.2-windows-x64-portable.exe",
                "Cadence-windows-v1.0.2-windows-x64-setup.exe",
                "Cadence-windows-v1.0.2-windows-x64.msi",
            ],
        );
        let picked = pick_preferred_windows_asset(&rel.assets).unwrap();
        assert_eq!(picked.name, "Cadence-windows-v1.0.2-windows-x64-setup.exe");
        assert!(github_releases_api_url().contains("/releases?per_page=30"));
    }
}
