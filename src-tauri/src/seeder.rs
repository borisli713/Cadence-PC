use chrono::{Duration, Local, NaiveDate};
use serde::{Deserialize, Serialize};

use crate::fairness::{compute_shift_hours, get_monday_of_week};
use crate::models::{
    ApprovalStatus, NotificationCategory, PushNotificationRecord, ScheduleChangeRequest,
    ScheduleChangeType, Shift, ShiftReport, ShiftReportStatus, ShiftStatus, ShiftSubmission,
    StaffDirectoryEntry, SubmissionStatus, TimeOffRequest, UserRole,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleWorkspaceBundle {
    pub roster: Vec<StaffDirectoryEntry>,
    pub shifts: Vec<Shift>,
    pub schedule_changes: Vec<ScheduleChangeRequest>,
    pub shift_reports: Vec<ShiftReport>,
    pub shift_submissions: Vec<ShiftSubmission>,
    pub time_off_requests: Vec<TimeOffRequest>,
    pub notifications: Vec<PushNotificationRecord>,
}

pub fn build_sample_workspace_bundle(
    manager_uid: &str,
    manager_name: &str,
    today: NaiveDate,
) -> SampleWorkspaceBundle {
    let monday = get_monday_of_week(today);
    let d0 = monday.format("%Y-%m-%d").to_string();
    let d1 = (monday + Duration::days(1)).format("%Y-%m-%d").to_string();
    let d2 = (monday + Duration::days(2)).format("%Y-%m-%d").to_string();
    let d3 = (monday + Duration::days(3)).format("%Y-%m-%d").to_string();
    let d4 = (monday + Duration::days(4)).format("%Y-%m-%d").to_string();

    let roster = vec![
        StaffDirectoryEntry {
            uid: "sample_maya".to_string(),
            display_name: "Maya Patel".to_string(),
            role: UserRole::Staff,
            department: "Operations".to_string(),
            total_hours_worked: 14.0,
            scheduled_hours_this_week: 8.0,
            weekly_hours_target: 40.0,
            last_assigned_at: d0.clone(),
            is_sample_roster: true,
        },
        StaffDirectoryEntry {
            uid: "sample_liam".to_string(),
            display_name: "Liam Brooks".to_string(),
            role: UserRole::Staff,
            department: "Operations".to_string(),
            total_hours_worked: 34.0,
            scheduled_hours_this_week: 16.0,
            weekly_hours_target: 40.0,
            last_assigned_at: d1.clone(),
            is_sample_roster: true,
        },
        StaffDirectoryEntry {
            uid: "sample_elena".to_string(),
            display_name: "Elena Chen".to_string(),
            role: UserRole::Staff,
            department: "Support".to_string(),
            total_hours_worked: 20.0,
            scheduled_hours_this_week: 8.0,
            weekly_hours_target: 36.0,
            last_assigned_at: d0.clone(),
            is_sample_roster: true,
        },
    ];

    let shifts = vec![
        Shift {
            id: "sample_shift_conflict_1".to_string(),
            title: "Morning Dock Control".to_string(),
            department: "Operations".to_string(),
            date: d1.clone(),
            start_time: "07:00".to_string(),
            end_time: "15:00".to_string(),
            duration_hours: compute_shift_hours("07:00", "15:00", 0),
            assigned_uid: "sample_liam".to_string(),
            assigned_name: "Liam Brooks".to_string(),
            candidate_uids: vec!["sample_liam".to_string(), "sample_maya".to_string()],
            status: ShiftStatus::Conflict,
            visibility: "team".to_string(),
            fairness_note: "Overlapping availability from Liam Brooks & Maya Patel.".to_string(),
            created_by: manager_uid.to_string(),
        },
        Shift {
            id: "sample_shift_open_1".to_string(),
            title: "Closing Floor Audit".to_string(),
            department: "Operations".to_string(),
            date: d2.clone(),
            start_time: "15:00".to_string(),
            end_time: "23:00".to_string(),
            duration_hours: compute_shift_hours("15:00", "23:00", 0),
            assigned_uid: String::new(),
            assigned_name: String::new(),
            candidate_uids: vec!["sample_maya".to_string(), "sample_elena".to_string()],
            status: ShiftStatus::Open,
            visibility: "team".to_string(),
            fairness_note: "Open shift ready for fair allocation.".to_string(),
            created_by: manager_uid.to_string(),
        },
        Shift {
            id: "sample_shift_sched_1".to_string(),
            title: "Support Desk Peak".to_string(),
            department: "Support".to_string(),
            date: d3.clone(),
            start_time: "11:00".to_string(),
            end_time: "19:00".to_string(),
            duration_hours: compute_shift_hours("11:00", "19:00", 0),
            assigned_uid: "sample_elena".to_string(),
            assigned_name: "Elena Chen".to_string(),
            candidate_uids: vec![],
            status: ShiftStatus::PendingChange,
            visibility: "team".to_string(),
            fairness_note: String::new(),
            created_by: manager_uid.to_string(),
        },
    ];

    let schedule_changes = vec![
        ScheduleChangeRequest {
            id: "sample_chg_1".to_string(),
            shift_id: "sample_shift_sched_1".to_string(),
            shift_title: "Support Desk Peak".to_string(),
            requester_uid: "sample_elena".to_string(),
            requester_name: "Elena Chen".to_string(),
            request_type: ScheduleChangeType::TimeChange,
            current_date: d3.clone(),
            current_start_time: "11:00".to_string(),
            current_end_time: "19:00".to_string(),
            proposed_date: d3.clone(),
            proposed_start_time: "10:00".to_string(),
            proposed_end_time: "18:00".to_string(),
            proposed_assignee_uid: String::new(),
            proposed_assignee_name: String::new(),
            reason: "Earlier transit window".to_string(),
            status: ApprovalStatus::Pending,
            reviewed_by_uid: String::new(),
            reviewed_by_name: String::new(),
            review_note: String::new(),
        },
        ScheduleChangeRequest {
            id: "sample_chg_2".to_string(),
            shift_id: "sample_shift_open_1".to_string(),
            shift_title: "Closing Floor Audit".to_string(),
            requester_uid: "sample_maya".to_string(),
            requester_name: "Maya Patel".to_string(),
            request_type: ScheduleChangeType::Claim,
            current_date: d2.clone(),
            current_start_time: "15:00".to_string(),
            current_end_time: "23:00".to_string(),
            proposed_date: d2.clone(),
            proposed_start_time: "15:00".to_string(),
            proposed_end_time: "23:00".to_string(),
            proposed_assignee_uid: "sample_maya".to_string(),
            proposed_assignee_name: "Maya Patel".to_string(),
            reason: "Available to pick up closing coverage".to_string(),
            status: ApprovalStatus::Pending,
            reviewed_by_uid: String::new(),
            reviewed_by_name: String::new(),
            review_note: String::new(),
        },
    ];

    let shift_reports = vec![ShiftReport {
        id: "sample_rep_1".to_string(),
        shift_id: String::new(),
        shift_title: "Morning Inbound Check".to_string(),
        staff_uid: "sample_maya".to_string(),
        staff_name: "Maya Patel".to_string(),
        department: "Operations".to_string(),
        date: d0.clone(),
        actual_start_time: "07:00".to_string(),
        actual_end_time: "15:30".to_string(),
        break_minutes: 30,
        worked_hours: compute_shift_hours("07:00", "15:30", 30),
        handoff_notes: "All scanner stations calibrated; bay 2 cleared.".to_string(),
        status: ShiftReportStatus::Submitted,
        verified_by_uid: String::new(),
    }];

    let shift_submissions = vec![
        ShiftSubmission {
            id: "sample_sub_1".to_string(),
            staff_uid: "sample_maya".to_string(),
            staff_name: "Maya Patel".to_string(),
            department: "Operations".to_string(),
            date: d4.clone(),
            start_time: "07:00".to_string(),
            end_time: "15:00".to_string(),
            shift_title: "Morning Operations".to_string(),
            notes: "Preferred morning block".to_string(),
            status: SubmissionStatus::Submitted,
        },
        ShiftSubmission {
            id: "sample_sub_2".to_string(),
            staff_uid: "sample_elena".to_string(),
            staff_name: "Elena Chen".to_string(),
            department: "Support".to_string(),
            date: d4.clone(),
            start_time: "11:00".to_string(),
            end_time: "19:00".to_string(),
            shift_title: "Midday Floor Support".to_string(),
            notes: "Ready for peak coverage".to_string(),
            status: SubmissionStatus::Submitted,
        },
    ];

    let time_off_requests = vec![TimeOffRequest {
        id: "sample_to_1".to_string(),
        staff_uid: "sample_liam".to_string(),
        staff_name: "Liam Brooks".to_string(),
        department: "Operations".to_string(),
        start_date: d3.clone(),
        end_date: d4,
        reason: "Scheduled family travel".to_string(),
        status: ApprovalStatus::Pending,
        reviewed_by_uid: String::new(),
        reviewed_by_name: String::new(),
        review_note: String::new(),
    }];

    let notifications = vec![PushNotificationRecord {
        id: "sample_notif_1".to_string(),
        recipient_uid: manager_uid.to_string(),
        title: "Sample Fairness Scenario Ready".to_string(),
        message: format!(
            "{} loaded sample overlaps, pending requests, shift report, and time off.",
            manager_name
        ),
        category: NotificationCategory::FairnessRebalanced,
        related_shift_id: "sample_shift_conflict_1".to_string(),
        is_read: false,
        actor_uid: manager_uid.to_string(),
    }];

    SampleWorkspaceBundle {
        roster,
        shifts,
        schedule_changes,
        shift_reports,
        shift_submissions,
        time_off_requests,
        notifications,
    }
}

pub fn build_default_sample_bundle_today(
    manager_uid: &str,
    manager_name: &str,
) -> SampleWorkspaceBundle {
    build_sample_workspace_bundle(manager_uid, manager_name, Local::now().date_naive())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_consistent_sample_workspace_bundle() {
        let anchor = NaiveDate::from_ymd_opt(2026, 11, 20).unwrap();
        let bundle = build_sample_workspace_bundle("mgr_1", "Alex", anchor);
        assert_eq!(bundle.roster.len(), 3);
        assert_eq!(bundle.shifts.len(), 3);
        assert_eq!(bundle.schedule_changes.len(), 2);
        assert_eq!(bundle.shift_reports.len(), 1);
        assert_eq!(bundle.shift_reports[0].worked_hours, 8.0);
        assert_eq!(bundle.time_off_requests.len(), 1);
    }
}
