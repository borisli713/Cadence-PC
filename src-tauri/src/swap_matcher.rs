use serde::{Deserialize, Serialize};
use tauri::State;

use crate::compliance::{
    analyze_workforce_compliance, DEFAULT_MAX_DAILY_HOURS, DEFAULT_MIN_REST_HOURS,
};
use crate::fairness::rank_candidates_by_fairness;
use crate::models::{
    FairnessScoreBreakdown, Shift, StaffDirectoryEntry, TimeOffRequest, UserRole,
};
use crate::workspace_cache::WorkspaceCacheState;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SwapCandidateRecommendation {
    pub uid: String,
    pub display_name: String,
    pub department: String,
    pub same_department: bool,
    pub current_utilization_percent: i64,
    pub projected_utilization_percent: i64,
    pub compliance_safe: bool,
    pub has_conflict: bool,
    pub has_approved_time_off: bool,
    pub score_breakdown: FairnessScoreBreakdown,
    pub recommendation_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SwapImpactSimulation {
    pub shift_id: String,
    pub replacement_uid: String,
    pub replacement_name: String,
    pub previous_uid: String,
    pub previous_compliance_violations: usize,
    pub new_compliance_violations: usize,
    pub improves_or_keeps_compliance: bool,
    pub projected_utilization_percent: i64,
    pub summary: String,
}

fn round2(val: f64) -> f64 {
    (val * 100.0).round() / 100.0
}

pub fn recommend_swap_candidates(
    shift: &Shift,
    staff_directory: &[StaffDirectoryEntry],
    all_shifts: &[Shift],
    time_off_requests: &[TimeOffRequest],
    limit: usize,
) -> Vec<SwapCandidateRecommendation> {
    let candidate_uids: Vec<String> = staff_directory
        .iter()
        .filter(|m| m.role == UserRole::Staff && m.uid != shift.assigned_uid)
        .map(|m| m.uid.clone())
        .collect();

    let ranked = rank_candidates_by_fairness(
        &candidate_uids,
        staff_directory,
        all_shifts,
        &shift.date,
        &shift.start_time,
        &shift.end_time,
        Some(&shift.id),
        time_off_requests,
    );

    let baseline_compliance = analyze_workforce_compliance(
        staff_directory,
        all_shifts,
        DEFAULT_MIN_REST_HOURS,
        DEFAULT_MAX_DAILY_HOURS,
    );

    let max_items = limit.clamp(1, 25);
    let mut results: Vec<SwapCandidateRecommendation> = ranked
        .into_iter()
        .map(|b| {
            let same_department = b.department.eq_ignore_ascii_case(&shift.department);
            let target = b.weekly_hours_target.max(1.0);
            let current_credit = b.total_hours_worked + b.scheduled_hours_this_week;
            let current_utilization_percent = ((current_credit / target) * 100.0).round() as i64;
            let projected_utilization_percent =
                (((current_credit + shift.duration_hours) / target) * 100.0).round() as i64;

            let sim = simulate_swap_impact(
                shift,
                &b.uid,
                staff_directory,
                all_shifts,
                baseline_compliance.total_violations,
            );

            let recommendation_reason = if b.has_approved_time_off {
                format!(
                    "Blocked: approved time off ({})",
                    b.time_off_reason.as_deref().unwrap_or("Leave")
                )
            } else if b.has_conflict {
                "Blocked: overlapping shift in schedule".to_string()
            } else if !sim.improves_or_keeps_compliance {
                "Caution: replacement increases rest/daily hours warning".to_string()
            } else if same_department {
                format!(
                    "Strong match ({} dept, {}% -> {}% target load)",
                    b.department, current_utilization_percent, projected_utilization_percent
                )
            } else {
                format!(
                    "Cross-dept match ({} -> {}, {}% -> {}% target load)",
                    b.department,
                    shift.department,
                    current_utilization_percent,
                    projected_utilization_percent
                )
            };

            SwapCandidateRecommendation {
                uid: b.uid.clone(),
                display_name: b.display_name.clone(),
                department: b.department.clone(),
                same_department,
                current_utilization_percent,
                projected_utilization_percent,
                compliance_safe: sim.improves_or_keeps_compliance,
                has_conflict: b.has_conflict,
                has_approved_time_off: b.has_approved_time_off,
                score_breakdown: b,
                recommendation_reason,
            }
        })
        .collect();

    results.sort_by(|a, b| {
        let a_ok = !a.has_conflict && !a.has_approved_time_off && a.compliance_safe;
        let b_ok = !b.has_conflict && !b.has_approved_time_off && b.compliance_safe;
        b_ok.cmp(&a_ok)
            .then_with(|| b.same_department.cmp(&a.same_department))
            .then_with(|| {
                a.projected_utilization_percent
                    .cmp(&b.projected_utilization_percent)
            })
    });

    results.truncate(max_items);
    results
}

pub fn simulate_swap_impact(
    shift: &Shift,
    replacement_uid: &str,
    staff_directory: &[StaffDirectoryEntry],
    all_shifts: &[Shift],
    baseline_violations_override: usize,
) -> SwapImpactSimulation {
    let baseline = if baseline_violations_override == usize::MAX {
        analyze_workforce_compliance(
            staff_directory,
            all_shifts,
            DEFAULT_MIN_REST_HOURS,
            DEFAULT_MAX_DAILY_HOURS,
        )
        .total_violations
    } else {
        baseline_violations_override
    };

    let replacement = staff_directory.iter().find(|m| m.uid == replacement_uid);
    let replacement_name = replacement
        .map(|m| m.display_name.clone())
        .unwrap_or_else(|| replacement_uid.to_string());

    let mut simulated_shifts = all_shifts.to_vec();
    for s in &mut simulated_shifts {
        if s.id == shift.id {
            s.assigned_uid = replacement_uid.to_string();
            s.assigned_name = replacement_name.clone();
        }
    }

    let after = analyze_workforce_compliance(
        staff_directory,
        &simulated_shifts,
        DEFAULT_MIN_REST_HOURS,
        DEFAULT_MAX_DAILY_HOURS,
    );

    let projected_utilization_percent = if let Some(member) = replacement {
        let target = member.weekly_hours_target.max(1.0);
        let new_credit = round2(
            member.total_hours_worked + member.scheduled_hours_this_week + shift.duration_hours,
        );
        ((new_credit / target) * 100.0).round() as i64
    } else {
        0
    };

    let improves_or_keeps_compliance = after.total_violations <= baseline;
    let summary = if improves_or_keeps_compliance {
        format!(
            "Reassigning {} to {} keeps compliance healthy ({} violation(s)) at {}% weekly load.",
            shift.title, replacement_name, after.total_violations, projected_utilization_percent
        )
    } else {
        format!(
            "Warning: assigning {} to {} raises compliance alerts from {} to {}.",
            shift.title, replacement_name, baseline, after.total_violations
        )
    };

    SwapImpactSimulation {
        shift_id: shift.id.clone(),
        replacement_uid: replacement_uid.to_string(),
        replacement_name,
        previous_uid: shift.assigned_uid.clone(),
        previous_compliance_violations: baseline,
        new_compliance_violations: after.total_violations,
        improves_or_keeps_compliance,
        projected_utilization_percent,
        summary,
    }
}

#[tauri::command]
pub fn recommend_swap_candidates_cmd(
    cache: State<'_, WorkspaceCacheState>,
    shift: Shift,
    limit: Option<usize>,
) -> Vec<SwapCandidateRecommendation> {
    let snap = cache.current_snapshot();
    recommend_swap_candidates(
        &shift,
        &snap.staff_directory,
        &snap.shifts,
        &snap.time_off_requests,
        limit.unwrap_or(8),
    )
}

#[tauri::command]
pub fn simulate_swap_impact_cmd(
    cache: State<'_, WorkspaceCacheState>,
    shift: Shift,
    replacement_uid: String,
) -> SwapImpactSimulation {
    let snap = cache.current_snapshot();
    simulate_swap_impact(&shift, &replacement_uid, &snap.staff_directory, &snap.shifts, usize::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ApprovalStatus, ShiftStatus};

    fn mk_staff(uid: &str, dept: &str, worked: f64) -> StaffDirectoryEntry {
        StaffDirectoryEntry {
            uid: uid.to_string(),
            display_name: format!("Staff {uid}"),
            role: UserRole::Staff,
            department: dept.to_string(),
            total_hours_worked: worked,
            scheduled_hours_this_week: 0.0,
            weekly_hours_target: 40.0,
            last_assigned_at: String::new(),
            is_sample_roster: false,
        }
    }

    fn mk_shift(id: &str, date: &str, start: &str, end: &str, uid: &str, dept: &str) -> Shift {
        Shift {
            id: id.to_string(),
            title: format!("Shift {id}"),
            department: dept.to_string(),
            date: date.to_string(),
            start_time: start.to_string(),
            end_time: end.to_string(),
            duration_hours: 8.0,
            assigned_uid: uid.to_string(),
            assigned_name: format!("Staff {uid}"),
            candidate_uids: vec![],
            status: ShiftStatus::Scheduled,
            visibility: "team".to_string(),
            fairness_note: String::new(),
            created_by: "mgr".to_string(),
        }
    }

    #[test]
    fn ranks_eligible_same_department_low_hours_candidate_first() {
        let target_shift = mk_shift("s_target", "2026-11-24", "07:00", "15:00", "u_orig", "Operations");
        let staff = vec![
            mk_staff("u_orig", "Operations", 32.0),
            mk_staff("u_busy", "Operations", 36.0),
            mk_staff("u_fair", "Operations", 8.0),
            mk_staff("u_leave", "Operations", 0.0),
            mk_staff("u_other", "Support", 4.0),
        ];
        let to = vec![TimeOffRequest {
            id: "to_1".to_string(),
            staff_uid: "u_leave".to_string(),
            staff_name: "Leave".to_string(),
            department: "Operations".to_string(),
            start_date: "2026-11-23".to_string(),
            end_date: "2026-11-26".to_string(),
            reason: "Off".to_string(),
            status: ApprovalStatus::Approved,
            reviewed_by_uid: String::new(),
            reviewed_by_name: String::new(),
            review_note: String::new(),
        }];

        let recs = recommend_swap_candidates(&target_shift, &staff, &[target_shift.clone()], &to, 10);
        assert_eq!(recs[0].uid, "u_fair");
        assert!(recs[0].same_department);
        assert!(recs[0].compliance_safe);
        assert_eq!(recs[0].projected_utilization_percent, 40);
        assert!(recs.iter().find(|r| r.uid == "u_leave").unwrap().has_approved_time_off);
    }

    #[test]
    fn simulates_swap_impact_detecting_rest_gap_violations() {
        let shift_prev = mk_shift("s_late", "2026-11-23", "15:00", "23:00", "u_tired", "Operations");
        let shift_next = mk_shift("s_early", "2026-11-24", "05:00", "13:00", "u_orig", "Operations");
        let staff = vec![
            mk_staff("u_orig", "Operations", 16.0),
            mk_staff("u_tired", "Operations", 16.0),
            mk_staff("u_fresh", "Operations", 8.0),
        ];

        let bad_sim = simulate_swap_impact(
            &shift_next,
            "u_tired",
            &staff,
            &[shift_prev.clone(), shift_next.clone()],
            usize::MAX,
        );
        assert!(!bad_sim.improves_or_keeps_compliance);
        assert!(bad_sim.new_compliance_violations > bad_sim.previous_compliance_violations);

        let good_sim = simulate_swap_impact(
            &shift_next.clone(),
            "u_fresh",
            &staff,
            &[shift_prev, shift_next],
            usize::MAX,
        );
        assert!(good_sim.improves_or_keeps_compliance);
    }
}
