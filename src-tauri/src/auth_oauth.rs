use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use serde_json::Value;
use tauri::Emitter;
use tauri_plugin_shell::ShellExt;

use crate::deep_link::focus_main_window;
use crate::models::ExternalOAuthResult;

const EMBEDDED_FIREBASE_CONFIG: &str = include_str!("../../firebase-applet-config.json");
const GOOGLE_AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
static SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopOAuthClientConfig {
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OAuthCallbackPayload {
    state: String,
    id_token: String,
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CancelPayload {
    state: String,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Default)]
pub struct OAuthFlowState {
    active_cancel: Mutex<Option<Arc<AtomicBool>>>,
}

impl OAuthFlowState {
    pub fn cancel_active(&self) {
        if let Ok(mut guard) = self.active_cancel.lock() {
            if let Some(flag) = guard.take() {
                flag.store(true, Ordering::SeqCst);
            }
        }
    }

    fn register_active(&self, flag: Arc<AtomicBool>) {
        if let Ok(mut guard) = self.active_cancel.lock() {
            if let Some(prev) = guard.replace(flag) {
                prev.store(true, Ordering::SeqCst);
            }
        }
    }

    fn clear_active(&self) {
        if let Ok(mut guard) = self.active_cancel.lock() {
            *guard = None;
        }
    }
}

pub fn resolve_desktop_oauth_client() -> Option<DesktopOAuthClientConfig> {
    let compile_id = option_env!("CADENCE_GOOGLE_DESKTOP_CLIENT_ID")
        .unwrap_or("")
        .trim()
        .to_string();
    let compile_secret = option_env!("CADENCE_GOOGLE_DESKTOP_CLIENT_SECRET")
        .unwrap_or("")
        .trim()
        .to_string();

    let env_id = std::env::var("CADENCE_GOOGLE_DESKTOP_CLIENT_ID")
        .unwrap_or_default()
        .trim()
        .to_string();
    let env_secret = std::env::var("CADENCE_GOOGLE_DESKTOP_CLIENT_SECRET")
        .unwrap_or_default()
        .trim()
        .to_string();

    let client_id = if !env_id.is_empty() {
        env_id
    } else {
        compile_id
    };
    let client_secret = if !env_secret.is_empty() {
        env_secret
    } else {
        compile_secret
    };

    if client_id.is_empty() || client_secret.is_empty() {
        None
    } else {
        Some(DesktopOAuthClientConfig {
            client_id,
            client_secret,
        })
    }
}

fn generate_state_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = SESSION_COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("cadence_{:x}_{:x}", nanos, seq)
}

pub fn sha256_digest(data: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];

    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];

    let bit_len = (data.len() as u64) * 8;
    let mut padded = data.to_vec();
    padded.push(0x80);
    while (padded.len() % 64) != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in padded.chunks_exact(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([
                chunk[i * 4],
                chunk[i * 4 + 1],
                chunk[i * 4 + 2],
                chunk[i * 4 + 3],
            ]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    let mut out = [0u8; 32];
    for (idx, word) in h.iter().enumerate() {
        out[idx * 4..idx * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}

pub fn base64url_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity((bytes.len() * 4).div_ceil(3));
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;

        out.push(TABLE[((triple >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((triple >> 6) & 0x3F) as usize] as char);
        }
        if chunk.len() > 2 {
            out.push(TABLE[(triple & 0x3F) as usize] as char);
        }
    }
    out
}

fn base64url_decode_str(input: &str) -> Option<Vec<u8>> {
    fn val(b: u8) -> Option<u32> {
        match b {
            b'A'..=b'Z' => Some((b - b'A') as u32),
            b'a'..=b'z' => Some((b - b'a' + 26) as u32),
            b'0'..=b'9' => Some((b - b'0' + 52) as u32),
            b'-' | b'+' => Some(62),
            b'_' | b'/' => Some(63),
            _ => None,
        }
    }
    let clean = input.trim_end_matches('=');
    let bytes = clean.as_bytes();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    let mut i = 0;
    while i + 1 < bytes.len() {
        let v0 = val(bytes[i])?;
        let v1 = val(bytes[i + 1])?;
        out.push(((v0 << 2) | (v1 >> 4)) as u8);
        if i + 2 < bytes.len() {
            let v2 = val(bytes[i + 2])?;
            out.push((((v1 & 0x0F) << 4) | (v2 >> 2)) as u8);
            if i + 3 < bytes.len() {
                let v3 = val(bytes[i + 3])?;
                out.push((((v2 & 0x03) << 6) | v3) as u8);
            }
        }
        i += 4;
    }
    Some(out)
}

fn generate_pkce_verifier() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = SESSION_COUNTER.fetch_add(1, Ordering::SeqCst);
    let seed = format!("cadence_pkce_{}_{}_{}", nanos, seq, std::process::id());
    let digest = sha256_digest(seed.as_bytes());
    base64url_encode(&digest)
}

pub fn pkce_s256_challenge(verifier: &str) -> String {
    let hash = sha256_digest(verifier.as_bytes());
    base64url_encode(&hash)
}

pub fn percent_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.as_bytes() {
        let ch = *byte as char;
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '~') {
            out.push(ch);
        } else {
            out.push_str(&format!("%{:02X}", byte));
        }
    }
    out
}

pub fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (
                (bytes[i + 1] as char).to_digit(16),
                (bytes[i + 2] as char).to_digit(16),
            ) {
                out.push(((h << 4) | l) as u8);
                i += 3;
                continue;
            }
        } else if bytes[i] == b'+' {
            out.push(b' ');
            i += 1;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

pub fn parse_query_params(raw_target: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Some((_, query)) = raw_target.split_once('?') else {
        return map;
    };
    let clean_query = query.split('#').next().unwrap_or(query);
    for pair in clean_query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        map.insert(percent_decode(k), percent_decode(v));
    }
    map
}

pub fn build_google_direct_auth_url(
    client_id: &str,
    redirect_uri: &str,
    state: &str,
    code_challenge: &str,
) -> String {
    format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=select_account",
        GOOGLE_AUTH_ENDPOINT,
        percent_encode(client_id),
        percent_encode(redirect_uri),
        percent_encode("openid email profile"),
        percent_encode(state),
        percent_encode(code_challenge),
    )
}

fn decode_jwt_profile_claims(id_token: &str) -> (Option<String>, Option<String>) {
    let mut parts = id_token.split('.');
    let _header = parts.next();
    let Some(payload_b64) = parts.next() else {
        return (None, None);
    };
    let Some(bytes) = base64url_decode_str(payload_b64) else {
        return (None, None);
    };
    let Ok(val) = serde_json::from_slice::<Value>(&bytes) else {
        return (None, None);
    };
    let email = val
        .get("email")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let name = val
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    (email, name)
}

async fn exchange_google_auth_code(
    code: &str,
    code_verifier: &str,
    redirect_uri: &str,
    desktop_cfg: &DesktopOAuthClientConfig,
) -> Result<ExternalOAuthResult, String> {
    let body = format!(
        "code={}&client_id={}&client_secret={}&redirect_uri={}&code_verifier={}&grant_type=authorization_code",
        percent_encode(code),
        percent_encode(&desktop_cfg.client_id),
        percent_encode(&desktop_cfg.client_secret),
        percent_encode(redirect_uri),
        percent_encode(code_verifier),
    );

    let client = reqwest::Client::builder()
        .user_agent("Cadence-Windows-Desktop")
        .build()
        .map_err(|e| format!("Failed to initialize HTTP client: {e}"))?;

    let resp = client
        .post(GOOGLE_TOKEN_ENDPOINT)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Network error exchanging Google authorization code: {e}"))?;

    let status = resp.status();
    let payload: Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Google token response: {e}"))?;

    if !status.is_success() {
        let detail = payload["error_description"]
            .as_str()
            .or_else(|| payload["error"].as_str())
            .unwrap_or("Google OAuth token exchange failed.");
        return Err(format!("Google sign-in error: {detail}"));
    }

    let id_token = payload["id_token"]
        .as_str()
        .unwrap_or_default()
        .trim()
        .to_string();
    if id_token.is_empty() {
        return Err("Google token response did not include an ID token.".to_string());
    }
    let access_token = payload["access_token"]
        .as_str()
        .map(|s| s.to_string());
    let (email, display_name) = decode_jwt_profile_claims(&id_token);

    Ok(ExternalOAuthResult {
        id_token,
        access_token,
        email,
        display_name,
    })
}

fn build_callback_complete_html(error_message: Option<&str>) -> String {
    if let Some(err) = error_message {
        let safe_err = err
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;");
        return format!(
            r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Cadence Desktop — Google Sign-In Error</title>
  <style>
    body {{ margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; background:#f8fafc; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; color:#0f172a; }}
    .card {{ max-width:430px; width:100%; background:#fff; border:1px solid #fecaca; border-radius:16px; padding:28px; box-shadow:0 10px 30px -12px rgba(15,23,42,0.12); }}
    h1 {{ margin:0 0 8px; font-size:18px; color:#991b1b; }}
    p {{ margin:0; font-size:14px; color:#334155; line-height:1.5; }}
  </style>
</head>
<body>
  <div class="card">
    <h1>Google Sign-In Did Not Complete</h1>
    <p>{safe_err}</p>
  </div>
</body>
</html>"#
        );
    }

    r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Cadence Desktop — Signed In</title>
  <style>
    body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; background:#f8fafc; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; color:#0f172a; }
    .card { max-width:430px; width:100%; background:#fff; border:1px solid #bbf7d0; border-radius:16px; padding:28px; box-shadow:0 10px 30px -12px rgba(15,23,42,0.12); }
    h1 { margin:0 0 8px; font-size:19px; color:#166534; }
    p { margin:0 0 18px; font-size:14px; color:#334155; line-height:1.5; }
    .btn { display:inline-flex; width:100%; box-sizing:border-box; align-items:center; justify-content:center; padding:12px 16px; border-radius:10px; background:#2563eb; color:#fff; font-size:14px; font-weight:600; text-decoration:none; }
    .btn:hover { background:#1d4ed8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Signed in to Cadence!</h1>
    <p>Click <strong>Open Cadence</strong> on the browser prompt if shown, or click the button below to jump straight back to the desktop app.</p>
    <a class="btn" href="cadence://auth?status=success">Open Cadence Desktop App</a>
  </div>
  <script>
    setTimeout(function () {
      window.location.href = "cadence://auth?status=success";
    }, 120);
  </script>
</body>
</html>"#
        .to_string()
}

fn build_auth_bridge_html(port: u16, expected_state: &str, firebase_json: &str) -> String {
    let safe_state = expected_state.replace('"', "");
    let template = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Cadence Desktop — Sign In with Google</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #0f172a;
    }
    .card {
      width: 100%;
      max-width: 430px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 28px;
      box-shadow: 0 10px 30px -12px rgba(15, 23, 42, 0.12);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 18px;
    }
    .badge {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: #2563eb;
      color: #fff;
      font-weight: 800;
      display: grid;
      place-items: center;
      font-size: 18px;
    }
    h1 { margin: 0; font-size: 19px; font-weight: 700; }
    .sub { margin: 2px 0 0; font-size: 13px; color: #64748b; }
    .desc { font-size: 14px; color: #334155; line-height: 1.5; margin: 0 0 20px; }
    .btn {
      width: 100%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 12px 16px;
      border-radius: 10px;
      border: none;
      background: #2563eb;
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
    }
    .btn:hover { background: #1d4ed8; }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-secondary {
      margin-top: 10px;
      background: #f1f5f9;
      color: #0f172a;
      border: 1px solid #cbd5e1;
    }
    .btn-secondary:hover { background: #e2e8f0; }
    .status {
      margin-top: 16px;
      padding: 12px;
      border-radius: 10px;
      font-size: 13px;
      line-height: 1.45;
      display: none;
    }
    .status.info { display: block; background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af; }
    .status.success { display: block; background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; }
    .status.error { display: block; background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <div class="badge">C</div>
      <div>
        <h1>Cadence Desktop</h1>
        <p class="sub">Local Sign-In Handoff Bridge</p>
      </div>
    </div>

    <div id="signin-view">
      <p class="desc">
        This local handoff page securely opens Google Sign-In in your browser and passes your verified session straight back to the Cadence Windows app.
      </p>
      <button id="google-btn" class="btn" type="button">
        Continue with Google Account
      </button>
      <button id="cancel-btn" class="btn btn-secondary" type="button">
        Cancel Sign In
      </button>
    </div>

    <div id="done-view" class="hidden">
      <p class="desc">
        <strong>Signed in!</strong> Click <em>Open Cadence</em> on the browser prompt if shown, or click the button below to jump back to the desktop app.
      </p>
      <a id="open-app-link" class="btn" href="cadence://auth?status=success">
        Open Cadence Desktop App
      </a>
    </div>

    <div id="status-box" class="status"></div>
  </div>

  <script src="https://www.gstatic.com/firebasejs/11.4.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/11.4.0/firebase-auth-compat.js"></script>
  <script>
    (function () {
      var CONFIG = __FIREBASE_CONFIG__;
      var STATE = "__CADENCE_STATE__";
      var BASE_URL = "http://localhost:__PORT__";

      var statusBox = document.getElementById("status-box");
      var googleBtn = document.getElementById("google-btn");
      var cancelBtn = document.getElementById("cancel-btn");
      var signinView = document.getElementById("signin-view");
      var doneView = document.getElementById("done-view");

      function showStatus(kind, msg) {
        statusBox.className = "status " + kind;
        statusBox.textContent = msg;
      }

      try {
        firebase.initializeApp(CONFIG);
      } catch (e) {
        showStatus("error", "Failed to initialize Firebase Auth: " + (e.message || e));
        return;
      }

      var auth = firebase.auth();
      auth.useDeviceLanguage();

      async function completeToDesktop(result) {
        var cred = null;
        try {
          cred = firebase.auth.GoogleAuthProvider.credentialFromResult(result);
        } catch (_) {}
        var fallbackCred = result && result.credential ? result.credential : null;
        var tokenResp = result && result._tokenResponse ? result._tokenResponse : null;
        var idToken =
          (cred && cred.idToken) ||
          (fallbackCred && fallbackCred.idToken) ||
          (tokenResp && tokenResp.oauthIdToken) ||
          "";
        var accessToken =
          (cred && cred.accessToken) ||
          (fallbackCred && fallbackCred.accessToken) ||
          (tokenResp && tokenResp.oauthAccessToken) ||
          null;

        if (!idToken) {
          throw new Error("Google OAuth did not return an ID token. Please try again.");
        }

        var user = result.user;
        var resp = await fetch(BASE_URL + "/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            state: STATE,
            idToken: idToken,
            accessToken: accessToken,
            email: user ? user.email : null,
            displayName: user ? user.displayName : null
          })
        });

        if (!resp.ok) {
          throw new Error("Desktop callback rejected response (" + resp.status + ")");
        }

        try { await auth.signOut(); } catch (_) {}

        signinView.classList.add("hidden");
        doneView.classList.remove("hidden");
        showStatus("success", "Authentication verified! Click Open Cadence to return to the desktop app.");

        setTimeout(function () {
          window.location.href = "cadence://auth?status=success";
        }, 120);
      }

      googleBtn.addEventListener("click", async function () {
        googleBtn.disabled = true;
        showStatus("info", "Waiting for Google sign-in...");
        try {
          var provider = new firebase.auth.GoogleAuthProvider();
          provider.setCustomParameters({ prompt: "select_account" });
          var result = await auth.signInWithPopup(provider);
          await completeToDesktop(result);
        } catch (err) {
          googleBtn.disabled = false;
          var msg = (err && err.message) ? err.message : String(err);
          showStatus("error", msg);
        }
      });

      cancelBtn.addEventListener("click", async function () {
        try {
          await fetch(BASE_URL + "/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: STATE, reason: "Sign-in cancelled in browser." })
          });
        } catch (_) {}
        showStatus("info", "Sign-in cancelled. You can close this browser tab.");
        window.close();
      });
    })();
  </script>
</body>
</html>"#;

    template
        .replace("__FIREBASE_CONFIG__", firebase_json)
        .replace("__CADENCE_STATE__", &safe_state)
        .replace("__PORT__", &port.to_string())
}

fn send_http_response(
    stream: &mut TcpStream,
    status_line: &str,
    content_type: &str,
    body: &str,
) {
    let response = format!(
        "HTTP/1.1 {status_line}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

enum ServerEvent {
    Completed(ExternalOAuthResult),
    AuthCode(String),
    Failed(String),
}

fn handle_http_connection(
    mut stream: TcpStream,
    port: u16,
    expected_state: &str,
    sender: &mpsc::Sender<ServerEvent>,
) -> bool {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut reader = BufReader::new(&stream);

    let mut request_line = String::new();
    if reader.read_line(&mut request_line).unwrap_or(0) == 0 {
        return false;
    }

    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("/");

    let mut content_length: usize = 0;
    loop {
        let mut header_line = String::new();
        let n = reader.read_line(&mut header_line).unwrap_or(0);
        if n == 0 || header_line == "\r\n" || header_line == "\n" {
            break;
        }
        let lower = header_line.to_ascii_lowercase();
        if let Some(val) = lower.strip_prefix("content-length:") {
            content_length = val.trim().parse::<usize>().unwrap_or(0).min(65536);
        }
    }

    let mut body_bytes = vec![0u8; content_length];
    if content_length > 0 && reader.read_exact(&mut body_bytes).is_err() {
        send_http_response(&mut stream, "400 Bad Request", "text/plain", "Bad body");
        return false;
    }
    let body_str = String::from_utf8_lossy(&body_bytes).to_string();

    if method == "OPTIONS" {
        send_http_response(&mut stream, "204 No Content", "text/plain", "");
        return false;
    }

    if method == "GET" && path.starts_with("/callback") {
        let params = parse_query_params(path);
        let state_ok = params
            .get("state")
            .map(|s| s == expected_state)
            .unwrap_or(false);
        if !state_ok {
            let html = build_callback_complete_html(Some("Invalid OAuth state parameter."));
            send_http_response(&mut stream, "400 Bad Request", "text/html; charset=utf-8", &html);
            return false;
        }
        if let Some(err) = params.get("error") {
            let msg = if err == "access_denied" {
                "Google sign-in was cancelled.".to_string()
            } else {
                format!("Google sign-in returned error: {err}")
            };
            let html = build_callback_complete_html(Some(&msg));
            send_http_response(&mut stream, "200 OK", "text/html; charset=utf-8", &html);
            let _ = sender.send(ServerEvent::Failed(msg));
            return true;
        }
        if let Some(code) = params.get("code").filter(|c| !c.trim().is_empty()) {
            let html = build_callback_complete_html(None);
            send_http_response(&mut stream, "200 OK", "text/html; charset=utf-8", &html);
            let _ = sender.send(ServerEvent::AuthCode(code.clone()));
            return true;
        }
        let html = build_callback_complete_html(Some("Authorization code missing in callback."));
        send_http_response(&mut stream, "400 Bad Request", "text/html; charset=utf-8", &html);
        return false;
    }

    if method == "GET" && path.starts_with("/auth") {
        let html = build_auth_bridge_html(port, expected_state, EMBEDDED_FIREBASE_CONFIG);
        send_http_response(&mut stream, "200 OK", "text/html; charset=utf-8", &html);
        return false;
    }

    if method == "POST" && path == "/complete" {
        match serde_json::from_str::<OAuthCallbackPayload>(&body_str) {
            Ok(payload) if payload.state == expected_state && !payload.id_token.trim().is_empty() => {
                send_http_response(&mut stream, "200 OK", "application/json", r#"{"ok":true}"#);
                let _ = sender.send(ServerEvent::Completed(ExternalOAuthResult {
                    id_token: payload.id_token,
                    access_token: payload.access_token,
                    email: payload.email,
                    display_name: payload.display_name,
                }));
                return true;
            }
            _ => {
                send_http_response(
                    &mut stream,
                    "400 Bad Request",
                    "application/json",
                    r#"{"ok":false,"error":"Invalid OAuth state or missing token"}"#,
                );
                return false;
            }
        }
    }

    if method == "POST" && path == "/cancel" {
        if let Ok(payload) = serde_json::from_str::<CancelPayload>(&body_str) {
            if payload.state == expected_state {
                send_http_response(&mut stream, "200 OK", "application/json", r#"{"ok":true}"#);
                let _ = sender.send(ServerEvent::Failed(
                    payload
                        .reason
                        .unwrap_or_else(|| "Google sign-in was cancelled.".to_string()),
                ));
                return true;
            }
        }
        send_http_response(&mut stream, "400 Bad Request", "text/plain", "Invalid state");
        return false;
    }

    send_http_response(&mut stream, "404 Not Found", "text/plain", "Not Found");
    false
}

#[allow(deprecated)]
fn open_external_url(app: &tauri::AppHandle, url: &str) -> Result<(), String> {
    app.shell()
        .open(url, None)
        .map_err(|e| format!("Could not open external browser: {e}"))
}

pub async fn start_external_google_login(
    app: tauri::AppHandle,
    flow_state: &OAuthFlowState,
) -> Result<ExternalOAuthResult, String> {
    let listener_v4 = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to start local OAuth callback server: {e}"))?;
    let port = listener_v4
        .local_addr()
        .map_err(|e| format!("Failed to read local OAuth port: {e}"))?
        .port();

    let _ = listener_v4.set_nonblocking(true);

    let listener_v6 = TcpListener::bind(format!("[::1]:{}", port)).ok();
    if let Some(ref l6) = listener_v6 {
        let _ = l6.set_nonblocking(true);
    }

    let expected_state = generate_state_token();
    let cancel_flag = Arc::new(AtomicBool::new(false));
    flow_state.register_active(Arc::clone(&cancel_flag));

    let (tx, rx) = mpsc::channel::<ServerEvent>();
    let state_for_v4 = expected_state.clone();
    let tx_v4 = tx.clone();
    let cancel_v4 = Arc::clone(&cancel_flag);

    thread::spawn(move || {
        while !cancel_v4.load(Ordering::SeqCst) {
            match listener_v4.accept() {
                Ok((stream, _)) => {
                    if handle_http_connection(stream, port, &state_for_v4, &tx_v4) {
                        break;
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(40));
                }
                Err(_) => break,
            }
        }
    });

    if let Some(l6) = listener_v6 {
        let state_for_v6 = expected_state.clone();
        let tx_v6 = tx.clone();
        let cancel_v6 = Arc::clone(&cancel_flag);
        thread::spawn(move || {
            while !cancel_v6.load(Ordering::SeqCst) {
                match l6.accept() {
                    Ok((stream, _)) => {
                        if handle_http_connection(stream, port, &state_for_v6, &tx_v6) {
                            break;
                        }
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(40));
                    }
                    Err(_) => break,
                }
            }
        });
    }

    let desktop_oauth = resolve_desktop_oauth_client();
    let redirect_uri = format!("http://127.0.0.1:{}/callback", port);
    let pkce_verifier = generate_pkce_verifier();

    let launch_url = if let Some(ref cfg) = desktop_oauth {
        let challenge = pkce_s256_challenge(&pkce_verifier);
        build_google_direct_auth_url(&cfg.client_id, &redirect_uri, &expected_state, &challenge)
    } else {
        format!("http://localhost:{}/auth?state={}", port, expected_state)
    };

    open_external_url(&app, &launch_url)?;

    let wait_flag = Arc::clone(&cancel_flag);
    let server_event = tauri::async_runtime::spawn_blocking(move || {
        let deadline = SystemTime::now() + Duration::from_secs(300);
        loop {
            if wait_flag.load(Ordering::SeqCst) {
                return Err("External browser sign-in was cancelled.".to_string());
            }
            match rx.recv_timeout(Duration::from_millis(120)) {
                Ok(ev) => return Ok(ev),
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if SystemTime::now() >= deadline {
                        return Err("Google sign-in timed out in external browser.".to_string());
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err("Local OAuth server stopped unexpectedly.".to_string());
                }
            }
        }
    })
    .await
    .map_err(|e| format!("OAuth task join failure: {e}"))?;

    cancel_flag.store(true, Ordering::SeqCst);
    flow_state.clear_active();

    let outcome = match server_event? {
        ServerEvent::Completed(res) => Ok(res),
        ServerEvent::Failed(msg) => Err(msg),
        ServerEvent::AuthCode(code) => {
            let cfg = desktop_oauth.ok_or_else(|| {
                "Received OAuth code without desktop OAuth configuration.".to_string()
            })?;
            exchange_google_auth_code(&code, &pkce_verifier, &redirect_uri, &cfg).await
        }
    };

    if let Ok(ref res) = outcome {
        let _ = app.emit("cadence://oauth-complete", res);
        let app_clone = app.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(2200));
            focus_main_window(&app_clone);
        });
    }

    outcome
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_unique_state_tokens() {
        let a = generate_state_token();
        let b = generate_state_token();
        assert_ne!(a, b);
        assert!(a.starts_with("cadence_"));
    }

    #[test]
    fn computes_rfc7636_pkce_s256_challenge_and_nist_sha256() {
        let digest = sha256_digest(b"abc");
        let hex: String = digest.iter().map(|b| format!("{:02x}", b)).collect();
        assert_eq!(
            hex,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );

        let challenge = pkce_s256_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn builds_direct_google_oauth_url_and_parses_callback_query() {
        let url = build_google_direct_auth_url(
            "123-desktop.apps.googleusercontent.com",
            "http://127.0.0.1:54321/callback",
            "state_xyz",
            "challenge_abc",
        );
        assert!(url.starts_with("https://accounts.google.com/o/oauth2/v2/auth?"));
        assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A54321%2Fcallback"));
        assert!(url.contains("code_challenge_method=S256"));

        let params = parse_query_params("/callback?code=4%2F0AfJoh%2Btest&state=state_xyz");
        assert_eq!(params.get("code").map(String::as_str), Some("4/0AfJoh+test"));
        assert_eq!(params.get("state").map(String::as_str), Some("state_xyz"));
    }

    #[test]
    fn builds_auth_bridge_page_and_callback_page_with_deep_link() {
        let html = build_auth_bridge_html(51234, "state_abc", EMBEDDED_FIREBASE_CONFIG);
        assert!(html.contains("http://localhost:51234"));
        assert!(html.contains("cadence://auth?status=success"));
        assert!(html.contains("silken-eye-377716"));

        let cb_ok = build_callback_complete_html(None);
        assert!(cb_ok.contains("cadence://auth?status=success"));
        let cb_err = build_callback_complete_html(Some("Denied <test>"));
        assert!(cb_err.contains("Denied &lt;test&gt;"));
    }
}
