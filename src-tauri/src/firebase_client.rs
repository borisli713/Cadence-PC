use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::models::{ApprovalStatus, ShiftStatus, UserRole};

const EMBEDDED_FIREBASE_CONFIG: &str = include_str!("../../firebase-applet-config.json");
pub const FIRESTORE_COMMIT_CHUNK_SIZE: usize = 400;
static ID_COUNTER: AtomicU64 = AtomicU64::new(1);

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RefreshedIdToken {
    pub id_token: String,
    pub refresh_token: String,
    pub user_id: String,
    pub expires_in_seconds: u64,
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

#[derive(Debug, Clone, PartialEq)]
pub enum FirestoreWriteOp {
    Set {
        collection: String,
        doc_id: String,
        fields: Map<String, Value>,
        server_timestamp_fields: Vec<String>,
        require_not_exists: bool,
    },
    UpdateMask {
        collection: String,
        doc_id: String,
        fields: Map<String, Value>,
        mask_paths: Vec<String>,
        server_timestamp_fields: Vec<String>,
        require_exists: bool,
    },
    Delete {
        collection: String,
        doc_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub batches_committed: usize,
    pub total_writes: usize,
}

pub fn generate_firestore_id(prefix: &str) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let seq = ID_COUNTER.fetch_add(1, Ordering::SeqCst);
    let pid = std::process::id();
    format!("{prefix}_{millis:x}{pid:x}{seq:04x}")
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

pub fn firestore_rest_url(
    cfg: &FirebaseProjectConfig,
    collection: &str,
    doc_id: Option<&str>,
) -> String {
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

pub fn firestore_commit_url(cfg: &FirebaseProjectConfig) -> String {
    format!(
        "https://firestore.googleapis.com/v1/{}/documents:commit",
        firestore_database_name(cfg)
    )
}

pub fn firestore_run_query_url(cfg: &FirebaseProjectConfig) -> String {
    format!(
        "https://firestore.googleapis.com/v1/{}/documents:runQuery",
        firestore_database_name(cfg)
    )
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
    if let Some(arr) = obj.get("arrayValue") {
        if let Some(values) = arr.get("values").and_then(|v| v.as_array()) {
            return Value::Array(values.iter().map(firestore_value_to_json).collect());
        }
        return Value::Array(Vec::new());
    }
    if let Some(fields) = obj
        .get("mapValue")
        .and_then(|v| v.get("fields"))
        .and_then(|v| v.as_object())
    {
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

pub fn extract_doc_id_from_name(doc_name: &str) -> String {
    doc_name
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_string()
}

pub fn write_op_to_commit_json(cfg: &FirebaseProjectConfig, op: &FirestoreWriteOp) -> Value {
    match op {
        FirestoreWriteOp::Set {
            collection,
            doc_id,
            fields,
            server_timestamp_fields,
            require_not_exists,
        } => {
            let doc_name = firestore_document_path(cfg, collection, doc_id);
            let mut encoded_fields = Map::new();
            for (k, v) in fields {
                encoded_fields.insert(k.clone(), json_to_firestore_value(v));
            }
            let mut write_obj = Map::new();
            write_obj.insert(
                "update".to_string(),
                serde_json::json!({
                    "name": doc_name,
                    "fields": encoded_fields,
                }),
            );
            if !server_timestamp_fields.is_empty() {
                let transforms: Vec<Value> = server_timestamp_fields
                    .iter()
                    .map(|field| {
                        serde_json::json!({
                            "fieldPath": field,
                            "setToServerValue": "REQUEST_TIME",
                        })
                    })
                    .collect();
                write_obj.insert("updateTransforms".to_string(), Value::Array(transforms));
            }
            if *require_not_exists {
                write_obj.insert(
                    "currentDocument".to_string(),
                    serde_json::json!({ "exists": false }),
                );
            }
            Value::Object(write_obj)
        }
        FirestoreWriteOp::UpdateMask {
            collection,
            doc_id,
            fields,
            mask_paths,
            server_timestamp_fields,
            require_exists,
        } => {
            let doc_name = firestore_document_path(cfg, collection, doc_id);
            let mut encoded_fields = Map::new();
            for (k, v) in fields {
                encoded_fields.insert(k.clone(), json_to_firestore_value(v));
            }
            let mut write_obj = Map::new();
            write_obj.insert(
                "update".to_string(),
                serde_json::json!({
                    "name": doc_name,
                    "fields": encoded_fields,
                }),
            );
            write_obj.insert(
                "updateMask".to_string(),
                serde_json::json!({ "fieldPaths": mask_paths }),
            );
            if !server_timestamp_fields.is_empty() {
                let transforms: Vec<Value> = server_timestamp_fields
                    .iter()
                    .map(|field| {
                        serde_json::json!({
                            "fieldPath": field,
                            "setToServerValue": "REQUEST_TIME",
                        })
                    })
                    .collect();
                write_obj.insert("updateTransforms".to_string(), Value::Array(transforms));
            }
            if *require_exists {
                write_obj.insert(
                    "currentDocument".to_string(),
                    serde_json::json!({ "exists": true }),
                );
            }
            Value::Object(write_obj)
        }
        FirestoreWriteOp::Delete { collection, doc_id } => {
            let doc_name = firestore_document_path(cfg, collection, doc_id);
            serde_json::json!({ "delete": doc_name })
        }
    }
}

pub fn build_commit_request_body(cfg: &FirebaseProjectConfig, writes: &[FirestoreWriteOp]) -> Value {
    let encoded: Vec<Value> = writes
        .iter()
        .map(|op| write_op_to_commit_json(cfg, op))
        .collect();
    serde_json::json!({ "writes": encoded })
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

pub fn map_firestore_rest_error(status: u16, body: &Value, context_path: &str) -> String {
    let raw_msg = body["error"]["message"]
        .as_str()
        .or_else(|| body.as_array().and_then(|arr| arr.first()).and_then(|v| v["error"]["message"].as_str()))
        .unwrap_or("Unexpected Firestore database error.");
    let raw_status = body["error"]["status"].as_str().unwrap_or("");
    if status == 403 || raw_status == "PERMISSION_DENIED" {
        return format!(
            "Permission denied on {context_path}. Ensure your email is verified and your account has permission ({raw_msg})."
        );
    }
    if status == 401 || raw_status == "UNAUTHENTICATED" {
        return "Session expired. Please sign in again to continue syncing.".to_string();
    }
    if status == 429 || raw_status == "RESOURCE_EXHAUSTED" {
        return format!("Firestore quota or rate limit reached: {raw_msg}");
    }
    format!("Firestore error ({status}) on {context_path}: {raw_msg}")
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

    pub async fn refresh_id_token(&self, refresh_token: &str) -> Result<RefreshedIdToken, String> {
        let url = format!(
            "https://securetoken.googleapis.com/v1/token?key={}",
            self.config.api_key
        );
        let resp = self
            .http
            .post(url)
            .form(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token.trim()),
            ])
            .send()
            .await
            .map_err(|e| format!("Network error refreshing Firebase token: {e}"))?;

        let status = resp.status();
        let body: Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse token refresh response: {e}"))?;

        if !status.is_success() {
            let msg = body["error"]["message"]
                .as_str()
                .unwrap_or("Failed to refresh Firebase session.");
            return Err(map_identity_toolkit_error(msg));
        }

        let expires = body["expires_in"]
            .as_str()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(3600);

        Ok(RefreshedIdToken {
            id_token: body["id_token"].as_str().unwrap_or_default().to_string(),
            refresh_token: body["refresh_token"]
                .as_str()
                .unwrap_or(refresh_token)
                .to_string(),
            user_id: body["user_id"].as_str().unwrap_or_default().to_string(),
            expires_in_seconds: expires,
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

        let status = resp.status();
        if status.as_u16() == 404 {
            return Ok(None);
        }
        let payload: Value = resp
            .json()
            .await
            .map_err(|e| format!("Invalid Firestore document JSON: {e}"))?;
        if !status.is_success() {
            return Err(map_firestore_rest_error(
                status.as_u16(),
                &payload,
                &format!("{collection}/{doc_id}"),
            ));
        }

        Ok(Some(decode_firestore_fields(&payload)))
    }

    pub async fn list_collection(
        &self,
        id_token: &str,
        collection: &str,
        page_size: u32,
    ) -> Result<Vec<(String, Map<String, Value>)>, String> {
        let base_url = firestore_rest_url(&self.config, collection, None);
        let clamped = page_size.clamp(1, 500);
        let mut results = Vec::new();
        let mut page_token: Option<String> = None;

        loop {
            let mut req = self
                .http
                .get(&base_url)
                .bearer_auth(id_token)
                .query(&[("pageSize", clamped.to_string())]);
            if let Some(ref token) = page_token {
                req = req.query(&[("pageToken", token.as_str())]);
            }
            let resp = req
                .send()
                .await
                .map_err(|e| format!("Firestore list error on {collection}: {e}"))?;
            let status = resp.status();
            let payload: Value = resp
                .json()
                .await
                .map_err(|e| format!("Invalid Firestore list JSON on {collection}: {e}"))?;
            if !status.is_success() {
                return Err(map_firestore_rest_error(
                    status.as_u16(),
                    &payload,
                    collection,
                ));
            }
            if let Some(docs) = payload.get("documents").and_then(|v| v.as_array()) {
                for doc in docs {
                    let doc_id = doc["name"]
                        .as_str()
                        .map(extract_doc_id_from_name)
                        .unwrap_or_default();
                    if !doc_id.is_empty() {
                        results.push((doc_id, decode_firestore_fields(doc)));
                    }
                }
            }
            match payload.get("nextPageToken").and_then(|v| v.as_str()) {
                Some(tok) if !tok.is_empty() => page_token = Some(tok.to_string()),
                _ => break,
            }
        }

        Ok(results)
    }

    pub async fn run_query(
        &self,
        id_token: &str,
        collection: &str,
        equality_filters: &[(&str, Value)],
    ) -> Result<Vec<(String, Map<String, Value>)>, String> {
        let url = firestore_run_query_url(&self.config);
        let structured_query = if equality_filters.is_empty() {
            serde_json::json!({
                "from": [{ "collectionId": collection }]
            })
        } else if equality_filters.len() == 1 {
            let (field, val) = &equality_filters[0];
            serde_json::json!({
                "from": [{ "collectionId": collection }],
                "where": {
                    "fieldFilter": {
                        "field": { "fieldPath": field },
                        "op": "EQUAL",
                        "value": json_to_firestore_value(val),
                    }
                }
            })
        } else {
            let filters: Vec<Value> = equality_filters
                .iter()
                .map(|(field, val)| {
                    serde_json::json!({
                        "fieldFilter": {
                            "field": { "fieldPath": field },
                            "op": "EQUAL",
                            "value": json_to_firestore_value(val),
                        }
                    })
                })
                .collect();
            serde_json::json!({
                "from": [{ "collectionId": collection }],
                "where": {
                    "compositeFilter": {
                        "op": "AND",
                        "filters": filters,
                    }
                }
            })
        };

        let resp = self
            .http
            .post(url)
            .bearer_auth(id_token)
            .json(&serde_json::json!({ "structuredQuery": structured_query }))
            .send()
            .await
            .map_err(|e| format!("Firestore query error on {collection}: {e}"))?;

        let status = resp.status();
        let payload: Value = resp
            .json()
            .await
            .map_err(|e| format!("Invalid Firestore query JSON on {collection}: {e}"))?;
        if !status.is_success() {
            return Err(map_firestore_rest_error(
                status.as_u16(),
                &payload,
                collection,
            ));
        }

        let mut out = Vec::new();
        if let Some(items) = payload.as_array() {
            for item in items {
                if let Some(doc) = item.get("document") {
                    let id = doc["name"]
                        .as_str()
                        .map(extract_doc_id_from_name)
                        .unwrap_or_default();
                    if !id.is_empty() {
                        out.push((id, decode_firestore_fields(doc)));
                    }
                }
            }
        }
        Ok(out)
    }

    pub async fn commit_writes(
        &self,
        id_token: &str,
        writes: &[FirestoreWriteOp],
        context_path: &str,
    ) -> Result<CommitSummary, String> {
        if writes.is_empty() {
            return Ok(CommitSummary {
                batches_committed: 0,
                total_writes: 0,
            });
        }
        if id_token.trim().is_empty() {
            return Err("User must be signed in before accessing Firestore.".to_string());
        }

        let url = firestore_commit_url(&self.config);
        let mut batches_committed = 0usize;

        for chunk in writes.chunks(FIRESTORE_COMMIT_CHUNK_SIZE) {
            let body = build_commit_request_body(&self.config, chunk);
            let resp = self
                .http
                .post(&url)
                .bearer_auth(id_token.trim())
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Firestore commit network error on {context_path}: {e}"))?;

            let status = resp.status();
            let payload: Value = resp
                .json()
                .await
                .map_err(|e| format!("Invalid Firestore commit response on {context_path}: {e}"))?;
            if !status.is_success() {
                return Err(map_firestore_rest_error(
                    status.as_u16(),
                    &payload,
                    context_path,
                ));
            }
            batches_committed += 1;
        }

        Ok(CommitSummary {
            batches_committed,
            total_writes: writes.len(),
        })
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
    fn loads_embedded_firebase_config_for_shared_database() {
        let cfg = load_embedded_firebase_config().expect("firebase-applet-config.json should parse");
        assert_eq!(cfg.project_id, "silken-eye-377716");
        assert_eq!(
            cfg.firestore_database_id,
            "ai-studio-2204fa2b-edd1-4012-9dfd-e10210864d68"
        );
        let path = firestore_document_path(&cfg, "shifts", "shift_1");
        assert_eq!(
            path,
            "projects/silken-eye-377716/databases/ai-studio-2204fa2b-edd1-4012-9dfd-e10210864d68/documents/shifts/shift_1"
        );
        assert!(firestore_commit_url(&cfg).ends_with("/documents:commit"));
    }

    #[test]
    fn roundtrips_json_to_firestore_fields_and_back() {
        let original = serde_json::json!({
            "id": "sh_1",
            "durationHours": 8.5,
            "breakMinutes": 30,
            "verified": true,
            "candidateUids": ["u1", "u2"],
            "emptyList": [],
            "nested": { "department": "Operations" }
        });
        let map = original.as_object().unwrap();
        let encoded = encode_firestore_fields(map);
        let decoded = decode_firestore_fields(&encoded);

        assert_eq!(decoded.get("id").and_then(|v| v.as_str()), Some("sh_1"));
        assert_eq!(decoded.get("breakMinutes").and_then(|v| v.as_i64()), Some(30));
        assert_eq!(decoded.get("verified").and_then(|v| v.as_bool()), Some(true));
        assert_eq!(decoded["candidateUids"][1].as_str(), Some("u2"));
        assert_eq!(decoded["emptyList"].as_array().map(|a| a.len()), Some(0));
        assert_eq!(decoded["nested"]["department"].as_str(), Some("Operations"));
    }

    #[test]
    fn builds_commit_json_for_set_update_mask_and_delete() {
        let cfg = load_embedded_firebase_config().unwrap();
        let mut set_fields = Map::new();
        set_fields.insert("id".to_string(), Value::String("sh_1".to_string()));
        set_fields.insert("durationHours".to_string(), serde_json::json!(8.0));

        let mut upd_fields = Map::new();
        upd_fields.insert("status".to_string(), Value::String("scheduled".to_string()));

        let writes = vec![
            FirestoreWriteOp::Set {
                collection: "shifts".to_string(),
                doc_id: "sh_1".to_string(),
                fields: set_fields,
                server_timestamp_fields: vec!["createdAt".to_string(), "updatedAt".to_string()],
                require_not_exists: false,
            },
            FirestoreWriteOp::UpdateMask {
                collection: "shifts".to_string(),
                doc_id: "sh_1".to_string(),
                fields: upd_fields,
                mask_paths: vec!["status".to_string()],
                server_timestamp_fields: vec!["updatedAt".to_string()],
                require_exists: true,
            },
            FirestoreWriteOp::Delete {
                collection: "managers".to_string(),
                doc_id: "u_old".to_string(),
            },
        ];

        let payload = build_commit_request_body(&cfg, &writes);
        let arr = payload["writes"].as_array().unwrap();
        assert_eq!(arr.len(), 3);
        assert_eq!(
            arr[0]["updateTransforms"][0]["setToServerValue"].as_str(),
            Some("REQUEST_TIME")
        );
        assert_eq!(arr[1]["updateMask"]["fieldPaths"][0].as_str(), Some("status"));
        assert_eq!(arr[1]["currentDocument"]["exists"].as_bool(), Some(true));
        assert!(arr[2]["delete"].as_str().unwrap().ends_with("/documents/managers/u_old"));
    }

    #[test]
    fn maps_identity_toolkit_and_firestore_errors_cleanly() {
        assert_eq!(
            map_identity_toolkit_error("INVALID_LOGIN_CREDENTIALS"),
            "Invalid email or password."
        );
        assert_eq!(
            map_identity_toolkit_error("EMAIL_EXISTS"),
            "An account already exists for that email address."
        );
        let perm = map_firestore_rest_error(
            403,
            &serde_json::json!({ "error": { "status": "PERMISSION_DENIED", "message": "Missing permissions" } }),
            "shifts/sh_1",
        );
        assert!(perm.contains("Permission denied on shifts/sh_1"));
    }

    #[test]
    fn generates_firestore_rule_compliant_ids() {
        let id_a = generate_firestore_id("shift");
        let id_b = generate_firestore_id("shift");
        assert_ne!(id_a, id_b);
        assert!(id_a.starts_with("shift_"));
        assert!(id_a.len() <= 128);
        assert!(id_a.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'));
    }
}
