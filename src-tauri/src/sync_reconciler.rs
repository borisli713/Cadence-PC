use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::State;

use crate::fairness::compute_scheduled_hours_by_uid;
use crate::firebase_client::{load_embedded_firebase_config, FirebaseRestClient, FirestoreWriteOp};
use crate::models::{
    ApprovalStatus, ScheduleChangeRequest, Shift, ShiftReport, ShiftReportStatus, ShiftStatus,
    StaffDirectoryEntry, TimeOffRequest,
};
use crate::scheduler::detect_schedule_conflicts;
use crate::workspace_cache::{WorkspaceCacheState, WorkspaceSnapshot};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncHoursDrift {
    pub uid: String,
    pub display_name: String,
    pub recorded_scheduled_hours: f64,
    pub live_scheduled_hours: f64,
    pub delta_hours: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncConsistencyIssue {
    pub issue_id: String,
    pub collection: String,
    pub doc_id: String,
    pub severity: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThreeWaySyncAuditReport {
    pub project_id: String,
    pub firestore_database_id: String,
    pub is_synced_target_valid: bool,
    pub total_staff_checked: usize,
    pub total_shifts_checked: usize,
    pub scheduled_hours_drifts: Vec<SyncHoursDrift>,
    pub consistency_issues: Vec<SyncConsistencyIssue>,
    pub verified_hours_by_uid: HashMap<String, f64>,
    pub healthy: bool,
}

fn round2(val: f64) -> f64 {
    (val * 100.0).round() / 100.0
}

pub fn reconcile_workspace_snapshot(snapshot: &WorkspaceSnapshot) -> ThreeWaySyncAuditReport {
    let (project_id, firestore_database_id, target_ok) = match load_embedded_firebase_config() {
        Ok(cfg) => {
            let valid = cfg.project_id == "silken-eye-377716"
                && cfg.firestore_database_id == "ai-studio-2204fa2b-edd1-4012-9dfd-e10210864d68";
            (cfg.project_id, cfg.firestore_database_id, valid)
        }
        Err(_) => (String::new(), String::new(), false),
    };

    let live_scheduled = compute_scheduled_hours_by_uid(&snapshot.shifts);
    let mut drifts = Vec::new();
    for member in &snapshot.staff_directory {
        let live_val = round2(live_scheduled.get(&member.uid).copied().unwrap_or(0.0));
        let recorded_val = round2(member.scheduled_hours_this_week);
        let delta = round2(live_val - recorded_val);
        if delta.abs() >= 0.1 {
            drifts.push(SyncHoursDrift {
                uid: member.uid.clone(),
                display_name: member.display_name.clone(),
                recorded_scheduled_hours: recorded_val,
                live_scheduled_hours: live_val,
                delta_hours: delta,
            });
        }
    }

    let mut verified_hours_by_uid: HashMap<String, f64> = HashMap::new();
    for rep in &snapshot.shift_reports {
        if rep.status == ShiftReportStatus::Verified {
            *verified_hours_by_uid
                .entry(rep.staff_uid.clone())
                .or_insert(0.0) += rep.worked_hours;
        }
    }
    for v in verified_hours_by_uid.values_mut() {
        *v = round2(*v);
    }

    let mut issues = Vec::new();

    if !target_ok {
        issues.push(SyncConsistencyIssue {
            issue_id: "firebase_target_mismatch".to_string(),
            collection: "config".to_string(),
            doc_id: "firebase-applet-config.json".to_string(),
            severity: "error".to_string(),
            message: "Shared Firebase database target does not match Android and Web clients."
                .to_string(),
        });
    }

    let pending_change_shift_ids: HashSet<&str> = snapshot
        .schedule_changes
        .iter()
        .filter(|c| c.status == ApprovalStatus::Pending)
        .map(|c| c.shift_id.as_str())
        .collect();

    let shift_ids: HashSet<&str> = snapshot.shifts.iter().map(|s| s.id.as_str()).collect();
    let roster_uids: HashSet<&str> = snapshot
        .staff_directory
        .iter()
        .map(|m| m.uid.as_str())
        .collect();

    for shift in &snapshot.shifts {
        if shift.status == ShiftStatus::PendingChange
            && !pending_change_shift_ids.contains(shift.id.as_str())
        {
            issues.push(SyncConsistencyIssue {
                issue_id: format!("orphan_pending_shift_{}", shift.id),
                collection: "shifts".to_string(),
                doc_id: shift.id.clone(),
                severity: "warning".to_string(),
                message: format!(
                    "Shift '{}' is marked pending_change without an active pending request.",
                    shift.title
                ),
            });
        }
        if shift.status != ShiftStatus::Open
            && !shift.assigned_uid.trim().is_empty()
            && !roster_uids.contains(shift.assigned_uid.as_str())
        {
            issues.push(SyncConsistencyIssue {
                issue_id: format!("unlisted_assignee_{}", shift.id),
                collection: "shifts".to_string(),
                doc_id: shift.id.clone(),
                severity: "info".to_string(),
                message: format!(
                    "Shift '{}' assignee '{}' is not present in loaded team roster.",
                    shift.title, shift.assigned_uid
                ),
            });
        }
    }

    for chg in &snapshot.schedule_changes {
        if chg.status == ApprovalStatus::Pending && !shift_ids.contains(chg.shift_id.as_str()) {
            issues.push(SyncConsistencyIssue {
                issue_id: format!("dangling_change_{}", chg.id),
                collection: "scheduleChanges".to_string(),
                doc_id: chg.id.clone(),
                severity: "warning".to_string(),
                message: format!(
                    "Pending change request '{}' references missing shift '{}'.",
                    chg.id, chg.shift_id
                ),
            });
        }
    }

    for member in &snapshot.staff_directory {
        if let Some(&verified_sum) = verified_hours_by_uid.get(&member.uid) {
            if (verified_sum - member.total_hours_worked).abs() >= 0.1 {
                issues.push(SyncConsistencyIssue {
                    issue_id: format!("verified_hours_mismatch_{}", member.uid),
                    collection: "staffDirectory".to_string(),
                    doc_id: member.uid.clone(),
                    severity: "warning".to_string(),
                    message: format!(
                        "{} has {:.1}h in verified shift reports vs {:.1}h recorded in staffDirectory.",
                        member.display_name, verified_sum, member.total_hours_worked
                    ),
                });
            }
        }
    }

    let conflicts = detect_schedule_conflicts(&snapshot.shifts, &snapshot.time_off_requests);
    for conflict in conflicts {
        issues.push(SyncConsistencyIssue {
            issue_id: format!("conflict_{}", conflict.shift_id),
            collection: "shifts".to_string(),
            doc_id: conflict.shift_id,
            severity: "warning".to_string(),
            message: format!(
                "{} ({} {}): {}",
                conflict.shift_title, conflict.date, conflict.assigned_name, conflict.reason
            ),
        });
    }

    let healthy = target_ok && drifts.is_empty() && issues.iter().all(|i| i.severity != "error");

    ThreeWaySyncAuditReport {
        project_id,
        firestore_database_id,
        is_synced_target_valid: target_ok,
        total_staff_checked: snapshot.staff_directory.len(),
        total_shifts_checked: snapshot.shifts.len(),
        scheduled_hours_drifts: drifts,
        consistency_issues: issues,
        verified_hours_by_uid,
        healthy,
    }
}

pub fn audit_from_collections(
    staff_directory: Vec<StaffDirectoryEntry>,
    shifts: Vec<Shift>,
    schedule_changes: Vec<ScheduleChangeRequest>,
    shift_reports: Vec<ShiftReport>,
    time_off_requests: Vec<TimeOffRequest>,
) -> ThreeWaySyncAuditReport {
    let snapshot = WorkspaceSnapshot {
        profile: None,
        staff_directory,
        shifts,
        schedule_changes,
        shift_reports,
        shift_submissions: Vec::new(),
        time_off_requests,
        notifications: Vec::new(),
    };
    reconcile_workspace_snapshot(&snapshot)
}

#[tauri::command]
pub fn reconcile_workspace_sync_cmd(
    cache: State<'_, WorkspaceCacheState>,
) -> ThreeWaySyncAuditReport {
    let snapshot = cache.current_snapshot();
    reconcile_workspace_snapshot(&snapshot)
}

#[tauri::command]
pub fn verify_three_way_sync_integrity_cmd(
    staff_directory: Vec<StaffDirectoryEntry>,
    shifts: Vec<Shift>,
    schedule_changes: Vec<ScheduleChangeRequest>,
    shift_reports: Vec<ShiftReport>,
    time_off_requests: Vec<TimeOffRequest>,
) -> ThreeWaySyncAuditReport {
    audit_from_collections(
        staff_directory,
        shifts,
        schedule_changes,
        shift_reports,
        time_off_requests,
    )
}

#[tauri::command]
pub async fn repair_scheduled_hours_drift_cmd(
    id_token: String,
    staff_directory: Vec<StaffDirectoryEntry>,
    shifts: Vec<Shift>,
) -> Result<usize, String> {
    let live_scheduled = compute_scheduled_hours_by_uid(&shifts);
    let mut writes: Vec<FirestoreWriteOp> = Vec::new();

    for member in &staff_directory {
        let live_val = round2(live_scheduled.get(&member.uid).copied().unwrap_or(0.0));
        let recorded_val = round2(member.scheduled_hours_this_week);
        if (live_val - recorded_val).abs() >= 0.1 {
            let mut fields = Map::new();
            fields.insert("scheduledHoursThisWeek".to_string(), Value::from(live_val));
            writes.push(FirestoreWriteOp::UpdateMask {
                collection: "staffDirectory".to_string(),
                doc_id: member.uid.clone(),
                fields,
                mask_paths: vec![
                    "scheduledHoursThisWeek".to_string(),
                    "updatedAt".to_string(),
                ],
                server_timestamp_fields: vec!["updatedAt".to_string()],
                require_exists: true,
            });
        }
    }

    if writes.is_empty() {
        return Ok(0);
    }

    let repaired = writes.len();
    let client = FirebaseRestClient::from_embedded_config()?;
    client
        .commit_writes(&id_token, &writes, "staffDirectory")
        .await?;
    Ok(repaired)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ScheduleChangeType, UserRole};

    fn staff(uid: &str, name: &str, recorded_sched: f64) -> StaffDirectoryEntry {
        StaffDirectoryEntry {
            uid: uid.to_string(),
            display_name: name.to_string(),
            role: UserRole::Staff,
            department: "Operations".to_string(),
            total_hours_worked: 12.0,
            scheduled_hours_this_week: recorded_sched,
            weekly_hours_target: 40.0,
            last_assigned_at: String::new(),
            is_sample_roster: false,
        }
    }

    fn shift(id: &str, uid: &str, status: ShiftStatus, hours: f64) -> Shift {
        Shift {
            id: id.to_string(),
            title: "Morning Ops".to_string(),
            department: "Operations".to_string(),
            date: "2026-11-24".to_string(),
            start_time: "07:00".to_string(),
            end_time: "15:00".to_string(),
            duration_hours: hours,
            assigned_uid: uid.to_string(),
            assigned_name: "Maya".to_string(),
            candidate_uids: vec![],
            status,
            visibility: "team".to_string(),
            fairness_note: String::new(),
            created_by: "mgr".to_string(),
        }
    }

    #[test]
    fn validates_shared_firebase_project_and_detects_hours_drift() {
        let audit = audit_from_collections(
            vec![staff("u1", "Maya", 4.0)],
            vec![shift("s1", "u1", ShiftStatus::Scheduled, 8.0)],
            Vec::new(),
            Vec::new(),
            Vec::new(),
        );
        assert!(audit.is_synced_target_valid);
        assert_eq!(audit.project_id, "silken-eye-377716");
        assert_eq!(
            audit.firestore_database_id,
            "ai-studio-2204fa2b-edd1-4012-9dfd-e10210864d68"
        );
        assert_eq!(audit.scheduled_hours_drifts.len(), 1);
        assert_eq!(audit.scheduled_hours_drifts[0].delta_hours, 4.0);
        assert!(!audit.healthy);
    }

    #[test]
    fn flags_orphan_pending_change_shift_and_dangling_request() {
        let mut s = shift("s1", "u1", ShiftStatus::PendingChange, 8.0);
        s.title = "Afternoon Ops".to_string();
        let dangling = ScheduleChangeRequest {
            id: "chg_missing".to_string(),
            shift_id: "s_nonexistent".to_string(),
            shift_title: "Missing".to_string(),
            requester_uid: "u1".to_string(),
            requester_name: "Maya".to_string(),
            request_type: ScheduleChangeType::Drop,
            current_date: "2026-11-24".to_string(),
            current_start_time: "09:00".to_string(),
            current_end_time: "17:00".to_string(),
            proposed_date: "2026-11-24".to_string(),
            proposed_start_time: "09:00".to_string(),
            proposed_end_time: "17:00".to_string(),
            proposed_assignee_uid: String::new(),
            proposed_assignee_name: String::new(),
            reason: "Sick".to_string(),
            status: ApprovalStatus::Pending,
            reviewed_by_uid: String::new(),
            reviewed_by_name: String::new(),
            review_note: String::new(),
        };

        let audit = audit_from_collections(
            vec![staff("u1", "Maya", 8.0)],
            vec![s],
            vec![dangling],
            Vec::new(),
            Vec::new(),
        );
        assert!(audit
            .consistency_issues
            .iter()
            .any(|i| i.issue_id == "orphan_pending_shift_s1"));
        assert!(audit
            .consistency_issues
            .iter()
            .any(|i| i.issue_id == "dangling_change_chg_missing"));
    }

    #[test]
    fn detects_verified_hours_mismatch_and_confirms_clean_sync_when_aligned() {
        let rep = ShiftReport {
            id: "rep_v1".to_string(),
            shift_id: "s1".to_string(),
            shift_title: "Morning Ops".to_string(),
            staff_uid: "u1".to_string(),
            staff_name: "Maya".to_string(),
            department: "Operations".to_string(),
            date: "2026-11-24".to_string(),
            actual_start_time: "07:00".to_string(),
            actual_end_time: "15:00".to_string(),
            break_minutes: 0,
            worked_hours: 8.0,
            handoff_notes: String::new(),
            status: ShiftReportStatus::Verified,
            verified_by_uid: "mgr".to_string(),
        };

        let mismatched = audit_from_collections(
            vec![staff("u1", "Maya", 8.0)],
            vec![shift("s1", "u1", ShiftStatus::Scheduled, 8.0)],
            Vec::new(),
            vec![rep],
            Vec::new(),
        );
        assert!(mismatched
            .consistency_issues
            .iter()
            .any(|i| i.issue_id == "verified_hours_mismatch_u1"));

        let clean = audit_from_collections(
            vec![staff("u1", "Maya", 8.0)],
            vec![shift("s1", "u1", ShiftStatus::Scheduled, 8.0)],
            Vec::new(),
            Vec::new(),
            Vec::new(),
        );
        assert!(clean.healthy);
        assert!(clean.consistency_issues.is_empty());
        assert!(clean.scheduled_hours_drifts.is_empty());
    }
}
