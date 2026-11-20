use tauri::Manager;

pub const CADENCE_URL_SCHEME: &str = "cadence";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedCadenceDeepLink {
    pub host: String,
    pub status: Option<String>,
}

pub fn parse_cadence_deep_link(raw_url: &str) -> Option<ParsedCadenceDeepLink> {
    let trimmed = raw_url.trim().trim_matches('"');
    let rest = trimmed.strip_prefix("cadence://")?;
    let mut parts = rest.splitn(2, '?');
    let host = parts.next().unwrap_or("").trim_end_matches('/').to_string();
    let query = parts.next().unwrap_or("");
    let mut status = None;
    for pair in query.split('&') {
        let mut kv = pair.splitn(2, '=');
        if kv.next() == Some("status") {
            if let Some(val) = kv.next() {
                status = Some(val.to_string());
            }
        }
    }
    Some(ParsedCadenceDeepLink { host, status })
}

pub fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn handle_cli_args_for_deep_link(app: &tauri::AppHandle, args: &[String]) -> bool {
    for arg in args {
        if let Some(parsed) = parse_cadence_deep_link(arg) {
            focus_main_window(app);
            if parsed.host == "auth" {
                return true;
            }
        }
    }
    false
}

#[cfg(target_os = "windows")]
pub fn register_windows_url_protocol() -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let exe_path = std::env::current_exe()
        .map_err(|e| format!("Failed to locate executable path: {e}"))?;
    let exe_str = exe_path.to_string_lossy();

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let base_path = format!("Software\\Classes\\{}", CADENCE_URL_SCHEME);
    let (scheme_key, _) = hkcu
        .create_subkey(&base_path)
        .map_err(|e| format!("Registry protocol registration failed: {e}"))?;

    scheme_key
        .set_value("", &"URL:Cadence Desktop Protocol")
        .map_err(|e| format!("Registry description failed: {e}"))?;
    scheme_key
        .set_value("URL Protocol", &"")
        .map_err(|e| format!("Registry URL Protocol flag failed: {e}"))?;

    let (icon_key, _) = hkcu
        .create_subkey(format!("{}\\DefaultIcon", base_path))
        .map_err(|e| format!("Registry icon key failed: {e}"))?;
    let _ = icon_key.set_value("", &format!("\"{}\",0", exe_str));

    let (cmd_key, _) = hkcu
        .create_subkey(format!("{}\\shell\\open\\command", base_path))
        .map_err(|e| format!("Registry command key failed: {e}"))?;
    cmd_key
        .set_value("", &format!("\"{}\" \"%1\"", exe_str))
        .map_err(|e| format!("Registry command value failed: {e}"))?;

    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn register_windows_url_protocol() -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cadence_auth_deep_link() {
        let parsed = parse_cadence_deep_link("cadence://auth?status=success").unwrap();
        assert_eq!(parsed.host, "auth");
        assert_eq!(parsed.status.as_deref(), Some("success"));
    }

    #[test]
    fn rejects_non_cadence_urls() {
        assert!(parse_cadence_deep_link("https://example.com").is_none());
        assert!(parse_cadence_deep_link("http://localhost:3000").is_none());
    }
}
