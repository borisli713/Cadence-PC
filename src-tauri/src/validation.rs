use crate::fairness::compute_shift_hours;
use crate::models::{
    ScheduleChangeType, Shift, ShiftStatus, ValidationOutcome,
};

pub const MAX_DISPLAY_NAME: usize = 80;
pub const MAX_DEPARTMENT: usize = 60;
pub const MAX_TITLE: usize = 120;
pub const MAX_FAIRNESS_NOTE: usize = 300;
pub const MAX_REASON: usize = 400;
pub const MAX_REVIEW_NOTE: usize = 300;
pub const MAX_HANDOFF_NOTES: usize = 600;
pub const MAX_NOTES: usize = 300;

pub fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub fn is_valid_iso_date(date: &str) -> bool {
    let bytes = date.as_bytes();
    if bytes.len() != 10 {
        return false;
    }
    if bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    let y_ok = bytes[0..4].iter().all(|b| b.is_ascii_digit());
    let m_ok = bytes[5..7].iter().all(|b| b.is_ascii_digit());
    let d_ok = bytes[8..10].iter().all(|b| b.is_ascii_digit());
    if !y_ok || !m_ok || !d_ok {
        return false;
    }
    let month: u32 = date[5..7].parse().unwrap_or(0);
    let day: u32 = date[8..10].parse().unwrap_or(0);
    (1..=12).contains(&month) && (1..=31).contains(&day)
}

pub fn is_valid_hhmm(time: &str) -> bool {
    let bytes = time.as_bytes();
    if bytes.len() != 5 || bytes[2] != b':' {
        return false;
    }
    let h: u32 = match time[0..2].parse() {
        Ok(v) => v,
        Err(_) => return false,
    };
    let m: u32 = match time[3..5].parse() {
        Ok(v) => v,
        Err(_) => return false,
    };
    h < 24 && m < 60
}

pub fn clamp_str(input: &str, max_chars: usize) -> String {
    input.trim().chars().take(max_chars).collect()
}

pub fn validate_shift_input(
    title: &str,
    department: &str,
    date: &str,
    start_time: &str,
    end_time: &str,
) -> ValidationOutcome {
    if title.trim().is_empty() || title.trim().chars().count() > MAX_TITLE {
        return ValidationOutcome {
            valid: false,
            error_message: Some(format!(
                "Shift title must be between 1 and {} characters.",
                MAX_TITLE
            )),
        };
    }
    if department.trim().is_empty() || department.trim().chars().count() > MAX_DEPARTMENT {
        return ValidationOutcome {
            valid: false,
            error_message: Some(format!(
                "Department must be between 1 and {} characters.",
                MAX_DEPARTMENT
            )),
        };
    }
    if !is_valid_iso_date(date) {
        return ValidationOutcome {
            valid: false,
            error_message: Some("Date must follow YYYY-MM-DD format.".to_string()),
        };
    }
    if !is_valid_hhmm(start_time) || !is_valid_hhmm(end_time) {
        return ValidationOutcome {
            valid: false,
            error_message: Some("Start and end times must follow HH:MM 24-hour format.".to_string()),
        };
    }
    if compute_shift_hours(start_time, end_time, 0) < 0.25 {
        return ValidationOutcome {
            valid: false,
            error_message: Some("Shift duration must be at least 15 minutes.".to_string()),
        };
    }
    ValidationOutcome {
        valid: true,
        error_message: None,
    }
}

pub fn validate_shift_report_input(
    shift_title: &str,
    department: &str,
    date: &str,
    actual_start: &str,
    actual_end: &str,
    break_minutes: i32,
) -> ValidationOutcome {
    if !(0..=180).contains(&break_minutes) {
        return ValidationOutcome {
            valid: false,
            error_message: Some("Break minutes must be between 0 and 180.".to_string()),
        };
    }
    validate_shift_input(shift_title, department, date, actual_start, actual_end)
}

pub fn validate_time_off_input(
    start_date: &str,
    end_date: &str,
    reason: &str,
) -> ValidationOutcome {
    if !is_valid_iso_date(start_date) || !is_valid_iso_date(end_date) {
        return ValidationOutcome {
            valid: false,
            error_message: Some("Enter valid YYYY-MM-DD start and end dates.".to_string()),
        };
    }
    if end_date < start_date {
        return ValidationOutcome {
            valid: false,
            error_message: Some("End date must be on or after start date.".to_string()),
        };
    }
    let clean_reason = reason.trim();
    if clean_reason.is_empty() || clean_reason.chars().count() > MAX_REASON {
        return ValidationOutcome {
            valid: false,
            error_message: Some(format!(
                "Time off reason must be between 1 and {} characters.",
                MAX_REASON
            )),
        };
    }
    ValidationOutcome {
        valid: true,
        error_message: None,
    }
}

pub fn validate_schedule_change_request(
    shift: &Shift,
    requester_uid: &str,
    is_manager: bool,
    request_type: &ScheduleChangeType,
    proposed_date: &str,
    proposed_start: &str,
    proposed_end: &str,
    proposed_assignee_uid: &str,
    reason: &str,
) -> ValidationOutcome {
    if shift.status == ShiftStatus::Completed {
        return ValidationOutcome {
            valid: false,
            error_message: Some("Completed shifts cannot be modified.".to_string()),
        };
    }
    if !is_valid_iso_date(proposed_date)
        || !is_valid_hhmm(proposed_start)
        || !is_valid_hhmm(proposed_end)
    {
        return ValidationOutcome {
            valid: false,
            error_message: Some("Enter valid proposed date and time.".to_string()),
        };
    }
    if reason.trim().is_empty() || reason.trim().chars().count() > MAX_REASON {
        return ValidationOutcome {
            valid: false,
            error_message: Some("Provide a reason for manager review.".to_string()),
        };
    }

    if !is_manager {
        match request_type {
            ScheduleChangeType::Claim => {
                if shift.status != ShiftStatus::Open || !shift.assigned_uid.trim().is_empty() {
                    return ValidationOutcome {
                        valid: false,
                        error_message: Some("Only unassigned open shifts can be claimed.".to_string()),
                    };
                }
                if !proposed_assignee_uid.is_empty() && proposed_assignee_uid != requester_uid {
                    return ValidationOutcome {
                        valid: false,
                        error_message: Some("Claims can only assign the shift to yourself.".to_string()),
                    };
                }
            }
            ScheduleChangeType::Swap => {
                if shift.assigned_uid != requester_uid {
                    return ValidationOutcome {
                        valid: false,
                        error_message: Some("You can only swap shifts currently assigned to you.".to_string()),
                    };
                }
                if proposed_assignee_uid.trim().is_empty() {
                    return ValidationOutcome {
                        valid: false,
                        error_message: Some("Select a teammate to swap this shift with.".to_string()),
                    };
                }
            }
            ScheduleChangeType::Drop => {
                if shift.assigned_uid != requester_uid {
                    return ValidationOutcome {
                        valid: false,
                        error_message: Some("You can only drop shifts assigned to you.".to_string()),
                    };
                }
                if !proposed_assignee_uid.is_empty() {
                    return ValidationOutcome {
                        valid: false,
                        error_message: Some("Drop requests must leave assignee empty.".to_string()),
                    };
                }
            }
            ScheduleChangeType::TimeChange => {
                if shift.assigned_uid != requester_uid {
                    return ValidationOutcome {
                        valid: false,
                        error_message: Some("You can only request time changes for your shifts.".to_string()),
                    };
                }
            }
        }
    }

    ValidationOutcome {
        valid: true,
        error_message: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_shift(status: ShiftStatus, assigned_uid: &str) -> Shift {
        Shift {
            id: "s1".to_string(),
            title: "Morning Ops".to_string(),
            department: "Operations".to_string(),
            date: "2026-11-23".to_string(),
            start_time: "07:00".to_string(),
            end_time: "15:00".to_string(),
            duration_hours: 8.0,
            assigned_uid: assigned_uid.to_string(),
            assigned_name: String::new(),
            candidate_uids: vec![],
            status,
            visibility: "team".to_string(),
            fairness_note: String::new(),
            created_by: "mgr".to_string(),
        }
    }

    #[test]
    fn validates_iso_dates_and_hhmm() {
        assert!(is_valid_iso_date("2026-11-20"));
        assert!(!is_valid_iso_date("2026-13-01"));
        assert!(!is_valid_iso_date("20-11-2026"));
        assert!(is_valid_hhmm("07:30"));
        assert!(is_valid_hhmm("23:59"));
        assert!(!is_valid_hhmm("24:00"));
        assert!(!is_valid_hhmm("09:60"));
    }

    #[test]
    fn enforces_time_off_ordering() {
        let bad = validate_time_off_input("2026-11-25", "2026-11-22", "Trip");
        assert!(!bad.valid);
        let good = validate_time_off_input("2026-11-22", "2026-11-25", "Family trip");
        assert!(good.valid);
    }

    #[test]
    fn enforces_schedule_change_authorization() {
        let open_shift = sample_shift(ShiftStatus::Open, "");
        let ok_claim = validate_schedule_change_request(
            &open_shift,
            "u1",
            false,
            &ScheduleChangeType::Claim,
            "2026-11-23",
            "07:00",
            "15:00",
            "u1",
            "Available to cover",
        );
        assert!(ok_claim.valid);

        let other_shift = sample_shift(ShiftStatus::Scheduled, "u2");
        let denied_drop = validate_schedule_change_request(
            &other_shift,
            "u1",
            false,
            &ScheduleChangeType::Drop,
            "2026-11-23",
            "07:00",
            "15:00",
            "",
            "Cannot work",
        );
        assert!(!denied_drop.valid);
    }

    #[test]
    fn validates_ids_breaks_and_overnight_shift_inputs() {
        assert!(is_valid_id("shift_abc-123"));
        assert!(!is_valid_id(""));
        assert!(!is_valid_id("shift/abc"));
        assert_eq!(clamp_str("  Operations  ", 5), "Opera");

        let overnight = validate_shift_input(
            "Overnight Guard",
            "Security",
            "2026-11-24",
            "22:00",
            "06:00",
        );
        assert!(overnight.valid);

        let too_short_break = validate_shift_report_input(
            "Morning",
            "Operations",
            "2026-11-24",
            "08:00",
            "16:00",
            240,
        );
        assert!(!too_short_break.valid);

        let empty_title = validate_shift_input("  ", "Operations", "2026-11-24", "08:00", "16:00");
        assert!(!empty_title.valid);
    }

    #[test]
    fn enforces_completed_lock_swap_target_and_manager_override() {
        let completed = sample_shift(ShiftStatus::Completed, "u1");
        let completed_res = validate_schedule_change_request(
            &completed,
            "u1",
            true,
            &ScheduleChangeType::TimeChange,
            "2026-11-23",
            "08:00",
            "16:00",
            "",
            "Adjust time",
        );
        assert!(!completed_res.valid);

        let assigned = sample_shift(ShiftStatus::Scheduled, "u1");
        let swap_missing_peer = validate_schedule_change_request(
            &assigned,
            "u1",
            false,
            &ScheduleChangeType::Swap,
            "2026-11-23",
            "07:00",
            "15:00",
            "",
            "Need trade",
        );
        assert!(!swap_missing_peer.valid);

        let manager_override = validate_schedule_change_request(
            &assigned,
            "mgr_1",
            true,
            &ScheduleChangeType::TimeChange,
            "2026-11-23",
            "08:00",
            "16:00",
            "",
            "Schedule rebalance",
        );
        assert!(manager_override.valid);
    }
}
