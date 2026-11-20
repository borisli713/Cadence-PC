use serde::{Deserialize, Serialize};

use crate::fairness::{compute_scheduled_hours_by_uid, compute_shift_hours};
use crate::models::{
    NotificationCategory, Shift, ShiftReport, ShiftReportStatus, ShiftStatus, StaffDirectoryEntry,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlannedReportReview {
    pub report_id: String,
    pub next_status: ShiftReportStatus,
    pub verified_by_uid: String,
    pub staff_uid: String,
    pub previous_staff_total_hours: f64,
    pub updated_staff_total_hours: f64,
    pub hours_delta: f64,
    pub mark_linked_shift_completed: bool,
    pub linked_shift_id: Option<String>,
    pub notification_title: Option<String>,
    pub notification_message: Option<String>,
    pub notification_category: Option<NotificationCategory>,
}

pub fn compute_net_worked_hours(start_time: &str, end_time: &str, break_minutes: i32) -> f64 {
    let clamped_break = break_minutes.clamp(0, 180);
    compute_shift_hours(start_time, end_time, clamped_break)
}

pub fn plan_report_review(
    report: &ShiftReport,
    next_status: ShiftReportStatus,
    reviewer_uid: &str,
    staff_entry: Option<&StaffDirectoryEntry>,
    linked_shift: Option<&Shift>,
) -> PlannedReportReview {
    let was_verified = report.status == ShiftReportStatus::Verified;
    let will_verify = next_status == ShiftReportStatus::Verified;

    let hours_delta = if !was_verified && will_verify {
        report.worked_hours.max(0.0)
    } else if was_verified && !will_verify {
        -report.worked_hours.max(0.0)
    } else {
        0.0
    };

    let prev_total = staff_entry.map(|s| s.total_hours_worked).unwrap_or(0.0);
    let updated_total = ((prev_total + hours_delta).max(0.0) * 100.0).round() / 100.0;

    let mark_completed = will_verify
        && linked_shift
            .map(|s| s.status != ShiftStatus::Completed)
            .unwrap_or(false);
    let linked_shift_id = if mark_completed {
        linked_shift.map(|s| s.id.clone())
    } else {
        None
    };

    let (title, message, category) = if will_verify {
        (
            Some(format!("Shift Report Verified: {}", report.shift_title)),
            Some(format!(
                "{:.2}h verified for {} ({}).",
                report.worked_hours, report.date, report.department
            )),
            Some(NotificationCategory::ReportVerified),
        )
    } else if next_status == ShiftReportStatus::Flagged {
        (
            Some(format!("Shift Report Flagged: {}", report.shift_title)),
            Some(format!(
                "Manager flagged your shift report for {} ({}–{}). Please review handoff notes.",
                report.date, report.actual_start_time, report.actual_end_time
            )),
            Some(NotificationCategory::ShiftDenied),
        )
    } else {
        (None, None, None)
    };

    PlannedReportReview {
        report_id: report.id.clone(),
        next_status,
        verified_by_uid: reviewer_uid.to_string(),
        staff_uid: report.staff_uid.clone(),
        previous_staff_total_hours: prev_total,
        updated_staff_total_hours: updated_total,
        hours_delta: (hours_delta * 100.0).round() / 100.0,
        mark_linked_shift_completed: mark_completed,
        linked_shift_id,
        notification_title: title,
        notification_message: message,
        notification_category: category,
    }
}

fn csv_escape(raw: &str) -> String {
    let safe = raw.replace('"', "\"\"");
    if safe.contains(',') || safe.contains('"') || safe.contains('\n') || safe.contains('\r') {
        format!("\"{}\"", safe)
    } else {
        safe
    }
}

pub fn export_shift_reports_csv(reports: &[ShiftReport]) -> String {
    let mut lines = vec![
        "Report ID,Date,Staff Name,Department,Shift Title,Actual Start,Actual End,Break (min),Worked Hours,Status,Handoff Notes".to_string(),
    ];
    for rep in reports {
        let status = match rep.status {
            ShiftReportStatus::Submitted => "submitted",
            ShiftReportStatus::Verified => "verified",
            ShiftReportStatus::Flagged => "flagged",
        };
        lines.push(format!(
            "{},{},{},{},{},{},{},{},{:.2},{},{}",
            csv_escape(&rep.id),
            csv_escape(&rep.date),
            csv_escape(&rep.staff_name),
            csv_escape(&rep.department),
            csv_escape(&rep.shift_title),
            csv_escape(&rep.actual_start_time),
            csv_escape(&rep.actual_end_time),
            rep.break_minutes,
            rep.worked_hours,
            status,
            csv_escape(&rep.handoff_notes),
        ));
    }
    lines.join("\r\n")
}

pub fn export_team_hours_csv(staff_directory: &[StaffDirectoryEntry], shifts: &[Shift]) -> String {
    let scheduled_by_uid = compute_scheduled_hours_by_uid(shifts);
    let mut lines = vec![
        "UID,Staff Name,Department,Role,Verified Worked Hours,Scheduled Hours,Target Hours,Utilization %"
            .to_string(),
    ];
    for member in staff_directory {
        let logged = member.total_hours_worked.max(0.0);
        let scheduled = scheduled_by_uid
            .get(&member.uid)
            .copied()
            .unwrap_or(member.scheduled_hours_this_week)
            .max(0.0);
        let target = member.weekly_hours_target.max(1.0);
        let pct = ((logged + scheduled) / target * 100.0).round() as i64;
        let role = match member.role {
            crate::models::UserRole::Manager => "manager",
            crate::models::UserRole::Staff => "staff",
        };
        lines.push(format!(
            "{},{},{},{},{:.2},{:.2},{:.1},{}%",
            csv_escape(&member.uid),
            csv_escape(&member.display_name),
            csv_escape(&member.department),
            role,
            logged,
            scheduled,
            target,
            pct
        ));
    }
    lines.join("\r\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::UserRole;

    fn sample_report(status: ShiftReportStatus) -> ShiftReport {
        ShiftReport {
            id: "rep_1".to_string(),
            shift_id: "sh_1".to_string(),
            shift_title: "Morning Ops".to_string(),
            staff_uid: "u1".to_string(),
            staff_name: "Maya Patel".to_string(),
            department: "Operations".to_string(),
            date: "2026-11-20".to_string(),
            actual_start_time: "07:00".to_string(),
            actual_end_time: "15:30".to_string(),
            break_minutes: 30,
            worked_hours: 8.0,
            handoff_notes: "All systems checked, restocked.".to_string(),
            status,
            verified_by_uid: String::new(),
        }
    }

    #[test]
    fn clamps_break_minutes_and_computes_net_hours() {
        assert_eq!(compute_net_worked_hours("09:00", "17:30", 30), 8.0);
        assert_eq!(compute_net_worked_hours("09:00", "17:00", -20), 8.0);
        assert_eq!(compute_net_worked_hours("09:00", "17:00", 300), 5.0);
    }

    #[test]
    fn verify_report_adds_hours_once_and_completes_linked_shift() {
        let rep = sample_report(ShiftReportStatus::Submitted);
        let staff = StaffDirectoryEntry {
            uid: "u1".to_string(),
            display_name: "Maya Patel".to_string(),
            role: UserRole::Staff,
            department: "Operations".to_string(),
            total_hours_worked: 16.0,
            scheduled_hours_this_week: 8.0,
            weekly_hours_target: 40.0,
            last_assigned_at: String::new(),
            is_sample_roster: false,
        };
        let shift = Shift {
            id: "sh_1".to_string(),
            title: "Morning Ops".to_string(),
            department: "Operations".to_string(),
            date: "2026-11-20".to_string(),
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
        };

        let review = plan_report_review(
            &rep,
            ShiftReportStatus::Verified,
            "mgr_1",
            Some(&staff),
            Some(&shift),
        );
        assert_eq!(review.hours_delta, 8.0);
        assert_eq!(review.updated_staff_total_hours, 24.0);
        assert!(review.mark_linked_shift_completed);
        assert_eq!(review.linked_shift_id.as_deref(), Some("sh_1"));
    }

    #[test]
    fn exports_valid_rfc4180_csv_for_reports() {
        let rep = sample_report(ShiftReportStatus::Verified);
        let csv = export_shift_reports_csv(&[rep]);
        assert!(csv.contains("Report ID,Date,Staff Name"));
        assert!(csv.contains("\"All systems checked, restocked.\""));
        assert!(csv.contains("8.00,verified"));
    }
}
