use serde::{Deserialize, Serialize};

use crate::models::{ApprovalStatus, ScheduleChangeRequest};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HistoryFilterKind {
    All,
    Approved,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryQueryResult {
    pub items: Vec<ScheduleChangeRequest>,
    pub total_resolved: usize,
    pub approved_count: usize,
    pub rejected_count: usize,
}

pub fn filter_shift_history(
    changes: &[ScheduleChangeRequest],
    filter: &HistoryFilterKind,
    search_query: &str,
) -> HistoryQueryResult {
    let resolved: Vec<&ScheduleChangeRequest> = changes
        .iter()
        .filter(|c| c.status != ApprovalStatus::Pending)
        .collect();

    let approved_count = resolved
        .iter()
        .filter(|c| c.status == ApprovalStatus::Approved)
        .count();
    let rejected_count = resolved
        .iter()
        .filter(|c| c.status == ApprovalStatus::Denied)
        .count();

    let q = search_query.trim().to_ascii_lowercase();
    let items: Vec<ScheduleChangeRequest> = resolved
        .into_iter()
        .filter(|item| match filter {
            HistoryFilterKind::All => true,
            HistoryFilterKind::Approved => item.status == ApprovalStatus::Approved,
            HistoryFilterKind::Rejected => item.status == ApprovalStatus::Denied,
        })
        .filter(|item| {
            if q.is_empty() {
                return true;
            }
            item.shift_title.to_ascii_lowercase().contains(&q)
                || item.requester_name.to_ascii_lowercase().contains(&q)
                || item.reviewed_by_name.to_ascii_lowercase().contains(&q)
                || item.proposed_date.to_ascii_lowercase().contains(&q)
                || item.review_note.to_ascii_lowercase().contains(&q)
        })
        .cloned()
        .collect();

    HistoryQueryResult {
        total_resolved: approved_count + rejected_count,
        approved_count,
        rejected_count,
        items,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ScheduleChangeType;

    fn mk_change(
        id: &str,
        title: &str,
        requester: &str,
        status: ApprovalStatus,
    ) -> ScheduleChangeRequest {
        ScheduleChangeRequest {
            id: id.to_string(),
            shift_id: "s1".to_string(),
            shift_title: title.to_string(),
            requester_uid: "u1".to_string(),
            requester_name: requester.to_string(),
            request_type: ScheduleChangeType::TimeChange,
            current_date: "2026-11-23".to_string(),
            current_start_time: "07:00".to_string(),
            current_end_time: "15:00".to_string(),
            proposed_date: "2026-11-23".to_string(),
            proposed_start_time: "08:00".to_string(),
            proposed_end_time: "16:00".to_string(),
            proposed_assignee_uid: String::new(),
            proposed_assignee_name: String::new(),
            reason: "Adjusted".to_string(),
            status,
            reviewed_by_uid: "mgr".to_string(),
            reviewed_by_name: "Alex".to_string(),
            review_note: "Reviewed".to_string(),
        }
    }

    #[test]
    fn filters_resolved_history_by_status_and_query() {
        let items = vec![
            mk_change("1", "Morning Ops", "Maya Patel", ApprovalStatus::Approved),
            mk_change("2", "Night Desk", "Liam Brooks", ApprovalStatus::Denied),
            mk_change("3", "Pending Shift", "Elena Chen", ApprovalStatus::Pending),
        ];

        let all = filter_shift_history(&items, &HistoryFilterKind::All, "");
        assert_eq!(all.total_resolved, 2);
        assert_eq!(all.approved_count, 1);
        assert_eq!(all.rejected_count, 1);

        let maya = filter_shift_history(&items, &HistoryFilterKind::Approved, "maya");
        assert_eq!(maya.items.len(), 1);
        assert_eq!(maya.items[0].id, "1");

        let denied_miss = filter_shift_history(&items, &HistoryFilterKind::Rejected, "maya");
        assert!(denied_miss.items.is_empty());
    }
}
