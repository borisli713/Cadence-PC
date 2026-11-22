use std::fs;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::firebase_client::load_embedded_firebase_config;
use crate::workspace_cache::{WorkspaceCacheState, WorkspaceSnapshot};

pub const BACKUP_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBackupEnvelope {
    pub schema_version: u32,
    pub exported_at_iso: String,
    pub app_version: String,
    pub project_id: String,
    pub firestore_database_id: String,
    pub total_records: usize,
    pub checksum_hex: String,
    pub snapshot: WorkspaceSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupValidationReport {
    pub valid: bool,
    pub schema_version: u32,
    pub matches_shared_firebase: bool,
    pub checksum_valid: bool,
    pub total_records: usize,
    pub message: String,
}

fn count_snapshot_records(snapshot: &WorkspaceSnapshot) -> usize {
    snapshot.staff_directory.len()
        + snapshot.shifts.len()
        + snapshot.schedule_changes.len()
        + snapshot.shift_reports.len()
        + snapshot.shift_submissions.len()
        + snapshot.time_off_requests.len()
        + snapshot.notifications.len()
}

pub fn compute_snapshot_checksum(snapshot: &WorkspaceSnapshot) -> String {
    let serialized = serde_json::to_string(snapshot).unwrap_or_default();
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in serialized.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

pub fn build_backup_envelope(snapshot: WorkspaceSnapshot) -> Result<WorkspaceBackupEnvelope, String> {
    let cfg = load_embedded_firebase_config()?;
    let total_records = count_snapshot_records(&snapshot);
    let checksum_hex = compute_snapshot_checksum(&snapshot);
    Ok(WorkspaceBackupEnvelope {
        schema_version: BACKUP_SCHEMA_VERSION,
        exported_at_iso: Utc::now().to_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        project_id: cfg.project_id,
        firestore_database_id: cfg.firestore_database_id,
        total_records,
        checksum_hex,
        snapshot,
    })
}

pub fn validate_workspace_backup_json(raw_json: &str) -> BackupValidationReport {
    let parsed: WorkspaceBackupEnvelope = match serde_json::from_str(raw_json) {
        Ok(v) => v,
        Err(err) => {
            return BackupValidationReport {
                valid: false,
                schema_version: 0,
                matches_shared_firebase: false,
                checksum_valid: false,
                total_records: 0,
                message: format!("Malformed backup JSON: {err}"),
            };
        }
    };

    let expected_checksum = compute_snapshot_checksum(&parsed.snapshot);
    let checksum_valid = expected_checksum == parsed.checksum_hex;
    let matches_shared_firebase = parsed.project_id == "silken-eye-377716"
        && parsed.firestore_database_id == "ai-studio-2204fa2b-edd1-4012-9dfd-e10210864d68";
    let total_records = count_snapshot_records(&parsed.snapshot);
    let schema_ok = parsed.schema_version == BACKUP_SCHEMA_VERSION;
    let valid = schema_ok && checksum_valid && matches_shared_firebase;

    let message = if !schema_ok {
        format!("Unsupported backup schema version {}", parsed.schema_version)
    } else if !checksum_valid {
        "Backup checksum mismatch; file may have been modified.".to_string()
    } else if !matches_shared_firebase {
        "Backup belongs to a different Firebase database target.".to_string()
    } else {
        format!("Verified {total_records} records matching shared Cadence Firebase workspace.")
    };

    BackupValidationReport {
        valid,
        schema_version: parsed.schema_version,
        matches_shared_firebase,
        checksum_valid,
        total_records,
        message,
    }
}

#[tauri::command]
pub fn validate_workspace_backup_cmd(raw_json: String) -> BackupValidationReport {
    validate_workspace_backup_json(&raw_json)
}

#[tauri::command]
pub async fn export_workspace_backup_cmd(
    app: AppHandle,
    cache: State<'_, WorkspaceCacheState>,
    default_filename: Option<String>,
) -> Result<Option<String>, String> {
    let snap = cache.current_snapshot();
    let envelope = build_backup_envelope(snap)?;
    let json = serde_json::to_string_pretty(&envelope)
        .map_err(|e| format!("Failed to serialize workspace backup: {e}"))?;
    let file_name = default_filename.unwrap_or_else(|| "cadence-workspace-backup.json".to_string());

    let selected = app
        .dialog()
        .file()
        .add_filter("JSON Backup", &["json"])
        .set_file_name(&file_name)
        .blocking_save_file();

    match selected {
        Some(FilePath::Path(path)) => {
            fs::write(&path, json.as_bytes())
                .map_err(|e| format!("Failed to write workspace backup: {e}"))?;
            Ok(Some(path.to_string_lossy().to_string()))
        }
        Some(FilePath::Url(url)) => Ok(Some(url.to_string())),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Shift, ShiftStatus, StaffDirectoryEntry, UserRole};

    fn sample_snapshot() -> WorkspaceSnapshot {
        WorkspaceSnapshot {
            staff_directory: vec![StaffDirectoryEntry {
                uid: "u1".to_string(),
                display_name: "Maya Patel".to_string(),
                role: UserRole::Staff,
                department: "Operations".to_string(),
                total_hours_worked: 16.0,
                scheduled_hours_this_week: 8.0,
                weekly_hours_target: 40.0,
                last_assigned_at: String::new(),
                is_sample_roster: false,
            }],
            shifts: vec![Shift {
                id: "s1".to_string(),
                title: "Morning Ops".to_string(),
                department: "Operations".to_string(),
                date: "2026-11-23".to_string(),
                start_time: "07:00".to_string(),
                end_time: "15:00".to_string(),
                duration_hours: 8.0,
                assigned_uid: "u1".to_string(),
                assigned_name: "Maya Patel".to_string(),
                candidate_uids: vec![],
                status: ShiftStatus::Scheduled,
                visibility: "team".to_string(),
                fairness_note: String::new(),
                created_by: "mgr".to_string(),
            }],
            ..WorkspaceSnapshot::default()
        }
    }

    #[test]
    fn builds_and_verifies_backup_envelope_against_shared_firebase() {
        let envelope = build_backup_envelope(sample_snapshot()).expect("envelope should build");
        assert_eq!(envelope.total_records, 2);
        assert_eq!(envelope.project_id, "silken-eye-377716");
        let raw = serde_json::to_string(&envelope).unwrap();
        let report = validate_workspace_backup_json(&raw);
        assert!(report.valid);
        assert!(report.checksum_valid);
        assert!(report.matches_shared_firebase);
        assert_eq!(report.total_records, 2);
    }

    #[test]
    fn detects_tampered_backup_checksum_and_invalid_json() {
        let mut envelope = build_backup_envelope(sample_snapshot()).unwrap();
        envelope.snapshot.shifts[0].title = "Modified".to_string();
        let tampered_raw = serde_json::to_string(&envelope).unwrap();
        let report = validate_workspace_backup_json(&tampered_raw);
        assert!(!report.valid);
        assert!(!report.checksum_valid);

        let malformed = validate_workspace_backup_json("{not valid json");
        assert!(!malformed.valid);
    }
}
