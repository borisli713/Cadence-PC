use std::sync::RwLock;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::analytics::{build_staff_chart_rows, compute_dashboard_kpis};
use crate::models::{
    ApprovalStatus, DashboardKpis, NotificationWorkPayload, PushNotificationRecord,
    ScheduleChangeRequest, Shift, ShiftReport, ShiftSubmission, StaffChartRow,
    StaffDirectoryEntry, TimeOffRequest, UserProfile, UserRole,
};
use crate::notifications::{build_manager_work_payloads, unread_notification_ids};
use crate::roster::{compute_team_roster_stats, TeamRosterStats};
use crate::scheduler::{
    detect_schedule_conflicts, summarize_department_coverage, ConflictReportItem,
    DepartmentCoverageSummary,
};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub profile: Option<UserProfile>,
    #[serde(default)]
    pub staff_directory: Vec<StaffDirectoryEntry>,
    #[serde(default)]
    pub shifts: Vec<Shift>,
    #[serde(default)]
    pub schedule_changes: Vec<ScheduleChangeRequest>,
    #[serde(default)]
    pub shift_reports: Vec<ShiftReport>,
    #[serde(default)]
    pub shift_submissions: Vec<ShiftSubmission>,
    #[serde(default)]
    pub time_off_requests: Vec<TimeOffRequest>,
    #[serde(default)]
    pub notifications: Vec<PushNotificationRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DerivedWorkspaceInsights {
    pub kpis: DashboardKpis,
    pub staff_chart: Vec<StaffChartRow>,
    pub conflicts: Vec<ConflictReportItem>,
    pub department_coverage: Vec<DepartmentCoverageSummary>,
    pub roster_stats: TeamRosterStats,
    pub manager_work_payloads: Vec<NotificationWorkPayload>,
    pub unread_notification_count: usize,
    pub cached_doc_count: usize,
}

#[derive(Default)]
pub struct WorkspaceCacheState {
    inner: RwLock<WorkspaceSnapshot>,
}

impl WorkspaceCacheState {
    pub fn update_and_derive(&self, snapshot: WorkspaceSnapshot) -> DerivedWorkspaceInsights {
        let insights = derive_insights_from_snapshot(&snapshot);
        if let Ok(mut guard) = self.inner.write() {
            *guard = snapshot;
        }
        insights
    }

    pub fn current_insights(&self) -> DerivedWorkspaceInsights {
        match self.inner.read() {
            Ok(guard) => derive_insights_from_snapshot(&guard),
            Err(_) => derive_insights_from_snapshot(&WorkspaceSnapshot::default()),
        }
    }

    pub fn current_snapshot(&self) -> WorkspaceSnapshot {
        match self.inner.read() {
            Ok(guard) => guard.clone(),
            Err(_) => WorkspaceSnapshot::default(),
        }
    }
}

pub fn derive_insights_from_snapshot(snapshot: &WorkspaceSnapshot) -> DerivedWorkspaceInsights {
    let (uid, weekly_target, is_manager) = match snapshot.profile {
        Some(ref p) => (p.uid.as_str(), p.weekly_hours_target, p.role == UserRole::Manager),
        None => ("", 40.0, false),
    };

    let pending_changes = snapshot
        .schedule_changes
        .iter()
        .filter(|c| c.status == ApprovalStatus::Pending)
        .count();

    let kpis = compute_dashboard_kpis(
        uid,
        weekly_target,
        &snapshot.shifts,
        pending_changes,
        &snapshot.time_off_requests,
        &snapshot.staff_directory,
    );
    let staff_chart = build_staff_chart_rows(&snapshot.staff_directory, &snapshot.shifts);
    let conflicts = detect_schedule_conflicts(&snapshot.shifts, &snapshot.time_off_requests);
    let department_coverage = summarize_department_coverage(&snapshot.shifts);
    let roster_stats = compute_team_roster_stats(&snapshot.staff_directory);
    let manager_work_payloads = if is_manager && !uid.is_empty() {
        build_manager_work_payloads(
            uid,
            &snapshot.schedule_changes,
            &snapshot.time_off_requests,
            &snapshot.shift_reports,
        )
    } else {
        Vec::new()
    };
    let unread_notification_count = unread_notification_ids(&snapshot.notifications).len();
    let cached_doc_count = snapshot.staff_directory.len()
        + snapshot.shifts.len()
        + snapshot.schedule_changes.len()
        + snapshot.shift_reports.len()
        + snapshot.shift_submissions.len()
        + snapshot.time_off_requests.len()
        + snapshot.notifications.len();

    DerivedWorkspaceInsights {
        kpis,
        staff_chart,
        conflicts,
        department_coverage,
        roster_stats,
        manager_work_payloads,
        unread_notification_count,
        cached_doc_count,
    }
}

#[tauri::command]
pub fn sync_workspace_snapshot_cmd(
    cache: State<'_, WorkspaceCacheState>,
    snapshot: WorkspaceSnapshot,
) -> DerivedWorkspaceInsights {
    cache.update_and_derive(snapshot)
}

#[tauri::command]
pub fn get_workspace_insights_cmd(
    cache: State<'_, WorkspaceCacheState>,
) -> DerivedWorkspaceInsights {
    cache.current_insights()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ShiftStatus, UserRole};

    #[test]
    fn derives_workspace_kpis_conflicts_and_roster_stats_in_rust() {
        let state = WorkspaceCacheState::default();
        let snap = WorkspaceSnapshot {
            profile: Some(UserProfile {
                uid: "mgr_1".to_string(),
                email: "mgr@cadence.app".to_string(),
                display_name: "Alex".to_string(),
                role: UserRole::Manager,
                department: "Operations".to_string(),
                weekly_hours_target: 40.0,
                push_notifications_enabled: true,
            }),
            staff_directory: vec![StaffDirectoryEntry {
                uid: "u1".to_string(),
                display_name: "Maya".to_string(),
                role: UserRole::Staff,
                department: "Operations".to_string(),
                total_hours_worked: 16.0,
                scheduled_hours_this_week: 8.0,
                weekly_hours_target: 40.0,
                last_assigned_at: String::new(),
                is_sample_roster: false,
            }],
            shifts: vec![
                Shift {
                    id: "s1".to_string(),
                    title: "Morning".to_string(),
                    department: "Operations".to_string(),
                    date: "2026-11-23".to_string(),
                    start_time: "07:00".to_string(),
                    end_time: "15:00".to_string(),
                    duration_hours: 8.0,
                    assigned_uid: "u1".to_string(),
                    assigned_name: "Maya".to_string(),
                    candidate_uids: vec![],
                    status: ShiftStatus::Scheduled,
                    visibility: "team".to_string(),
                    fairness_note: String::new(),
                    created_by: "mgr_1".to_string(),
                },
                Shift {
                    id: "s2".to_string(),
                    title: "Overlap".to_string(),
                    department: "Operations".to_string(),
                    date: "2026-11-23".to_string(),
                    start_time: "11:00".to_string(),
                    end_time: "19:00".to_string(),
                    duration_hours: 8.0,
                    assigned_uid: "u1".to_string(),
                    assigned_name: "Maya".to_string(),
                    candidate_uids: vec![],
                    status: ShiftStatus::Scheduled,
                    visibility: "team".to_string(),
                    fairness_note: String::new(),
                    created_by: "mgr_1".to_string(),
                },
            ],
            ..WorkspaceSnapshot::default()
        };

        let insights = state.update_and_derive(snap);
        assert_eq!(insights.cached_doc_count, 3);
        assert_eq!(insights.conflicts.len(), 2);
        assert_eq!(insights.department_coverage.len(), 1);
        assert_eq!(insights.roster_stats.total_members, 1);
        assert_eq!(state.current_snapshot().shifts.len(), 2);
    }
}
