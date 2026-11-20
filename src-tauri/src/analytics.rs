use chrono::{Local, NaiveDate};

use crate::fairness::compute_scheduled_hours_by_uid;
use crate::models::{
    ApprovalStatus, DashboardKpis, Shift, ShiftStatus, StaffChartRow, StaffDirectoryEntry,
    TimeOffRequest,
};

pub fn compute_dashboard_kpis(
    uid: &str,
    weekly_hours_target: f64,
    shifts: &[Shift],
    schedule_changes_pending: usize,
    time_off_requests: &[TimeOffRequest],
    staff_directory: &[StaffDirectoryEntry],
) -> DashboardKpis {
    let today_iso = Local::now().date_naive().format("%Y-%m-%d").to_string();
    let my_shifts: Vec<&Shift> = shifts
        .iter()
        .filter(|s| s.assigned_uid == uid && s.status != ShiftStatus::Open)
        .collect();
    let my_upcoming: Vec<&&Shift> = my_shifts
        .iter()
        .filter(|s| s.status != ShiftStatus::Completed && s.date >= today_iso)
        .collect();

    let my_scheduled_hours: f64 = my_upcoming.iter().map(|s| s.duration_hours).sum();
    let my_verified_hours = staff_directory
        .iter()
        .find(|s| s.uid == uid)
        .map(|s| s.total_hours_worked)
        .unwrap_or(0.0);

    let pending_time_off_count = time_off_requests
        .iter()
        .filter(|t| t.status == ApprovalStatus::Pending)
        .count();
    let conflict_shifts_count = shifts
        .iter()
        .filter(|s| s.status == ShiftStatus::Conflict || s.candidate_uids.len() > 1)
        .count();
    let open_shifts_count = shifts
        .iter()
        .filter(|s| s.status == ShiftStatus::Open)
        .count();

    let _ = weekly_hours_target;
    DashboardKpis {
        my_shifts_count: my_shifts.len(),
        my_upcoming_count: my_upcoming.len(),
        my_scheduled_hours: (my_scheduled_hours * 100.0).round() / 100.0,
        my_verified_hours: (my_verified_hours * 100.0).round() / 100.0,
        pending_approvals_count: schedule_changes_pending,
        pending_time_off_count,
        conflict_shifts_count,
        open_shifts_count,
    }
}

pub fn build_staff_chart_rows(
    staff_directory: &[StaffDirectoryEntry],
    shifts: &[Shift],
) -> Vec<StaffChartRow> {
    let scheduled_by_uid = compute_scheduled_hours_by_uid(shifts);

    let mut rows: Vec<StaffChartRow> = staff_directory
        .iter()
        .map(|member| {
            let logged = member.total_hours_worked.max(0.0);
            let scheduled = scheduled_by_uid
                .get(&member.uid)
                .copied()
                .unwrap_or(member.scheduled_hours_this_week)
                .max(0.0);
            let target = member.weekly_hours_target.max(1.0);
            let combined = logged + scheduled;
            let ratio = combined / target;
            StaffChartRow {
                uid: member.uid.clone(),
                display_name: member.display_name.clone(),
                department: member.department.clone(),
                logged_hours: (logged * 10.0).round() / 10.0,
                scheduled_hours: (scheduled * 10.0).round() / 10.0,
                target_hours: target,
                combined_hours: (combined * 10.0).round() / 10.0,
                utilization_ratio: ratio,
                utilization_percent: (ratio * 100.0).round() as i64,
            }
        })
        .collect();

    rows.sort_by(|a, b| {
        a.utilization_ratio
            .partial_cmp(&b.utilization_ratio)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.display_name.cmp(&b.display_name))
    });
    rows
}

pub fn count_days_inclusive(start_iso: &str, end_iso: &str) -> i64 {
    let Ok(s) = NaiveDate::parse_from_str(start_iso, "%Y-%m-%d") else {
        return 1;
    };
    let Ok(e) = NaiveDate::parse_from_str(end_iso, "%Y-%m-%d") else {
        return 1;
    };
    (e - s).num_days().max(0) + 1
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::UserRole;

    #[test]
    fn sorts_staff_chart_lowest_utilization_first() {
        let staff = vec![
            StaffDirectoryEntry {
                uid: "u1".to_string(),
                display_name: "Liam".to_string(),
                role: UserRole::Staff,
                department: "Ops".to_string(),
                total_hours_worked: 32.0,
                scheduled_hours_this_week: 0.0,
                weekly_hours_target: 40.0,
                last_assigned_at: String::new(),
                is_sample_roster: false,
            },
            StaffDirectoryEntry {
                uid: "u2".to_string(),
                display_name: "Maya".to_string(),
                role: UserRole::Staff,
                department: "Ops".to_string(),
                total_hours_worked: 10.0,
                scheduled_hours_this_week: 0.0,
                weekly_hours_target: 40.0,
                last_assigned_at: String::new(),
                is_sample_roster: false,
            },
        ];
        let shifts = vec![Shift {
            id: "s1".to_string(),
            title: "Morning".to_string(),
            department: "Ops".to_string(),
            date: "2026-11-23".to_string(),
            start_time: "08:00".to_string(),
            end_time: "16:00".to_string(),
            duration_hours: 8.0,
            assigned_uid: "u2".to_string(),
            assigned_name: "Maya".to_string(),
            candidate_uids: vec![],
            status: ShiftStatus::Scheduled,
            visibility: "team".to_string(),
            fairness_note: String::new(),
            created_by: "mgr".to_string(),
        }];

        let rows = build_staff_chart_rows(&staff, &shifts);
        assert_eq!(rows[0].uid, "u2");
        assert_eq!(rows[0].utilization_percent, 45);
        assert_eq!(rows[1].utilization_percent, 80);
    }

    #[test]
    fn counts_time_off_days_inclusively() {
        assert_eq!(count_days_inclusive("2026-11-20", "2026-11-20"), 1);
        assert_eq!(count_days_inclusive("2026-11-20", "2026-11-22"), 3);
    }
}
