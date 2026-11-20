use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tauri::Emitter;
use tauri_plugin_shell::ShellExt;

use crate::deep_link::focus_main_window;
use crate::models::ExternalOAuthResult;

const EMBEDDED_FIREBASE_CONFIG: &str = include_str!("../../firebase-applet-config.json");
static SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);

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

fn generate_state_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = SESSION_COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("cadence_{:x}_{:x}", nanos, seq)
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
        <p class="sub">External Browser Authentication</p>
      </div>
    </div>

    <div id="signin-view">
      <p class="desc">
        Sign in with your Google account in this browser. Once verified, you will be redirected straight back to the Cadence desktop app.
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

        // Trigger OS custom protocol prompt ("Open Cadence?") to bring user back to the app
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

    let auth_url = format!("http://localhost:{}/auth?state={}", port, expected_state);
    app.shell()
        .open(&auth_url, None)
        .map_err(|e| format!("Could not open external browser: {e}"))?;

    let wait_flag = Arc::clone(&cancel_flag);
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let deadline = SystemTime::now() + Duration::from_secs(300);
        loop {
            if wait_flag.load(Ordering::SeqCst) {
                return Err("External browser sign-in was cancelled.".to_string());
            }
            match rx.recv_timeout(Duration::from_millis(120)) {
                Ok(ServerEvent::Completed(res)) => return Ok(res),
                Ok(ServerEvent::Failed(msg)) => return Err(msg),
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
    fn builds_auth_bridge_page_with_deep_link_and_config() {
        let html = build_auth_bridge_html(51234, "state_abc", EMBEDDED_FIREBASE_CONFIG);
        assert!(html.contains("http://localhost:51234"));
        assert!(html.contains("cadence://auth?status=success"));
        assert!(html.contains("silken-eye-377716"));
    }
}
