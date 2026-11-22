use std::collections::{BTreeMap, HashMap};

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::fairness::parse_time_to_minutes;
use crate::models::{Shift, ShiftStatus, StaffDirectoryEntry};
use crate::workspace_cache::WorkspaceCacheState;

pub const DEFAULT_MIN_REST_HOURS: f64 = 10.0;
pub const DEFAULT_MAX_DAILY_HOURS: f64 = 12.0;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ComplianceRuleKind {
    InsufficientRestGap,
    WeeklyOvertimeRisk,
    ExcessiveDailyHours,
    ConsecutiveDaysStreak,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceViolation {
    pub rule: ComplianceRuleKind,
    pub severity: String,
    pub staff_uid: String,
    pub staff_name: String,
    pub date: String,
    pub shift_ids: Vec<String>,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StaffWorkloadRisk {
    pub uid: String,
    pub display_name: String,
    pub scheduled_hours: f64,
    pub logged_hours: f64,
    pub weekly_target: f64,
    pub overtime_hours: f64,
    pub max_consecutive_days: usize,
    pub violation_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceAuditReport {
    pub min_rest_hours: f64,
    pub max_daily_hours: f64,
    pub total_violations: usize,
    pub critical_count: usize,
    pub warning_count: usize,
    pub violations: Vec<ComplianceViolation>,
    pub staff_risks: Vec<StaffWorkloadRisk>,
}

fn shift_window_epoch_minutes(shift: &Shift) -> Option<(i64, i64)> {
    let date = NaiveDate::parse_from_str(shift.date.trim(), "%Y-%m-%d").ok()?;
    let epoch = NaiveDate::from_ymd_opt(1970, 1, 1)?;
    let days = date.signed_duration_since(epoch).num_days();
    let start_m = parse_time_to_minutes(&shift.start_time) as i64;
    let mut end_m = parse_time_to_minutes(&shift.end_time) as i64;
    if end_m <= start_m {
        end_m += 24 * 60;
    }
    let base = days * 24 * 60;
    Some((base + start_m, base + end_m))
}

fn longest_consecutive_day_streak(dates: &[NaiveDate]) -> usize {
    if dates.is_empty() {
        return 0;
    }
    let mut best = 1usize;
    let mut cur = 1usize;
    for pair in dates.windows(2) {
        let diff = pair[1].signed_duration_since(pair[0]).num_days();
        if diff == 1 {
            cur += 1;
            if cur > best {
                best = cur;
            }
        } else if diff > 1 {
            cur = 1;
        }
    }
    best
}

fn round2(val: f64) -> f64 {
    (val * 100.0).round() / 100.0
}

pub fn analyze_workforce_compliance(
    staff_directory: &[StaffDirectoryEntry],
    shifts: &[Shift],
    min_rest_hours: f64,
    max_daily_hours: f64,
) -> ComplianceAuditReport {
    let min_rest_mins = (min_rest_hours.max(1.0) * 60.0) as i64;
    let mut by_uid: HashMap<&str, Vec<&Shift>> = HashMap::new();
    for shift in shifts {
        if shift.status == ShiftStatus::Open || shift.assigned_uid.trim().is_empty() {
            continue;
        }
        by_uid
            .entry(shift.assigned_uid.as_str())
            .or_default()
            .push(shift);
    }

    let mut violations = Vec::new();
    let mut staff_risks = Vec::new();

    for member in staff_directory {
        let member_shifts = by_uid.get(member.uid.as_str()).cloned().unwrap_or_default();
        let mut timed: Vec<(i64, i64, &Shift)> = member_shifts
            .iter()
            .filter_map(|s| shift_window_epoch_minutes(s).map(|(st, en)| (st, en, *s)))
            .collect();
        timed.sort_by_key(|(st, en, _)| (*st, *en));

        let mut member_violation_count = 0usize;

        for pair in timed.windows(2) {
            let (prev_start, prev_end, prev_shift) = pair[0];
            let (next_start, _next_end, next_shift) = pair[1];
            if next_start >= prev_end {
                let gap_mins = next_start - prev_end;
                if gap_mins < min_rest_mins {
                    let gap_hours = round2(gap_mins as f64 / 60.0);
                    member_violation_count += 1;
                    violations.push(ComplianceViolation {
                        rule: ComplianceRuleKind::InsufficientRestGap,
                        severity: if gap_hours < 8.0 {
                            "critical".to_string()
                        } else {
                            "warning".to_string()
                        },
                        staff_uid: member.uid.clone(),
                        staff_name: member.display_name.clone(),
                        date: next_shift.date.clone(),
                        shift_ids: vec![prev_shift.id.clone(), next_shift.id.clone()],
                        detail: format!(
                            "Only {:.1}h rest between '{}' ({} {}) and '{}' ({} {}); minimum is {:.1}h.",
                            gap_hours,
                            prev_shift.title,
                            prev_shift.date,
                            prev_shift.end_time,
                            next_shift.title,
                            next_shift.date,
                            next_shift.start_time,
                            min_rest_hours
                        ),
                    });
                }
            } else if prev_start != next_start || prev_shift.id != next_shift.id {
                // Overlapping already flagged in scheduler, skip rest gap notice
            }
        }

        let mut hours_by_date: BTreeMap<NaiveDate, (f64, Vec<String>)> = BTreeMap::new();
        let mut scheduled_total = 0.0;
        for s in &member_shifts {
            scheduled_total += s.duration_hours;
            if let Ok(d) = NaiveDate::parse_from_str(s.date.trim(), "%Y-%m-%d") {
                let entry = hours_by_date.entry(d).or_insert_with(|| (0.0, Vec::new()));
                entry.0 += s.duration_hours;
                entry.1.push(s.id.clone());
            }
        }

        for (day, (hrs, ids)) in &hours_by_date {
            if *hrs > max_daily_hours + 0.01 {
                member_violation_count += 1;
                violations.push(ComplianceViolation {
                    rule: ComplianceRuleKind::ExcessiveDailyHours,
                    severity: "critical".to_string(),
                    staff_uid: member.uid.clone(),
                    staff_name: member.display_name.clone(),
                    date: day.format("%Y-%m-%d").to_string(),
                    shift_ids: ids.clone(),
                    detail: format!(
                        "Scheduled for {:.1}h on {}, exceeding {:.1}h daily limit.",
                        hrs,
                        day.format("%Y-%m-%d"),
                        max_daily_hours
                    ),
                });
            }
        }

        let sorted_dates: Vec<NaiveDate> = hours_by_date.keys().copied().collect();
        let streak = longest_consecutive_day_streak(&sorted_dates);
        if streak >= 6 {
            member_violation_count += 1;
            let last_day = sorted_dates
                .last()
                .map(|d| d.format("%Y-%m-%d").to_string())
                .unwrap_or_default();
            violations.push(ComplianceViolation {
                rule: ComplianceRuleKind::ConsecutiveDaysStreak,
                severity: "warning".to_string(),
                staff_uid: member.uid.clone(),
                staff_name: member.display_name.clone(),
                date: last_day,
                shift_ids: member_shifts.iter().map(|s| s.id.clone()).collect(),
                detail: format!("Scheduled {} consecutive days without a rest day.", streak),
            });
        }

        let combined = round2(member.total_hours_worked + scheduled_total);
        let overtime = round2((combined - member.weekly_hours_target).max(0.0));
        if overtime >= 4.0 {
            member_violation_count += 1;
            violations.push(ComplianceViolation {
                rule: ComplianceRuleKind::WeeklyOvertimeRisk,
                severity: if overtime >= 10.0 {
                    "critical".to_string()
                } else {
                    "warning".to_string()
                },
                staff_uid: member.uid.clone(),
                staff_name: member.display_name.clone(),
                date: sorted_dates
                    .last()
                    .map(|d| d.format("%Y-%m-%d").to_string())
                    .unwrap_or_default(),
                shift_ids: Vec::new(),
                detail: format!(
                    "Projected {:.1}h combined vs {:.1}h target (+{:.1}h overtime).",
                    combined, member.weekly_hours_target, overtime
                ),
            });
        }

        staff_risks.push(StaffWorkloadRisk {
            uid: member.uid.clone(),
            display_name: member.display_name.clone(),
            scheduled_hours: round2(scheduled_total),
            logged_hours: round2(member.total_hours_worked),
            weekly_target: member.weekly_hours_target,
            overtime_hours: overtime,
            max_consecutive_days: streak,
            violation_count: member_violation_count,
        });
    }

    staff_risks.sort_by(|a, b| {
        b.violation_count
            .cmp(&a.violation_count)
            .then_with(|| a.display_name.cmp(&b.display_name))
    });

    let critical_count = violations.iter().filter(|v| v.severity == "critical").count();
    let warning_count = violations.len().saturating_sub(critical_count);

    ComplianceAuditReport {
        min_rest_hours,
        max_daily_hours,
        total_violations: violations.len(),
        critical_count,
        warning_count,
        violations,
        staff_risks,
    }
}

#[tauri::command]
pub fn analyze_workforce_compliance_cmd(
    cache: State<'_, WorkspaceCacheState>,
    min_rest_hours: Option<f64>,
    max_daily_hours: Option<f64>,
) -> ComplianceAuditReport {
    let snap = cache.current_snapshot();
    analyze_workforce_compliance(
        &snap.staff_directory,
        &snap.shifts,
        min_rest_hours.unwrap_or(DEFAULT_MIN_REST_HOURS),
        max_daily_hours.unwrap_or(DEFAULT_MAX_DAILY_HOURS),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::UserRole;

    fn mk_staff(uid: &str, worked: f64, target: f64) -> StaffDirectoryEntry {
        StaffDirectoryEntry {
            uid: uid.to_string(),
            display_name: uid.to_string(),
            role: UserRole::Staff,
            department: "Operations".to_string(),
            total_hours_worked: worked,
            scheduled_hours_this_week: 0.0,
            weekly_hours_target: target,
            last_assigned_at: String::new(),
            is_sample_roster: false,
        }
    }

    fn mk_shift(id: &str, uid: &str, date: &str, start: &str, end: &str, hrs: f64) -> Shift {
        Shift {
            id: id.to_string(),
            title: format!("Shift {id}"),
            department: "Operations".to_string(),
            date: date.to_string(),
            start_time: start.to_string(),
            end_time: end.to_string(),
            duration_hours: hrs,
            assigned_uid: uid.to_string(),
            assigned_name: uid.to_string(),
            candidate_uids: vec![],
            status: ShiftStatus::Scheduled,
            visibility: "team".to_string(),
            fairness_note: String::new(),
            created_by: "mgr".to_string(),
        }
    }

    #[test]
    fn detects_clopening_insufficient_rest_gap() {
        let roster = vec![mk_staff("u1", 0.0, 40.0)];
        let shifts = vec![
            mk_shift("s1", "u1", "2026-11-23", "15:00", "23:00", 8.0),
            mk_shift("s2", "u1", "2026-11-24", "07:00", "15:00", 8.0),
        ];
        let report = analyze_workforce_compliance(&roster, &shifts, 10.0, 12.0);
        assert_eq!(report.total_violations, 1);
        assert_eq!(
            report.violations[0].rule,
            ComplianceRuleKind::InsufficientRestGap
        );
        assert_eq!(report.violations[0].severity, "warning");
    }

    #[test]
    fn detects_six_day_streak_and_overtime() {
        let roster = vec![mk_staff("u1", 10.0, 40.0)];
        let shifts: Vec<Shift> = (1..=6)
            .map(|d| {
                mk_shift(
                    &format!("s{d}"),
                    "u1",
                    &format!("2026-11-{:02}", 10 + d),
                    "09:00",
                    "17:00",
                    8.0,
                )
            })
            .collect();
        let report = analyze_workforce_compliance(&roster, &shifts, 10.0, 12.0);
        assert!(report
            .violations
            .iter()
            .any(|v| v.rule == ComplianceRuleKind::ConsecutiveDaysStreak));
        assert!(report
            .violations
            .iter()
            .any(|v| v.rule == ComplianceRuleKind::WeeklyOvertimeRisk));
        assert_eq!(report.staff_risks[0].overtime_hours, 18.0);
        assert_eq!(report.staff_risks[0].max_consecutive_days, 6);
    }

    #[test]
    fn flags_excessive_daily_hours_as_critical_and_passes_exact_rest_boundary() {
        let roster = vec![mk_staff("u1", 0.0, 40.0), mk_staff("u2", 0.0, 40.0)];
        let shifts = vec![
            mk_shift("d1", "u1", "2026-11-23", "06:00", "20:00", 14.0),
            mk_shift("r1", "u2", "2026-11-23", "12:00", "20:00", 8.0),
            mk_shift("r2", "u2", "2026-11-24", "06:00", "14:00", 8.0),
        ];
        let report = analyze_workforce_compliance(&roster, &shifts, 10.0, 12.0);
        assert_eq!(report.critical_count, 1);
        assert_eq!(report.warning_count, 0);
        assert_eq!(
            report.violations[0].rule,
            ComplianceRuleKind::ExcessiveDailyHours
        );
        assert_eq!(report.violations[0].staff_uid, "u1");
    }
}
