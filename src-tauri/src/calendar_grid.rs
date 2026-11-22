use std::collections::{BTreeMap, HashMap};

use chrono::{Datelike, Duration, NaiveDate};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::fairness::shifts_time_overlap;
use crate::models::{Shift, ShiftStatus, ShiftSubmission, SubmissionStatus, TimeOffRequest};
use crate::workspace_cache::WorkspaceCacheState;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CalendarDayCell {
    pub date: String,
    pub day_of_month: u32,
    pub is_current_month: bool,
    pub total_shifts: usize,
    pub scheduled_count: usize,
    pub open_count: usize,
    pub conflict_count: usize,
    pub completed_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyCoverageDay {
    pub date: String,
    pub weekday_label: String,
    pub total_shifts: usize,
    pub assigned_shifts: usize,
    pub open_shifts: usize,
    pub conflict_shifts: usize,
    pub scheduled_hours: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AvailabilityMatchSummary {
    pub shift_id: String,
    pub shift_title: String,
    pub date: String,
    pub matching_submission_uids: Vec<String>,
    pub match_count: usize,
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

pub fn build_month_calendar_grid(
    year: i32,
    month: u32,
    shifts: &[Shift],
) -> Result<Vec<CalendarDayCell>, String> {
    let first_of_month = NaiveDate::from_ymd_opt(year, month, 1)
        .ok_or_else(|| format!("Invalid calendar year/month: {year}-{month:02}"))?;

    let mut counts_by_date: HashMap<&str, (usize, usize, usize, usize, usize)> = HashMap::new();
    for s in shifts {
        let entry = counts_by_date.entry(s.date.as_str()).or_insert((0, 0, 0, 0, 0));
        entry.0 += 1;
        match s.status {
            ShiftStatus::Scheduled | ShiftStatus::PendingChange => entry.1 += 1,
            ShiftStatus::Open => entry.2 += 1,
            ShiftStatus::Conflict => entry.3 += 1,
            ShiftStatus::Completed => entry.4 += 1,
        }
    }

    let leading_days = first_of_month.weekday().num_days_from_monday() as i64;
    let grid_start = first_of_month - Duration::days(leading_days);
    let mut cells = Vec::with_capacity(42);

    for offset in 0..42i64 {
        let cur = grid_start + Duration::days(offset);
        let iso = cur.format("%Y-%m-%d").to_string();
        let (total, scheduled, open, conflict, completed) =
            counts_by_date.get(iso.as_str()).copied().unwrap_or((0, 0, 0, 0, 0));

        cells.push(CalendarDayCell {
            date: iso,
            day_of_month: cur.day(),
            is_current_month: cur.month() == month && cur.year() == year,
            total_shifts: total,
            scheduled_count: scheduled,
            open_count: open,
            conflict_count: conflict,
            completed_count: completed,
        });
    }

    Ok(cells)
}

pub fn build_weekly_coverage_matrix(
    monday_iso: &str,
    shifts: &[Shift],
) -> Result<Vec<WeeklyCoverageDay>, String> {
    let monday = NaiveDate::parse_from_str(monday_iso.trim(), "%Y-%m-%d")
        .map_err(|_| "Week start date must follow YYYY-MM-DD.".to_string())?;

    let mut by_date: BTreeMap<String, Vec<&Shift>> = BTreeMap::new();
    for s in shifts {
        by_date.entry(s.date.clone()).or_default().push(s);
    }

    let labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    let mut days = Vec::with_capacity(7);

    for offset in 0..7i64 {
        let cur = monday + Duration::days(offset);
        let iso = cur.format("%Y-%m-%d").to_string();
        let day_shifts = by_date.get(&iso).cloned().unwrap_or_default();

        let mut assigned_shifts = 0usize;
        let mut open_shifts = 0usize;
        let mut conflict_shifts = 0usize;
        let mut scheduled_hours = 0.0;

        for s in &day_shifts {
            match s.status {
                ShiftStatus::Open => open_shifts += 1,
                ShiftStatus::Conflict => {
                    conflict_shifts += 1;
                    scheduled_hours += s.duration_hours;
                }
                _ => {
                    if !s.assigned_uid.trim().is_empty() {
                        assigned_shifts += 1;
                        scheduled_hours += s.duration_hours;
                    }
                }
            }
        }

        days.push(WeeklyCoverageDay {
            date: iso,
            weekday_label: labels[offset as usize].to_string(),
            total_shifts: day_shifts.len(),
            assigned_shifts,
            open_shifts,
            conflict_shifts,
            scheduled_hours: round2(scheduled_hours),
        });
    }

    Ok(days)
}

pub fn compute_staff_availability_overlap(
    shifts: &[Shift],
    submissions: &[ShiftSubmission],
    time_off_requests: &[TimeOffRequest],
) -> Vec<AvailabilityMatchSummary> {
    let active_subs: Vec<&ShiftSubmission> = submissions
        .iter()
        .filter(|s| s.status == SubmissionStatus::Submitted)
        .collect();

    let mut out = Vec::new();
    for shift in shifts {
        if shift.status != ShiftStatus::Open {
            continue;
        }
        let mut matched_uids = Vec::new();
        for sub in &active_subs {
            if sub.date != shift.date {
                continue;
            }
            if !shifts_time_overlap(
                &sub.date,
                &sub.start_time,
                &sub.end_time,
                &shift.date,
                &shift.start_time,
                &shift.end_time,
            ) {
                continue;
            }
            let blocked_by_leave = time_off_requests.iter().any(|to| {
                to.staff_uid == sub.staff_uid
                    && to.status == crate::models::ApprovalStatus::Approved
                    && shift.date >= to.start_date
                    && shift.date <= to.end_date
            });
            if !blocked_by_leave && !matched_uids.contains(&sub.staff_uid) {
                matched_uids.push(sub.staff_uid.clone());
            }
        }
        out.push(AvailabilityMatchSummary {
            shift_id: shift.id.clone(),
            shift_title: shift.title.clone(),
            date: shift.date.clone(),
            match_count: matched_uids.len(),
            matching_submission_uids: matched_uids,
        });
    }
    out
}

#[tauri::command]
pub fn build_month_calendar_grid_cmd(
    cache: State<'_, WorkspaceCacheState>,
    year: i32,
    month: u32,
) -> Result<Vec<CalendarDayCell>, String> {
    let snap = cache.current_snapshot();
    build_month_calendar_grid(year, month, &snap.shifts)
}

#[tauri::command]
pub fn build_weekly_coverage_matrix_cmd(
    cache: State<'_, WorkspaceCacheState>,
    monday_iso: String,
) -> Result<Vec<WeeklyCoverageDay>, String> {
    let snap = cache.current_snapshot();
    build_weekly_coverage_matrix(&monday_iso, &snap.shifts)
}

#[tauri::command]
pub fn compute_staff_availability_overlap_cmd(
    cache: State<'_, WorkspaceCacheState>,
) -> Vec<AvailabilityMatchSummary> {
    let snap = cache.current_snapshot();
    compute_staff_availability_overlap(
        &snap.shifts,
        &snap.shift_submissions,
        &snap.time_off_requests,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ApprovalStatus;

    fn mk_shift(id: &str, date: &str, status: ShiftStatus, uid: &str) -> Shift {
        Shift {
            id: id.to_string(),
            title: format!("Shift {id}"),
            department: "Operations".to_string(),
            date: date.to_string(),
            start_time: "08:00".to_string(),
            end_time: "16:00".to_string(),
            duration_hours: 8.0,
            assigned_uid: uid.to_string(),
            assigned_name: uid.to_string(),
            candidate_uids: vec![],
            status,
            visibility: "team".to_string(),
            fairness_note: String::new(),
            created_by: "mgr".to_string(),
        }
    }

    #[test]
    fn builds_42_cell_month_grid_with_shift_status_counts() {
        let shifts = vec![
            mk_shift("s1", "2026-11-23", ShiftStatus::Scheduled, "u1"),
            mk_shift("s2", "2026-11-23", ShiftStatus::Open, ""),
            mk_shift("s3", "2026-11-24", ShiftStatus::Conflict, "u2"),
        ];
        let cells = build_month_calendar_grid(2026, 11, &shifts).expect("valid month");
        assert_eq!(cells.len(), 42);
        let nov23 = cells.iter().find(|c| c.date == "2026-11-23").unwrap();
        assert_eq!(nov23.total_shifts, 2);
        assert_eq!(nov23.scheduled_count, 1);
        assert_eq!(nov23.open_count, 1);
        assert!(nov23.is_current_month);
    }

    #[test]
    fn builds_weekly_coverage_matrix_and_excludes_time_off_in_availability_matches() {
        let open = mk_shift("s_open", "2026-11-23", ShiftStatus::Open, "");
        let assigned = mk_shift("s_ok", "2026-11-24", ShiftStatus::Scheduled, "u1");
        let matrix = build_weekly_coverage_matrix("2026-11-23", &[open.clone(), assigned]).unwrap();
        assert_eq!(matrix.len(), 7);
        assert_eq!(matrix[0].open_shifts, 1);
        assert_eq!(matrix[1].assigned_shifts, 1);
        assert_eq!(matrix[1].scheduled_hours, 8.0);

        let subs = vec![
            ShiftSubmission {
                id: "sub1".to_string(),
                staff_uid: "u1".to_string(),
                staff_name: "Maya".to_string(),
                department: "Ops".to_string(),
                date: "2026-11-23".to_string(),
                start_time: "08:00".to_string(),
                end_time: "16:00".to_string(),
                shift_title: "Day".to_string(),
                notes: String::new(),
                status: SubmissionStatus::Submitted,
            },
            ShiftSubmission {
                id: "sub2".to_string(),
                staff_uid: "u2".to_string(),
                staff_name: "Liam".to_string(),
                department: "Ops".to_string(),
                date: "2026-11-23".to_string(),
                start_time: "08:00".to_string(),
                end_time: "16:00".to_string(),
                shift_title: "Day".to_string(),
                notes: String::new(),
                status: SubmissionStatus::Submitted,
            },
        ];
        let to = vec![TimeOffRequest {
            id: "to1".to_string(),
            staff_uid: "u2".to_string(),
            staff_name: "Liam".to_string(),
            department: "Ops".to_string(),
            start_date: "2026-11-20".to_string(),
            end_date: "2026-11-25".to_string(),
            reason: "Leave".to_string(),
            status: ApprovalStatus::Approved,
            reviewed_by_uid: String::new(),
            reviewed_by_name: String::new(),
            review_note: String::new(),
        }];

        let matches = compute_staff_availability_overlap(&[open], &subs, &to);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].matching_submission_uids, vec!["u1".to_string()]);
    }
}
