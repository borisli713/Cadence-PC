use std::collections::HashMap;
use std::fs;

use chrono::{Datelike, NaiveDate, Weekday};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::fairness::parse_time_to_minutes;
use crate::models::{Shift, ShiftReport, ShiftReportStatus, ShiftStatus, StaffDirectoryEntry};
use crate::workspace_cache::WorkspaceCacheState;

pub const DEFAULT_OVERTIME_THRESHOLD_HOURS: f64 = 40.0;
pub const DEFAULT_OVERTIME_MULTIPLIER: f64 = 1.5;
pub const DEFAULT_NIGHT_DIFF_HOURS_WINDOW: (i32, i32) = (22 * 60, 6 * 60);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PayrollPolicyConfig {
    pub weekly_overtime_threshold: f64,
    pub base_hourly_rate: f64,
    pub overtime_multiplier: f64,
    pub night_differential_bonus: f64,
    pub weekend_differential_bonus: f64,
}

impl Default for PayrollPolicyConfig {
    fn default() -> Self {
        Self {
            weekly_overtime_threshold: DEFAULT_OVERTIME_THRESHOLD_HOURS,
            base_hourly_rate: 24.0,
            overtime_multiplier: DEFAULT_OVERTIME_MULTIPLIER,
            night_differential_bonus: 3.0,
            weekend_differential_bonus: 2.5,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StaffPayrollLine {
    pub uid: String,
    pub display_name: String,
    pub department: String,
    pub regular_hours: f64,
    pub overtime_hours: f64,
    pub night_hours: f64,
    pub weekend_hours: f64,
    pub total_credit_hours: f64,
    pub estimated_gross_pay: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DepartmentPayrollSummary {
    pub department: String,
    pub headcount: usize,
    pub total_hours: f64,
    pub overtime_hours: f64,
    pub estimated_payroll_cost: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PayrollBreakdownReport {
    pub policy: PayrollPolicyConfig,
    pub total_regular_hours: f64,
    pub total_overtime_hours: f64,
    pub total_night_hours: f64,
    pub total_weekend_hours: f64,
    pub total_estimated_payroll: f64,
    pub staff_lines: Vec<StaffPayrollLine>,
    pub department_summaries: Vec<DepartmentPayrollSummary>,
}

fn round2(val: f64) -> f64 {
    (val * 100.0).round() / 100.0
}

fn overlap_minutes(a_start: i32, a_end: i32, b_start: i32, b_end: i32) -> i32 {
    let start = a_start.max(b_start);
    let end = a_end.min(b_end);
    (end - start).max(0)
}

pub fn compute_night_differential_hours(start_hhmm: &str, end_hhmm: &str) -> f64 {
    let s = parse_time_to_minutes(start_hhmm);
    let mut e = parse_time_to_minutes(end_hhmm);
    if e <= s {
        e += 24 * 60;
    }

    let night_mins = overlap_minutes(s, e, 0, DEFAULT_NIGHT_DIFF_HOURS_WINDOW.1)
        + overlap_minutes(
            s,
            e,
            DEFAULT_NIGHT_DIFF_HOURS_WINDOW.0,
            24 * 60 + DEFAULT_NIGHT_DIFF_HOURS_WINDOW.1,
        )
        + overlap_minutes(s, e, 24 * 60 + DEFAULT_NIGHT_DIFF_HOURS_WINDOW.0, 48 * 60);

    round2(night_mins as f64 / 60.0)
}

pub fn is_weekend_iso_date(date_iso: &str) -> bool {
    let Ok(date) = NaiveDate::parse_from_str(date_iso.trim(), "%Y-%m-%d") else {
        return false;
    };
    matches!(date.weekday(), Weekday::Sat | Weekday::Sun)
}

pub fn compute_payroll_breakdown(
    staff_directory: &[StaffDirectoryEntry],
    shifts: &[Shift],
    shift_reports: &[ShiftReport],
    policy: &PayrollPolicyConfig,
) -> PayrollBreakdownReport {
    let mut verified_hours_by_uid: HashMap<&str, f64> = HashMap::new();
    let mut night_hours_by_uid: HashMap<&str, f64> = HashMap::new();
    let mut weekend_hours_by_uid: HashMap<&str, f64> = HashMap::new();

    for rep in shift_reports {
        if rep.status == ShiftReportStatus::Verified {
            *verified_hours_by_uid.entry(rep.staff_uid.as_str()).or_insert(0.0) +=
                rep.worked_hours.max(0.0);
            let night_h =
                compute_night_differential_hours(&rep.actual_start_time, &rep.actual_end_time);
            *night_hours_by_uid.entry(rep.staff_uid.as_str()).or_insert(0.0) += night_h;
            if is_weekend_iso_date(&rep.date) {
                *weekend_hours_by_uid.entry(rep.staff_uid.as_str()).or_insert(0.0) +=
                    rep.worked_hours.max(0.0);
            }
        }
    }

    let mut scheduled_hours_by_uid: HashMap<&str, f64> = HashMap::new();
    for shift in shifts {
        if shift.status == ShiftStatus::Open || shift.assigned_uid.trim().is_empty() {
            continue;
        }
        *scheduled_hours_by_uid
            .entry(shift.assigned_uid.as_str())
            .or_insert(0.0) += shift.duration_hours.max(0.0);
        if shift.status != ShiftStatus::Completed {
            let night_h = compute_night_differential_hours(&shift.start_time, &shift.end_time);
            *night_hours_by_uid
                .entry(shift.assigned_uid.as_str())
                .or_insert(0.0) += night_h;
            if is_weekend_iso_date(&shift.date) {
                *weekend_hours_by_uid
                    .entry(shift.assigned_uid.as_str())
                    .or_insert(0.0) += shift.duration_hours.max(0.0);
            }
        }
    }

    let ot_threshold = policy.weekly_overtime_threshold.max(1.0);
    let base_rate = policy.base_hourly_rate.max(0.0);
    let ot_mult = policy.overtime_multiplier.max(1.0);

    let mut staff_lines = Vec::with_capacity(staff_directory.len());
    let mut dept_map: HashMap<String, DepartmentPayrollSummary> = HashMap::new();

    let mut total_regular_hours = 0.0;
    let mut total_overtime_hours = 0.0;
    let mut total_night_hours = 0.0;
    let mut total_weekend_hours = 0.0;
    let mut total_estimated_payroll = 0.0;

    for member in staff_directory {
        let verified_from_reports = verified_hours_by_uid
            .get(member.uid.as_str())
            .copied()
            .unwrap_or(0.0);
        let logged = member.total_hours_worked.max(verified_from_reports);
        let scheduled = scheduled_hours_by_uid
            .get(member.uid.as_str())
            .copied()
            .unwrap_or(member.scheduled_hours_this_week);
        let total_credit = round2(logged.max(0.0) + scheduled.max(0.0));

        let regular_hours = round2(total_credit.min(ot_threshold));
        let overtime_hours = round2((total_credit - ot_threshold).max(0.0));
        let night_hours = round2(
            night_hours_by_uid
                .get(member.uid.as_str())
                .copied()
                .unwrap_or(0.0)
                .min(total_credit),
        );
        let weekend_hours = round2(
            weekend_hours_by_uid
                .get(member.uid.as_str())
                .copied()
                .unwrap_or(0.0)
                .min(total_credit),
        );

        let gross = round2(
            regular_hours * base_rate
                + overtime_hours * base_rate * ot_mult
                + night_hours * policy.night_differential_bonus.max(0.0)
                + weekend_hours * policy.weekend_differential_bonus.max(0.0),
        );

        total_regular_hours += regular_hours;
        total_overtime_hours += overtime_hours;
        total_night_hours += night_hours;
        total_weekend_hours += weekend_hours;
        total_estimated_payroll += gross;

        let dept = if member.department.trim().is_empty() {
            "Operations".to_string()
        } else {
            member.department.trim().to_string()
        };
        let dept_entry = dept_map
            .entry(dept.clone())
            .or_insert_with(|| DepartmentPayrollSummary {
                department: dept,
                headcount: 0,
                total_hours: 0.0,
                overtime_hours: 0.0,
                estimated_payroll_cost: 0.0,
            });
        dept_entry.headcount += 1;
        dept_entry.total_hours = round2(dept_entry.total_hours + total_credit);
        dept_entry.overtime_hours = round2(dept_entry.overtime_hours + overtime_hours);
        dept_entry.estimated_payroll_cost = round2(dept_entry.estimated_payroll_cost + gross);

        staff_lines.push(StaffPayrollLine {
            uid: member.uid.clone(),
            display_name: member.display_name.clone(),
            department: member.department.clone(),
            regular_hours,
            overtime_hours,
            night_hours,
            weekend_hours,
            total_credit_hours: total_credit,
            estimated_gross_pay: gross,
        });
    }

    staff_lines.sort_by(|a, b| a.display_name.cmp(&b.display_name));
    let mut department_summaries: Vec<DepartmentPayrollSummary> = dept_map.into_values().collect();
    department_summaries.sort_by(|a, b| a.department.cmp(&b.department));

    PayrollBreakdownReport {
        policy: policy.clone(),
        total_regular_hours: round2(total_regular_hours),
        total_overtime_hours: round2(total_overtime_hours),
        total_night_hours: round2(total_night_hours),
        total_weekend_hours: round2(total_weekend_hours),
        total_estimated_payroll: round2(total_estimated_payroll),
        staff_lines,
        department_summaries,
    }
}

pub fn render_payroll_breakdown_csv(report: &PayrollBreakdownReport) -> String {
    let mut lines = vec![
        "UID,Name,Department,Regular Hours,Overtime Hours,Night Diff Hours,Weekend Diff Hours,Total Hours,Estimated Gross Pay"
            .to_string(),
    ];
    for row in &report.staff_lines {
        let safe_name = row.display_name.replace('"', "\"\"");
        let safe_dept = row.department.replace('"', "\"\"");
        lines.push(format!(
            "{},\"{}\",\"{}\",{:.2},{:.2},{:.2},{:.2},{:.2},{:.2}",
            row.uid,
            safe_name,
            safe_dept,
            row.regular_hours,
            row.overtime_hours,
            row.night_hours,
            row.weekend_hours,
            row.total_credit_hours,
            row.estimated_gross_pay
        ));
    }
    lines.join("\r\n")
}

#[tauri::command]
pub fn compute_payroll_breakdown_cmd(
    cache: State<'_, WorkspaceCacheState>,
    policy: Option<PayrollPolicyConfig>,
) -> PayrollBreakdownReport {
    let snap = cache.current_snapshot();
    compute_payroll_breakdown(
        &snap.staff_directory,
        &snap.shifts,
        &snap.shift_reports,
        &policy.unwrap_or_default(),
    )
}

#[tauri::command]
pub async fn export_payroll_breakdown_csv_cmd(
    app: AppHandle,
    cache: State<'_, WorkspaceCacheState>,
    policy: Option<PayrollPolicyConfig>,
    default_filename: Option<String>,
) -> Result<Option<String>, String> {
    let snap = cache.current_snapshot();
    let breakdown = compute_payroll_breakdown(
        &snap.staff_directory,
        &snap.shifts,
        &snap.shift_reports,
        &policy.unwrap_or_default(),
    );
    let csv = render_payroll_breakdown_csv(&breakdown);
    let file_name = default_filename.unwrap_or_else(|| "cadence-payroll-breakdown.csv".to_string());

    let selected = app
        .dialog()
        .file()
        .add_filter("CSV", &["csv"])
        .set_file_name(&file_name)
        .blocking_save_file();

    match selected {
        Some(FilePath::Path(path)) => {
            fs::write(&path, csv.as_bytes())
                .map_err(|e| format!("Failed to save payroll breakdown CSV: {e}"))?;
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

    fn mk_member(uid: &str, worked: f64) -> StaffDirectoryEntry {
        StaffDirectoryEntry {
            uid: uid.to_string(),
            display_name: format!("Staff {uid}"),
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
    fn computes_night_shift_and_weekend_differentials() {
        assert_eq!(compute_night_differential_hours("22:00", "06:00"), 8.0);
        assert_eq!(compute_night_differential_hours("07:00", "15:00"), 0.0);
        assert_eq!(compute_night_differential_hours("18:00", "02:00"), 4.0);
        assert!(is_weekend_iso_date("2026-11-21")); // Saturday
        assert!(is_weekend_iso_date("2026-11-22")); // Sunday
        assert!(!is_weekend_iso_date("2026-11-23")); // Monday
    }

    #[test]
    fn calculates_overtime_and_premiums_into_payroll_breakdown() {
        let roster = vec![mk_member("u1", 36.0)];
        let shifts = vec![Shift {
            id: "s_wknd".to_string(),
            title: "Overnight Saturday".to_string(),
            department: "Operations".to_string(),
            date: "2026-11-21".to_string(),
            start_time: "22:00".to_string(),
            end_time: "06:00".to_string(),
            duration_hours: 8.0,
            assigned_uid: "u1".to_string(),
            assigned_name: "Staff u1".to_string(),
            candidate_uids: vec![],
            status: ShiftStatus::Scheduled,
            visibility: "team".to_string(),
            fairness_note: String::new(),
            created_by: "mgr".to_string(),
        }];
        let policy = PayrollPolicyConfig::default();
        let report = compute_payroll_breakdown(&roster, &shifts, &[], &policy);
        assert_eq!(report.staff_lines.len(), 1);
        let line = &report.staff_lines[0];
        assert_eq!(line.regular_hours, 40.0);
        assert_eq!(line.overtime_hours, 4.0);
        assert_eq!(line.night_hours, 8.0);
        assert_eq!(line.weekend_hours, 8.0);
        // 40*24 + 4*24*1.5 + 8*3 + 8*2.5 = 960 + 144 + 24 + 20 = 1148
        assert_eq!(line.estimated_gross_pay, 1148.0);
    }
}
