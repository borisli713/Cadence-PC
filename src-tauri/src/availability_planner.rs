use std::collections::{BTreeMap, HashSet};

use chrono::{Duration, NaiveDate};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::fairness::{compute_shift_hours, parse_time_to_minutes, shifts_time_overlap};
use crate::models::{
    ApprovalStatus, Shift, ShiftSubmission, StaffDirectoryEntry, SubmissionStatus, TimeOffRequest,
    WeekSlotConfig,
};
use crate::validation::validate_shift_input;
use crate::workspace_cache::WorkspaceCacheState;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlannedSubmissionDate {
    pub date: String,
    pub valid: bool,
    pub conflicts_with_time_off: bool,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AvailabilityBatchPlan {
    pub accepted_dates: Vec<String>,
    pub skipped_dates: Vec<PlannedSubmissionDate>,
    pub total_hours_requested: f64,
    pub consecutive_days_streak: usize,
    pub fatigue_warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SlotCoverageCell {
    pub date: String,
    pub slot_id: String,
    pub slot_label: String,
    pub department: String,
    pub start_time: String,
    pub end_time: String,
    pub existing_shifts: usize,
    pub eligible_submissions: usize,
    pub status_tag: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyAvailabilityCoverage {
    pub monday_iso: String,
    pub total_slots: usize,
    pub well_covered_slots: usize,
    pub under_covered_slots: usize,
    pub cells: Vec<SlotCoverageCell>,
}

fn is_valid_iso_date(date_str: &str) -> bool {
    NaiveDate::parse_from_str(date_str.trim(), "%Y-%m-%d").is_ok()
}

pub fn max_consecutive_iso_days(dates: &[String]) -> usize {
    let mut parsed: Vec<NaiveDate> = dates
        .iter()
        .filter_map(|d| NaiveDate::parse_from_str(d.trim(), "%Y-%m-%d").ok())
        .collect();
    if parsed.is_empty() {
        return 0;
    }
    parsed.sort();
    parsed.dedup();

    let mut best = 1usize;
    let mut current = 1usize;
    for pair in parsed.windows(2) {
        if (pair[1] - pair[0]).num_days() == 1 {
            current += 1;
            best = best.max(current);
        } else {
            current = 1;
        }
    }
    best
}

pub fn plan_staff_availability_batch(
    staff_uid: &str,
    dates: &[String],
    start_time: &str,
    end_time: &str,
    shift_title: &str,
    department: &str,
    existing_submissions: &[ShiftSubmission],
    time_off_requests: &[TimeOffRequest],
) -> Result<AvailabilityBatchPlan, String> {
    let first_valid_date = dates
        .iter()
        .find(|d| is_valid_iso_date(d))
        .cloned()
        .ok_or_else(|| "Select at least one valid YYYY-MM-DD date.".to_string())?;

    let effective_title = if shift_title.trim().is_empty() {
        "Submitted Availability"
    } else {
        shift_title.trim()
    };
    let effective_dept = if department.trim().is_empty() {
        "Operations"
    } else {
        department.trim()
    };

    let check = validate_shift_input(
        effective_title,
        effective_dept,
        &first_valid_date,
        start_time,
        end_time,
    );
    if !check.valid {
        return Err(check
            .error_message
            .unwrap_or_else(|| "Invalid availability time window.".to_string()));
    }

    let shift_hours = compute_shift_hours(start_time, end_time, 0);
    let mut seen = HashSet::new();
    let mut accepted_dates = Vec::new();
    let mut skipped_dates = Vec::new();

    for raw in dates {
        let trimmed = raw.trim().to_string();
        if trimmed.is_empty() || !seen.insert(trimmed.clone()) {
            continue;
        }
        if !is_valid_iso_date(&trimmed) {
            skipped_dates.push(PlannedSubmissionDate {
                date: trimmed,
                valid: false,
                conflicts_with_time_off: false,
                note: "Invalid date format (expected YYYY-MM-DD).".to_string(),
            });
            continue;
        }

        let blocked_by_leave = time_off_requests.iter().any(|to| {
            to.staff_uid == staff_uid
                && to.status == ApprovalStatus::Approved
                && trimmed >= to.start_date
                && trimmed <= to.end_date
        });
        if blocked_by_leave {
            skipped_dates.push(PlannedSubmissionDate {
                date: trimmed,
                valid: false,
                conflicts_with_time_off: true,
                note: "Overlaps approved time-off request.".to_string(),
            });
            continue;
        }

        let duplicate_sub = existing_submissions.iter().any(|sub| {
            sub.staff_uid == staff_uid
                && sub.status == SubmissionStatus::Submitted
                && shifts_time_overlap(
                    &sub.date,
                    &sub.start_time,
                    &sub.end_time,
                    &trimmed,
                    start_time,
                    end_time,
                )
        });
        if duplicate_sub {
            skipped_dates.push(PlannedSubmissionDate {
                date: trimmed,
                valid: false,
                conflicts_with_time_off: false,
                note: "Overlaps an already-submitted availability window.".to_string(),
            });
            continue;
        }

        accepted_dates.push(trimmed);
    }

    accepted_dates.sort();

    let mut all_dates: Vec<String> = existing_submissions
        .iter()
        .filter(|s| s.staff_uid == staff_uid && s.status == SubmissionStatus::Submitted)
        .map(|s| s.date.clone())
        .collect();
    all_dates.extend(accepted_dates.clone());
    let consecutive_days_streak = max_consecutive_iso_days(&all_dates);
    let fatigue_warning = if consecutive_days_streak >= 6 {
        Some(format!(
            "Availability spans {consecutive_days_streak} consecutive days; monitor weekly fatigue limits."
        ))
    } else {
        None
    };

    let total_hours_requested = ((accepted_dates.len() as f64 * shift_hours) * 100.0).round() / 100.0;

    Ok(AvailabilityBatchPlan {
        accepted_dates,
        skipped_dates,
        total_hours_requested,
        consecutive_days_streak,
        fatigue_warning,
    })
}

pub fn evaluate_weekly_availability_coverage(
    monday_iso: &str,
    slots: &[WeekSlotConfig],
    shifts: &[Shift],
    submissions: &[ShiftSubmission],
    time_off_requests: &[TimeOffRequest],
) -> Result<WeeklyAvailabilityCoverage, String> {
    let monday = NaiveDate::parse_from_str(monday_iso.trim(), "%Y-%m-%d")
        .map_err(|_| "Week start date must follow YYYY-MM-DD.".to_string())?;
    if slots.is_empty() {
        return Err("At least one shift template slot is required.".to_string());
    }

    let mut cells = Vec::with_capacity(slots.len() * 7);
    let mut well_covered_slots = 0usize;
    let mut under_covered_slots = 0usize;

    for offset in 0..7i64 {
        let cur = monday + Duration::days(offset);
        let iso = cur.format("%Y-%m-%d").to_string();

        for slot in slots {
            let slot_start = parse_time_to_minutes(&slot.start_time);
            let mut slot_end = parse_time_to_minutes(&slot.end_time);
            if slot_end <= slot_start {
                slot_end += 24 * 60;
            }

            let existing_shifts = shifts
                .iter()
                .filter(|sh| {
                    sh.date == iso
                        && shifts_time_overlap(
                            &sh.date,
                            &sh.start_time,
                            &sh.end_time,
                            &iso,
                            &slot.start_time,
                            &slot.end_time,
                        )
                })
                .count();

            let mut eligible_uids = HashSet::new();
            for sub in submissions {
                if sub.status != SubmissionStatus::Submitted || sub.date != iso {
                    continue;
                }
                let sub_start = parse_time_to_minutes(&sub.start_time);
                let mut sub_end = parse_time_to_minutes(&sub.end_time);
                if sub_end <= sub_start {
                    sub_end += 24 * 60;
                }
                let covers_window = sub_start <= slot_start && sub_end >= slot_end;
                let overlaps = shifts_time_overlap(
                    &sub.date,
                    &sub.start_time,
                    &sub.end_time,
                    &iso,
                    &slot.start_time,
                    &slot.end_time,
                );
                if !(covers_window || overlaps) {
                    continue;
                }
                let on_leave = time_off_requests.iter().any(|to| {
                    to.staff_uid == sub.staff_uid
                        && to.status == ApprovalStatus::Approved
                        && iso >= to.start_date
                        && iso <= to.end_date
                });
                if !on_leave {
                    eligible_uids.insert(sub.staff_uid.as_str());
                }
            }

            let eligible_submissions = eligible_uids.len();
            let status_tag = if existing_shifts > 0 || eligible_submissions >= 2 {
                well_covered_slots += 1;
                if existing_shifts > 0 {
                    "scheduled"
                } else {
                    "ready"
                }
            } else if eligible_submissions == 1 {
                "single_candidate"
            } else {
                under_covered_slots += 1;
                "gap"
            };

            cells.push(SlotCoverageCell {
                date: iso.clone(),
                slot_id: slot.id.clone(),
                slot_label: slot.label.clone(),
                department: slot.department.clone(),
                start_time: slot.start_time.clone(),
                end_time: slot.end_time.clone(),
                existing_shifts,
                eligible_submissions,
                status_tag: status_tag.to_string(),
            });
        }
    }

    Ok(WeeklyAvailabilityCoverage {
        monday_iso: monday_iso.trim().to_string(),
        total_slots: cells.len(),
        well_covered_slots,
        under_covered_slots,
        cells,
    })
}

pub fn render_availability_heatmap_markdown(
    coverage: &WeeklyAvailabilityCoverage,
    staff_directory: &[StaffDirectoryEntry],
) -> String {
    let mut by_date: BTreeMap<&str, Vec<&SlotCoverageCell>> = BTreeMap::new();
    for cell in &coverage.cells {
        by_date.entry(cell.date.as_str()).or_default().push(cell);
    }

    let mut dept_counts: BTreeMap<&str, usize> = BTreeMap::new();
    for m in staff_directory {
        let dept = if m.department.trim().is_empty() {
            "Operations"
        } else {
            m.department.trim()
        };
        *dept_counts.entry(dept).or_insert(0) += 1;
    }

    let dept_summary = if dept_counts.is_empty() {
        "Roster Size: 0".to_string()
    } else {
        let parts: Vec<String> = dept_counts
            .into_iter()
            .map(|(dept, count)| format!("{dept}: {count}"))
            .collect();
        format!("Roster Size: {} ({})", staff_directory.len(), parts.join(", "))
    };

    let mut lines = vec![
        format!("# Cadence Availability Heatmap — Week of {}", coverage.monday_iso),
        String::new(),
        format!(
            "Total Template Slots: {} | Covered/Ready: {} | Coverage Gaps: {} | {}",
            coverage.total_slots,
            coverage.well_covered_slots,
            coverage.under_covered_slots,
            dept_summary
        ),
        String::new(),
        "| Date | Slot | Window | Existing Shifts | Eligible Staff | Status |".to_string(),
        "| --- | --- | --- | ---: | ---: | --- |".to_string(),
    ];

    for (date, day_cells) in by_date {
        for c in day_cells {
            lines.push(format!(
                "| {} | {} ({}) | {}-{} | {} | {} | {} |",
                date,
                c.slot_label,
                c.department,
                c.start_time,
                c.end_time,
                c.existing_shifts,
                c.eligible_submissions,
                c.status_tag
            ));
        }
    }

    lines.join("\n")
}

#[tauri::command]
pub fn plan_staff_availability_batch_cmd(
    cache: State<'_, WorkspaceCacheState>,
    staff_uid: String,
    dates: Vec<String>,
    start_time: String,
    end_time: String,
    shift_title: String,
    department: String,
) -> Result<AvailabilityBatchPlan, String> {
    let snap = cache.current_snapshot();
    plan_staff_availability_batch(
        &staff_uid,
        &dates,
        &start_time,
        &end_time,
        &shift_title,
        &department,
        &snap.shift_submissions,
        &snap.time_off_requests,
    )
}

#[tauri::command]
pub fn evaluate_availability_coverage_cmd(
    cache: State<'_, WorkspaceCacheState>,
    monday_iso: String,
    slots: Vec<WeekSlotConfig>,
) -> Result<WeeklyAvailabilityCoverage, String> {
    let snap = cache.current_snapshot();
    let effective = if slots.is_empty() {
        crate::fairness::default_week_slots()
    } else {
        slots
    };
    evaluate_weekly_availability_coverage(
        &monday_iso,
        &effective,
        &snap.shifts,
        &snap.shift_submissions,
        &snap.time_off_requests,
    )
}

#[tauri::command]
pub fn render_availability_heatmap_cmd(
    cache: State<'_, WorkspaceCacheState>,
    monday_iso: String,
    slots: Vec<WeekSlotConfig>,
) -> Result<String, String> {
    let snap = cache.current_snapshot();
    let effective = if slots.is_empty() {
        crate::fairness::default_week_slots()
    } else {
        slots
    };
    let cov = evaluate_weekly_availability_coverage(
        &monday_iso,
        &effective,
        &snap.shifts,
        &snap.shift_submissions,
        &snap.time_off_requests,
    )?;
    Ok(render_availability_heatmap_markdown(&cov, &snap.staff_directory))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fairness::default_week_slots;

    #[test]
    fn plans_availability_batch_filtering_leave_and_detecting_streak() {
        let leave = vec![TimeOffRequest {
            id: "to_1".to_string(),
            staff_uid: "u_maya".to_string(),
            staff_name: "Maya".to_string(),
            department: "Operations".to_string(),
            start_date: "2026-11-25".to_string(),
            end_date: "2026-11-25".to_string(),
            reason: "Personal".to_string(),
            status: ApprovalStatus::Approved,
            reviewed_by_uid: String::new(),
            reviewed_by_name: String::new(),
            review_note: String::new(),
        }];
        let dates = vec![
            "2026-11-23".to_string(),
            "2026-11-24".to_string(),
            "2026-11-25".to_string(),
            "2026-11-26".to_string(),
            "2026-11-23".to_string(),
        ];
        let plan = plan_staff_availability_batch(
            "u_maya",
            &dates,
            "07:00",
            "15:00",
            "Morning Availability",
            "Operations",
            &[],
            &leave,
        )
        .expect("batch plan succeeds");

        assert_eq!(plan.accepted_dates, vec!["2026-11-23", "2026-11-24", "2026-11-26"]);
        assert_eq!(plan.skipped_dates.len(), 1);
        assert!(plan.skipped_dates[0].conflicts_with_time_off);
        assert_eq!(plan.total_hours_requested, 24.0);
        assert_eq!(plan.consecutive_days_streak, 2);
        assert!(plan.fatigue_warning.is_none());
    }

    #[test]
    fn evaluates_weekly_coverage_and_renders_heatmap_markdown() {
        let slots = default_week_slots();
        let subs = vec![ShiftSubmission {
            id: "sub_1".to_string(),
            staff_uid: "u1".to_string(),
            staff_name: "Maya".to_string(),
            department: "Operations".to_string(),
            date: "2026-11-23".to_string(),
            start_time: "07:00".to_string(),
            end_time: "15:00".to_string(),
            shift_title: "Morning".to_string(),
            notes: String::new(),
            status: SubmissionStatus::Submitted,
        }];
        let cov = evaluate_weekly_availability_coverage("2026-11-23", &slots, &[], &subs, &[])
            .expect("coverage evaluates");
        assert_eq!(cov.total_slots, 21);
        assert_eq!(cov.under_covered_slots, 20);
        let mon_morning = cov
            .cells
            .iter()
            .find(|c| c.date == "2026-11-23" && c.slot_id == "morning")
            .unwrap();
        assert_eq!(mon_morning.eligible_submissions, 1);
        assert_eq!(mon_morning.status_tag, "single_candidate");

        let md = render_availability_heatmap_markdown(&cov, &[]);
        assert!(md.contains("Cadence Availability Heatmap"));
        assert!(md.contains("2026-11-23"));
    }
}
