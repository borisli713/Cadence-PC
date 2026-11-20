use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::fairness::{compute_shift_hours, find_staff_conflicts, is_staff_on_approved_time_off};
use crate::models::{Shift, ShiftStatus, StaffDirectoryEntry, TimeOffRequest, WeekSlotConfig};
use crate::validation::{is_valid_hhmm, is_valid_iso_date};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictReportItem {
    pub shift_id: String,
    pub shift_title: String,
    pub date: String,
    pub start_time: String,
    pub end_time: String,
    pub assigned_uid: String,
    pub assigned_name: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DepartmentCoverageSummary {
    pub department: String,
    pub total_shifts: usize,
    pub open_shifts: usize,
    pub conflict_shifts: usize,
    pub completed_shifts: usize,
    pub total_hours: f64,
}

pub fn detect_schedule_conflicts(
    shifts: &[Shift],
    time_off_requests: &[TimeOffRequest],
) -> Vec<ConflictReportItem> {
    let mut reports = Vec::new();
    for shift in shifts {
        if shift.status == ShiftStatus::Open || shift.assigned_uid.trim().is_empty() {
            continue;
        }
        let overlaps = find_staff_conflicts(
            shifts,
            &shift.assigned_uid,
            &shift.date,
            &shift.start_time,
            &shift.end_time,
            Some(&shift.id),
        );
        if !overlaps.is_empty() {
            let names: Vec<String> = overlaps.iter().map(|s| s.title.clone()).collect();
            reports.push(ConflictReportItem {
                shift_id: shift.id.clone(),
                shift_title: shift.title.clone(),
                date: shift.date.clone(),
                start_time: shift.start_time.clone(),
                end_time: shift.end_time.clone(),
                assigned_uid: shift.assigned_uid.clone(),
                assigned_name: shift.assigned_name.clone(),
                reason: format!("Overlaps with {}", names.join(", ")),
            });
            continue;
        }

        let to = is_staff_on_approved_time_off(&shift.assigned_uid, &shift.date, time_off_requests);
        if to.has_time_off {
            reports.push(ConflictReportItem {
                shift_id: shift.id.clone(),
                shift_title: shift.title.clone(),
                date: shift.date.clone(),
                start_time: shift.start_time.clone(),
                end_time: shift.end_time.clone(),
                assigned_uid: shift.assigned_uid.clone(),
                assigned_name: shift.assigned_name.clone(),
                reason: format!(
                    "Assigned during approved time off ({})",
                    to.reason.unwrap_or_else(|| "Approved leave".to_string())
                ),
            });
        }
    }
    reports
}

pub fn summarize_department_coverage(shifts: &[Shift]) -> Vec<DepartmentCoverageSummary> {
    let mut by_dept: HashMap<String, DepartmentCoverageSummary> = HashMap::new();
    for s in shifts {
        let dept = if s.department.trim().is_empty() {
            "Operations".to_string()
        } else {
            s.department.trim().to_string()
        };
        let entry = by_dept.entry(dept.clone()).or_insert_with(|| DepartmentCoverageSummary {
            department: dept,
            total_shifts: 0,
            open_shifts: 0,
            conflict_shifts: 0,
            completed_shifts: 0,
            total_hours: 0.0,
        });
        entry.total_shifts += 1;
        entry.total_hours += s.duration_hours;
        match s.status {
            ShiftStatus::Open => entry.open_shifts += 1,
            ShiftStatus::Conflict => entry.conflict_shifts += 1,
            ShiftStatus::Completed => entry.completed_shifts += 1,
            _ => {}
        }
    }
    let mut list: Vec<DepartmentCoverageSummary> = by_dept.into_values().collect();
    for item in &mut list {
        item.total_hours = (item.total_hours * 100.0).round() / 100.0;
    }
    list.sort_by(|a, b| a.department.cmp(&b.department));
    list
}

pub fn validate_week_slots(slots: &[WeekSlotConfig]) -> Result<(), String> {
    if slots.is_empty() {
        return Err("At least one weekly shift slot template is required.".to_string());
    }
    for slot in slots {
        if slot.title.trim().is_empty() {
            return Err("Every shift slot template requires a non-empty title.".to_string());
        }
        if !is_valid_hhmm(&slot.start_time) || !is_valid_hhmm(&slot.end_time) {
            return Err(format!("Invalid HH:MM window on slot '{}'.", slot.label));
        }
        if compute_shift_hours(&slot.start_time, &slot.end_time, 0) < 0.25 {
            return Err(format!("Slot '{}' must be at least 15 minutes.", slot.label));
        }
    }
    Ok(())
}

pub fn eligible_open_shift_claimants<'a>(
    shift: &Shift,
    staff_directory: &'a [StaffDirectoryEntry],
    all_shifts: &[Shift],
    time_off_requests: &[TimeOffRequest],
) -> Vec<&'a StaffDirectoryEntry> {
    if shift.status != ShiftStatus::Open || !is_valid_iso_date(&shift.date) {
        return Vec::new();
    }
    staff_directory
        .iter()
        .filter(|member| {
            let conflicts = find_staff_conflicts(
                all_shifts,
                &member.uid,
                &shift.date,
                &shift.start_time,
                &shift.end_time,
                Some(&shift.id),
            );
            let time_off = is_staff_on_approved_time_off(&member.uid, &shift.date, time_off_requests);
            conflicts.is_empty() && !time_off.has_time_off
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ApprovalStatus, UserRole};

    fn mk_shift(id: &str, uid: &str, name: &str, date: &str, start: &str, end: &str, status: ShiftStatus) -> Shift {
        Shift {
            id: id.to_string(),
            title: format!("Shift {}", id),
            department: "Operations".to_string(),
            date: date.to_string(),
            start_time: start.to_string(),
            end_time: end.to_string(),
            duration_hours: compute_shift_hours(start, end, 0),
            assigned_uid: uid.to_string(),
            assigned_name: name.to_string(),
            candidate_uids: vec![],
            status,
            visibility: "team".to_string(),
            fairness_note: String::new(),
            created_by: "mgr".to_string(),
        }
    }

    #[test]
    fn detects_overlapping_and_time_off_conflicts() {
        let s1 = mk_shift("1", "u1", "Maya", "2026-11-23", "07:00", "15:00", ShiftStatus::Scheduled);
        let s2 = mk_shift("2", "u1", "Maya", "2026-11-23", "12:00", "20:00", ShiftStatus::Scheduled);
        let s3 = mk_shift("3", "u2", "Liam", "2026-11-24", "09:00", "17:00", ShiftStatus::Scheduled);
        let to = vec![TimeOffRequest {
            id: "to1".to_string(),
            staff_uid: "u2".to_string(),
            staff_name: "Liam".to_string(),
            department: "Operations".to_string(),
            start_date: "2026-11-24".to_string(),
            end_date: "2026-11-25".to_string(),
            reason: "Medical".to_string(),
            status: ApprovalStatus::Approved,
            reviewed_by_uid: String::new(),
            reviewed_by_name: String::new(),
            review_note: String::new(),
        }];

        let reports = detect_schedule_conflicts(&[s1, s2, s3], &to);
        assert_eq!(reports.len(), 3);
        assert!(reports[2].reason.contains("approved time off"));
    }

    #[test]
    fn filters_eligible_open_shift_claimants() {
        let open = mk_shift("open1", "", "", "2026-11-23", "09:00", "17:00", ShiftStatus::Open);
        let busy = mk_shift("busy1", "u1", "Maya", "2026-11-23", "08:00", "12:00", ShiftStatus::Scheduled);
        let roster = vec![
            StaffDirectoryEntry {
                uid: "u1".to_string(),
                display_name: "Maya".to_string(),
                role: UserRole::Staff,
                department: "Operations".to_string(),
                total_hours_worked: 10.0,
                scheduled_hours_this_week: 4.0,
                weekly_hours_target: 40.0,
                last_assigned_at: String::new(),
                is_sample_roster: false,
            },
            StaffDirectoryEntry {
                uid: "u2".to_string(),
                display_name: "Liam".to_string(),
                role: UserRole::Staff,
                department: "Operations".to_string(),
                total_hours_worked: 12.0,
                scheduled_hours_this_week: 0.0,
                weekly_hours_target: 40.0,
                last_assigned_at: String::new(),
                is_sample_roster: false,
            },
        ];

        let eligible = eligible_open_shift_claimants(&open, &roster, &[open.clone(), busy], &[]);
        assert_eq!(eligible.len(), 1);
        assert_eq!(eligible[0].uid, "u2");
    }
}
