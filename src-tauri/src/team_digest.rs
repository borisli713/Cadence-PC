use std::collections::HashMap;
use std::fs;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::analytics::build_staff_chart_rows;
use crate::compliance::{
    analyze_workforce_compliance, DEFAULT_MAX_DAILY_HOURS, DEFAULT_MIN_REST_HOURS,
};
use crate::models::{ApprovalStatus, Shift, ShiftReport, ShiftStatus, StaffDirectoryEntry};
use crate::scheduler::detect_schedule_conflicts;
use crate::workspace_cache::{WorkspaceCacheState, WorkspaceSnapshot};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UtilizationAnomaly {
    pub uid: String,
    pub display_name: String,
    pub department: String,
    pub utilization_percent: i64,
    pub classification: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyTeamBriefing {
    pub total_staff: usize,
    pub total_shifts: usize,
    pub open_shifts_count: usize,
    pub conflict_shifts_count: usize,
    pub pending_changes_count: usize,
    pub pending_time_off_count: usize,
    pub submitted_reports_count: usize,
    pub average_utilization_percent: i64,
    pub department_headcounts: HashMap<String, usize>,
    pub anomalies: Vec<UtilizationAnomaly>,
    pub compliance_alerts: usize,
    pub action_items: Vec<String>,
}

pub fn build_weekly_team_briefing(snapshot: &WorkspaceSnapshot) -> WeeklyTeamBriefing {
    let chart_rows = build_staff_chart_rows(&snapshot.staff_directory, &snapshot.shifts);
    let conflicts = detect_schedule_conflicts(&snapshot.shifts, &snapshot.time_off_requests);
    let compliance = analyze_workforce_compliance(
        &snapshot.staff_directory,
        &snapshot.shifts,
        DEFAULT_MIN_REST_HOURS,
        DEFAULT_MAX_DAILY_HOURS,
    );

    let open_shifts_count = snapshot
        .shifts
        .iter()
        .filter(|s| s.status == ShiftStatus::Open)
        .count();
    let conflict_shifts_count = snapshot
        .shifts
        .iter()
        .filter(|s| s.status == ShiftStatus::Conflict || s.candidate_uids.len() > 1)
        .count()
        .max(conflicts.len());
    let pending_changes_count = snapshot
        .schedule_changes
        .iter()
        .filter(|c| c.status == ApprovalStatus::Pending)
        .count();
    let pending_time_off_count = snapshot
        .time_off_requests
        .iter()
        .filter(|t| t.status == ApprovalStatus::Pending)
        .count();
    let submitted_reports_count = snapshot
        .shift_reports
        .iter()
        .filter(|r| r.status == crate::models::ShiftReportStatus::Submitted)
        .count();

    let mut department_headcounts: HashMap<String, usize> = HashMap::new();
    for member in &snapshot.staff_directory {
        let dept = if member.department.trim().is_empty() {
            "Operations".to_string()
        } else {
            member.department.trim().to_string()
        };
        *department_headcounts.entry(dept).or_insert(0) += 1;
    }

    let average_utilization_percent = if chart_rows.is_empty() {
        0
    } else {
        let sum: i64 = chart_rows.iter().map(|r| r.utilization_percent).sum();
        (sum as f64 / chart_rows.len() as f64).round() as i64
    };

    let mut anomalies = Vec::new();
    for row in &chart_rows {
        if row.utilization_percent >= 105 {
            anomalies.push(UtilizationAnomaly {
                uid: row.uid.clone(),
                display_name: row.display_name.clone(),
                department: row.department.clone(),
                utilization_percent: row.utilization_percent,
                classification: "over_allocated".to_string(),
            });
        } else if row.utilization_percent <= 35 && row.target_hours >= 20.0 {
            anomalies.push(UtilizationAnomaly {
                uid: row.uid.clone(),
                display_name: row.display_name.clone(),
                department: row.department.clone(),
                utilization_percent: row.utilization_percent,
                classification: "under_utilized".to_string(),
            });
        }
    }

    let mut action_items = Vec::new();
    if conflict_shifts_count > 0 {
        action_items.push(format!(
            "Run Fairness Overlap Resolver for {conflict_shifts_count} conflicted shift(s)."
        ));
    }
    if open_shifts_count > 0 {
        action_items.push(format!(
            "Fill {open_shifts_count} open shift slot(s) via submissions or fairness planner."
        ));
    }
    if pending_changes_count > 0 || pending_time_off_count > 0 {
        action_items.push(format!(
            "Review {pending_changes_count} schedule change request(s) and {pending_time_off_count} time-off request(s)."
        ));
    }
    if submitted_reports_count > 0 {
        action_items.push(format!(
            "Verify {submitted_reports_count} submitted shift report(s) for payroll accuracy."
        ));
    }
    if compliance.total_violations > 0 {
        action_items.push(format!(
            "Inspect {} workforce rest/overtime compliance alert(s).",
            compliance.total_violations
        ));
    }

    WeeklyTeamBriefing {
        total_staff: snapshot.staff_directory.len(),
        total_shifts: snapshot.shifts.len(),
        open_shifts_count,
        conflict_shifts_count,
        pending_changes_count,
        pending_time_off_count,
        submitted_reports_count,
        average_utilization_percent,
        department_headcounts,
        anomalies,
        compliance_alerts: compliance.total_violations,
        action_items,
    }
}

pub fn render_briefing_markdown(
    briefing: &WeeklyTeamBriefing,
    shifts: &[Shift],
    staff_directory: &[StaffDirectoryEntry],
    shift_reports: &[ShiftReport],
) -> String {
    let total_verified_hours: f64 = shift_reports
        .iter()
        .filter(|r| r.status == crate::models::ShiftReportStatus::Verified)
        .map(|r| r.worked_hours)
        .sum();
    let mut lines = vec![
        "# Cadence Weekly Manager Briefing".to_string(),
        String::new(),
        format!(
            "- **Roster Headcount**: {} | **Scheduled/Tracked Shifts**: {}",
            briefing.total_staff, shifts.len()
        ),
        format!(
            "- **Average Target Utilization**: {}% | **Verified Report Hours**: {:.1}h",
            briefing.average_utilization_percent, total_verified_hours
        ),
        format!(
            "- **Open Shifts**: {} | **Conflicts**: {} | **Compliance Alerts**: {}",
            briefing.open_shifts_count, briefing.conflict_shifts_count, briefing.compliance_alerts
        ),
        String::new(),
        "## Priority Action Items".to_string(),
    ];

    if briefing.action_items.is_empty() {
        lines.push("- Schedule balanced with zero pending manager actions.".to_string());
    } else {
        for item in &briefing.action_items {
            lines.push(format!("- {item}"));
        }
    }

    if !briefing.anomalies.is_empty() {
        lines.push(String::new());
        lines.push("## Utilization Anomalies".to_string());
        for a in &briefing.anomalies {
            lines.push(format!(
                "- {} ({}) — {}% ({})",
                a.display_name, a.department, a.utilization_percent, a.classification
            ));
        }
    }

    let _ = staff_directory;
    lines.join("\n")
}

#[tauri::command]
pub fn build_weekly_team_briefing_cmd(
    cache: State<'_, WorkspaceCacheState>,
) -> WeeklyTeamBriefing {
    let snap = cache.current_snapshot();
    build_weekly_team_briefing(&snap)
}

#[tauri::command]
pub async fn save_weekly_briefing_markdown_cmd(
    app: AppHandle,
    cache: State<'_, WorkspaceCacheState>,
    default_filename: Option<String>,
) -> Result<Option<String>, String> {
    let snap = cache.current_snapshot();
    let briefing = build_weekly_team_briefing(&snap);
    let md = render_briefing_markdown(
        &briefing,
        &snap.shifts,
        &snap.staff_directory,
        &snap.shift_reports,
    );
    let file_name = default_filename.unwrap_or_else(|| "cadence-manager-briefing.md".to_string());

    let selected = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md"])
        .set_file_name(&file_name)
        .blocking_save_file();

    match selected {
        Some(FilePath::Path(path)) => {
            fs::write(&path, md.as_bytes())
                .map_err(|e| format!("Failed to save weekly briefing: {e}"))?;
            Ok(Some(path.to_string_lossy().to_string()))
        }
        Some(FilePath::Url(url)) => Ok(Some(url.to_string())),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ShiftReportStatus, UserRole};

    fn staff(uid: &str, worked: f64) -> StaffDirectoryEntry {
        StaffDirectoryEntry {
            uid: uid.to_string(),
            display_name: format!("Member {uid}"),
            role: UserRole::Staff,
            department: "Operations".to_string(),
            total_hours_worked: worked,
            scheduled_hours_this_week: 0.0,
            weekly_hours_target: 40.0,
            last_assigned_at: String::new(),
            is_sample_roster: false,
        }
    }

    #[test]
    fn builds_briefing_with_anomalies_and_action_items() {
        let snap = WorkspaceSnapshot {
            staff_directory: vec![staff("u_over", 44.0), staff("u_under", 4.0)],
            shifts: vec![Shift {
                id: "s_open".to_string(),
                title: "Evening".to_string(),
                department: "Operations".to_string(),
                date: "2026-11-24".to_string(),
                start_time: "15:00".to_string(),
                end_time: "23:00".to_string(),
                duration_hours: 8.0,
                assigned_uid: String::new(),
                assigned_name: String::new(),
                candidate_uids: vec![],
                status: ShiftStatus::Open,
                visibility: "team".to_string(),
                fairness_note: String::new(),
                created_by: "mgr".to_string(),
            }],
            shift_reports: vec![ShiftReport {
                id: "rep_1".to_string(),
                shift_id: "s1".to_string(),
                shift_title: "Morning".to_string(),
                staff_uid: "u_over".to_string(),
                staff_name: "Member u_over".to_string(),
                department: "Operations".to_string(),
                date: "2026-11-23".to_string(),
                actual_start_time: "07:00".to_string(),
                actual_end_time: "15:00".to_string(),
                break_minutes: 0,
                worked_hours: 8.0,
                handoff_notes: "Handoff ok".to_string(),
                status: ShiftReportStatus::Verified,
                verified_by_uid: "mgr".to_string(),
            }],
            ..WorkspaceSnapshot::default()
        };

        let briefing = build_weekly_team_briefing(&snap);
        assert_eq!(briefing.total_staff, 2);
        assert_eq!(briefing.open_shifts_count, 1);
        assert_eq!(briefing.anomalies.len(), 2);
        assert!(briefing
            .anomalies
            .iter()
            .any(|a| a.classification == "over_allocated"));
        assert!(briefing
            .anomalies
            .iter()
            .any(|a| a.classification == "under_utilized"));

        let md = render_briefing_markdown(
            &briefing,
            &snap.shifts,
            &snap.staff_directory,
            &snap.shift_reports,
        );
        assert!(md.contains("# Cadence Weekly Manager Briefing"));
        assert!(md.contains("Verified Report Hours**: 8.0h"));
    }
}
