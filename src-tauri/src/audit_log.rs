use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::firebase_client::generate_firestore_id;

const AUDIT_LOG_FILENAME: &str = "cadence_audit_log.json";
const MAX_AUDIT_ENTRIES: usize = 1000;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuditCategory {
    ScheduleMutation,
    FairnessEngine,
    ManagerApproval,
    ShiftReport,
    RosterRole,
    SyncReconcile,
    OfflineReplay,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuditLogInput {
    pub category: AuditCategory,
    pub actor_uid: String,
    pub actor_name: String,
    pub action: String,
    pub target_collection: String,
    pub target_doc_id: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuditLogEntry {
    pub id: String,
    pub sequence: u64,
    pub timestamp_epoch_ms: u64,
    pub category: AuditCategory,
    pub actor_uid: String,
    pub actor_name: String,
    pub action: String,
    pub target_collection: String,
    pub target_doc_id: String,
    pub summary: String,
    pub prev_hash: String,
    pub entry_hash: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedAuditStore {
    #[serde(default)]
    next_sequence: u64,
    #[serde(default)]
    entries: Vec<AuditLogEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuditQueryResult {
    pub total_entries: usize,
    pub filtered_entries: Vec<AuditLogEntry>,
    pub chain_intact: bool,
}

#[derive(Default)]
pub struct AuditLogState {
    inner: Mutex<PersistedAuditStore>,
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn fnv1a_64_hex(input: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in input.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn compute_entry_hash(
    prev_hash: &str,
    sequence: u64,
    timestamp_epoch_ms: u64,
    actor_uid: &str,
    action: &str,
    target_collection: &str,
    target_doc_id: &str,
    summary: &str,
) -> String {
    let payload = format!(
        "{prev_hash}|{sequence}|{timestamp_epoch_ms}|{actor_uid}|{action}|{target_collection}|{target_doc_id}|{summary}"
    );
    fnv1a_64_hex(&payload)
}

fn audit_path_from_dir(dir: &Path) -> PathBuf {
    dir.join(AUDIT_LOG_FILENAME)
}

fn resolve_audit_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| audit_path_from_dir(&dir))
}

fn load_audit_from_path(path: &Path) -> PersistedAuditStore {
    let Ok(bytes) = fs::read(path) else {
        return PersistedAuditStore::default();
    };
    serde_json::from_slice::<PersistedAuditStore>(&bytes).unwrap_or_default()
}

fn save_audit_to_path(path: &Path, store: &PersistedAuditStore) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_vec_pretty(store) {
        let _ = fs::write(path, json);
    }
}

pub fn verify_hash_chain(entries: &[AuditLogEntry]) -> bool {
    let mut expected_prev = "0000000000000000".to_string();
    for (idx, entry) in entries.iter().enumerate() {
        if idx > 0 && entry.prev_hash != expected_prev {
            return false;
        }
        let recomputed = compute_entry_hash(
            &entry.prev_hash,
            entry.sequence,
            entry.timestamp_epoch_ms,
            &entry.actor_uid,
            &entry.action,
            &entry.target_collection,
            &entry.target_doc_id,
            &entry.summary,
        );
        if recomputed != entry.entry_hash {
            return false;
        }
        expected_prev = entry.entry_hash.clone();
    }
    true
}

pub fn render_audit_log_markdown(entries: &[AuditLogEntry], chain_intact: bool) -> String {
    let mut lines = vec![
        "# Cadence Desktop Audit Log".to_string(),
        String::new(),
        format!(
            "Entries: {} | Integrity Chain: {}",
            entries.len(),
            if chain_intact { "Verified" } else { "Tampered / Broken" }
        ),
        String::new(),
        "| Seq | Actor | Action | Target | Summary | Hash |".to_string(),
        "| ---: | --- | --- | --- | --- | --- |".to_string(),
    ];

    for entry in entries {
        lines.push(format!(
            "| {} | {} | {} | {}/{} | {} | `{}` |",
            entry.sequence,
            entry.actor_name.replace('|', "/"),
            entry.action.replace('|', "/"),
            entry.target_collection.replace('|', "/"),
            entry.target_doc_id.replace('|', "/"),
            entry.summary.replace('|', "/"),
            entry.entry_hash
        ));
    }

    lines.join("\n")
}

impl AuditLogState {
    fn hydrate_if_empty(&self, path: Option<&Path>) {
        let Some(p) = path else {
            return;
        };
        if let Ok(mut guard) = self.inner.lock() {
            if guard.entries.is_empty() && guard.next_sequence == 0 && p.exists() {
                *guard = load_audit_from_path(p);
            }
        }
    }

    pub fn append(
        &self,
        store_file: Option<&Path>,
        input: AuditLogInput,
    ) -> Result<AuditLogEntry, String> {
        if input.action.trim().is_empty() {
            return Err("Audit action cannot be empty.".to_string());
        }
        self.hydrate_if_empty(store_file);

        let Ok(mut guard) = self.inner.lock() else {
            return Err("Failed to acquire audit log lock.".to_string());
        };

        guard.next_sequence = guard.next_sequence.saturating_add(1);
        let sequence = guard.next_sequence;
        let prev_hash = guard
            .entries
            .last()
            .map(|e| e.entry_hash.clone())
            .unwrap_or_else(|| "0000000000000000".to_string());
        let timestamp_epoch_ms = now_epoch_ms();
        let actor_uid = input.actor_uid.trim().to_string();
        let actor_name: String = input.actor_name.trim().chars().take(80).collect();
        let action: String = input.action.trim().chars().take(80).collect();
        let target_collection = input.target_collection.trim().to_string();
        let target_doc_id = input.target_doc_id.trim().to_string();
        let summary: String = input.summary.trim().chars().take(320).collect();

        let entry_hash = compute_entry_hash(
            &prev_hash,
            sequence,
            timestamp_epoch_ms,
            &actor_uid,
            &action,
            &target_collection,
            &target_doc_id,
            &summary,
        );

        let entry = AuditLogEntry {
            id: generate_firestore_id("aud"),
            sequence,
            timestamp_epoch_ms,
            category: input.category,
            actor_uid,
            actor_name,
            action,
            target_collection,
            target_doc_id,
            summary,
            prev_hash,
            entry_hash,
        };

        guard.entries.push(entry.clone());
        if guard.entries.len() > MAX_AUDIT_ENTRIES {
            let excess = guard.entries.len() - MAX_AUDIT_ENTRIES;
            guard.entries.drain(0..excess);
        }

        if let Some(p) = store_file {
            save_audit_to_path(p, &guard);
        }
        Ok(entry)
    }

    pub fn query(
        &self,
        store_file: Option<&Path>,
        category: Option<AuditCategory>,
        search: &str,
        limit: usize,
    ) -> AuditQueryResult {
        self.hydrate_if_empty(store_file);
        let Ok(guard) = self.inner.lock() else {
            return AuditQueryResult {
                total_entries: 0,
                filtered_entries: Vec::new(),
                chain_intact: true,
            };
        };

        let chain_intact = verify_hash_chain(&guard.entries);
        let q = search.trim().to_lowercase();
        let effective_limit = limit.clamp(1, MAX_AUDIT_ENTRIES);

        let filtered_entries: Vec<AuditLogEntry> = guard
            .entries
            .iter()
            .rev()
            .filter(|e| category.map(|c| c == e.category).unwrap_or(true))
            .filter(|e| {
                q.is_empty()
                    || e.actor_name.to_lowercase().contains(&q)
                    || e.action.to_lowercase().contains(&q)
                    || e.summary.to_lowercase().contains(&q)
                    || e.target_collection.to_lowercase().contains(&q)
                    || e.target_doc_id.to_lowercase().contains(&q)
            })
            .take(effective_limit)
            .cloned()
            .collect();

        AuditQueryResult {
            total_entries: guard.entries.len(),
            filtered_entries,
            chain_intact,
        }
    }
}

#[tauri::command]
pub fn append_audit_event_cmd(
    app: AppHandle,
    audit: State<'_, AuditLogState>,
    input: AuditLogInput,
) -> Result<AuditLogEntry, String> {
    let path = resolve_audit_file(&app);
    audit.append(path.as_deref(), input)
}

#[tauri::command]
pub fn query_audit_log_cmd(
    app: AppHandle,
    audit: State<'_, AuditLogState>,
    category: Option<AuditCategory>,
    search: Option<String>,
    limit: Option<usize>,
) -> AuditQueryResult {
    let path = resolve_audit_file(&app);
    audit.query(
        path.as_deref(),
        category,
        search.as_deref().unwrap_or(""),
        limit.unwrap_or(100),
    )
}

#[tauri::command]
pub fn verify_audit_chain_cmd(app: AppHandle, audit: State<'_, AuditLogState>) -> bool {
    let path = resolve_audit_file(&app);
    audit.query(path.as_deref(), None, "", MAX_AUDIT_ENTRIES).chain_intact
}

#[tauri::command]
pub async fn export_audit_log_cmd(
    app: AppHandle,
    audit: State<'_, AuditLogState>,
    default_filename: Option<String>,
) -> Result<Option<String>, String> {
    let path = resolve_audit_file(&app);
    let result = audit.query(path.as_deref(), None, "", MAX_AUDIT_ENTRIES);
    let md = render_audit_log_markdown(&result.filtered_entries, result.chain_intact);
    let file_name = default_filename.unwrap_or_else(|| "cadence-audit-log.md".to_string());

    let selected = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md"])
        .set_file_name(&file_name)
        .blocking_save_file();

    match selected {
        Some(FilePath::Path(save_path)) => {
            fs::write(&save_path, md.as_bytes())
                .map_err(|e| format!("Failed to save audit log: {e}"))?;
            Ok(Some(save_path.to_string_lossy().to_string()))
        }
        Some(FilePath::Url(url)) => Ok(Some(url.to_string())),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_input(action: &str, doc_id: &str) -> AuditLogInput {
        AuditLogInput {
            category: AuditCategory::ManagerApproval,
            actor_uid: "mgr_1".to_string(),
            actor_name: "Alex Manager".to_string(),
            action: action.to_string(),
            target_collection: "scheduleChanges".to_string(),
            target_doc_id: doc_id.to_string(),
            summary: format!("{action} on {doc_id}"),
        }
    }

    #[test]
    fn maintains_hash_chain_and_detects_tampering() {
        let test_dir = std::env::temp_dir().join(format!("cadence_audit_test_{}", std::process::id()));
        let file = audit_path_from_dir(&test_dir);
        let _ = fs::remove_file(&file);

        let state = AuditLogState::default();
        let e1 = state
            .append(Some(&file), sample_input("Approve Shift Swap", "chg_1"))
            .unwrap();
        let e2 = state
            .append(Some(&file), sample_input("Accept All Pending", "chg_2"))
            .unwrap();
        assert_eq!(e1.sequence, 1);
        assert_eq!(e2.prev_hash, e1.entry_hash);

        let reloaded = AuditLogState::default();
        let query = reloaded.query(Some(&file), Some(AuditCategory::ManagerApproval), "Accept All", 50);
        assert!(query.chain_intact);
        assert_eq!(query.total_entries, 2);
        assert_eq!(query.filtered_entries.len(), 1);
        assert_eq!(query.filtered_entries[0].target_doc_id, "chg_2");

        let mut tampered = vec![e1, e2];
        tampered[0].summary = "Forged summary".to_string();
        assert!(!verify_hash_chain(&tampered));

        let _ = fs::remove_dir_all(&test_dir);
    }

    #[test]
    fn exports_markdown_summary_with_chain_status() {
        let state = AuditLogState::default();
        state
            .append(None, sample_input("Verify Report", "rep_9"))
            .unwrap();
        let res = state.query(None, None, "", 20);
        let md = render_audit_log_markdown(&res.filtered_entries, res.chain_intact);
        assert!(md.contains("Integrity Chain: Verified"));
        assert!(md.contains("shiftReports") || md.contains("Verify Report"));
    }
}
