use chrono::{Duration, NaiveDate};

use crate::models::{Shift, ShiftStatus};

fn escape_ics_text(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace("\r\n", "\\n")
        .replace('\n', "\\n")
        .replace(',', "\\,")
        .replace(';', "\\;")
}

fn resolve_end_date(date_str: &str, start_time: &str, end_time: &str) -> String {
    if end_time <= start_time {
        if let Ok(parsed) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
            return (parsed + Duration::days(1)).format("%Y-%m-%d").to_string();
        }
    }
    date_str.to_string()
}

fn to_ics_stamp(date_str: &str, time_str: &str) -> String {
    let d = date_str.replace('-', "");
    let t = format!("{}00", time_str.replace(':', ""));
    format!("{}T{}", d, t)
}

pub fn generate_ics_content(shifts: &[Shift]) -> String {
    let mut lines = vec![
        "BEGIN:VCALENDAR".to_string(),
        "VERSION:2.0".to_string(),
        "PRODID:-//Cadence//Shift Reporting & Fair Scheduling//EN".to_string(),
        "CALSCALE:GREGORIAN".to_string(),
        "METHOD:PUBLISH".to_string(),
    ];

    for shift in shifts {
        let end_date = resolve_end_date(&shift.date, &shift.start_time, &shift.end_time);
        let dt_start = to_ics_stamp(&shift.date, &shift.start_time);
        let dt_end = to_ics_stamp(&end_date, &shift.end_time);
        let assignee = if !shift.assigned_name.trim().is_empty() {
            shift.assigned_name.as_str()
        } else {
            "Open Shift"
        };
        let summary = escape_ics_text(&format!("{} — {}", shift.title, assignee));
        let mut raw_desc = format!(
            "Department: {}\nStatus: {}\nHours: {}h",
            shift.department,
            shift.status.as_str(),
            shift.duration_hours
        );
        if !shift.fairness_note.trim().is_empty() {
            raw_desc.push('\n');
            raw_desc.push_str(&shift.fairness_note);
        }
        let desc = escape_ics_text(&raw_desc);
        let status_val = if shift.status == ShiftStatus::Open {
            "TENTATIVE"
        } else {
            "CONFIRMED"
        };

        lines.push("BEGIN:VEVENT".to_string());
        lines.push(format!("UID:cadence-{}@cadence.app", shift.id));
        lines.push(format!("DTSTART:{}", dt_start));
        lines.push(format!("DTEND:{}", dt_end));
        lines.push(format!("SUMMARY:{}", summary));
        lines.push(format!("DESCRIPTION:{}", desc));
        lines.push(format!("CATEGORIES:{}", escape_ics_text(&shift.department)));
        lines.push(format!("STATUS:{}", status_val));
        lines.push("END:VEVENT".to_string());
    }

    lines.push("END:VCALENDAR".to_string());
    lines.join("\r\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_valid_ics_with_overnight_rollover() {
        let shifts = vec![Shift {
            id: "s_night".to_string(),
            title: "Overnight Desk".to_string(),
            department: "Operations".to_string(),
            date: "2026-11-23".to_string(),
            start_time: "22:00".to_string(),
            end_time: "06:00".to_string(),
            duration_hours: 8.0,
            assigned_uid: "u1".to_string(),
            assigned_name: "Maya Patel".to_string(),
            candidate_uids: vec![],
            status: ShiftStatus::Scheduled,
            visibility: "team".to_string(),
            fairness_note: "Fair assignment".to_string(),
            created_by: "mgr".to_string(),
        }];
        let ics = generate_ics_content(&shifts);
        assert!(ics.contains("DTSTART:20261123T220000"));
        assert!(ics.contains("DTEND:20261124T060000"));
        assert!(ics.contains("STATUS:CONFIRMED"));
    }
}
