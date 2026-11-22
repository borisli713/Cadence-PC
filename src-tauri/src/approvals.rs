use serde::{Deserialize, Serialize};

use crate::fairness::compute_shift_hours;
use crate::models::{
    ApprovalStatus, NotificationCategory, ScheduleChangeRequest, ScheduleChangeType, Shift,
    ShiftStatus, TimeOffRequest,
};
use crate::validation::clamp_str;

pub const FIRESTORE_BATCH_LIMIT: usize = 400;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlannedShiftPatch {
    pub shift_id: String,
    pub date: String,
    pub start_time: String,
    pub end_time: String,
    pub duration_hours: f64,
    pub assigned_uid: String,
    pub assigned_name: String,
    pub status: ShiftStatus,
    pub fairness_note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlannedApprovalNotification {
    pub recipient_uid: String,
    pub title: String,
    pub message: String,
    pub category: NotificationCategory,
    pub related_shift_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlannedChangeDecision {
    pub request_id: String,
    pub decision: ApprovalStatus,
    pub reviewed_by_uid: String,
    pub reviewed_by_name: String,
    pub review_note: String,
    pub shift_patch: Option<PlannedShiftPatch>,
    pub notifications: Vec<PlannedApprovalNotification>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AcceptAllPlan {
    pub decisions: Vec<PlannedChangeDecision>,
    pub approved_count: usize,
    pub skipped_count: usize,
    pub estimated_write_ops: usize,
    pub chunk_ranges: Vec<(usize, usize)>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlannedTimeOffDecision {
    pub request_id: String,
    pub decision: ApprovalStatus,
    pub reviewed_by_uid: String,
    pub reviewed_by_name: String,
    pub review_note: String,
    pub notification: PlannedApprovalNotification,
}

fn build_shift_patch_for_approved_change(
    req: &ScheduleChangeRequest,
    shift: &Shift,
) -> PlannedShiftPatch {
    let duration_hours = compute_shift_hours(&req.proposed_start_time, &req.proposed_end_time, 0);
    match req.request_type {
        ScheduleChangeType::TimeChange => PlannedShiftPatch {
            shift_id: shift.id.clone(),
            date: req.proposed_date.clone(),
            start_time: req.proposed_start_time.clone(),
            end_time: req.proposed_end_time.clone(),
            duration_hours,
            assigned_uid: shift.assigned_uid.clone(),
            assigned_name: shift.assigned_name.clone(),
            status: ShiftStatus::Scheduled,
            fairness_note: format!(
                "Approved time change ({} {}-{}).",
                req.proposed_date, req.proposed_start_time, req.proposed_end_time
            ),
        },
        ScheduleChangeType::Drop => PlannedShiftPatch {
            shift_id: shift.id.clone(),
            date: shift.date.clone(),
            start_time: shift.start_time.clone(),
            end_time: shift.end_time.clone(),
            duration_hours: shift.duration_hours,
            assigned_uid: String::new(),
            assigned_name: String::new(),
            status: ShiftStatus::Open,
            fairness_note: format!("Dropped by {}; shift is open for claim.", req.requester_name),
        },
        ScheduleChangeType::Claim => PlannedShiftPatch {
            shift_id: shift.id.clone(),
            date: shift.date.clone(),
            start_time: shift.start_time.clone(),
            end_time: shift.end_time.clone(),
            duration_hours: shift.duration_hours,
            assigned_uid: if req.proposed_assignee_uid.trim().is_empty() {
                req.requester_uid.clone()
            } else {
                req.proposed_assignee_uid.clone()
            },
            assigned_name: if req.proposed_assignee_name.trim().is_empty() {
                req.requester_name.clone()
            } else {
                req.proposed_assignee_name.clone()
            },
            status: ShiftStatus::Scheduled,
            fairness_note: format!("Open shift claim approved for {}.", req.requester_name),
        },
        ScheduleChangeType::Swap => {
            let next_uid = if req.proposed_assignee_uid.trim().is_empty() {
                shift.assigned_uid.clone()
            } else {
                req.proposed_assignee_uid.clone()
            };
            let next_name = if req.proposed_assignee_name.trim().is_empty() {
                shift.assigned_name.clone()
            } else {
                req.proposed_assignee_name.clone()
            };
            PlannedShiftPatch {
                shift_id: shift.id.clone(),
                date: req.proposed_date.clone(),
                start_time: req.proposed_start_time.clone(),
                end_time: req.proposed_end_time.clone(),
                duration_hours,
                assigned_uid: next_uid,
                assigned_name: next_name.clone(),
                status: ShiftStatus::Scheduled,
                fairness_note: format!(
                    "Shift swap approved: {} -> {}.",
                    req.requester_name, next_name
                ),
            }
        }
    }
}

pub fn plan_schedule_change_decision(
    req: &ScheduleChangeRequest,
    linked_shift: Option<&Shift>,
    decision: ApprovalStatus,
    reviewer_uid: &str,
    reviewer_name: &str,
    review_note: &str,
) -> PlannedChangeDecision {
    let clean_note = clamp_str(review_note, 300);
    let mut notifications = Vec::new();
    let shift_patch = if decision == ApprovalStatus::Approved {
        linked_shift.map(|s| build_shift_patch_for_approved_change(req, s))
    } else {
        None
    };

    if decision == ApprovalStatus::Approved {
        let detail = if clean_note.is_empty() {
            String::new()
        } else {
            format!(" Note: {}", clean_note)
        };
        notifications.push(PlannedApprovalNotification {
            recipient_uid: req.requester_uid.clone(),
            title: format!("Shift Request Approved: {}", req.shift_title),
            message: format!(
                "{} approved your {} request for {} ({}–{}).{}",
                reviewer_name,
                req.request_type.label(),
                req.proposed_date,
                req.proposed_start_time,
                req.proposed_end_time,
                detail
            ),
            category: NotificationCategory::ShiftApproved,
            related_shift_id: req.shift_id.clone(),
        });

        if req.request_type == ScheduleChangeType::Swap
            && !req.proposed_assignee_uid.trim().is_empty()
            && req.proposed_assignee_uid != req.requester_uid
        {
            notifications.push(PlannedApprovalNotification {
                recipient_uid: req.proposed_assignee_uid.clone(),
                title: format!("Assigned via Shift Swap: {}", req.shift_title),
                message: format!(
                    "{} assigned {} ({} {}–{}) to you via swap with {}.",
                    reviewer_name,
                    req.shift_title,
                    req.proposed_date,
                    req.proposed_start_time,
                    req.proposed_end_time,
                    req.requester_name
                ),
                category: NotificationCategory::ShiftAssigned,
                related_shift_id: req.shift_id.clone(),
            });
        }
    } else {
        let detail = if clean_note.is_empty() {
            String::new()
        } else {
            format!(" Reason: {}", clean_note)
        };
        notifications.push(PlannedApprovalNotification {
            recipient_uid: req.requester_uid.clone(),
            title: format!("Shift Request Denied: {}", req.shift_title),
            message: format!(
                "{} denied your {} request for {}.{}",
                reviewer_name,
                req.request_type.label(),
                req.proposed_date,
                detail
            ),
            category: NotificationCategory::ShiftDenied,
            related_shift_id: req.shift_id.clone(),
        });
    }

    PlannedChangeDecision {
        request_id: req.id.clone(),
        decision,
        reviewed_by_uid: reviewer_uid.to_string(),
        reviewed_by_name: reviewer_name.to_string(),
        review_note: clean_note,
        shift_patch,
        notifications,
    }
}

pub fn chunk_ranges(total_items: usize, max_chunk_size: usize) -> Vec<(usize, usize)> {
    if total_items == 0 || max_chunk_size == 0 {
        return Vec::new();
    }
    let mut ranges = Vec::new();
    let mut start = 0;
    while start < total_items {
        let end = (start + max_chunk_size).min(total_items);
        ranges.push((start, end));
        start = end;
    }
    ranges
}

pub fn plan_accept_all_changes(
    requests: &[ScheduleChangeRequest],
    shifts: &[Shift],
    reviewer_uid: &str,
    reviewer_name: &str,
    note: &str,
) -> AcceptAllPlan {
    let effective_note = if note.trim().is_empty() {
        "Batch approved via Accept All"
    } else {
        note.trim()
    };

    let mut decisions = Vec::new();
    let mut skipped = 0usize;
    let mut ops = 0usize;

    for req in requests {
        if req.status != ApprovalStatus::Pending {
            skipped += 1;
            continue;
        }
        let linked = shifts.iter().find(|s| s.id == req.shift_id);
        let plan = plan_schedule_change_decision(
            req,
            linked,
            ApprovalStatus::Approved,
            reviewer_uid,
            reviewer_name,
            effective_note,
        );
        ops += 1; // request status update
        if plan.shift_patch.is_some() {
            ops += 1;
        }
        ops += plan.notifications.len();
        decisions.push(plan);
    }

    let approved_count = decisions.len();
    let ranges = chunk_ranges(ops, FIRESTORE_BATCH_LIMIT);

    AcceptAllPlan {
        decisions,
        approved_count,
        skipped_count: skipped,
        estimated_write_ops: ops,
        chunk_ranges: ranges,
    }
}

pub fn plan_time_off_decision(
    req: &TimeOffRequest,
    decision: ApprovalStatus,
    reviewer_uid: &str,
    reviewer_name: &str,
    review_note: &str,
) -> PlannedTimeOffDecision {
    let clean_note = clamp_str(review_note, 300);
    let detail = if clean_note.is_empty() {
        String::new()
    } else {
        format!(" Note: {}", clean_note)
    };
    let (title, verb, category) = if decision == ApprovalStatus::Approved {
        (
            "Time Off Approved".to_string(),
            "approved",
            NotificationCategory::TimeOffApproved,
        )
    } else {
        (
            "Time Off Denied".to_string(),
            "denied",
            NotificationCategory::TimeOffDenied,
        )
    };

    PlannedTimeOffDecision {
        request_id: req.id.clone(),
        decision,
        reviewed_by_uid: reviewer_uid.to_string(),
        reviewed_by_name: reviewer_name.to_string(),
        review_note: clean_note,
        notification: PlannedApprovalNotification {
            recipient_uid: req.staff_uid.clone(),
            title,
            message: format!(
                "{} {} your time off request ({} to {}).{}",
                reviewer_name, verb, req.start_date, req.end_date, detail
            ),
            category,
            related_shift_id: String::new(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_shift(status: ShiftStatus, assigned_uid: &str, assigned_name: &str) -> Shift {
        Shift {
            id: "sh_1".to_string(),
            title: "Morning Ops".to_string(),
            department: "Operations".to_string(),
            date: "2026-11-23".to_string(),
            start_time: "07:00".to_string(),
            end_time: "15:00".to_string(),
            duration_hours: 8.0,
            assigned_uid: assigned_uid.to_string(),
            assigned_name: assigned_name.to_string(),
            candidate_uids: vec![],
            status,
            visibility: "team".to_string(),
            fairness_note: String::new(),
            created_by: "mgr".to_string(),
        }
    }

    fn sample_req(
        id: &str,
        req_type: ScheduleChangeType,
        status: ApprovalStatus,
    ) -> ScheduleChangeRequest {
        ScheduleChangeRequest {
            id: id.to_string(),
            shift_id: "sh_1".to_string(),
            shift_title: "Morning Ops".to_string(),
            requester_uid: "u1".to_string(),
            requester_name: "Maya Patel".to_string(),
            request_type: req_type,
            current_date: "2026-11-23".to_string(),
            current_start_time: "07:00".to_string(),
            current_end_time: "15:00".to_string(),
            proposed_date: "2026-11-23".to_string(),
            proposed_start_time: "08:00".to_string(),
            proposed_end_time: "16:00".to_string(),
            proposed_assignee_uid: "u2".to_string(),
            proposed_assignee_name: "Liam Brooks".to_string(),
            reason: "Doctor appointment".to_string(),
            status,
            reviewed_by_uid: String::new(),
            reviewed_by_name: String::new(),
            review_note: String::new(),
        }
    }

    #[test]
    fn swap_decision_notifies_both_requester_and_new_assignee() {
        let shift = sample_shift(ShiftStatus::PendingChange, "u1", "Maya Patel");
        let req = sample_req("c1", ScheduleChangeType::Swap, ApprovalStatus::Pending);
        let plan = plan_schedule_change_decision(
            &req,
            Some(&shift),
            ApprovalStatus::Approved,
            "mgr_1",
            "Alex Manager",
            "Approved cleanly",
        );

        let patch = plan.shift_patch.expect("swap should patch shift");
        assert_eq!(patch.assigned_uid, "u2");
        assert_eq!(patch.assigned_name, "Liam Brooks");
        assert_eq!(patch.status, ShiftStatus::Scheduled);
        assert_eq!(plan.notifications.len(), 2);
        assert_eq!(plan.notifications[0].recipient_uid, "u1");
        assert_eq!(plan.notifications[1].recipient_uid, "u2");
    }

    #[test]
    fn accept_all_filters_pending_and_chunks_writes() {
        let shift = sample_shift(ShiftStatus::PendingChange, "u1", "Maya Patel");
        let reqs = vec![
            sample_req("c1", ScheduleChangeType::TimeChange, ApprovalStatus::Pending),
            sample_req("c2", ScheduleChangeType::Drop, ApprovalStatus::Approved),
        ];
        let plan = plan_accept_all_changes(&reqs, &[shift], "mgr_1", "Alex", "");
        assert_eq!(plan.approved_count, 1);
        assert_eq!(plan.skipped_count, 1);
        assert_eq!(plan.estimated_write_ops, 3);
        assert_eq!(plan.chunk_ranges, vec![(0, 3)]);
    }

    #[test]
    fn chunk_ranges_splits_above_batch_limit() {
        let ranges = chunk_ranges(850, 400);
        assert_eq!(ranges, vec![(0, 400), (400, 800), (800, 850)]);
    }

    #[test]
    fn time_off_decision_builds_expected_notification() {
        let req = TimeOffRequest {
            id: "to_1".to_string(),
            staff_uid: "u1".to_string(),
            staff_name: "Maya".to_string(),
            department: "Operations".to_string(),
            start_date: "2026-12-01".to_string(),
            end_date: "2026-12-03".to_string(),
            reason: "Family trip".to_string(),
            status: ApprovalStatus::Pending,
            reviewed_by_uid: String::new(),
            reviewed_by_name: String::new(),
            review_note: String::new(),
        };
        let dec = plan_time_off_decision(&req, ApprovalStatus::Denied, "mgr", "Alex", "Peak week");
        assert_eq!(dec.notification.category, NotificationCategory::TimeOffDenied);
        assert!(dec.notification.message.contains("Peak week"));
    }

    #[test]
    fn approved_drop_opens_shift_and_denial_restores_scheduled_status() {
        let shift = sample_shift(ShiftStatus::PendingChange, "u1", "Maya Patel");
        let drop_req = sample_req("c_drop", ScheduleChangeType::Drop, ApprovalStatus::Pending);
        let approved = plan_schedule_change_decision(
            &drop_req,
            Some(&shift),
            ApprovalStatus::Approved,
            "mgr_1",
            "Alex",
            "Covered by float pool",
        );
        let patch = approved.shift_patch.expect("drop should patch shift");
        assert_eq!(patch.status, ShiftStatus::Open);
        assert!(patch.assigned_uid.is_empty());

        let denied = plan_schedule_change_decision(
            &drop_req,
            Some(&shift),
            ApprovalStatus::Denied,
            "mgr_1",
            "Alex",
            "No backup",
        );
        assert!(denied.shift_patch.is_none());
        assert_eq!(denied.decision, ApprovalStatus::Denied);
        assert_eq!(
            denied.notifications[0].category,
            NotificationCategory::ShiftDenied
        );
    }
}
