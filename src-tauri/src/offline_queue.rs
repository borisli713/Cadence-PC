use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager, State};

use crate::firebase_client::{
    generate_firestore_id, FirebaseRestClient, FirestoreWriteOp, FIRESTORE_COMMIT_CHUNK_SIZE,
};
use crate::validation::is_valid_id;

const OFFLINE_QUEUE_FILENAME: &str = "cadence_offline_queue.json";
const MAX_QUEUED_MUTATIONS: usize = 500;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OfflineMutationKind {
    Set,
    UpdateMask,
    Delete,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OfflineMutationInput {
    pub kind: OfflineMutationKind,
    pub collection: String,
    pub doc_id: String,
    #[serde(default)]
    pub fields: Map<String, Value>,
    #[serde(default)]
    pub mask_paths: Vec<String>,
    #[serde(default)]
    pub server_timestamp_fields: Vec<String>,
    #[serde(default)]
    pub require_exists: bool,
    #[serde(default)]
    pub require_not_exists: bool,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueuedFirestoreMutation {
    pub mutation_id: String,
    pub kind: OfflineMutationKind,
    pub collection: String,
    pub doc_id: String,
    #[serde(default)]
    pub fields: Map<String, Value>,
    #[serde(default)]
    pub mask_paths: Vec<String>,
    #[serde(default)]
    pub server_timestamp_fields: Vec<String>,
    #[serde(default)]
    pub require_exists: bool,
    #[serde(default)]
    pub require_not_exists: bool,
    #[serde(default)]
    pub description: String,
    pub queued_at_epoch_ms: u64,
    pub retry_count: u32,
    #[serde(default)]
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OfflineQueueSummary {
    pub pending_count: usize,
    pub total_retries: u32,
    pub oldest_queued_epoch_ms: Option<u64>,
    pub items: Vec<QueuedFirestoreMutation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FlushOfflineQueueResult {
    pub flushed_count: usize,
    pub remaining_count: usize,
    pub batches_committed: usize,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedOfflineQueue {
    #[serde(default)]
    items: Vec<QueuedFirestoreMutation>,
}

#[derive(Default)]
pub struct OfflineQueueState {
    inner: Mutex<PersistedOfflineQueue>,
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn queue_path_from_dir(dir: &Path) -> PathBuf {
    dir.join(OFFLINE_QUEUE_FILENAME)
}

fn resolve_queue_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| queue_path_from_dir(&dir))
}

fn load_queue_from_path(path: &Path) -> PersistedOfflineQueue {
    let Ok(bytes) = fs::read(path) else {
        return PersistedOfflineQueue::default();
    };
    serde_json::from_slice::<PersistedOfflineQueue>(&bytes).unwrap_or_default()
}

fn save_queue_to_path(path: &Path, queue: &PersistedOfflineQueue) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_vec_pretty(queue) {
        let _ = fs::write(path, json);
    }
}

pub fn validate_offline_mutation(input: &OfflineMutationInput) -> Result<(), String> {
    let allowed_collections = [
        "users",
        "managers",
        "staffDirectory",
        "shifts",
        "scheduleChanges",
        "shiftReports",
        "shiftSubmissions",
        "timeOffRequests",
        "notifications",
    ];
    let clean_col = input.collection.trim();
    if !allowed_collections.contains(&clean_col) {
        return Err(format!(
            "Unsupported Firestore collection '{clean_col}' for offline sync queue."
        ));
    }
    if !is_valid_id(input.doc_id.trim()) {
        return Err("Invalid Firestore document ID for offline sync queue.".to_string());
    }
    if input.kind == OfflineMutationKind::UpdateMask && input.mask_paths.is_empty() {
        return Err("UpdateMask mutations require at least one field mask path.".to_string());
    }
    Ok(())
}

pub fn queued_mutation_to_write_op(item: &QueuedFirestoreMutation) -> FirestoreWriteOp {
    match item.kind {
        OfflineMutationKind::Set => FirestoreWriteOp::Set {
            collection: item.collection.clone(),
            doc_id: item.doc_id.clone(),
            fields: item.fields.clone(),
            server_timestamp_fields: item.server_timestamp_fields.clone(),
            require_not_exists: item.require_not_exists,
        },
        OfflineMutationKind::UpdateMask => FirestoreWriteOp::UpdateMask {
            collection: item.collection.clone(),
            doc_id: item.doc_id.clone(),
            fields: item.fields.clone(),
            mask_paths: item.mask_paths.clone(),
            server_timestamp_fields: item.server_timestamp_fields.clone(),
            require_exists: item.require_exists,
        },
        OfflineMutationKind::Delete => FirestoreWriteOp::Delete {
            collection: item.collection.clone(),
            doc_id: item.doc_id.clone(),
        },
    }
}

pub fn coalesce_mutation(
    queue: &mut Vec<QueuedFirestoreMutation>,
    incoming: QueuedFirestoreMutation,
) {
    if incoming.kind == OfflineMutationKind::Delete {
        queue.retain(|m| !(m.collection == incoming.collection && m.doc_id == incoming.doc_id));
        queue.push(incoming);
        return;
    }

    if incoming.kind == OfflineMutationKind::Set {
        if let Some(existing) = queue
            .iter_mut()
            .find(|m| m.collection == incoming.collection && m.doc_id == incoming.doc_id)
        {
            if existing.kind == OfflineMutationKind::Set {
                *existing = incoming;
                return;
            }
        }
    }

    if incoming.kind == OfflineMutationKind::UpdateMask {
        if let Some(existing) = queue.iter_mut().rev().find(|m| {
            m.collection == incoming.collection
                && m.doc_id == incoming.doc_id
                && m.kind == OfflineMutationKind::UpdateMask
        }) {
            for (k, v) in incoming.fields {
                existing.fields.insert(k, v);
            }
            for path in incoming.mask_paths {
                if !existing.mask_paths.contains(&path) {
                    existing.mask_paths.push(path);
                }
            }
            for ts in incoming.server_timestamp_fields {
                if !existing.server_timestamp_fields.contains(&ts) {
                    existing.server_timestamp_fields.push(ts);
                }
            }
            if !incoming.description.trim().is_empty() {
                existing.description = incoming.description;
            }
            existing.queued_at_epoch_ms = incoming.queued_at_epoch_ms;
            return;
        }
    }

    queue.push(incoming);
    if queue.len() > MAX_QUEUED_MUTATIONS {
        let excess = queue.len() - MAX_QUEUED_MUTATIONS;
        queue.drain(0..excess);
    }
}

impl OfflineQueueState {
    fn hydrate_from_disk_if_empty(&self, path: Option<&Path>) {
        let Some(p) = path else {
            return;
        };
        if let Ok(mut guard) = self.inner.lock() {
            if guard.items.is_empty() && p.exists() {
                *guard = load_queue_from_path(p);
            }
        }
    }

    pub fn enqueue(
        &self,
        store_file: Option<&Path>,
        input: OfflineMutationInput,
    ) -> Result<QueuedFirestoreMutation, String> {
        validate_offline_mutation(&input)?;
        self.hydrate_from_disk_if_empty(store_file);

        let entry = QueuedFirestoreMutation {
            mutation_id: generate_firestore_id("oq"),
            kind: input.kind,
            collection: input.collection.trim().to_string(),
            doc_id: input.doc_id.trim().to_string(),
            fields: input.fields,
            mask_paths: input.mask_paths,
            server_timestamp_fields: input.server_timestamp_fields,
            require_exists: input.require_exists,
            require_not_exists: input.require_not_exists,
            description: input.description.trim().chars().take(240).collect(),
            queued_at_epoch_ms: now_epoch_ms(),
            retry_count: 0,
            last_error: None,
        };

        let Ok(mut guard) = self.inner.lock() else {
            return Err("Failed to acquire offline queue lock.".to_string());
        };
        coalesce_mutation(&mut guard.items, entry.clone());
        if let Some(p) = store_file {
            save_queue_to_path(p, &guard);
        }
        Ok(entry)
    }

    pub fn summary(&self, store_file: Option<&Path>) -> OfflineQueueSummary {
        self.hydrate_from_disk_if_empty(store_file);
        let Ok(guard) = self.inner.lock() else {
            return OfflineQueueSummary {
                pending_count: 0,
                total_retries: 0,
                oldest_queued_epoch_ms: None,
                items: Vec::new(),
            };
        };
        let total_retries = guard.items.iter().map(|m| m.retry_count).sum();
        let oldest = guard.items.iter().map(|m| m.queued_at_epoch_ms).min();
        OfflineQueueSummary {
            pending_count: guard.items.len(),
            total_retries,
            oldest_queued_epoch_ms: oldest,
            items: guard.items.clone(),
        }
    }

    pub fn remove_mutation(&self, store_file: Option<&Path>, mutation_id: &str) -> bool {
        self.hydrate_from_disk_if_empty(store_file);
        let Ok(mut guard) = self.inner.lock() else {
            return false;
        };
        let before = guard.items.len();
        guard.items.retain(|m| m.mutation_id != mutation_id);
        let removed = guard.items.len() < before;
        if removed {
            if let Some(p) = store_file {
                save_queue_to_path(p, &guard);
            }
        }
        removed
    }

    pub fn snapshot_items(&self, store_file: Option<&Path>) -> Vec<QueuedFirestoreMutation> {
        self.hydrate_from_disk_if_empty(store_file);
        self.inner
            .lock()
            .map(|g| g.items.clone())
            .unwrap_or_default()
    }

    pub fn mark_chunk_flushed(&self, store_file: Option<&Path>, flushed_ids: &[String]) {
        if let Ok(mut guard) = self.inner.lock() {
            guard
                .items
                .retain(|m| !flushed_ids.iter().any(|id| id == &m.mutation_id));
            if let Some(p) = store_file {
                save_queue_to_path(p, &guard);
            }
        }
    }

    pub fn record_chunk_failure(
        &self,
        store_file: Option<&Path>,
        failed_ids: &[String],
        err_msg: &str,
    ) {
        if let Ok(mut guard) = self.inner.lock() {
            for item in &mut guard.items {
                if failed_ids.iter().any(|id| id == &item.mutation_id) {
                    item.retry_count = item.retry_count.saturating_add(1);
                    item.last_error = Some(err_msg.chars().take(240).collect());
                }
            }
            if let Some(p) = store_file {
                save_queue_to_path(p, &guard);
            }
        }
    }
}

#[tauri::command]
pub fn queue_offline_mutation_cmd(
    app: AppHandle,
    queue: State<'_, OfflineQueueState>,
    input: OfflineMutationInput,
) -> Result<QueuedFirestoreMutation, String> {
    let path = resolve_queue_file(&app);
    queue.enqueue(path.as_deref(), input)
}

#[tauri::command]
pub fn list_offline_mutations_cmd(
    app: AppHandle,
    queue: State<'_, OfflineQueueState>,
) -> OfflineQueueSummary {
    let path = resolve_queue_file(&app);
    queue.summary(path.as_deref())
}

#[tauri::command]
pub fn clear_offline_mutation_cmd(
    app: AppHandle,
    queue: State<'_, OfflineQueueState>,
    mutation_id: String,
) -> bool {
    let path = resolve_queue_file(&app);
    queue.remove_mutation(path.as_deref(), &mutation_id)
}

#[tauri::command]
pub async fn flush_offline_mutations_cmd(
    app: AppHandle,
    queue: State<'_, OfflineQueueState>,
    id_token: String,
) -> Result<FlushOfflineQueueResult, String> {
    if id_token.trim().is_empty() {
        return Err("Sign in to replay queued changes to Firebase.".to_string());
    }
    let path = resolve_queue_file(&app);
    let pending = queue.snapshot_items(path.as_deref());
    if pending.is_empty() {
        return Ok(FlushOfflineQueueResult {
            flushed_count: 0,
            remaining_count: 0,
            batches_committed: 0,
            last_error: None,
        });
    }

    let client = FirebaseRestClient::from_embedded_config()?;
    let mut flushed_count = 0usize;
    let mut batches_committed = 0usize;
    let mut last_error: Option<String> = None;

    for chunk in pending.chunks(FIRESTORE_COMMIT_CHUNK_SIZE) {
        let ops: Vec<FirestoreWriteOp> = chunk.iter().map(queued_mutation_to_write_op).collect();
        let ids: Vec<String> = chunk.iter().map(|m| m.mutation_id.clone()).collect();
        match client
            .commit_writes(&id_token, &ops, "offlineQueue/replay")
            .await
        {
            Ok(summary) => {
                queue.mark_chunk_flushed(path.as_deref(), &ids);
                flushed_count += chunk.len();
                batches_committed += summary.batches_committed;
            }
            Err(err) => {
                queue.record_chunk_failure(path.as_deref(), &ids, &err);
                last_error = Some(err);
                break;
            }
        }
    }

    let remaining_count = queue.summary(path.as_deref()).pending_count;
    Ok(FlushOfflineQueueResult {
        flushed_count,
        remaining_count,
        batches_committed,
        last_error,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::firebase_client::{build_commit_request_body, load_embedded_firebase_config};

    fn make_update_input(doc_id: &str, path: &str, val: Value) -> OfflineMutationInput {
        let mut fields = Map::new();
        fields.insert(path.to_string(), val);
        OfflineMutationInput {
            kind: OfflineMutationKind::UpdateMask,
            collection: "shifts".to_string(),
            doc_id: doc_id.to_string(),
            fields,
            mask_paths: vec![path.to_string()],
            server_timestamp_fields: vec!["updatedAt".to_string()],
            require_exists: true,
            require_not_exists: false,
            description: format!("Update {path} on {doc_id}"),
        }
    }

    #[test]
    fn validates_collections_and_ids() {
        let mut bad_col = make_update_input("sh_1", "status", Value::String("open".to_string()));
        bad_col.collection = "unknownCollection".to_string();
        assert!(validate_offline_mutation(&bad_col).is_err());

        let mut bad_id = make_update_input("sh/1", "status", Value::String("open".to_string()));
        bad_id.doc_id = "bad/doc/id".to_string();
        assert!(validate_offline_mutation(&bad_id).is_err());

        let ok = make_update_input("sh_1", "status", Value::String("open".to_string()));
        assert!(validate_offline_mutation(&ok).is_ok());
    }

    #[test]
    fn coalesces_updates_and_persists_to_disk() {
        let test_dir = std::env::temp_dir().join(format!(
            "cadence_offline_queue_test_{}",
            std::process::id()
        ));
        let queue_file = queue_path_from_dir(&test_dir);
        let _ = fs::remove_file(&queue_file);

        let state = OfflineQueueState::default();
        state
            .enqueue(
                Some(&queue_file),
                make_update_input("sh_42", "status", Value::String("scheduled".to_string())),
            )
            .expect("first update queues");
        state
            .enqueue(
                Some(&queue_file),
                make_update_input("sh_42", "assignedUid", Value::String("u_maya".to_string())),
            )
            .expect("second update coalesces");

        let reloaded = OfflineQueueState::default();
        let summary = reloaded.summary(Some(&queue_file));
        assert_eq!(summary.pending_count, 1);
        assert_eq!(summary.items[0].mask_paths.len(), 2);
        assert_eq!(
            summary.items[0].fields.get("assignedUid").and_then(|v| v.as_str()),
            Some("u_maya")
        );

        let cfg = load_embedded_firebase_config().expect("firebase config valid");
        let write_op = queued_mutation_to_write_op(&summary.items[0]);
        let commit_json = build_commit_request_body(&cfg, &[write_op]);
        assert_eq!(commit_json["writes"].as_array().map(|a| a.len()), Some(1));

        let id = summary.items[0].mutation_id.clone();
        reloaded.record_chunk_failure(Some(&queue_file), std::slice::from_ref(&id), "offline");
        assert_eq!(reloaded.summary(Some(&queue_file)).total_retries, 1);
        reloaded.mark_chunk_flushed(Some(&queue_file), std::slice::from_ref(&id));
        assert_eq!(reloaded.summary(Some(&queue_file)).pending_count, 0);

        let _ = fs::remove_dir_all(&test_dir);
    }

    #[test]
    fn delete_mutation_supersedes_prior_queued_writes_on_same_doc() {
        let state = OfflineQueueState::default();
        state
            .enqueue(
                None,
                make_update_input("sh_del", "status", Value::String("scheduled".to_string())),
            )
            .unwrap();
        state
            .enqueue(
                None,
                OfflineMutationInput {
                    kind: OfflineMutationKind::Delete,
                    collection: "shifts".to_string(),
                    doc_id: "sh_del".to_string(),
                    fields: Map::new(),
                    mask_paths: vec![],
                    server_timestamp_fields: vec![],
                    require_exists: false,
                    require_not_exists: false,
                    description: "Delete shift".to_string(),
                },
            )
            .unwrap();

        let summary = state.summary(None);
        assert_eq!(summary.pending_count, 1);
        assert_eq!(summary.items[0].kind, OfflineMutationKind::Delete);
    }
}
