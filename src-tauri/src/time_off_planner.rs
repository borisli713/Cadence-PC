use std::collections::{BTreeMap, HashMap};

use chrono::{Duration, NaiveDate};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::models::{
    ApprovalStatus, Shift, ShiftStatus, StaffDirectoryEntry, TimeOffRequest, UserRole,
};
use crate::workspace_cache::WorkspaceCacheState;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimeOffShiftConflict {
    pub request_id: String,
    pub staff_uid: String,
    pub staff_name: String,
    pub shift_id: String,
    pub shift_title: String,
    pub shift_date: String,
    pub shift_window: String,
    pub department: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DepartmentAbsenceDay {
    pub date: String,
    pub department: String,
    pub absent_staff_count: usize,
    pub department_headcount: usize,
    pub absence_ratio_percent: i64,
    pub absent_staff_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimeOffImpactAssessment {
    pub request_id: String,
    pub staff_uid: String,
    pub requested_days: usize,
    pub impacted_shifts: Vec<TimeOffShiftConflict>,
    pub concurrent_teammate_absences: usize,
    pub safe_to_approve: bool,
    pub summary: String,
}

fn parse_iso(raw: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(raw.trim(), "%Y-%m-%d").ok()
}

pub fn analyze_time_off_shift_conflicts(
    shifts: &[Shift],
    time_off_requests: &[TimeOffRequest],
    include_pending: bool,
) -> Vec<TimeOffShiftConflict> {
    let mut conflicts = Vec::new();
    for req in time_off_requests {
        let relevant = match req.status {
            ApprovalStatus::Approved => true,
            ApprovalStatus::Pending => include_pending,
            ApprovalStatus::Denied => false,
        };
        if !relevant {
            continue;
        }
        for sh in shifts {
            if sh.status == ShiftStatus::Completed || sh.assigned_uid != req.staff_uid {
                continue;
            }
            if sh.date >= req.start_date && sh.date <= req.end_date {
                conflicts.push(TimeOffShiftConflict {
                    request_id: req.id.clone(),
                    staff_uid: req.staff_uid.clone(),
                    staff_name: req.staff_name.clone(),
                    shift_id: sh.id.clone(),
                    shift_title: sh.title.clone(),
                    shift_date: sh.date.clone(),
                    shift_window: format!("{}-{}", sh.start_time, sh.end_time),
                    department: sh.department.clone(),
                });
            }
        }
    }
    conflicts.sort_by(|a, b| a.shift_date.cmp(&b.shift_date).then_with(|| a.staff_name.cmp(&b.staff_name)));
    conflicts
}

pub fn compute_department_absence_calendar(
    staff_directory: &[StaffDirectoryEntry],
    time_off_requests: &[TimeOffRequest],
    include_pending: bool,
) -> Vec<DepartmentAbsenceDay> {
    let mut headcounts: HashMap<String, usize> = HashMap::new();
    for member in staff_directory {
        if member.role != UserRole::Staff {
            continue;
        }
        let dept = if member.department.trim().is_empty() {
            "Operations".to_string()
        } else {
            member.department.trim().to_string()
        };
        *headcounts.entry(dept).or_insert(0) += 1;
    }

    let mut day_dept_names: BTreeMap<(String, String), Vec<String>> = BTreeMap::new();
    for req in time_off_requests {
        let relevant = match req.status {
            ApprovalStatus::Approved => true,
            ApprovalStatus::Pending => include_pending,
            ApprovalStatus::Denied => false,
        };
        if !relevant {
            continue;
        }
        let (Some(start), Some(end)) = (parse_iso(&req.start_date), parse_iso(&req.end_date)) else {
            continue;
        };
        if end < start {
            continue;
        }
        let dept = if req.department.trim().is_empty() {
            "Operations".to_string()
        } else {
            req.department.trim().to_string()
        };
        let span_days = (end - start).num_days().clamp(0, 60);
        for offset in 0..=span_days {
            let cur = (start + Duration::days(offset)).format("%Y-%m-%d").to_string();
            let entry = day_dept_names.entry((cur, dept.clone())).or_default();
            if !entry.contains(&req.staff_name) {
                entry.push(req.staff_name.clone());
            }
        }
    }

    day_dept_names
        .into_iter()
        .map(|((date, department), names)| {
            let department_headcount = headcounts.get(&department).copied().unwrap_or(0);
            let absent_staff_count = names.len();
            let absence_ratio_percent = if department_headcount > 0 {
                ((absent_staff_count as f64 / department_headcount as f64) * 100.0).round() as i64
            } else {
                0
            };
            DepartmentAbsenceDay {
                date,
                department,
                absent_staff_count,
                department_headcount,
                absence_ratio_percent,
                absent_staff_names: names,
            }
        })
        .collect()
}

pub fn evaluate_time_off_request_impact(
    req: &TimeOffRequest,
    shifts: &[Shift],
    all_requests: &[TimeOffRequest],
) -> TimeOffImpactAssessment {
    let requested_days = match (parse_iso(&req.start_date), parse_iso(&req.end_date)) {
        (Some(s), Some(e)) if e >= s => ((e - s).num_days() + 1) as usize,
        _ => 0,
    };

    let impacted_shifts = analyze_time_off_shift_conflicts(shifts, std::slice::from_ref(req), true);
    let concurrent_teammate_absences = all_requests
        .iter()
        .filter(|other| {
            other.id != req.id
                && other.staff_uid != req.staff_uid
                && other.department.eq_ignore_ascii_case(&req.department)
                && other.status == ApprovalStatus::Approved
                && other.start_date <= req.end_date
                && other.end_date >= req.start_date
        })
        .count();

    let safe_to_approve = impacted_shifts.is_empty() && concurrent_teammate_absences < 2;
    let summary = if safe_to_approve {
        format!(
            "Clean to approve {} day(s) off for {}: 0 shift conflicts and {} overlapping department absence(s).",
            requested_days, req.staff_name, concurrent_teammate_absences
        )
    } else {
        format!(
            "Review needed for {}: {} assigned shift conflict(s) and {} overlapping {} leave(s).",
            req.staff_name,
            impacted_shifts.len(),
            concurrent_teammate_absences,
            req.department
        )
    };

    TimeOffImpactAssessment {
        request_id: req.id.clone(),
        staff_uid: req.staff_uid.clone(),
        requested_days,
        impacted_shifts,
        concurrent_teammate_absences,
        safe_to_approve,
        summary,
    }
}

#[tauri::command]
pub fn analyze_time_off_shift_conflicts_cmd(
    cache: State<'_, WorkspaceCacheState>,
    include_pending: Option<bool>,
) -> Vec<TimeOffShiftConflict> {
    let snap = cache.current_snapshot();
    analyze_time_off_shift_conflicts(
        &snap.shifts,
        &snap.time_off_requests,
        include_pending.unwrap_or(true),
    )
}

#[tauri::command]
pub fn compute_department_absence_calendar_cmd(
    cache: State<'_, WorkspaceCacheState>,
    include_pending: Option<bool>,
) -> Vec<DepartmentAbsenceDay> {
    let snap = cache.current_snapshot();
    compute_department_absence_calendar(
        &snap.staff_directory,
        &snap.time_off_requests,
        include_pending.unwrap_or(false),
    )
}

#[tauri::command]
pub fn evaluate_time_off_request_impact_cmd(
    cache: State<'_, WorkspaceCacheState>,
    request: TimeOffRequest,
) -> TimeOffImpactAssessment {
    let snap = cache.current_snapshot();
    evaluate_time_off_request_impact(&request, &snap.shifts, &snap.time_off_requests)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_req(id: &str, uid: &str, start: &str, end: &str, status: ApprovalStatus) -> TimeOffRequest {
        TimeOffRequest {
            id: id.to_string(),
            staff_uid: uid.to_string(),
            staff_name: format!("Staff {uid}"),
            department: "Operations".to_string(),
            start_date: start.to_string(),
            end_date: end.to_string(),
            reason: "Family".to_string(),
            status,
            reviewed_by_uid: String::new(),
            reviewed_by_name: String::new(),
            review_note: String::new(),
        }
    }

    #[test]
    fn detects_assigned_shift_conflicts_and_concurrent_department_absences() {
        let shift = Shift {
            id: "sh_1".to_string(),
            title: "Morning Ops".to_string(),
            department: "Operations".to_string(),
            date: "2026-11-24".to_string(),
            start_time: "07:00".to_string(),
            end_time: "15:00".to_string(),
            duration_hours: 8.0,
            assigned_uid: "u1".to_string(),
            assigned_name: "Staff u1".to_string(),
            candidate_uids: vec![],
            status: ShiftStatus::Scheduled,
            visibility: "team".to_string(),
            fairness_note: String::new(),
            created_by: "mgr".to_string(),
        };
        let req_u1 = mk_req("to_1", "u1", "2026-11-23", "2026-11-25", ApprovalStatus::Pending);
        let req_u2 = mk_req("to_2", "u2", "2026-11-24", "2026-11-24", ApprovalStatus::Approved);

        let impact = evaluate_time_off_request_impact(&req_u1, &[shift], &[req_u1.clone(), req_u2.clone()]);
        assert_eq!(impact.requested_days, 3);
        assert_eq!(impact.impacted_shifts.len(), 1);
        assert_eq!(impact.concurrent_teammate_absences, 1);
        assert!(!impact.safe_to_approve);

        let roster = vec![
            StaffDirectoryEntry {
                uid: "u1".to_string(),
                display_name: "Staff u1".to_string(),
                role: UserRole::Staff,
                department: "Operations".to_string(),
                total_hours_worked: 0.0,
                scheduled_hours_this_week: 0.0,
                weekly_hours_target: 40.0,
                last_assigned_at: String::new(),
                is_sample_roster: false,
            },
            StaffDirectoryEntry {
                uid: "u2".to_string(),
                display_name: "Staff u2".to_string(),
                role: UserRole::Staff,
                department: "Operations".to_string(),
                total_hours_worked: 0.0,
                scheduled_hours_this_week: 0.0,
                weekly_hours_target: 40.0,
                last_assigned_at: String::new(),
                is_sample_roster: false,
            },
        ];
        let cal = compute_department_absence_calendar(&roster, &[req_u1, req_u2], true);
        let nov24 = cal.iter().find(|d| d.date == "2026-11-24").unwrap();
        assert_eq!(nov24.absent_staff_count, 2);
        assert_eq!(nov24.absence_ratio_percent, 100);
    }
}
