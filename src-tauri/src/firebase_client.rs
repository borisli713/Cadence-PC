use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::models::{ApprovalStatus, ShiftStatus, UserRole};

const EMBEDDED_FIREBASE_CONFIG: &str = include_str!("../../firebase-applet-config.json");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FirebaseProjectConfig {
    pub api_key: String,
    pub auth_domain: String,
    pub project_id: String,
    pub storage_bucket: String,
    pub messaging_sender_id: String,
    pub app_id: String,
    #[serde(default)]
    pub firestore_database_id: String,
    #[serde(default)]
    pub o_auth_client_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IdentityToolkitSession {
    pub local_id: String,
    pub email: String,
    pub display_name: String,
    pub id_token: String,
    pub refresh_token: String,
    pub email_verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "value")]
pub enum FirestoreTypedValue {
    Null,
    Boolean(bool),
    Integer(i64),
    Double(f64),
    String(String),
    Array(Vec<FirestoreTypedValue>),
    Map(BTreeMap<String, FirestoreTypedValue>),
}

pub fn load_embedded_firebase_config() -> Result<FirebaseProjectConfig, String> {
    serde_json::from_str::<FirebaseProjectConfig>(EMBEDDED_FIREBASE_CONFIG)
        .map_err(|e| format!("Invalid firebase-applet-config.json: {e}"))
}

pub fn firestore_database_name(cfg: &FirebaseProjectConfig) -> String {
    let db = if cfg.firestore_database_id.trim().is_empty() {
        "(default)"
    } else {
        cfg.firestore_database_id.trim()
    };
    format!("projects/{}/databases/{}", cfg.project_id, db)
}

pub fn firestore_document_path(
    cfg: &FirebaseProjectConfig,
    collection: &str,
    doc_id: &str,
) -> String {
    format!(
        "{}/documents/{}/{}",
        firestore_database_name(cfg),
        collection,
        doc_id
    )
}

pub fn firestore_rest_url(cfg: &FirebaseProjectConfig, collection: &str, doc_id: Option<&str>) -> String {
    let base = format!(
        "https://firestore.googleapis.com/v1/{}/documents/{}",
        firestore_database_name(cfg),
        collection
    );
    match doc_id {
        Some(id) if !id.trim().is_empty() => format!("{base}/{}", id.trim()),
        _ => base,
    }
}

pub fn json_to_firestore_value(val: &Value) -> Value {
    match val {
        Value::Null => serde_json::json!({ "nullValue": null }),
        Value::Bool(b) => serde_json::json!({ "booleanValue": b }),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                serde_json::json!({ "integerValue": i.to_string() })
            } else {
                serde_json::json!({ "doubleValue": n.as_f64().unwrap_or(0.0) })
            }
        }
        Value::String(s) => serde_json::json!({ "stringValue": s }),
        Value::Array(items) => {
            let values: Vec<Value> = items.iter().map(json_to_firestore_value).collect();
            serde_json::json!({ "arrayValue": { "values": values } })
        }
        Value::Object(map) => {
            let mut fields = Map::new();
            for (k, v) in map {
                fields.insert(k.clone(), json_to_firestore_value(v));
            }
            serde_json::json!({ "mapValue": { "fields": fields } })
        }
    }
}

pub fn firestore_value_to_json(val: &Value) -> Value {
    let Some(obj) = val.as_object() else {
        return Value::Null;
    };
    if obj.contains_key("nullValue") {
        return Value::Null;
    }
    if let Some(b) = obj.get("booleanValue").and_then(|v| v.as_bool()) {
        return Value::Bool(b);
    }
    if let Some(i_str) = obj.get("integerValue").and_then(|v| v.as_str()) {
        if let Ok(i) = i_str.parse::<i64>() {
            return Value::Number(i.into());
        }
    }
    if let Some(d) = obj.get("doubleValue").and_then(|v| v.as_f64()) {
        if let Some(num) = serde_json::Number::from_f64(d) {
            return Value::Number(num);
        }
    }
    if let Some(s) = obj.get("stringValue").and_then(|v| v.as_str()) {
        return Value::String(s.to_string());
    }
    if let Some(ts) = obj.get("timestampValue").and_then(|v| v.as_str()) {
        return Value::String(ts.to_string());
    }
    if let Some(arr) = obj.get("arrayValue").and_then(|v| v.get("values")).and_then(|v| v.as_array()) {
        return Value::Array(arr.iter().map(firestore_value_to_json).collect());
    }
    if let Some(fields) = obj.get("mapValue").and_then(|v| v.get("fields")).and_then(|v| v.as_object()) {
        let mut out = Map::new();
        for (k, v) in fields {
            out.insert(k.clone(), firestore_value_to_json(v));
        }
        return Value::Object(out);
    }
    Value::Null
}

pub fn encode_firestore_fields(doc_json: &Map<String, Value>) -> Value {
    let mut fields = Map::new();
    for (k, v) in doc_json {
        fields.insert(k.clone(), json_to_firestore_value(v));
    }
    serde_json::json!({ "fields": fields })
}

pub fn decode_firestore_fields(doc_payload: &Value) -> Map<String, Value> {
    let mut out = Map::new();
    let Some(fields) = doc_payload.get("fields").and_then(|v| v.as_object()) else {
        return out;
    };
    for (k, v) in fields {
        out.insert(k.clone(), firestore_value_to_json(v));
    }
    out
}

pub fn parse_user_role_str(raw: &str) -> UserRole {
    if raw.eq_ignore_ascii_case("manager") {
        UserRole::Manager
    } else {
        UserRole::Staff
    }
}

pub fn parse_shift_status_str(raw: &str) -> ShiftStatus {
    match raw {
        "open" => ShiftStatus::Open,
        "completed" => ShiftStatus::Completed,
        "conflict" => ShiftStatus::Conflict,
        "pending_change" => ShiftStatus::PendingChange,
        _ => ShiftStatus::Scheduled,
    }
}

pub fn parse_approval_status_str(raw: &str) -> ApprovalStatus {
    match raw {
        "approved" => ApprovalStatus::Approved,
        "denied" => ApprovalStatus::Denied,
        _ => ApprovalStatus::Pending,
    }
}

pub struct FirebaseRestClient {
    config: FirebaseProjectConfig,
    http: reqwest::Client,
}

impl FirebaseRestClient {
    pub fn from_embedded_config() -> Result<Self, String> {
        let config = load_embedded_firebase_config()?;
        let http = reqwest::Client::builder()
            .user_agent("Cadence-Windows-Desktop/1.0")
            .build()
            .map_err(|e| format!("Failed to initialize Firebase HTTP client: {e}"))?;
        Ok(Self { config, http })
    }

    pub fn config(&self) -> &FirebaseProjectConfig {
        &self.config
    }

    pub async fn sign_in_with_password(
        &self,
        email: &str,
        password: &str,
    ) -> Result<IdentityToolkitSession, String> {
        let url = format!(
            "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={}",
            self.config.api_key
        );
        let resp = self
            .http
            .post(url)
            .json(&serde_json::json!({
                "email": email.trim(),
                "password": password,
                "returnSecureToken": true
            }))
            .send()
            .await
            .map_err(|e| format!("Network error during sign-in: {e}"))?;

        let status = resp.status();
        let body: Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse auth response: {e}"))?;

        if !status.is_success() {
            let err_msg = body["error"]["message"]
                .as_str()
                .unwrap_or("Authentication failed.");
            return Err(map_identity_toolkit_error(err_msg));
        }

        let local_id = body["localId"].as_str().unwrap_or_default().to_string();
        let id_token = body["idToken"].as_str().unwrap_or_default().to_string();
        let refresh_token = body["refreshToken"].as_str().unwrap_or_default().to_string();
        let display_name = body["displayName"].as_str().unwrap_or_default().to_string();
        let resolved_email = body["email"].as_str().unwrap_or(email.trim()).to_string();

        let verified = self
            .lookup_email_verified(&id_token)
            .await
            .unwrap_or(false);

        Ok(IdentityToolkitSession {
            local_id,
            email: resolved_email,
            display_name,
            id_token,
            refresh_token,
            email_verified: verified,
        })
    }

    pub async fn sign_in_with_google_id_token(
        &self,
        google_id_token: &str,
        request_uri: &str,
    ) -> Result<IdentityToolkitSession, String> {
        let url = format!(
            "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key={}",
            self.config.api_key
        );
        let post_body = format!("id_token={}&providerId=google.com", google_id_token);
        let resp = self
            .http
            .post(url)
            .json(&serde_json::json!({
                "postBody": post_body,
                "requestUri": request_uri,
                "returnIdpCredential": true,
                "returnSecureToken": true
            }))
            .send()
            .await
            .map_err(|e| format!("Network error during Google token exchange: {e}"))?;

        let status = resp.status();
        let body: Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse Google exchange response: {e}"))?;

        if !status.is_success() {
            let err_msg = body["error"]["message"]
                .as_str()
                .unwrap_or("Google authentication failed.");
            return Err(map_identity_toolkit_error(err_msg));
        }

        Ok(IdentityToolkitSession {
            local_id: body["localId"].as_str().unwrap_or_default().to_string(),
            email: body["email"].as_str().unwrap_or_default().to_string(),
            display_name: body["displayName"].as_str().unwrap_or_default().to_string(),
            id_token: body["idToken"].as_str().unwrap_or_default().to_string(),
            refresh_token: body["refreshToken"].as_str().unwrap_or_default().to_string(),
            email_verified: body["emailVerified"].as_bool().unwrap_or(true),
        })
    }

    pub async fn lookup_email_verified(&self, id_token: &str) -> Result<bool, String> {
        let url = format!(
            "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key={}",
            self.config.api_key
        );
        let resp = self
            .http
            .post(url)
            .json(&serde_json::json!({ "idToken": id_token }))
            .send()
            .await
            .map_err(|e| format!("Network error checking verification: {e}"))?;
        let body: Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse lookup response: {e}"))?;
        Ok(body["users"][0]["emailVerified"].as_bool().unwrap_or(false))
    }

    pub async fn get_document(
        &self,
        id_token: &str,
        collection: &str,
        doc_id: &str,
    ) -> Result<Option<Map<String, Value>>, String> {
        let url = firestore_rest_url(&self.config, collection, Some(doc_id));
        let resp = self
            .http
            .get(url)
            .bearer_auth(id_token)
            .send()
            .await
            .map_err(|e| format!("Firestore read error: {e}"))?;

        if resp.status().as_u16() == 404 {
            return Ok(None);
        }
        if !resp.status().is_success() {
            return Err(format!("Firestore GET failed with status {}", resp.status()));
        }

        let payload: Value = resp
            .json()
            .await
            .map_err(|e| format!("Invalid Firestore document JSON: {e}"))?;
        Ok(Some(decode_firestore_fields(&payload)))
    }
}

pub fn map_identity_toolkit_error(code: &str) -> String {
    let clean = code.split(':').next().unwrap_or(code).trim();
    match clean {
        "EMAIL_NOT_FOUND" | "INVALID_PASSWORD" | "INVALID_LOGIN_CREDENTIALS" => {
            "Invalid email or password.".to_string()
        }
        "EMAIL_EXISTS" => "An account already exists for that email address.".to_string(),
        "USER_DISABLED" => "This account has been disabled.".to_string(),
        "TOO_MANY_ATTEMPTS_TRY_LATER" => {
            "Too many attempts. Please wait a moment and try again.".to_string()
        }
        "INVALID_EMAIL" => "Enter a valid email address.".to_string(),
        _ => format!("Authentication error: {}", code),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_embedded_firebase_config() {
        let cfg = load_embedded_firebase_config().expect("firebase-applet-config.json should parse");
        assert_eq!(cfg.project_id, "silken-eye-377716");
        assert!(!cfg.firestore_database_id.is_empty());
        let path = firestore_document_path(&cfg, "shifts", "shift_1");
        assert!(path.starts_with("projects/silken-eye-377716/databases/"));
        assert!(path.ends_with("/documents/shifts/shift_1"));
    }

    #[test]
    fn roundtrips_json_to_firestore_fields_and_back() {
        let original = serde_json::json!({
            "id": "sh_1",
            "durationHours": 8.5,
            "breakMinutes": 30,
            "verified": true,
            "candidateUids": ["u1", "u2"],
            "nested": { "department": "Operations" }
        });
        let map = original.as_object().unwrap();
        let encoded = encode_firestore_fields(map);
        let decoded = decode_firestore_fields(&encoded);

        assert_eq!(decoded.get("id").and_then(|v| v.as_str()), Some("sh_1"));
        assert_eq!(decoded.get("breakMinutes").and_then(|v| v.as_i64()), Some(30));
        assert_eq!(decoded.get("verified").and_then(|v| v.as_bool()), Some(true));
        assert_eq!(decoded["candidateUids"][1].as_str(), Some("u2"));
        assert_eq!(decoded["nested"]["department"].as_str(), Some("Operations"));
    }

    #[test]
    fn maps_identity_toolkit_errors_cleanly() {
        assert_eq!(
            map_identity_toolkit_error("INVALID_LOGIN_CREDENTIALS"),
            "Invalid email or password."
        );
        assert_eq!(
            map_identity_toolkit_error("EMAIL_EXISTS"),
            "An account already exists for that email address."
        );
    }
}
