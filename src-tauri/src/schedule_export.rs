use std::collections::HashMap;
use std::fs;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::analytics::build_staff_chart_rows;
use crate::models::{Shift, ShiftReport, ShiftReportStatus, ShiftStatus, StaffDirectoryEntry};
use crate::workspace_cache::WorkspaceCacheState;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PayrollSummaryRow {
    pub uid: String,
    pub display_name: String,
    pub department: String,
    pub verified_hours: f64,
    pub pending_report_hours: f64,
    pub scheduled_hours: f64,
    pub weekly_target: f64,
    pub utilization_percent: i64,
}

fn round2(val: f64) -> f64 {
    (val * 100.0).round() / 100.0
}

fn escape_html(raw: &str) -> String {
    raw.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

pub fn build_payroll_summary_rows(
    staff_directory: &[StaffDirectoryEntry],
    shifts: &[Shift],
    shift_reports: &[ShiftReport],
) -> Vec<PayrollSummaryRow> {
    let chart = build_staff_chart_rows(staff_directory, shifts);
    let mut verified_map: HashMap<&str, f64> = HashMap::new();
    let mut submitted_map: HashMap<&str, f64> = HashMap::new();

    for rep in shift_reports {
        match rep.status {
            ShiftReportStatus::Verified => {
                *verified_map.entry(rep.staff_uid.as_str()).or_insert(0.0) += rep.worked_hours;
            }
            ShiftReportStatus::Submitted => {
                *submitted_map.entry(rep.staff_uid.as_str()).or_insert(0.0) += rep.worked_hours;
            }
            ShiftReportStatus::Flagged => {}
        }
    }

    chart
        .into_iter()
        .map(|row| {
            let verified_reports = verified_map.get(row.uid.as_str()).copied().unwrap_or(0.0);
            PayrollSummaryRow {
                verified_hours: round2(row.logged_hours.max(verified_reports)),
                pending_report_hours: round2(
                    submitted_map.get(row.uid.as_str()).copied().unwrap_or(0.0),
                ),
                scheduled_hours: round2(row.scheduled_hours),
                weekly_target: round2(row.target_hours),
                utilization_percent: row.utilization_percent,
                uid: row.uid,
                display_name: row.display_name,
                department: row.department,
            }
        })
        .collect()
}

pub fn generate_schedule_markdown(shifts: &[Shift], title: &str) -> String {
    let mut sorted = shifts.to_vec();
    sorted.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.start_time.cmp(&b.start_time)));

    let mut lines = vec![
        format!("# {title}"),
        String::new(),
        format!("Total shifts exported: {}", sorted.len()),
        String::new(),
        "| Date | Window | Shift | Department | Assignee | Status | Hours |".to_string(),
        "| --- | --- | --- | --- | --- | --- | ---: |".to_string(),
    ];

    for shift in sorted {
        let assignee = if shift.assigned_name.trim().is_empty() {
            "Open Slot"
        } else {
            shift.assigned_name.trim()
        };
        let status_label = match shift.status {
            ShiftStatus::Open => "Open",
            ShiftStatus::Conflict => "Overlap",
            ShiftStatus::Completed => "Completed",
            ShiftStatus::PendingChange => "Pending Change",
            ShiftStatus::Scheduled => "Scheduled",
        };
        lines.push(format!(
            "| {} | {}-{} | {} | {} | {} | {} | {:.1}h |",
            shift.date,
            shift.start_time,
            shift.end_time,
            shift.title.replace('|', "/"),
            shift.department.replace('|', "/"),
            assignee.replace('|', "/"),
            status_label,
            shift.duration_hours
        ));
    }

    lines.join("\n")
}

pub fn generate_payroll_report_html(
    rows: &[PayrollSummaryRow],
    period_label: &str,
) -> String {
    let total_verified: f64 = rows.iter().map(|r| r.verified_hours).sum();
    let total_scheduled: f64 = rows.iter().map(|r| r.scheduled_hours).sum();

    let mut body_rows = String::new();
    for r in rows {
        body_rows.push_str(&format!(
            "<tr><td>{}</td><td>{}</td><td class=\"num\">{:.2}h</td><td class=\"num\">{:.2}h</td><td class=\"num\">{:.2}h</td><td class=\"num\">{:.0}h</td><td class=\"num\">{}%</td></tr>\n",
            escape_html(&r.display_name),
            escape_html(&r.department),
            r.verified_hours,
            r.pending_report_hours,
            r.scheduled_hours,
            r.weekly_target,
            r.utilization_percent
        ));
    }

    format!(
        "<!doctype html>
<html lang=\"en\">
<head>
<meta charset=\"utf-8\">
<title>Cadence Team Hours &amp; Payroll Summary</title>
<style>
  body {{ font-family: 'Segoe UI', system-ui, sans-serif; color: #0f172a; margin: 32px; background: #ffffff; }}
  h1 {{ font-size: 20px; margin: 0 0 4px; }}
  .meta {{ color: #475569; font-size: 13px; margin-bottom: 20px; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
  th, td {{ border-bottom: 1px solid #e2e8f0; padding: 10px 8px; text-align: left; }}
  th {{ background: #f8fafc; font-weight: 600; color: #334155; }}
  td.num, th.num {{ text-align: right; font-variant-numeric: tabular-nums; }}
  tfoot td {{ font-weight: 700; background: #f8fafc; }}
</style>
</head>
<body>
  <h1>Cadence Team Hours &amp; Verified Shift Summary</h1>
  <div class=\"meta\">Period: {} &middot; {} team members</div>
  <table>
    <thead>
      <tr>
        <th>Team Member</th>
        <th>Department</th>
        <th class=\"num\">Verified Worked</th>
        <th class=\"num\">Pending Verification</th>
        <th class=\"num\">Scheduled</th>
        <th class=\"num\">Weekly Target</th>
        <th class=\"num\">Utilization</th>
      </tr>
    </thead>
    <tbody>
      {}
    </tbody>
    <tfoot>
      <tr>
        <td colspan=\"2\">Team Totals</td>
        <td class=\"num\">{:.2}h</td>
        <td class=\"num\">—</td>
        <td class=\"num\">{:.2}h</td>
        <td class=\"num\">—</td>
        <td class=\"num\">—</td>
      </tr>
    </tfoot>
  </table>
</body>
</html>",
        escape_html(period_label),
        rows.len(),
        body_rows,
        round2(total_verified),
        round2(total_scheduled)
    )
}

#[tauri::command]
pub fn generate_schedule_markdown_cmd(
    cache: State<'_, WorkspaceCacheState>,
    title: Option<String>,
) -> String {
    let snap = cache.current_snapshot();
    generate_schedule_markdown(
        &snap.shifts,
        title.as_deref().unwrap_or("Cadence Team Schedule"),
    )
}

#[tauri::command]
pub fn generate_payroll_report_html_cmd(
    cache: State<'_, WorkspaceCacheState>,
    period_label: Option<String>,
) -> String {
    let snap = cache.current_snapshot();
    let rows = build_payroll_summary_rows(&snap.staff_directory, &snap.shifts, &snap.shift_reports);
    generate_payroll_report_html(&rows, period_label.as_deref().unwrap_or("Active Workspace"))
}

#[tauri::command]
pub async fn save_payroll_summary_cmd(
    app: AppHandle,
    cache: State<'_, WorkspaceCacheState>,
    period_label: Option<String>,
    default_filename: Option<String>,
) -> Result<Option<String>, String> {
    let snap = cache.current_snapshot();
    let rows = build_payroll_summary_rows(&snap.staff_directory, &snap.shifts, &snap.shift_reports);
    let html = generate_payroll_report_html(
        &rows,
        period_label.as_deref().unwrap_or("Active Workspace"),
    );
    let file_name = default_filename.unwrap_or_else(|| "cadence-payroll-summary.html".to_string());

    let selected = app
        .dialog()
        .file()
        .add_filter("HTML Report", &["html"])
        .set_file_name(&file_name)
        .blocking_save_file();

    match selected {
        Some(FilePath::Path(path)) => {
            fs::write(&path, html.as_bytes())
                .map_err(|e| format!("Failed to save payroll report: {e}"))?;
            Ok(Some(path.to_string_lossy().to_string()))
        }
        Some(FilePath::Url(url)) => Ok(Some(url.to_string())),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::UserRole;

    #[test]
    fn renders_markdown_schedule_and_html_payroll_report() {
        let roster = vec![StaffDirectoryEntry {
            uid: "u1".to_string(),
            display_name: "Maya Patel".to_string(),
            role: UserRole::Staff,
            department: "Operations".to_string(),
            total_hours_worked: 16.0,
            scheduled_hours_this_week: 8.0,
            weekly_hours_target: 40.0,
            last_assigned_at: String::new(),
            is_sample_roster: false,
        }];
        let shifts = vec![Shift {
            id: "s1".to_string(),
            title: "Morning Ops".to_string(),
            department: "Operations".to_string(),
            date: "2026-11-24".to_string(),
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
        }];
        let reports = vec![ShiftReport {
            id: "r1".to_string(),
            shift_id: "s0".to_string(),
            shift_title: "Prior Shift".to_string(),
            staff_uid: "u1".to_string(),
            staff_name: "Maya Patel".to_string(),
            department: "Operations".to_string(),
            date: "2026-11-23".to_string(),
            actual_start_time: "07:00".to_string(),
            actual_end_time: "15:30".to_string(),
            break_minutes: 30,
            worked_hours: 8.0,
            handoff_notes: String::new(),
            status: ShiftReportStatus::Submitted,
            verified_by_uid: String::new(),
        }];

        let md = generate_schedule_markdown(&shifts, "Weekly Roster");
        assert!(md.contains("# Weekly Roster"));
        assert!(md.contains("| 2026-11-24 | 07:00-15:00 | Morning Ops |"));

        let rows = build_payroll_summary_rows(&roster, &shifts, &reports);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].pending_report_hours, 8.0);
        let html = generate_payroll_report_html(&rows, "Nov 2026");
        assert!(html.contains("Maya Patel"));
        assert!(html.contains("16.00h"));
    }
}
