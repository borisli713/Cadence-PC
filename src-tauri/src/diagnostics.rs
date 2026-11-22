use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::audit_log::AuditLogState;
use crate::compliance::{
    analyze_workforce_compliance, DEFAULT_MAX_DAILY_HOURS, DEFAULT_MIN_REST_HOURS,
};
use crate::firebase_client::load_embedded_firebase_config;
use crate::offline_queue::OfflineQueueState;
use crate::sync_reconciler::reconcile_workspace_snapshot;
use crate::workspace_cache::WorkspaceCacheState;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPreflightReport {
    pub app_version: String,
    pub os_platform: String,
    pub firebase_project_id: String,
    pub firestore_database_id: String,
    pub three_way_sync_target_valid: bool,
    pub app_data_writable: bool,
    pub pending_offline_mutations: usize,
    pub audit_chain_intact: bool,
    pub audit_entries_count: usize,
    pub compliance_violations: usize,
    pub sync_healthy: bool,
    pub issues: Vec<String>,
}

fn check_dir_writable(dir: &Path) -> bool {
    if fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".cadence_write_probe");
    if fs::write(&probe, b"ok").is_err() {
        return false;
    }
    let _ = fs::remove_file(&probe);
    true
}

pub fn build_preflight_report(
    app_data_dir: Option<&Path>,
    cache: &WorkspaceCacheState,
    offline_queue: &OfflineQueueState,
    audit_log: &AuditLogState,
) -> DesktopPreflightReport {
    let mut issues = Vec::new();
    let (firebase_project_id, firestore_database_id, target_ok) =
        match load_embedded_firebase_config() {
            Ok(cfg) => {
                let matches = cfg.project_id == "silken-eye-377716"
                    && cfg.firestore_database_id
                        == "ai-studio-2204fa2b-edd1-4012-9dfd-e10210864d68";
                if !matches {
                    issues.push(
                        "Embedded Firebase config does not match Android and Web 3-way sync target."
                            .to_string(),
                    );
                }
                (cfg.project_id, cfg.firestore_database_id, matches)
            }
            Err(e) => {
                issues.push(e);
                (String::new(), String::new(), false)
            }
        };

    let app_data_writable = app_data_dir.map(check_dir_writable).unwrap_or(false);
    if !app_data_writable {
        issues.push("Windows AppData directory is not writable for local state cache.".to_string());
    }

    let queue_file = app_data_dir.map(|d| d.join("cadence_offline_queue.json"));
    let queue_summary = offline_queue.summary(queue_file.as_deref());

    let audit_file = app_data_dir.map(|d| d.join("cadence_audit_log.json"));
    let audit_res = audit_log.query(audit_file.as_deref(), None, "", 1000);
    if !audit_res.chain_intact {
        issues.push("Local desktop audit log hash chain verification failed.".to_string());
    }

    let snapshot = cache.current_snapshot();
    let compliance = analyze_workforce_compliance(
        &snapshot.staff_directory,
        &snapshot.shifts,
        DEFAULT_MIN_REST_HOURS,
        DEFAULT_MAX_DAILY_HOURS,
    );
    let sync_audit = reconcile_workspace_snapshot(&snapshot);
    if !sync_audit.healthy {
        for drift in &sync_audit.scheduled_hours_drifts {
            issues.push(format!(
                "Hours drift for {} ({:.1}h recorded vs {:.1}h live).",
                drift.display_name, drift.recorded_scheduled_hours, drift.live_scheduled_hours
            ));
        }
        for issue in &sync_audit.consistency_issues {
            issues.push(issue.message.clone());
        }
    }

    DesktopPreflightReport {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os_platform: std::env::consts::OS.to_string(),
        firebase_project_id,
        firestore_database_id,
        three_way_sync_target_valid: target_ok,
        app_data_writable,
        pending_offline_mutations: queue_summary.pending_count,
        audit_chain_intact: audit_res.chain_intact,
        audit_entries_count: audit_res.total_entries,
        compliance_violations: compliance.total_violations,
        sync_healthy: sync_audit.healthy,
        issues,
    }
}

#[tauri::command]
pub fn run_desktop_preflight_cmd(
    app: AppHandle,
    cache: State<'_, WorkspaceCacheState>,
    offline_queue: State<'_, OfflineQueueState>,
    audit_log: State<'_, AuditLogState>,
) -> DesktopPreflightReport {
    let dir = app.path().app_data_dir().ok();
    build_preflight_report(dir.as_deref(), &cache, &offline_queue, &audit_log)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifies_writable_temp_dir_and_shared_firebase_sync_target() {
        let temp_dir =
            std::env::temp_dir().join(format!("cadence_diag_test_{}", std::process::id()));
        let cache = WorkspaceCacheState::default();
        let queue = OfflineQueueState::default();
        let audit = AuditLogState::default();

        let report = build_preflight_report(Some(&temp_dir), &cache, &queue, &audit);
        assert!(report.three_way_sync_target_valid);
        assert_eq!(report.firebase_project_id, "silken-eye-377716");
        assert!(report.app_data_writable);
        assert!(report.audit_chain_intact);
        assert!(report.sync_healthy);

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
