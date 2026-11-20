use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use chrono::{Datelike, Duration, Local, NaiveDate, Weekday};

use crate::models::{
    ApprovalStatus, FairnessArrangementItem, FairnessScoreBreakdown, GeneratedShiftSpec,
    OpenShiftAssignmentItem, Shift, ShiftStatus, ShiftSubmission, StaffDirectoryEntry,
    SubmissionStatus, TimeOffConflict, TimeOffRequest, WeekSlotConfig,
};

pub fn default_week_slots() -> Vec<WeekSlotConfig> {
    vec![
        WeekSlotConfig {
            id: "morning".to_string(),
            label: "Morning".to_string(),
            title: "Morning Operations".to_string(),
            department: "Operations".to_string(),
            start_time: "07:00".to_string(),
            end_time: "15:00".to_string(),
        },
        WeekSlotConfig {
            id: "midday".to_string(),
            label: "Midday".to_string(),
            title: "Midday Floor Support".to_string(),
            department: "Support".to_string(),
            start_time: "11:00".to_string(),
            end_time: "19:00".to_string(),
        },
        WeekSlotConfig {
            id: "closing".to_string(),
            label: "Closing".to_string(),
            title: "Closing Operations".to_string(),
            department: "Operations".to_string(),
            start_time: "15:00".to_string(),
            end_time: "23:00".to_string(),
        },
    ]
}

pub fn parse_time_to_minutes(hhmm: &str) -> i32 {
    let mut parts = hhmm.split(':');
    let h = parts
        .next()
        .and_then(|v| v.parse::<i32>().ok())
        .unwrap_or(0);
    let m = parts
        .next()
        .and_then(|v| v.parse::<i32>().ok())
        .unwrap_or(0);
    h * 60 + m
}

pub fn compute_shift_hours(start_time: &str, end_time: &str, break_minutes: i32) -> f64 {
    let s = parse_time_to_minutes(start_time);
    let mut e = parse_time_to_minutes(end_time);
    if e <= s {
        e += 24 * 60;
    }
    let net_minutes = ((e - s) - break_minutes).max(15);
    ((net_minutes as f64 / 60.0) * 100.0).round() / 100.0
}

pub fn shifts_time_overlap(
    date_a: &str,
    start_a: &str,
    end_a: &str,
    date_b: &str,
    start_b: &str,
    end_b: &str,
) -> bool {
    if date_a != date_b {
        return false;
    }
    let s_a = parse_time_to_minutes(start_a);
    let mut e_a = parse_time_to_minutes(end_a);
    if e_a <= s_a {
        e_a += 24 * 60;
    }

    let s_b = parse_time_to_minutes(start_b);
    let mut e_b = parse_time_to_minutes(end_b);
    if e_b <= s_b {
        e_b += 24 * 60;
    }

    s_a < e_b && s_b < e_a
}

pub fn find_staff_conflicts<'a>(
    shifts: &'a [Shift],
    target_uid: &str,
    date: &str,
    start_time: &str,
    end_time: &str,
    exclude_shift_id: Option<&str>,
) -> Vec<&'a Shift> {
    if target_uid.trim().is_empty() {
        return Vec::new();
    }
    shifts
        .iter()
        .filter(|s| {
            exclude_shift_id != Some(s.id.as_str())
                && s.status != ShiftStatus::Open
                && s.assigned_uid == target_uid
                && shifts_time_overlap(&s.date, &s.start_time, &s.end_time, date, start_time, end_time)
        })
        .collect()
}

pub fn is_staff_on_approved_time_off(
    staff_uid: &str,
    date: &str,
    time_off_requests: &[TimeOffRequest],
) -> TimeOffConflict {
    if staff_uid.trim().is_empty() || date.trim().is_empty() || time_off_requests.is_empty() {
        return TimeOffConflict {
            has_time_off: false,
            reason: None,
        };
    }

    if let Some(req) = time_off_requests.iter().find(|req| {
        req.staff_uid == staff_uid
            && req.status == ApprovalStatus::Approved
            && date >= req.start_date.as_str()
            && date <= req.end_date.as_str()
    }) {
        TimeOffConflict {
            has_time_off: true,
            reason: Some(req.reason.clone()),
        }
    } else {
        TimeOffConflict {
            has_time_off: false,
            reason: None,
        }
    }
}

pub fn compute_scheduled_hours_by_uid(shifts: &[Shift]) -> HashMap<String, f64> {
    let mut map: HashMap<String, f64> = HashMap::new();
    for shift in shifts {
        if !shift.assigned_uid.trim().is_empty() && shift.status != ShiftStatus::Open {
            let entry = map.entry(shift.assigned_uid.clone()).or_insert(0.0);
            *entry += shift.duration_hours;
        }
    }
    map
}

pub fn rank_candidates_by_fairness(
    candidate_uids: &[String],
    staff_directory: &[StaffDirectoryEntry],
    all_shifts: &[Shift],
    target_date: &str,
    start_time: &str,
    end_time: &str,
    exclude_shift_id: Option<&str>,
    time_off_requests: &[TimeOffRequest],
) -> Vec<FairnessScoreBreakdown> {
    let scheduled_by_uid = compute_scheduled_hours_by_uid(all_shifts);
    let mut count_by_uid: HashMap<&str, usize> = HashMap::new();
    for s in all_shifts {
        if !s.assigned_uid.trim().is_empty() && s.status != ShiftStatus::Open {
            *count_by_uid.entry(s.assigned_uid.as_str()).or_insert(0) += 1;
        }
    }

    let candidate_set: HashSet<&str> = candidate_uids.iter().map(|s| s.as_str()).collect();
    let pool: Vec<&StaffDirectoryEntry> = if !candidate_uids.is_empty() {
        staff_directory
            .iter()
            .filter(|s| candidate_set.contains(s.uid.as_str()))
            .collect()
    } else {
        staff_directory.iter().collect()
    };

    let mut ranked: Vec<FairnessScoreBreakdown> = pool
        .into_iter()
        .map(|staff| {
            let scheduled = scheduled_by_uid
                .get(&staff.uid)
                .copied()
                .unwrap_or(staff.scheduled_hours_this_week);
            let target = staff.weekly_hours_target.max(1.0);
            let ratio = (staff.total_hours_worked + scheduled) / target;
            let has_conflict = !find_staff_conflicts(
                all_shifts,
                &staff.uid,
                target_date,
                start_time,
                end_time,
                exclude_shift_id,
            )
            .is_empty();
            let time_off = is_staff_on_approved_time_off(&staff.uid, target_date, time_off_requests);

            FairnessScoreBreakdown {
                uid: staff.uid.clone(),
                display_name: staff.display_name.clone(),
                department: staff.department.clone(),
                total_hours_worked: staff.total_hours_worked,
                scheduled_hours_this_week: (scheduled * 10.0).round() / 10.0,
                weekly_hours_target: target,
                utilization_ratio: ratio,
                shifts_this_week_count: *count_by_uid.get(staff.uid.as_str()).unwrap_or(&0),
                last_assigned_at: staff.last_assigned_at.clone(),
                has_conflict,
                has_approved_time_off: time_off.has_time_off,
                time_off_reason: time_off.reason,
            }
        })
        .collect();

    ranked.sort_by(|a, b| {
        let a_blocked = a.has_conflict || a.has_approved_time_off;
        let b_blocked = b.has_conflict || b.has_approved_time_off;
        if a_blocked != b_blocked {
            return if a_blocked {
                Ordering::Greater
            } else {
                Ordering::Less
            };
        }

        if (a.utilization_ratio - b.utilization_ratio).abs() > 0.001 {
            return a
                .utilization_ratio
                .partial_cmp(&b.utilization_ratio)
                .unwrap_or(Ordering::Equal);
        }

        if a.shifts_this_week_count != b.shifts_this_week_count {
            return a.shifts_this_week_count.cmp(&b.shifts_this_week_count);
        }

        if (a.total_hours_worked - b.total_hours_worked).abs() > 0.001 {
            return a
                .total_hours_worked
                .partial_cmp(&b.total_hours_worked)
                .unwrap_or(Ordering::Equal);
        }

        let a_time = if a.last_assigned_at.trim().is_empty() {
            "0000"
        } else {
            a.last_assigned_at.as_str()
        };
        let b_time = if b.last_assigned_at.trim().is_empty() {
            "0000"
        } else {
            b.last_assigned_at.as_str()
        };
        if a_time != b_time {
            return a_time.cmp(b_time);
        }

        a.display_name.cmp(&b.display_name)
    });

    ranked
}

pub fn pick_fairest_staff_for_shift(
    candidate_uids: &[String],
    staff_directory: &[StaffDirectoryEntry],
    all_shifts: &[Shift],
    target_date: &str,
    start_time: &str,
    end_time: &str,
    exclude_shift_id: Option<&str>,
    time_off_requests: &[TimeOffRequest],
) -> Option<FairnessScoreBreakdown> {
    let ranked = rank_candidates_by_fairness(
        candidate_uids,
        staff_directory,
        all_shifts,
        target_date,
        start_time,
        end_time,
        exclude_shift_id,
        time_off_requests,
    );
    ranked
        .iter()
        .find(|item| !item.has_conflict && !item.has_approved_time_off)
        .cloned()
        .or_else(|| ranked.into_iter().next())
}

pub fn build_fairness_arrangement_plan(
    shifts: &[Shift],
    staff_directory: &[StaffDirectoryEntry],
    time_off_requests: &[TimeOffRequest],
) -> Vec<FairnessArrangementItem> {
    let mut simulated_directory = staff_directory.to_vec();
    let mut plan = Vec::new();

    for shift in shifts {
        if !(shift.status == ShiftStatus::Conflict || shift.candidate_uids.len() > 1) {
            continue;
        }
        let ranked = rank_candidates_by_fairness(
            &shift.candidate_uids,
            &simulated_directory,
            shifts,
            &shift.date,
            &shift.start_time,
            &shift.end_time,
            Some(&shift.id),
            time_off_requests,
        );
        let best = ranked
            .iter()
            .find(|item| !item.has_conflict && !item.has_approved_time_off)
            .cloned()
            .or_else(|| ranked.into_iter().next());

        let Some(best) = best else {
            continue;
        };

        if let Some(member) = simulated_directory.iter_mut().find(|m| m.uid == best.uid) {
            member.total_hours_worked += shift.duration_hours;
            member.scheduled_hours_this_week += shift.duration_hours;
        }

        let pct = (best.utilization_ratio * 100.0).round() as i64;
        let reason = format!(
            "Assigned to {} ({}h logged, {} shifts, {}% target ratio)",
            best.display_name,
            format_hours(best.total_hours_worked),
            best.shifts_this_week_count,
            pct
        );

        plan.push(FairnessArrangementItem {
            shift: shift.clone(),
            previous_uid: shift.assigned_uid.clone(),
            previous_name: shift.assigned_name.clone(),
            chosen_uid: best.uid,
            chosen_name: best.display_name,
            reason,
        });
    }

    plan
}

pub fn build_open_shift_assignment_plan(
    shifts: &[Shift],
    staff_directory: &[StaffDirectoryEntry],
    submissions: &[ShiftSubmission],
    time_off_requests: &[TimeOffRequest],
    require_explicit_submission: bool,
) -> Vec<OpenShiftAssignmentItem> {
    if staff_directory.is_empty() {
        return Vec::new();
    }

    let open_shifts: Vec<Shift> = shifts
        .iter()
        .filter(|s| s.status == ShiftStatus::Open)
        .cloned()
        .collect();
    if open_shifts.is_empty() {
        return Vec::new();
    }

    let mut simulated_directory = staff_directory.to_vec();
    let mut simulated_shifts = shifts.to_vec();
    let mut plan = Vec::new();
    let active_submissions: Vec<&ShiftSubmission> = submissions
        .iter()
        .filter(|sub| sub.status == SubmissionStatus::Submitted)
        .collect();

    for shift in open_shifts {
        let mut submitted_uids = Vec::new();
        let mut seen = HashSet::new();
        for sub in &active_submissions {
            if sub.date == shift.date
                && shifts_time_overlap(
                    &sub.date,
                    &sub.start_time,
                    &sub.end_time,
                    &shift.date,
                    &shift.start_time,
                    &shift.end_time,
                )
                && seen.insert(sub.staff_uid.clone())
            {
                submitted_uids.push(sub.staff_uid.clone());
            }
        }

        if require_explicit_submission && submitted_uids.is_empty() {
            continue;
        }

        let candidate_pool: Vec<String> = if !submitted_uids.is_empty() {
            submitted_uids.clone()
        } else if !shift.candidate_uids.is_empty() {
            shift.candidate_uids.clone()
        } else {
            simulated_directory.iter().map(|m| m.uid.clone()).collect()
        };

        let ranked = rank_candidates_by_fairness(
            &candidate_pool,
            &simulated_directory,
            &simulated_shifts,
            &shift.date,
            &shift.start_time,
            &shift.end_time,
            Some(&shift.id),
            time_off_requests,
        );
        let Some(best) = ranked
            .into_iter()
            .find(|item| !item.has_conflict && !item.has_approved_time_off)
        else {
            continue;
        };

        if let Some(member) = simulated_directory.iter_mut().find(|m| m.uid == best.uid) {
            member.total_hours_worked += shift.duration_hours;
            member.scheduled_hours_this_week += shift.duration_hours;
        }
        if let Some(sim_shift) = simulated_shifts.iter_mut().find(|s| s.id == shift.id) {
            sim_shift.assigned_uid = best.uid.clone();
            sim_shift.assigned_name = best.display_name.clone();
            sim_shift.status = ShiftStatus::Scheduled;
        }

        let pct = (best.utilization_ratio * 100.0).round() as i64;
        let sub_note = if !submitted_uids.is_empty() {
            "Matched staff shift submission • "
        } else {
            ""
        };
        let reason = format!(
            "{}Assigned to {} ({}h logged, {} shifts, {}% target ratio)",
            sub_note,
            best.display_name,
            format_hours(best.total_hours_worked),
            best.shifts_this_week_count,
            pct
        );

        plan.push(OpenShiftAssignmentItem {
            shift,
            chosen_uid: best.uid,
            chosen_name: best.display_name,
            reason,
        });
    }

    plan
}

pub fn get_monday_of_week(date: NaiveDate) -> NaiveDate {
    let days_from_monday = match date.weekday() {
        Weekday::Mon => 0,
        Weekday::Tue => 1,
        Weekday::Wed => 2,
        Weekday::Thu => 3,
        Weekday::Fri => 4,
        Weekday::Sat => 5,
        Weekday::Sun => 6,
    };
    date - Duration::days(days_from_monday)
}

pub fn generate_weekly_fairness_schedule(
    week_start_date: &str,
    slots: &[WeekSlotConfig],
    staff_directory: &[StaffDirectoryEntry],
    existing_shifts: &[Shift],
    submissions: &[ShiftSubmission],
    time_off_requests: &[TimeOffRequest],
) -> Vec<GeneratedShiftSpec> {
    let base_date = NaiveDate::parse_from_str(week_start_date, "%Y-%m-%d")
        .unwrap_or_else(|_| get_monday_of_week(Local::now().date_naive()));

    let active_submissions: Vec<&ShiftSubmission> = submissions
        .iter()
        .filter(|s| s.status == SubmissionStatus::Submitted)
        .collect();
    let mut simulated_directory = staff_directory.to_vec();
    let mut simulated_shifts = existing_shifts.to_vec();
    let mut planned = Vec::new();

    for day_offset in 0..7 {
        let date_str = (base_date + Duration::days(day_offset))
            .format("%Y-%m-%d")
            .to_string();

        for slot in slots {
            let already_exists = simulated_shifts.iter().any(|s| {
                s.date == date_str
                    && s.start_time == slot.start_time
                    && s.end_time == slot.end_time
                    && s.title.eq_ignore_ascii_case(&slot.title)
            });
            if already_exists {
                continue;
            }

            let duration_hours = compute_shift_hours(&slot.start_time, &slot.end_time, 0);

            let matching_submissions: Vec<&ShiftSubmission> = active_submissions
                .iter()
                .copied()
                .filter(|sub| {
                    sub.date == date_str
                        && shifts_time_overlap(
                            &sub.date,
                            &sub.start_time,
                            &sub.end_time,
                            &date_str,
                            &slot.start_time,
                            &slot.end_time,
                        )
                })
                .collect();

            let mut submitted_uids = Vec::new();
            let mut seen = HashSet::new();
            for sub in &matching_submissions {
                if seen.insert(sub.staff_uid.clone()) {
                    submitted_uids.push(sub.staff_uid.clone());
                }
            }

            let ranked = if !submitted_uids.is_empty() {
                rank_candidates_by_fairness(
                    &submitted_uids,
                    &simulated_directory,
                    &simulated_shifts,
                    &date_str,
                    &slot.start_time,
                    &slot.end_time,
                    None,
                    time_off_requests,
                )
            } else {
                Vec::new()
            };

            let best = ranked
                .into_iter()
                .find(|item| !item.has_conflict && !item.has_approved_time_off);

            match best {
                None => {
                    let note = if submitted_uids.is_empty() {
                        "No staff shift submissions received for this slot; left open.".to_string()
                    } else {
                        "All submitting candidates had shift conflicts or approved time off; left open.".to_string()
                    };
                    planned.push(GeneratedShiftSpec {
                        title: slot.title.clone(),
                        department: slot.department.clone(),
                        date: date_str.clone(),
                        start_time: slot.start_time.clone(),
                        end_time: slot.end_time.clone(),
                        duration_hours,
                        assigned_uid: String::new(),
                        assigned_name: String::new(),
                        candidate_uids: submitted_uids.clone(),
                        status: ShiftStatus::Open,
                        fairness_note: note.clone(),
                    });
                    simulated_shifts.push(Shift {
                        id: format!("sim_{}_{}", date_str, slot.id),
                        title: slot.title.clone(),
                        department: slot.department.clone(),
                        date: date_str.clone(),
                        start_time: slot.start_time.clone(),
                        end_time: slot.end_time.clone(),
                        duration_hours,
                        assigned_uid: String::new(),
                        assigned_name: String::new(),
                        candidate_uids: submitted_uids,
                        status: ShiftStatus::Open,
                        visibility: "team".to_string(),
                        fairness_note: note,
                        created_by: "planner".to_string(),
                    });
                }
                Some(best) => {
                    let pct = (best.utilization_ratio * 100.0).round() as i64;
                    let matched_sub = matching_submissions
                        .iter()
                        .copied()
                        .find(|sub| sub.staff_uid == best.uid);
                    let mut note = format!(
                        "Matched submission • Assigned to {} ({}h logged, {}% target ratio)",
                        best.display_name,
                        format_hours(best.total_hours_worked),
                        pct
                    );
                    if let Some(sub) = matched_sub {
                        if !sub.notes.trim().is_empty() {
                            note.push_str(&format!(" — \"{}\"", sub.notes.trim()));
                        }
                    }

                    if let Some(member) = simulated_directory.iter_mut().find(|m| m.uid == best.uid) {
                        member.total_hours_worked += duration_hours;
                        member.scheduled_hours_this_week += duration_hours;
                    }

                    planned.push(GeneratedShiftSpec {
                        title: slot.title.clone(),
                        department: slot.department.clone(),
                        date: date_str.clone(),
                        start_time: slot.start_time.clone(),
                        end_time: slot.end_time.clone(),
                        duration_hours,
                        assigned_uid: best.uid.clone(),
                        assigned_name: best.display_name.clone(),
                        candidate_uids: submitted_uids.clone(),
                        status: ShiftStatus::Scheduled,
                        fairness_note: note.clone(),
                    });
                    simulated_shifts.push(Shift {
                        id: format!("sim_{}_{}", date_str, slot.id),
                        title: slot.title.clone(),
                        department: slot.department.clone(),
                        date: date_str.clone(),
                        start_time: slot.start_time.clone(),
                        end_time: slot.end_time.clone(),
                        duration_hours,
                        assigned_uid: best.uid,
                        assigned_name: best.display_name,
                        candidate_uids: submitted_uids,
                        status: ShiftStatus::Scheduled,
                        visibility: "team".to_string(),
                        fairness_note: note,
                        created_by: "planner".to_string(),
                    });
                }
            }
        }
    }

    planned
}

pub fn format_hours(value: f64) -> String {
    let rounded = (value * 10.0).round() / 10.0;
    if (rounded.fract()).abs() < 1e-6 {
        format!("{}", rounded as i64)
    } else {
        format!("{:.1}", rounded)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::UserRole;

    fn sample_staff() -> Vec<StaffDirectoryEntry> {
        vec![
            StaffDirectoryEntry {
                uid: "u_high".to_string(),
                display_name: "Liam Brooks".to_string(),
                role: UserRole::Staff,
                department: "Support".to_string(),
                total_hours_worked: 36.0,
                scheduled_hours_this_week: 0.0,
                weekly_hours_target: 40.0,
                last_assigned_at: "2026-11-10T08:00:00Z".to_string(),
                is_sample_roster: true,
            },
            StaffDirectoryEntry {
                uid: "u_low".to_string(),
                display_name: "Maya Patel".to_string(),
                role: UserRole::Staff,
                department: "Operations".to_string(),
                total_hours_worked: 12.0,
                scheduled_hours_this_week: 0.0,
                weekly_hours_target: 40.0,
                last_assigned_at: "2026-10-01T08:00:00Z".to_string(),
                is_sample_roster: true,
            },
        ]
    }

    #[test]
    fn computes_regular_and_overnight_shift_hours() {
        assert_eq!(compute_shift_hours("08:00", "16:30", 30), 8.0);
        assert_eq!(compute_shift_hours("22:00", "06:00", 0), 8.0);
        assert_eq!(compute_shift_hours("09:00", "09:05", 0), 0.25);
    }

    #[test]
    fn picks_lowest_utilization_candidate_and_excludes_time_off() {
        let staff = sample_staff();
        let shifts = vec![Shift {
            id: "s1".to_string(),
            title: "Morning Ops".to_string(),
            department: "Operations".to_string(),
            date: "2026-11-23".to_string(),
            start_time: "07:00".to_string(),
            end_time: "15:00".to_string(),
            duration_hours: 8.0,
            assigned_uid: "u_high".to_string(),
            assigned_name: "Liam Brooks".to_string(),
            candidate_uids: vec!["u_high".to_string(), "u_low".to_string()],
            status: ShiftStatus::Conflict,
            visibility: "team".to_string(),
            fairness_note: String::new(),
            created_by: "mgr".to_string(),
        }];

        let plan = build_fairness_arrangement_plan(&shifts, &staff, &[]);
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].chosen_uid, "u_low");

        let time_off = vec![TimeOffRequest {
            id: "to1".to_string(),
            staff_uid: "u_low".to_string(),
            staff_name: "Maya Patel".to_string(),
            department: "Operations".to_string(),
            start_date: "2026-11-23".to_string(),
            end_date: "2026-11-24".to_string(),
            reason: "Personal".to_string(),
            status: ApprovalStatus::Approved,
        }];
        let ranked = rank_candidates_by_fairness(
            &["u_high".to_string(), "u_low".to_string()],
            &staff,
            &shifts,
            "2026-11-23",
            "07:00",
            "15:00",
            Some("s1"),
            &time_off,
        );
        assert_eq!(ranked[0].uid, "u_high");
        assert!(ranked[1].has_approved_time_off);
    }
}
