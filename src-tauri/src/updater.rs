use serde::Deserialize;

use crate::models::{RemoteReleaseInfo, UpdateCheckResult};

pub const GITHUB_RELEASES_API_URL: &str =
    "https://api.github.com/repos/borisli713/Cadence-Mobile/releases/latest";
pub const GITHUB_RELEASES_PAGE_URL: &str =
    "https://github.com/borisli713/Cadence-Mobile/releases/latest";

#[derive(Debug, Deserialize)]
struct GitHubReleaseAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Deserialize)]
struct GitHubLatestRelease {
    tag_name: String,
    html_url: Option<String>,
    body: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    assets: Vec<GitHubReleaseAsset>,
}

pub fn normalize_version_name(raw: &str) -> String {
    let trimmed = raw.trim().trim_start_matches(['v', 'V']);
    if trimmed.chars().any(|c| c.is_ascii_digit()) {
        trimmed.to_string()
    } else {
        String::new()
    }
}

pub fn parse_version_parts(version: &str) -> Vec<u64> {
    let norm = normalize_version_name(version);
    let core = norm
        .split(['-', '+'])
        .next()
        .unwrap_or("")
        .trim();
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

pub fn clean_release_notes(raw: &str) -> String {
    if raw.trim().is_empty() {
        return String::new();
    }
    let lines: Vec<String> = raw
        .lines()
        .map(|l| l.trim())
        .filter(|l| {
            !l.is_empty() && !l.starts_with("## ") && !l.starts_with("**Full Changelog**")
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
    let client = reqwest::Client::builder()
        .user_agent("Cadence-Windows-Desktop")
        .build()
        .map_err(|e| format!("Failed to initialize HTTP client: {e}"))?;

    let resp = client
        .get(GITHUB_RELEASES_API_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Network request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API returned status {}", resp.status()));
    }

    let release: GitHubLatestRelease = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse GitHub release JSON: {e}"))?;

    if release.draft || release.prerelease {
        return Err("Latest release is draft or prerelease.".to_string());
    }

    let clean_ver = normalize_version_name(&release.tag_name);
    if clean_ver.is_empty() {
        return Err("Release tag did not contain a semantic version.".to_string());
    }

    let win_asset = release.assets.iter().find(|a| {
        let lower = a.name.to_lowercase();
        lower.ends_with(".exe") || lower.ends_with(".msi") || lower.contains("windows")
    });

    let download_page_url = release
        .html_url
        .filter(|u| !u.trim().is_empty())
        .unwrap_or_else(|| GITHUB_RELEASES_PAGE_URL.to_string());

    let latest = RemoteReleaseInfo {
        version_name: clean_ver.clone(),
        release_notes: clean_release_notes(release.body.as_deref().unwrap_or("")),
        download_page_url,
        windows_asset_url: win_asset.map(|a| a.browser_download_url.clone()),
        windows_asset_name: win_asset.map(|a| a.name.clone()),
    };

    let update_available =
        compare_version_names(&latest.version_name, current_version) == std::cmp::Ordering::Greater;

    Ok(UpdateCheckResult {
        current_version: normalize_version_name(current_version),
        latest,
        update_available,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions_starting_at_1_0_0() {
        assert_eq!(
            compare_version_names("1.0.1", "1.0.0"),
            std::cmp::Ordering::Greater
        );
        assert_eq!(
            compare_version_names("v1.0.2", "1.0.2"),
            std::cmp::Ordering::Equal
        );
        assert_eq!(
            compare_version_names("1.0.0", "1.0.1"),
            std::cmp::Ordering::Less
        );
    }
}
