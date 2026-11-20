use std::collections::HashSet;

use crate::models::{
    ApprovalStatus, NotificationWorkPayload, PushNotificationRecord, ScheduleChangeRequest,
    ShiftReport, ShiftReportStatus, TimeOffRequest,
};

pub fn filter_unnotified_alerts<'a>(
    notifications: &'a [PushNotificationRecord],
    seen_ids: &HashSet<String>,
    push_enabled: bool,
) -> Vec<&'a PushNotificationRecord> {
    if !push_enabled {
        return Vec::new();
    }
    notifications
        .iter()
        .filter(|n| !n.is_read && !seen_ids.contains(&n.id))
        .collect()
}

pub fn build_manager_work_payloads(
    manager_uid: &str,
    schedule_changes: &[ScheduleChangeRequest],
    time_off_requests: &[TimeOffRequest],
    shift_reports: &[ShiftReport],
) -> Vec<NotificationWorkPayload> {
    let mut payloads = Vec::new();

    for req in schedule_changes {
        if req.status == ApprovalStatus::Pending && req.requester_uid != manager_uid {
            let label = req.request_type.label();
            payloads.push(NotificationWorkPayload {
                key: format!("chg_{}", req.id),
                title: format!("New {} request", label),
                message: format!(
                    "{} requested {} for {} ({}).",
                    req.requester_name, label, req.shift_title, req.proposed_date
                ),
            });
        }
    }

    for to in time_off_requests {
        if to.status == ApprovalStatus::Pending && to.staff_uid != manager_uid {
            payloads.push(NotificationWorkPayload {
                key: format!("to_{}", to.id),
                title: "New Time Off Request".to_string(),
                message: format!(
                    "{} requested time off ({} to {}).",
                    to.staff_name, to.start_date, to.end_date
                ),
            });
        }
    }

    for rep in shift_reports {
        if rep.status == ShiftReportStatus::Submitted && rep.staff_uid != manager_uid {
            payloads.push(NotificationWorkPayload {
                key: format!("rep_{}", rep.id),
                title: "Shift Report Submitted".to_string(),
                message: format!(
                    "{} logged {:.2}h for {} ({}).",
                    rep.staff_name, rep.worked_hours, rep.shift_title, rep.date
                ),
            });
        }
    }

    payloads
}

pub fn filter_new_manager_work_alerts(
    items: Vec<NotificationWorkPayload>,
    seen_keys: &HashSet<String>,
    push_enabled: bool,
) -> Vec<NotificationWorkPayload> {
    if !push_enabled {
        return Vec::new();
    }
    items
        .into_iter()
        .filter(|item| !seen_keys.contains(&item.key))
        .collect()
}

pub fn unread_notification_ids(notifications: &[PushNotificationRecord]) -> Vec<String> {
    notifications
        .iter()
        .filter(|n| !n.is_read)
        .map(|n| n.id.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{NotificationCategory, ScheduleChangeType};

    #[test]
    fn builds_manager_work_payloads_excluding_self_requests() {
        let changes = vec![
            ScheduleChangeRequest {
                id: "c1".to_string(),
                shift_id: "s1".to_string(),
                shift_title: "Morning Ops".to_string(),
                requester_uid: "staff_1".to_string(),
                requester_name: "Maya".to_string(),
                request_type: ScheduleChangeType::TimeChange,
                current_date: "2026-11-23".to_string(),
                current_start_time: "07:00".to_string(),
                current_end_time: "15:00".to_string(),
                proposed_date: "2026-11-23".to_string(),
                proposed_start_time: "08:00".to_string(),
                proposed_end_time: "16:00".to_string(),
                proposed_assignee_uid: String::new(),
                proposed_assignee_name: String::new(),
                reason: "Commute".to_string(),
                status: ApprovalStatus::Pending,
                reviewed_by_uid: String::new(),
                reviewed_by_name: String::new(),
                review_note: String::new(),
            },
            ScheduleChangeRequest {
                id: "c_self".to_string(),
                shift_id: "s2".to_string(),
                shift_title: "Evening".to_string(),
                requester_uid: "mgr_1".to_string(),
                requester_name: "Alex".to_string(),
                request_type: ScheduleChangeType::Drop,
                current_date: "2026-11-24".to_string(),
                current_start_time: "15:00".to_string(),
                current_end_time: "23:00".to_string(),
                proposed_date: "2026-11-24".to_string(),
                proposed_start_time: "15:00".to_string(),
                proposed_end_time: "23:00".to_string(),
                proposed_assignee_uid: String::new(),
                proposed_assignee_name: String::new(),
                reason: "Self".to_string(),
                status: ApprovalStatus::Pending,
                reviewed_by_uid: String::new(),
                reviewed_by_name: String::new(),
                review_note: String::new(),
            },
        ];

        let payloads = build_manager_work_payloads("mgr_1", &changes, &[], &[]);
        assert_eq!(payloads.len(), 1);
        assert_eq!(payloads[0].key, "chg_c1");
    }

    #[test]
    fn filters_unread_unseen_notifications() {
        let records = vec![
            PushNotificationRecord {
                id: "n1".to_string(),
                recipient_uid: "u1".to_string(),
                title: "Approved".to_string(),
                message: "Done".to_string(),
                category: NotificationCategory::ShiftApproved,
                related_shift_id: "s1".to_string(),
                is_read: false,
                actor_uid: "mgr".to_string(),
            },
            PushNotificationRecord {
                id: "n2".to_string(),
                recipient_uid: "u1".to_string(),
                title: "Old".to_string(),
                message: "Done".to_string(),
                category: NotificationCategory::ShiftAssigned,
                related_shift_id: "s2".to_string(),
                is_read: true,
                actor_uid: "mgr".to_string(),
            },
        ];
        let mut seen = HashSet::new();
        let fresh = filter_unnotified_alerts(&records, &seen, true);
        assert_eq!(fresh.len(), 1);
        assert_eq!(fresh[0].id, "n1");

        seen.insert("n1".to_string());
        let after = filter_unnotified_alerts(&records, &seen, true);
        assert!(after.is_empty());
    }
}
