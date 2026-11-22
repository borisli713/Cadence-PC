use std::collections::HashSet;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::approvals::{
    plan_accept_all_changes, plan_schedule_change_decision, plan_time_off_decision,
};
use crate::fairness::{
    build_fairness_arrangement_plan, build_open_shift_assignment_plan, compute_shift_hours,
    default_week_slots, generate_weekly_fairness_schedule,
};
use crate::firebase_client::{
    generate_firestore_id, parse_user_role_str, FirebaseRestClient, FirestoreWriteOp,
};
use crate::models::{
    ApprovalStatus, FairnessArrangementItem, GeneratedShiftSpec, NotificationCategory,
    OpenShiftAssignmentItem, PushNotificationRecord, ScheduleChangeRequest, ScheduleChangeType,
    Shift, ShiftReport, ShiftReportStatus, ShiftStatus, ShiftSubmission, StaffDirectoryEntry,
    SubmissionStatus, TimeOffRequest, UserProfile, UserRole, WeekSlotConfig,
};
use crate::reports::{compute_net_worked_hours, plan_report_review};
use crate::roster::{build_provisioned_user_profile, can_toggle_manager_role};
use crate::seeder::build_default_sample_bundle_today;
use crate::validation::{
    clamp_str, is_valid_id, validate_schedule_change_request, validate_shift_input,
    validate_shift_report_input, validate_time_off_input, MAX_DEPARTMENT, MAX_DISPLAY_NAME,
    MAX_FAIRNESS_NOTE, MAX_HANDOFF_NOTES, MAX_NOTES, MAX_REASON, MAX_REVIEW_NOTE, MAX_TITLE,
};

pub const BOOTSTRAPPED_ADMIN_EMAIL: &str = "yatheili713@gmail.com";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyScheduleCommitResult {
    pub assigned: usize,
    pub open: usize,
}

fn enum_to_string<T: Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_default()
}

fn round2(val: f64) -> f64 {
    (val * 100.0).round() / 100.0
}

fn map_str(map: &Map<String, Value>, key: &str, fallback: &str) -> String {
    map.get(key)
        .and_then(|v| v.as_str())
        .unwrap_or(fallback)
        .to_string()
}

fn map_f64(map: &Map<String, Value>, key: &str, fallback: f64) -> f64 {
    map.get(key)
        .and_then(|v| v.as_f64())
        .filter(|v| v.is_finite())
        .unwrap_or(fallback)
}

fn map_bool(map: &Map<String, Value>, key: &str, fallback: bool) -> bool {
    map.get(key).and_then(|v| v.as_bool()).unwrap_or(fallback)
}

fn parse_profile_from_fields(
    uid: &str,
    fields: &Map<String, Value>,
    fallback_email: &str,
) -> UserProfile {
    let role_str = map_str(fields, "role", "staff");
    UserProfile {
        uid: map_str(fields, "uid", uid),
        email: map_str(fields, "email", fallback_email),
        display_name: map_str(fields, "displayName", "Team Member"),
        role: parse_user_role_str(&role_str),
        department: map_str(fields, "department", "Operations"),
        weekly_hours_target: map_f64(fields, "weeklyHoursTarget", 40.0),
        push_notifications_enabled: map_bool(fields, "pushNotificationsEnabled", true),
    }
}

fn notification_set_op(
    notif_id: &str,
    recipient_uid: &str,
    title: &str,
    message: &str,
    category: &NotificationCategory,
    related_shift_id: &str,
    actor_uid: &str,
) -> FirestoreWriteOp {
    let mut fields = Map::new();
    fields.insert("id".to_string(), Value::String(notif_id.to_string()));
    fields.insert(
        "recipientUid".to_string(),
        Value::String(recipient_uid.to_string()),
    );
    fields.insert("title".to_string(), Value::String(clamp_str(title, 120)));
    fields.insert("message".to_string(), Value::String(clamp_str(message, 400)));
    fields.insert("category".to_string(), Value::String(enum_to_string(category)));
    fields.insert(
        "relatedShiftId".to_string(),
        Value::String(related_shift_id.to_string()),
    );
    fields.insert("isRead".to_string(), Value::Bool(false));
    fields.insert("actorUid".to_string(), Value::String(actor_uid.to_string()));

    FirestoreWriteOp::Set {
        collection: "notifications".to_string(),
        doc_id: notif_id.to_string(),
        fields,
        server_timestamp_fields: vec!["createdAt".to_string(), "updatedAt".to_string()],
        require_not_exists: false,
    }
}

pub fn build_provision_plan(
    uid: &str,
    email: &str,
    display_name: &str,
    existing_user_fields: Option<&Map<String, Value>>,
    manager_doc_exists: bool,
    existing_staff_fields: Option<&Map<String, Value>>,
) -> (UserProfile, Vec<FirestoreWriteOp>, Option<FirestoreWriteOp>) {
    let clean_email = if email.trim().is_empty() {
        "staff@cadence.app"
    } else {
        email.trim()
    };
    let is_bootstrap_admin = clean_email.eq_ignore_ascii_case(BOOTSTRAPPED_ADMIN_EMAIL);

    let existing_profile =
        existing_user_fields.map(|fields| parse_profile_from_fields(uid, fields, clean_email));

    let effective_role = if is_bootstrap_admin || manager_doc_exists {
        UserRole::Manager
    } else if let Some(ref p) = existing_profile {
        p.role.clone()
    } else {
        UserRole::Staff
    };

    let provisioned_defaults =
        build_provisioned_user_profile(uid, clean_email, display_name, BOOTSTRAPPED_ADMIN_EMAIL);

    let mut writes = Vec::new();
    let final_profile = match existing_profile {
        None => {
            let initial_role = if effective_role == UserRole::Manager && !is_bootstrap_admin {
                UserRole::Staff
            } else {
                effective_role.clone()
            };

            let mut fields = Map::new();
            fields.insert("uid".to_string(), Value::String(uid.to_string()));
            fields.insert("email".to_string(), Value::String(clean_email.to_string()));
            fields.insert(
                "displayName".to_string(),
                Value::String(provisioned_defaults.display_name.clone()),
            );
            fields.insert("role".to_string(), Value::String(enum_to_string(&initial_role)));
            fields.insert(
                "department".to_string(),
                Value::String(provisioned_defaults.department.clone()),
            );
            fields.insert(
                "weeklyHoursTarget".to_string(),
                serde_json::json!(provisioned_defaults.weekly_hours_target),
            );
            fields.insert("pushNotificationsEnabled".to_string(), Value::Bool(true));

            writes.push(FirestoreWriteOp::Set {
                collection: "users".to_string(),
                doc_id: uid.to_string(),
                fields,
                server_timestamp_fields: vec!["createdAt".to_string(), "updatedAt".to_string()],
                require_not_exists: false,
            });

            if initial_role != effective_role {
                let mut role_fields = Map::new();
                role_fields.insert(
                    "role".to_string(),
                    Value::String(enum_to_string(&effective_role)),
                );
                writes.push(FirestoreWriteOp::UpdateMask {
                    collection: "users".to_string(),
                    doc_id: uid.to_string(),
                    fields: role_fields,
                    mask_paths: vec!["role".to_string()],
                    server_timestamp_fields: vec!["updatedAt".to_string()],
                    require_exists: true,
                });
            }

            UserProfile {
                role: effective_role.clone(),
                ..provisioned_defaults
            }
        }
        Some(existing) => {
            if existing.role != effective_role {
                let mut role_fields = Map::new();
                role_fields.insert(
                    "role".to_string(),
                    Value::String(enum_to_string(&effective_role)),
                );
                writes.push(FirestoreWriteOp::UpdateMask {
                    collection: "users".to_string(),
                    doc_id: uid.to_string(),
                    fields: role_fields,
                    mask_paths: vec!["role".to_string()],
                    server_timestamp_fields: vec!["updatedAt".to_string()],
                    require_exists: true,
                });
            }
            UserProfile {
                role: effective_role.clone(),
                ..existing
            }
        }
    };

    let mut optional_staff_role_sync: Option<FirestoreWriteOp> = None;
    match existing_staff_fields {
        None => {
            let mut staff_fields = Map::new();
            staff_fields.insert("uid".to_string(), Value::String(uid.to_string()));
            staff_fields.insert(
                "displayName".to_string(),
                Value::String(final_profile.display_name.clone()),
            );
            staff_fields.insert(
                "role".to_string(),
                Value::String(enum_to_string(&effective_role)),
            );
            staff_fields.insert(
                "department".to_string(),
                Value::String(final_profile.department.clone()),
            );
            staff_fields.insert("totalHoursWorked".to_string(), serde_json::json!(0.0));
            staff_fields.insert(
                "scheduledHoursThisWeek".to_string(),
                serde_json::json!(0.0),
            );
            staff_fields.insert(
                "weeklyHoursTarget".to_string(),
                serde_json::json!(final_profile.weekly_hours_target),
            );
            staff_fields.insert("lastAssignedAt".to_string(), Value::String(String::new()));
            staff_fields.insert("isSampleRoster".to_string(), Value::Bool(false));

            writes.push(FirestoreWriteOp::Set {
                collection: "staffDirectory".to_string(),
                doc_id: uid.to_string(),
                fields: staff_fields,
                server_timestamp_fields: vec!["updatedAt".to_string()],
                require_not_exists: false,
            });
        }
        Some(staff_fields) => {
            let existing_staff_role = parse_user_role_str(&map_str(staff_fields, "role", "staff"));
            if existing_staff_role != effective_role {
                let mut upd = Map::new();
                upd.insert(
                    "role".to_string(),
                    Value::String(enum_to_string(&effective_role)),
                );
                optional_staff_role_sync = Some(FirestoreWriteOp::UpdateMask {
                    collection: "staffDirectory".to_string(),
                    doc_id: uid.to_string(),
                    fields: upd,
                    mask_paths: vec!["role".to_string()],
                    server_timestamp_fields: vec!["updatedAt".to_string()],
                    require_exists: true,
                });
            }
        }
    }

    (final_profile, writes, optional_staff_role_sync)
}

pub fn writes_for_user_preferences(
    actor_uid: &str,
    uid: &str,
    display_name: &str,
    department: &str,
    weekly_hours_target: f64,
    push_notifications_enabled: bool,
) -> Result<Vec<FirestoreWriteOp>, String> {
    if actor_uid != uid {
        return Err("Cannot update another user preferences.".to_string());
    }
    let clean_name = clamp_str(display_name, MAX_DISPLAY_NAME);
    if clean_name.is_empty() {
        return Err("Display name cannot be empty.".to_string());
    }
    let clean_dept = {
        let trimmed = clamp_str(department, MAX_DEPARTMENT);
        if trimmed.is_empty() {
            "Operations".to_string()
        } else {
            trimmed
        }
    };
    let clamped_target = weekly_hours_target.clamp(1.0, 80.0);

    let mut user_fields = Map::new();
    user_fields.insert("displayName".to_string(), Value::String(clean_name.clone()));
    user_fields.insert("department".to_string(), Value::String(clean_dept.clone()));
    user_fields.insert(
        "weeklyHoursTarget".to_string(),
        serde_json::json!(clamped_target),
    );
    user_fields.insert(
        "pushNotificationsEnabled".to_string(),
        Value::Bool(push_notifications_enabled),
    );

    let mut staff_fields = Map::new();
    staff_fields.insert("displayName".to_string(), Value::String(clean_name));
    staff_fields.insert("department".to_string(), Value::String(clean_dept));
    staff_fields.insert(
        "weeklyHoursTarget".to_string(),
        serde_json::json!(clamped_target),
    );

    Ok(vec![
        FirestoreWriteOp::UpdateMask {
            collection: "users".to_string(),
            doc_id: uid.to_string(),
            fields: user_fields,
            mask_paths: vec![
                "displayName".to_string(),
                "department".to_string(),
                "weeklyHoursTarget".to_string(),
                "pushNotificationsEnabled".to_string(),
            ],
            server_timestamp_fields: vec!["updatedAt".to_string()],
            require_exists: true,
        },
        FirestoreWriteOp::UpdateMask {
            collection: "staffDirectory".to_string(),
            doc_id: uid.to_string(),
            fields: staff_fields,
            mask_paths: vec![
                "displayName".to_string(),
                "department".to_string(),
                "weeklyHoursTarget".to_string(),
            ],
            server_timestamp_fields: vec!["updatedAt".to_string()],
            require_exists: true,
        },
    ])
}

#[allow(clippy::too_many_arguments)]
pub fn writes_for_create_shift(
    actor_uid: &str,
    shift_id: &str,
    title: &str,
    department: &str,
    date: &str,
    start_time: &str,
    end_time: &str,
    assigned_uid: &str,
    assigned_name: &str,
    candidate_uids: &[String],
    status: &ShiftStatus,
    fairness_note: &str,
    created_by: &str,
) -> Result<Vec<FirestoreWriteOp>, String> {
    let clean_title = {
        let t = clamp_str(title, MAX_TITLE);
        if t.is_empty() {
            "Assigned Shift".to_string()
        } else {
            t
        }
    };
    let clean_dept = {
        let d = clamp_str(department, MAX_DEPARTMENT);
        if d.is_empty() {
            "Operations".to_string()
        } else {
            d
        }
    };
    let outcome = validate_shift_input(&clean_title, &clean_dept, date, start_time, end_time);
    if !outcome.valid {
        return Err(outcome
            .error_message
            .unwrap_or_else(|| "Invalid shift fields.".to_string()));
    }

    let duration = compute_shift_hours(start_time, end_time, 0);
    let is_open = *status == ShiftStatus::Open || assigned_uid.trim().is_empty();
    let effective_status = if is_open {
        ShiftStatus::Open
    } else {
        status.clone()
    };
    let effective_uid = if is_open { "" } else { assigned_uid.trim() };
    let effective_name = if is_open {
        ""
    } else {
        assigned_name.trim()
    };
    let clamped_candidates: Vec<Value> = candidate_uids
        .iter()
        .filter(|id| is_valid_id(id))
        .take(20)
        .map(|id| Value::String(id.clone()))
        .collect();

    let mut fields = Map::new();
    fields.insert("id".to_string(), Value::String(shift_id.to_string()));
    fields.insert("title".to_string(), Value::String(clean_title.clone()));
    fields.insert("department".to_string(), Value::String(clean_dept));
    fields.insert("date".to_string(), Value::String(date.to_string()));
    fields.insert(
        "startTime".to_string(),
        Value::String(start_time.to_string()),
    );
    fields.insert("endTime".to_string(), Value::String(end_time.to_string()));
    fields.insert("durationHours".to_string(), serde_json::json!(duration));
    fields.insert(
        "assignedUid".to_string(),
        Value::String(effective_uid.to_string()),
    );
    fields.insert(
        "assignedName".to_string(),
        Value::String(clamp_str(effective_name, MAX_DISPLAY_NAME)),
    );
    fields.insert("candidateUids".to_string(), Value::Array(clamped_candidates));
    fields.insert(
        "status".to_string(),
        Value::String(effective_status.as_str().to_string()),
    );
    fields.insert("visibility".to_string(), Value::String("team".to_string()));
    fields.insert(
        "fairnessNote".to_string(),
        Value::String(clamp_str(fairness_note, MAX_FAIRNESS_NOTE)),
    );
    fields.insert(
        "createdBy".to_string(),
        Value::String(if created_by.trim().is_empty() {
            actor_uid.to_string()
        } else {
            created_by.to_string()
        }),
    );

    let mut writes = vec![FirestoreWriteOp::Set {
        collection: "shifts".to_string(),
        doc_id: shift_id.to_string(),
        fields,
        server_timestamp_fields: vec!["createdAt".to_string(), "updatedAt".to_string()],
        require_not_exists: false,
    }];

    if !effective_uid.is_empty()
        && effective_uid != actor_uid
        && effective_status != ShiftStatus::Open
    {
        let notif_id = generate_firestore_id("ntf");
        writes.push(notification_set_op(
            &notif_id,
            effective_uid,
            "New Shift Assigned",
            &format!(
                "{clean_title} on {date} ({start_time}-{end_time}) was assigned to you."
            ),
            &NotificationCategory::ShiftAssigned,
            shift_id,
            actor_uid,
        ));
    }

    Ok(writes)
}

#[allow(clippy::too_many_arguments)]
pub fn writes_for_update_shift(
    actor_uid: &str,
    shift_id: &str,
    title: &str,
    department: &str,
    date: &str,
    start_time: &str,
    end_time: &str,
    assigned_uid: &str,
    assigned_name: &str,
    status: &ShiftStatus,
    fairness_note: &str,
    previous_shift_fields: Option<&Map<String, Value>>,
) -> Result<Vec<FirestoreWriteOp>, String> {
    if !is_valid_id(shift_id) {
        return Err("Invalid shift identifier.".to_string());
    }
    let clean_title = {
        let t = clamp_str(title, MAX_TITLE);
        if t.is_empty() {
            "Assigned Shift".to_string()
        } else {
            t
        }
    };
    let clean_dept = {
        let d = clamp_str(department, MAX_DEPARTMENT);
        if d.is_empty() {
            "Operations".to_string()
        } else {
            d
        }
    };
    let outcome = validate_shift_input(&clean_title, &clean_dept, date, start_time, end_time);
    if !outcome.valid {
        return Err(outcome
            .error_message
            .unwrap_or_else(|| "Invalid shift fields.".to_string()));
    }

    let duration = compute_shift_hours(start_time, end_time, 0);
    let is_open = *status == ShiftStatus::Open || assigned_uid.trim().is_empty();
    let effective_status = if is_open {
        ShiftStatus::Open
    } else {
        status.clone()
    };
    let effective_uid = if is_open { "" } else { assigned_uid.trim() };
    let effective_name = if is_open {
        ""
    } else {
        assigned_name.trim()
    };

    let mut fields = Map::new();
    fields.insert("title".to_string(), Value::String(clean_title.clone()));
    fields.insert("department".to_string(), Value::String(clean_dept));
    fields.insert("date".to_string(), Value::String(date.to_string()));
    fields.insert(
        "startTime".to_string(),
        Value::String(start_time.to_string()),
    );
    fields.insert("endTime".to_string(), Value::String(end_time.to_string()));
    fields.insert("durationHours".to_string(), serde_json::json!(duration));
    fields.insert(
        "assignedUid".to_string(),
        Value::String(effective_uid.to_string()),
    );
    fields.insert(
        "assignedName".to_string(),
        Value::String(clamp_str(effective_name, MAX_DISPLAY_NAME)),
    );
    fields.insert(
        "status".to_string(),
        Value::String(effective_status.as_str().to_string()),
    );
    fields.insert(
        "fairnessNote".to_string(),
        Value::String(clamp_str(fairness_note, MAX_FAIRNESS_NOTE)),
    );

    let mask_paths = vec![
        "title".to_string(),
        "department".to_string(),
        "date".to_string(),
        "startTime".to_string(),
        "endTime".to_string(),
        "durationHours".to_string(),
        "assignedUid".to_string(),
        "assignedName".to_string(),
        "status".to_string(),
        "fairnessNote".to_string(),
    ];

    let mut writes = vec![FirestoreWriteOp::UpdateMask {
        collection: "shifts".to_string(),
        doc_id: shift_id.to_string(),
        fields,
        mask_paths,
        server_timestamp_fields: vec!["updatedAt".to_string()],
        require_exists: true,
    }];

    if !effective_uid.is_empty()
        && effective_uid != actor_uid
        && effective_status != ShiftStatus::Open
    {
        let (is_new_assignment, schedule_changed) = match previous_shift_fields {
            None => (true, false),
            Some(prev) => {
                let prev_uid = map_str(prev, "assignedUid", "");
                let prev_status = map_str(prev, "status", "scheduled");
                let prev_date = map_str(prev, "date", "");
                let prev_start = map_str(prev, "startTime", "");
                let prev_end = map_str(prev, "endTime", "");
                let prev_title = map_str(prev, "title", "");
                (
                    prev_uid != effective_uid || prev_status == "open",
                    prev_date != date
                        || prev_start != start_time
                        || prev_end != end_time
                        || prev_title != clean_title,
                )
            }
        };

        if is_new_assignment || schedule_changed {
            let notif_id = generate_firestore_id("ntf");
            let notif_title = if is_new_assignment {
                "New Shift Assigned"
            } else {
                "Shift Schedule Updated"
            };
            let notif_msg = if is_new_assignment {
                format!("{clean_title} on {date} ({start_time}-{end_time}) was assigned to you.")
            } else {
                format!("Your shift {clean_title} was updated to {date} ({start_time}-{end_time}).")
            };
            writes.push(notification_set_op(
                &notif_id,
                effective_uid,
                notif_title,
                &notif_msg,
                &NotificationCategory::ShiftAssigned,
                shift_id,
                actor_uid,
            ));
        }
    }

    Ok(writes)
}

#[allow(clippy::too_many_arguments)]
pub fn writes_for_submit_schedule_change(
    change_id: &str,
    shift: &Shift,
    requester_uid: &str,
    requester_name: &str,
    is_manager: bool,
    request_type: &ScheduleChangeType,
    proposed_date: &str,
    proposed_start_time: &str,
    proposed_end_time: &str,
    proposed_assignee_uid: &str,
    proposed_assignee_name: &str,
    reason: &str,
) -> Result<Vec<FirestoreWriteOp>, String> {
    let outcome = validate_schedule_change_request(
        shift,
        requester_uid,
        is_manager,
        request_type,
        proposed_date,
        proposed_start_time,
        proposed_end_time,
        proposed_assignee_uid,
        reason,
    );
    if !outcome.valid {
        return Err(outcome
            .error_message
            .unwrap_or_else(|| "Invalid schedule change request.".to_string()));
    }

    let mut fields = Map::new();
    fields.insert("id".to_string(), Value::String(change_id.to_string()));
    fields.insert("shiftId".to_string(), Value::String(shift.id.clone()));
    fields.insert(
        "shiftTitle".to_string(),
        Value::String(clamp_str(&shift.title, MAX_TITLE)),
    );
    fields.insert(
        "requesterUid".to_string(),
        Value::String(requester_uid.to_string()),
    );
    fields.insert(
        "requesterName".to_string(),
        Value::String(clamp_str(requester_name, MAX_DISPLAY_NAME)),
    );
    fields.insert(
        "type".to_string(),
        Value::String(enum_to_string(request_type)),
    );
    fields.insert(
        "currentDate".to_string(),
        Value::String(shift.date.clone()),
    );
    fields.insert(
        "currentStartTime".to_string(),
        Value::String(shift.start_time.clone()),
    );
    fields.insert(
        "currentEndTime".to_string(),
        Value::String(shift.end_time.clone()),
    );
    fields.insert(
        "proposedDate".to_string(),
        Value::String(proposed_date.to_string()),
    );
    fields.insert(
        "proposedStartTime".to_string(),
        Value::String(proposed_start_time.to_string()),
    );
    fields.insert(
        "proposedEndTime".to_string(),
        Value::String(proposed_end_time.to_string()),
    );
    fields.insert(
        "proposedAssigneeUid".to_string(),
        Value::String(proposed_assignee_uid.to_string()),
    );
    fields.insert(
        "proposedAssigneeName".to_string(),
        Value::String(clamp_str(proposed_assignee_name, MAX_DISPLAY_NAME)),
    );
    fields.insert(
        "reason".to_string(),
        Value::String(clamp_str(reason, MAX_REASON)),
    );
    fields.insert(
        "status".to_string(),
        Value::String(enum_to_string(&ApprovalStatus::Pending)),
    );
    fields.insert("reviewedByUid".to_string(), Value::String(String::new()));
    fields.insert("reviewedByName".to_string(), Value::String(String::new()));
    fields.insert("reviewNote".to_string(), Value::String(String::new()));

    let mut writes = vec![FirestoreWriteOp::Set {
        collection: "scheduleChanges".to_string(),
        doc_id: change_id.to_string(),
        fields,
        server_timestamp_fields: vec!["createdAt".to_string(), "updatedAt".to_string()],
        require_not_exists: false,
    }];

    if *request_type != ScheduleChangeType::Claim && shift.assigned_uid == requester_uid {
        let mut shift_upd = Map::new();
        shift_upd.insert(
            "status".to_string(),
            Value::String(ShiftStatus::PendingChange.as_str().to_string()),
        );
        writes.push(FirestoreWriteOp::UpdateMask {
            collection: "shifts".to_string(),
            doc_id: shift.id.clone(),
            fields: shift_upd,
            mask_paths: vec!["status".to_string()],
            server_timestamp_fields: vec!["updatedAt".to_string()],
            require_exists: true,
        });
    }

    Ok(writes)
}

pub fn writes_for_schedule_change_decision(
    req: &ScheduleChangeRequest,
    linked_shift: Option<&Shift>,
    decision: ApprovalStatus,
    reviewer_uid: &str,
    reviewer_name: &str,
    review_note: &str,
) -> Vec<FirestoreWriteOp> {
    let plan = plan_schedule_change_decision(
        req,
        linked_shift,
        decision.clone(),
        reviewer_uid,
        reviewer_name,
        review_note,
    );

    let mut req_fields = Map::new();
    req_fields.insert(
        "status".to_string(),
        Value::String(enum_to_string(&plan.decision)),
    );
    req_fields.insert(
        "reviewedByUid".to_string(),
        Value::String(plan.reviewed_by_uid.clone()),
    );
    req_fields.insert(
        "reviewedByName".to_string(),
        Value::String(clamp_str(&plan.reviewed_by_name, MAX_DISPLAY_NAME)),
    );
    req_fields.insert(
        "reviewNote".to_string(),
        Value::String(clamp_str(&plan.review_note, MAX_REVIEW_NOTE)),
    );

    let mut writes = vec![FirestoreWriteOp::UpdateMask {
        collection: "scheduleChanges".to_string(),
        doc_id: plan.request_id.clone(),
        fields: req_fields,
        mask_paths: vec![
            "status".to_string(),
            "reviewedByUid".to_string(),
            "reviewedByName".to_string(),
            "reviewNote".to_string(),
        ],
        server_timestamp_fields: vec!["updatedAt".to_string()],
        require_exists: true,
    }];

    if let Some(patch) = plan.shift_patch {
        let mut s_fields = Map::new();
        s_fields.insert("date".to_string(), Value::String(patch.date));
        s_fields.insert("startTime".to_string(), Value::String(patch.start_time));
        s_fields.insert("endTime".to_string(), Value::String(patch.end_time));
        s_fields.insert(
            "durationHours".to_string(),
            serde_json::json!(patch.duration_hours),
        );
        s_fields.insert("assignedUid".to_string(), Value::String(patch.assigned_uid));
        s_fields.insert(
            "assignedName".to_string(),
            Value::String(clamp_str(&patch.assigned_name, MAX_DISPLAY_NAME)),
        );
        s_fields.insert(
            "status".to_string(),
            Value::String(patch.status.as_str().to_string()),
        );
        s_fields.insert(
            "fairnessNote".to_string(),
            Value::String(clamp_str(&patch.fairness_note, MAX_FAIRNESS_NOTE)),
        );

        writes.push(FirestoreWriteOp::UpdateMask {
            collection: "shifts".to_string(),
            doc_id: patch.shift_id,
            fields: s_fields,
            mask_paths: vec![
                "date".to_string(),
                "startTime".to_string(),
                "endTime".to_string(),
                "durationHours".to_string(),
                "assignedUid".to_string(),
                "assignedName".to_string(),
                "status".to_string(),
                "fairnessNote".to_string(),
            ],
            server_timestamp_fields: vec!["updatedAt".to_string()],
            require_exists: true,
        });
    } else if decision == ApprovalStatus::Denied {
        if let Some(shift) = linked_shift {
            let restored = if shift.assigned_uid.trim().is_empty() {
                ShiftStatus::Open
            } else {
                ShiftStatus::Scheduled
            };
            let mut s_fields = Map::new();
            s_fields.insert(
                "status".to_string(),
                Value::String(restored.as_str().to_string()),
            );
            writes.push(FirestoreWriteOp::UpdateMask {
                collection: "shifts".to_string(),
                doc_id: shift.id.clone(),
                fields: s_fields,
                mask_paths: vec!["status".to_string()],
                server_timestamp_fields: vec!["updatedAt".to_string()],
                require_exists: true,
            });
        }
    }

    for notif in plan.notifications {
        let notif_id = generate_firestore_id("ntf");
        writes.push(notification_set_op(
            &notif_id,
            &notif.recipient_uid,
            &notif.title,
            &notif.message,
            &notif.category,
            &notif.related_shift_id,
            reviewer_uid,
        ));
    }

    writes
}

pub fn writes_for_accept_all(
    pending_requests: &[ScheduleChangeRequest],
    shifts: &[Shift],
    reviewer_uid: &str,
    reviewer_name: &str,
) -> (usize, Vec<FirestoreWriteOp>) {
    let plan = plan_accept_all_changes(
        pending_requests,
        shifts,
        reviewer_uid,
        reviewer_name,
        "Approved via Accept All",
    );
    let mut writes = Vec::new();
    let req_map: std::collections::HashMap<&str, &ScheduleChangeRequest> =
        pending_requests.iter().map(|r| (r.id.as_str(), r)).collect();

    for decision in &plan.decisions {
        if let Some(req) = req_map.get(decision.request_id.as_str()) {
            let linked = shifts.iter().find(|s| s.id == req.shift_id);
            writes.extend(writes_for_schedule_change_decision(
                req,
                linked,
                ApprovalStatus::Approved,
                reviewer_uid,
                reviewer_name,
                "Approved via Accept All",
            ));
        }
    }

    (plan.approved_count, writes)
}

#[allow(clippy::too_many_arguments)]
pub fn writes_for_submit_shift_report(
    report_id: &str,
    shift_id: &str,
    shift_title: &str,
    staff_uid: &str,
    staff_name: &str,
    department: &str,
    date: &str,
    actual_start_time: &str,
    actual_end_time: &str,
    break_minutes: i32,
    handoff_notes: &str,
) -> Result<Vec<FirestoreWriteOp>, String> {
    let clean_title = clamp_str(shift_title, MAX_TITLE);
    let clean_dept = {
        let d = clamp_str(department, MAX_DEPARTMENT);
        if d.is_empty() {
            "Operations".to_string()
        } else {
            d
        }
    };
    let clamped_break = break_minutes.clamp(0, 180);
    let outcome = validate_shift_report_input(
        &clean_title,
        &clean_dept,
        date,
        actual_start_time,
        actual_end_time,
        clamped_break,
    );
    if !outcome.valid {
        return Err(outcome
            .error_message
            .unwrap_or_else(|| "Invalid shift report fields.".to_string()));
    }

    let worked_hours = compute_net_worked_hours(actual_start_time, actual_end_time, clamped_break);

    let mut fields = Map::new();
    fields.insert("id".to_string(), Value::String(report_id.to_string()));
    fields.insert("shiftId".to_string(), Value::String(shift_id.to_string()));
    fields.insert("shiftTitle".to_string(), Value::String(clean_title));
    fields.insert("staffUid".to_string(), Value::String(staff_uid.to_string()));
    fields.insert(
        "staffName".to_string(),
        Value::String(clamp_str(staff_name, MAX_DISPLAY_NAME)),
    );
    fields.insert("department".to_string(), Value::String(clean_dept));
    fields.insert("date".to_string(), Value::String(date.to_string()));
    fields.insert(
        "actualStartTime".to_string(),
        Value::String(actual_start_time.to_string()),
    );
    fields.insert(
        "actualEndTime".to_string(),
        Value::String(actual_end_time.to_string()),
    );
    fields.insert("breakMinutes".to_string(), serde_json::json!(clamped_break));
    fields.insert("workedHours".to_string(), serde_json::json!(worked_hours));
    fields.insert(
        "handoffNotes".to_string(),
        Value::String(clamp_str(handoff_notes, MAX_HANDOFF_NOTES)),
    );
    fields.insert(
        "status".to_string(),
        Value::String(enum_to_string(&ShiftReportStatus::Submitted)),
    );
    fields.insert("verifiedByUid".to_string(), Value::String(String::new()));

    Ok(vec![FirestoreWriteOp::Set {
        collection: "shiftReports".to_string(),
        doc_id: report_id.to_string(),
        fields,
        server_timestamp_fields: vec!["createdAt".to_string(), "updatedAt".to_string()],
        require_not_exists: false,
    }])
}

pub fn writes_for_report_review(
    report: &ShiftReport,
    next_status: ShiftReportStatus,
    verifier_uid: &str,
    staff_entry: Option<&StaffDirectoryEntry>,
    linked_shift: Option<&Shift>,
) -> Vec<FirestoreWriteOp> {
    let plan = plan_report_review(report, next_status, verifier_uid, staff_entry, linked_shift);

    let mut rep_fields = Map::new();
    rep_fields.insert(
        "status".to_string(),
        Value::String(enum_to_string(&plan.next_status)),
    );
    rep_fields.insert(
        "verifiedByUid".to_string(),
        Value::String(plan.verified_by_uid.clone()),
    );

    let mut writes = vec![FirestoreWriteOp::UpdateMask {
        collection: "shiftReports".to_string(),
        doc_id: plan.report_id.clone(),
        fields: rep_fields,
        mask_paths: vec!["status".to_string(), "verifiedByUid".to_string()],
        server_timestamp_fields: vec!["updatedAt".to_string()],
        require_exists: true,
    }];

    if plan.hours_delta.abs() > 0.001 && staff_entry.is_some() {
        let mut staff_upd = Map::new();
        staff_upd.insert(
            "totalHoursWorked".to_string(),
            serde_json::json!(plan.updated_staff_total_hours.clamp(0.0, 10000.0)),
        );
        writes.push(FirestoreWriteOp::UpdateMask {
            collection: "staffDirectory".to_string(),
            doc_id: plan.staff_uid.clone(),
            fields: staff_upd,
            mask_paths: vec!["totalHoursWorked".to_string()],
            server_timestamp_fields: vec!["updatedAt".to_string()],
            require_exists: true,
        });
    }

    if plan.mark_linked_shift_completed {
        if let Some(shift_id) = plan.linked_shift_id {
            let mut shift_upd = Map::new();
            shift_upd.insert(
                "status".to_string(),
                Value::String(ShiftStatus::Completed.as_str().to_string()),
            );
            writes.push(FirestoreWriteOp::UpdateMask {
                collection: "shifts".to_string(),
                doc_id: shift_id,
                fields: shift_upd,
                mask_paths: vec!["status".to_string()],
                server_timestamp_fields: vec!["updatedAt".to_string()],
                require_exists: true,
            });
        }
    }

    if let (Some(title), Some(message), Some(category)) = (
        plan.notification_title,
        plan.notification_message,
        plan.notification_category,
    ) {
        let notif_id = generate_firestore_id("ntf");
        writes.push(notification_set_op(
            &notif_id,
            &report.staff_uid,
            &title,
            &message,
            &category,
            &report.shift_id,
            verifier_uid,
        ));
    }

    writes
}

pub fn writes_for_fairness_plan(
    plan: &[FairnessArrangementItem],
    actor_uid: &str,
) -> Vec<FirestoreWriteOp> {
    let now_iso = Utc::now().to_rfc3339();
    let mut writes = Vec::new();
    let mut touched_staff = HashSet::new();

    for item in plan {
        let mut shift_fields = Map::new();
        shift_fields.insert(
            "assignedUid".to_string(),
            Value::String(item.chosen_uid.clone()),
        );
        shift_fields.insert(
            "assignedName".to_string(),
            Value::String(clamp_str(&item.chosen_name, MAX_DISPLAY_NAME)),
        );
        shift_fields.insert(
            "status".to_string(),
            Value::String(ShiftStatus::Scheduled.as_str().to_string()),
        );
        shift_fields.insert(
            "fairnessNote".to_string(),
            Value::String(clamp_str(&item.reason, MAX_FAIRNESS_NOTE)),
        );
        writes.push(FirestoreWriteOp::UpdateMask {
            collection: "shifts".to_string(),
            doc_id: item.shift.id.clone(),
            fields: shift_fields,
            mask_paths: vec![
                "assignedUid".to_string(),
                "assignedName".to_string(),
                "status".to_string(),
                "fairnessNote".to_string(),
            ],
            server_timestamp_fields: vec!["updatedAt".to_string()],
            require_exists: true,
        });

        touched_staff.insert(item.chosen_uid.clone());

        let notif_id = generate_firestore_id("ntf");
        writes.push(notification_set_op(
            &notif_id,
            &item.chosen_uid,
            "Overlap Resolved by Fairness",
            &format!(
                "{} ({} {}-{}) assigned to you. {}",
                item.shift.title,
                item.shift.date,
                item.shift.start_time,
                item.shift.end_time,
                item.reason
            ),
            &NotificationCategory::FairnessRebalanced,
            &item.shift.id,
            actor_uid,
        ));
    }

    for uid in touched_staff {
        let mut staff_upd = Map::new();
        staff_upd.insert("lastAssignedAt".to_string(), Value::String(now_iso.clone()));
        writes.push(FirestoreWriteOp::UpdateMask {
            collection: "staffDirectory".to_string(),
            doc_id: uid,
            fields: staff_upd,
            mask_paths: vec!["lastAssignedAt".to_string()],
            server_timestamp_fields: vec!["updatedAt".to_string()],
            require_exists: true,
        });
    }

    writes
}

pub fn writes_for_open_shift_plan(
    plan: &[OpenShiftAssignmentItem],
    actor_uid: &str,
) -> Vec<FirestoreWriteOp> {
    let now_iso = Utc::now().to_rfc3339();
    let mut writes = Vec::new();
    let mut touched_staff = HashSet::new();

    for item in plan {
        let mut shift_fields = Map::new();
        shift_fields.insert(
            "assignedUid".to_string(),
            Value::String(item.chosen_uid.clone()),
        );
        shift_fields.insert(
            "assignedName".to_string(),
            Value::String(clamp_str(&item.chosen_name, MAX_DISPLAY_NAME)),
        );
        shift_fields.insert(
            "status".to_string(),
            Value::String(ShiftStatus::Scheduled.as_str().to_string()),
        );
        shift_fields.insert(
            "fairnessNote".to_string(),
            Value::String(clamp_str(&item.reason, MAX_FAIRNESS_NOTE)),
        );
        writes.push(FirestoreWriteOp::UpdateMask {
            collection: "shifts".to_string(),
            doc_id: item.shift.id.clone(),
            fields: shift_fields,
            mask_paths: vec![
                "assignedUid".to_string(),
                "assignedName".to_string(),
                "status".to_string(),
                "fairnessNote".to_string(),
            ],
            server_timestamp_fields: vec!["updatedAt".to_string()],
            require_exists: true,
        });

        touched_staff.insert(item.chosen_uid.clone());

        let notif_id = generate_firestore_id("ntf");
        writes.push(notification_set_op(
            &notif_id,
            &item.chosen_uid,
            "Open Shift Assigned",
            &format!(
                "{} on {} ({}-{}) assigned to you.",
                item.shift.title, item.shift.date, item.shift.start_time, item.shift.end_time
            ),
            &NotificationCategory::ShiftAssigned,
            &item.shift.id,
            actor_uid,
        ));
    }

    for uid in touched_staff {
        let mut staff_upd = Map::new();
        staff_upd.insert("lastAssignedAt".to_string(), Value::String(now_iso.clone()));
        writes.push(FirestoreWriteOp::UpdateMask {
            collection: "staffDirectory".to_string(),
            doc_id: uid,
            fields: staff_upd,
            mask_paths: vec!["lastAssignedAt".to_string()],
            server_timestamp_fields: vec!["updatedAt".to_string()],
            require_exists: true,
        });
    }

    writes
}

pub fn writes_for_weekly_schedule(
    planned: &[GeneratedShiftSpec],
    actor_uid: &str,
) -> (WeeklyScheduleCommitResult, Vec<FirestoreWriteOp>) {
    let now_iso = Utc::now().to_rfc3339();
    let mut writes = Vec::new();
    let mut assigned = 0usize;
    let mut open = 0usize;
    let mut touched_staff = HashSet::new();

    for spec in planned {
        let shift_id = generate_firestore_id("shift");
        let has_assignee =
            spec.status != ShiftStatus::Open && !spec.assigned_uid.trim().is_empty();
        if has_assignee {
            assigned += 1;
        } else {
            open += 1;
        }

        let candidates: Vec<Value> = spec
            .candidate_uids
            .iter()
            .filter(|id| is_valid_id(id))
            .take(20)
            .map(|id| Value::String(id.clone()))
            .collect();

        let mut fields = Map::new();
        fields.insert("id".to_string(), Value::String(shift_id.clone()));
        fields.insert(
            "title".to_string(),
            Value::String(clamp_str(&spec.title, MAX_TITLE)),
        );
        fields.insert(
            "department".to_string(),
            Value::String(clamp_str(&spec.department, MAX_DEPARTMENT)),
        );
        fields.insert("date".to_string(), Value::String(spec.date.clone()));
        fields.insert(
            "startTime".to_string(),
            Value::String(spec.start_time.clone()),
        );
        fields.insert("endTime".to_string(), Value::String(spec.end_time.clone()));
        fields.insert(
            "durationHours".to_string(),
            serde_json::json!(spec.duration_hours),
        );
        fields.insert(
            "assignedUid".to_string(),
            Value::String(if has_assignee {
                spec.assigned_uid.clone()
            } else {
                String::new()
            }),
        );
        fields.insert(
            "assignedName".to_string(),
            Value::String(if has_assignee {
                clamp_str(&spec.assigned_name, MAX_DISPLAY_NAME)
            } else {
                String::new()
            }),
        );
        fields.insert("candidateUids".to_string(), Value::Array(candidates));
        fields.insert(
            "status".to_string(),
            Value::String(spec.status.as_str().to_string()),
        );
        fields.insert("visibility".to_string(), Value::String("team".to_string()));
        fields.insert(
            "fairnessNote".to_string(),
            Value::String(clamp_str(&spec.fairness_note, MAX_FAIRNESS_NOTE)),
        );
        fields.insert("createdBy".to_string(), Value::String(actor_uid.to_string()));

        writes.push(FirestoreWriteOp::Set {
            collection: "shifts".to_string(),
            doc_id: shift_id.clone(),
            fields,
            server_timestamp_fields: vec!["createdAt".to_string(), "updatedAt".to_string()],
            require_not_exists: false,
        });

        if has_assignee {
            touched_staff.insert(spec.assigned_uid.clone());
            let notif_id = generate_firestore_id("ntf");
            writes.push(notification_set_op(
                &notif_id,
                &spec.assigned_uid,
                "Weekly Schedule Published",
                &format!(
                    "You were scheduled for {} on {} ({}-{}).",
                    spec.title, spec.date, spec.start_time, spec.end_time
                ),
                &NotificationCategory::ShiftAssigned,
                &shift_id,
                actor_uid,
            ));
        }
    }

    for uid in touched_staff {
        let mut staff_upd = Map::new();
        staff_upd.insert("lastAssignedAt".to_string(), Value::String(now_iso.clone()));
        writes.push(FirestoreWriteOp::UpdateMask {
            collection: "staffDirectory".to_string(),
            doc_id: uid,
            fields: staff_upd,
            mask_paths: vec!["lastAssignedAt".to_string()],
            server_timestamp_fields: vec!["updatedAt".to_string()],
            require_exists: true,
        });
    }

    (WeeklyScheduleCommitResult { assigned, open }, writes)
}

pub fn writes_for_toggle_manager_role(
    member: &StaffDirectoryEntry,
    grant_manager: bool,
    actor_uid: &str,
    user_doc_exists: bool,
) -> Result<Vec<FirestoreWriteOp>, String> {
    if !can_toggle_manager_role(actor_uid, member) {
        return Err("Cannot change role for sample roster entries or your own account.".to_string());
    }
    let next_role = if grant_manager {
        UserRole::Manager
    } else {
        UserRole::Staff
    };
    let next_role_str = enum_to_string(&next_role);

    let mut writes = Vec::new();
    if grant_manager {
        let mut mgr_fields = Map::new();
        mgr_fields.insert("uid".to_string(), Value::String(member.uid.clone()));
        mgr_fields.insert("grantedBy".to_string(), Value::String(actor_uid.to_string()));
        writes.push(FirestoreWriteOp::Set {
            collection: "managers".to_string(),
            doc_id: member.uid.clone(),
            fields: mgr_fields,
            server_timestamp_fields: vec!["createdAt".to_string()],
            require_not_exists: false,
        });
    } else {
        writes.push(FirestoreWriteOp::Delete {
            collection: "managers".to_string(),
            doc_id: member.uid.clone(),
        });
    }

    let mut staff_upd = Map::new();
    staff_upd.insert("role".to_string(), Value::String(next_role_str.clone()));
    writes.push(FirestoreWriteOp::UpdateMask {
        collection: "staffDirectory".to_string(),
        doc_id: member.uid.clone(),
        fields: staff_upd,
        mask_paths: vec!["role".to_string()],
        server_timestamp_fields: vec!["updatedAt".to_string()],
        require_exists: true,
    });

    if user_doc_exists {
        let mut user_upd = Map::new();
        user_upd.insert("role".to_string(), Value::String(next_role_str));
        writes.push(FirestoreWriteOp::UpdateMask {
            collection: "users".to_string(),
            doc_id: member.uid.clone(),
            fields: user_upd,
            mask_paths: vec!["role".to_string()],
            server_timestamp_fields: vec!["updatedAt".to_string()],
            require_exists: true,
        });
    }

    Ok(writes)
}

pub fn writes_for_sample_workspace(actor_uid: &str, actor_name: &str) -> Vec<FirestoreWriteOp> {
    let bundle = build_default_sample_bundle_today(actor_uid, actor_name);
    let mut writes = Vec::new();

    for member in bundle.roster {
        let mut fields = Map::new();
        fields.insert("uid".to_string(), Value::String(member.uid.clone()));
        fields.insert("displayName".to_string(), Value::String(member.display_name));
        fields.insert("role".to_string(), Value::String(enum_to_string(&member.role)));
        fields.insert("department".to_string(), Value::String(member.department));
        fields.insert(
            "totalHoursWorked".to_string(),
            serde_json::json!(member.total_hours_worked),
        );
        fields.insert(
            "scheduledHoursThisWeek".to_string(),
            serde_json::json!(member.scheduled_hours_this_week),
        );
        fields.insert(
            "weeklyHoursTarget".to_string(),
            serde_json::json!(member.weekly_hours_target),
        );
        fields.insert(
            "lastAssignedAt".to_string(),
            Value::String(member.last_assigned_at),
        );
        fields.insert("isSampleRoster".to_string(), Value::Bool(member.is_sample_roster));

        writes.push(FirestoreWriteOp::Set {
            collection: "staffDirectory".to_string(),
            doc_id: member.uid,
            fields,
            server_timestamp_fields: vec!["updatedAt".to_string()],
            require_not_exists: false,
        });
    }

    for shift in bundle.shifts {
        let mut fields = Map::new();
        fields.insert("id".to_string(), Value::String(shift.id.clone()));
        fields.insert("title".to_string(), Value::String(shift.title));
        fields.insert("department".to_string(), Value::String(shift.department));
        fields.insert("date".to_string(), Value::String(shift.date));
        fields.insert("startTime".to_string(), Value::String(shift.start_time));
        fields.insert("endTime".to_string(), Value::String(shift.end_time));
        fields.insert(
            "durationHours".to_string(),
            serde_json::json!(shift.duration_hours),
        );
        fields.insert("assignedUid".to_string(), Value::String(shift.assigned_uid));
        fields.insert(
            "assignedName".to_string(),
            Value::String(shift.assigned_name),
        );
        fields.insert(
            "candidateUids".to_string(),
            Value::Array(shift.candidate_uids.into_iter().map(Value::String).collect()),
        );
        fields.insert(
            "status".to_string(),
            Value::String(shift.status.as_str().to_string()),
        );
        fields.insert("visibility".to_string(), Value::String(shift.visibility));
        fields.insert(
            "fairnessNote".to_string(),
            Value::String(shift.fairness_note),
        );
        fields.insert("createdBy".to_string(), Value::String(shift.created_by));

        writes.push(FirestoreWriteOp::Set {
            collection: "shifts".to_string(),
            doc_id: shift.id,
            fields,
            server_timestamp_fields: vec!["createdAt".to_string(), "updatedAt".to_string()],
            require_not_exists: false,
        });
    }

    for req in bundle.schedule_changes {
        let mut fields = Map::new();
        fields.insert("id".to_string(), Value::String(req.id.clone()));
        fields.insert("shiftId".to_string(), Value::String(req.shift_id));
        fields.insert("shiftTitle".to_string(), Value::String(req.shift_title));
        fields.insert("requesterUid".to_string(), Value::String(req.requester_uid));
        fields.insert(
            "requesterName".to_string(),
            Value::String(req.requester_name),
        );
        fields.insert(
            "type".to_string(),
            Value::String(enum_to_string(&req.request_type)),
        );
        fields.insert("currentDate".to_string(), Value::String(req.current_date));
        fields.insert(
            "currentStartTime".to_string(),
            Value::String(req.current_start_time),
        );
        fields.insert(
            "currentEndTime".to_string(),
            Value::String(req.current_end_time),
        );
        fields.insert("proposedDate".to_string(), Value::String(req.proposed_date));
        fields.insert(
            "proposedStartTime".to_string(),
            Value::String(req.proposed_start_time),
        );
        fields.insert(
            "proposedEndTime".to_string(),
            Value::String(req.proposed_end_time),
        );
        fields.insert(
            "proposedAssigneeUid".to_string(),
            Value::String(req.proposed_assignee_uid),
        );
        fields.insert(
            "proposedAssigneeName".to_string(),
            Value::String(req.proposed_assignee_name),
        );
        fields.insert("reason".to_string(), Value::String(req.reason));
        fields.insert("status".to_string(), Value::String(enum_to_string(&req.status)));
        fields.insert(
            "reviewedByUid".to_string(),
            Value::String(req.reviewed_by_uid),
        );
        fields.insert(
            "reviewedByName".to_string(),
            Value::String(req.reviewed_by_name),
        );
        fields.insert("reviewNote".to_string(), Value::String(req.review_note));

        writes.push(FirestoreWriteOp::Set {
            collection: "scheduleChanges".to_string(),
            doc_id: req.id,
            fields,
            server_timestamp_fields: vec!["createdAt".to_string(), "updatedAt".to_string()],
            require_not_exists: false,
        });
    }

    for rep in bundle.shift_reports {
        let mut fields = Map::new();
        fields.insert("id".to_string(), Value::String(rep.id.clone()));
        fields.insert("shiftId".to_string(), Value::String(rep.shift_id));
        fields.insert("shiftTitle".to_string(), Value::String(rep.shift_title));
        fields.insert("staffUid".to_string(), Value::String(rep.staff_uid));
        fields.insert("staffName".to_string(), Value::String(rep.staff_name));
        fields.insert("department".to_string(), Value::String(rep.department));
        fields.insert("date".to_string(), Value::String(rep.date));
        fields.insert(
            "actualStartTime".to_string(),
            Value::String(rep.actual_start_time),
        );
        fields.insert(
            "actualEndTime".to_string(),
            Value::String(rep.actual_end_time),
        );
        fields.insert("breakMinutes".to_string(), serde_json::json!(rep.break_minutes));
        fields.insert("workedHours".to_string(), serde_json::json!(rep.worked_hours));
        fields.insert("handoffNotes".to_string(), Value::String(rep.handoff_notes));
        fields.insert("status".to_string(), Value::String(enum_to_string(&rep.status)));
        fields.insert(
            "verifiedByUid".to_string(),
            Value::String(rep.verified_by_uid),
        );

        writes.push(FirestoreWriteOp::Set {
            collection: "shiftReports".to_string(),
            doc_id: rep.id,
            fields,
            server_timestamp_fields: vec!["createdAt".to_string(), "updatedAt".to_string()],
            require_not_exists: false,
        });
    }

    for sub in bundle.shift_submissions {
        let mut fields = Map::new();
        fields.insert("id".to_string(), Value::String(sub.id.clone()));
        fields.insert("staffUid".to_string(), Value::String(sub.staff_uid));
        fields.insert("staffName".to_string(), Value::String(sub.staff_name));
        fields.insert("department".to_string(), Value::String(sub.department));
        fields.insert("date".to_string(), Value::String(sub.date));
        fields.insert("startTime".to_string(), Value::String(sub.start_time));
        fields.insert("endTime".to_string(), Value::String(sub.end_time));
        fields.insert("shiftTitle".to_string(), Value::String(sub.shift_title));
        fields.insert("notes".to_string(), Value::String(sub.notes));
        fields.insert("status".to_string(), Value::String(enum_to_string(&sub.status)));

        writes.push(FirestoreWriteOp::Set {
            collection: "shiftSubmissions".to_string(),
            doc_id: sub.id,
            fields,
            server_timestamp_fields: vec!["createdAt".to_string(), "updatedAt".to_string()],
            require_not_exists: false,
        });
    }

    for to in bundle.time_off_requests {
        let mut fields = Map::new();
        fields.insert("id".to_string(), Value::String(to.id.clone()));
        fields.insert("staffUid".to_string(), Value::String(to.staff_uid));
        fields.insert("staffName".to_string(), Value::String(to.staff_name));
        fields.insert("department".to_string(), Value::String(to.department));
        fields.insert("startDate".to_string(), Value::String(to.start_date));
        fields.insert("endDate".to_string(), Value::String(to.end_date));
        fields.insert("reason".to_string(), Value::String(to.reason));
        fields.insert("status".to_string(), Value::String(enum_to_string(&to.status)));
        fields.insert(
            "reviewedByUid".to_string(),
            Value::String(to.reviewed_by_uid),
        );
        fields.insert(
            "reviewedByName".to_string(),
            Value::String(to.reviewed_by_name),
        );
        fields.insert("reviewNote".to_string(), Value::String(to.review_note));

        writes.push(FirestoreWriteOp::Set {
            collection: "timeOffRequests".to_string(),
            doc_id: to.id,
            fields,
            server_timestamp_fields: vec!["createdAt".to_string(), "updatedAt".to_string()],
            require_not_exists: false,
        });
    }

    for notif in bundle.notifications {
        writes.push(notification_set_op(
            &notif.id,
            &notif.recipient_uid,
            &notif.title,
            &notif.message,
            &notif.category,
            &notif.related_shift_id,
            &notif.actor_uid,
        ));
    }

    writes
}

// --- Tauri Async Repository Commands (Firestore REST Commit + Shared Live DB) ---

#[tauri::command]
pub async fn repo_ensure_verified_user_provisioned_cmd(
    id_token: String,
    uid: String,
    email: String,
    display_name: String,
) -> Result<UserProfile, String> {
    if !is_valid_id(&uid) {
        return Err("Invalid user ID.".to_string());
    }
    let client = FirebaseRestClient::from_embedded_config()?;
    let existing_user = client
        .get_document(&id_token, "users", &uid)
        .await?;
    let manager_exists = client
        .get_document(&id_token, "managers", &uid)
        .await
        .ok()
        .flatten()
        .is_some();
    let existing_staff = client
        .get_document(&id_token, "staffDirectory", &uid)
        .await?;

    let (profile, writes, optional_staff_sync) = build_provision_plan(
        &uid,
        &email,
        &display_name,
        existing_user.as_ref(),
        manager_exists,
        existing_staff.as_ref(),
    );

    client
        .commit_writes(&id_token, &writes, &format!("users/{uid}"))
        .await?;

    if let Some(staff_sync_op) = optional_staff_sync {
        let _ = client
            .commit_writes(&id_token, &[staff_sync_op], &format!("staffDirectory/{uid}"))
            .await;
    }

    Ok(profile)
}

#[tauri::command]
pub async fn repo_update_user_preferences_cmd(
    id_token: String,
    actor_uid: String,
    uid: String,
    display_name: String,
    department: String,
    weekly_hours_target: f64,
    push_notifications_enabled: bool,
) -> Result<(), String> {
    let writes = writes_for_user_preferences(
        &actor_uid,
        &uid,
        &display_name,
        &department,
        weekly_hours_target,
        push_notifications_enabled,
    )?;
    let client = FirebaseRestClient::from_embedded_config()?;
    client
        .commit_writes(&id_token, &writes, &format!("users/{uid}"))
        .await?;
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn repo_create_shift_cmd(
    id_token: String,
    actor_uid: String,
    title: String,
    department: String,
    date: String,
    start_time: String,
    end_time: String,
    assigned_uid: String,
    assigned_name: String,
    candidate_uids: Vec<String>,
    status: ShiftStatus,
    fairness_note: String,
    created_by: String,
) -> Result<String, String> {
    let id = generate_firestore_id("shift");
    let writes = writes_for_create_shift(
        &actor_uid,
        &id,
        &title,
        &department,
        &date,
        &start_time,
        &end_time,
        &assigned_uid,
        &assigned_name,
        &candidate_uids,
        &status,
        &fairness_note,
        &created_by,
    )?;
    let client = FirebaseRestClient::from_embedded_config()?;
    client
        .commit_writes(&id_token, &writes, &format!("shifts/{id}"))
        .await?;
    Ok(id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn repo_update_shift_cmd(
    id_token: String,
    actor_uid: String,
    shift_id: String,
    title: String,
    department: String,
    date: String,
    start_time: String,
    end_time: String,
    assigned_uid: String,
    assigned_name: String,
    status: ShiftStatus,
    fairness_note: String,
) -> Result<(), String> {
    let client = FirebaseRestClient::from_embedded_config()?;
    let prev = client
        .get_document(&id_token, "shifts", &shift_id)
        .await
        .ok()
        .flatten();
    let writes = writes_for_update_shift(
        &actor_uid,
        &shift_id,
        &title,
        &department,
        &date,
        &start_time,
        &end_time,
        &assigned_uid,
        &assigned_name,
        &status,
        &fairness_note,
        prev.as_ref(),
    )?;
    client
        .commit_writes(&id_token, &writes, &format!("shifts/{shift_id}"))
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn repo_delete_shift_cmd(id_token: String, shift_id: String) -> Result<(), String> {
    if !is_valid_id(&shift_id) {
        return Err("Invalid shift ID.".to_string());
    }
    let client = FirebaseRestClient::from_embedded_config()?;
    client
        .commit_writes(
            &id_token,
            &[FirestoreWriteOp::Delete {
                collection: "shifts".to_string(),
                doc_id: shift_id.clone(),
            }],
            &format!("shifts/{shift_id}"),
        )
        .await?;
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn repo_submit_schedule_change_cmd(
    id_token: String,
    shift: Shift,
    requester_uid: String,
    requester_name: String,
    is_manager: bool,
    request_type: ScheduleChangeType,
    proposed_date: String,
    proposed_start_time: String,
    proposed_end_time: String,
    proposed_assignee_uid: String,
    proposed_assignee_name: String,
    reason: String,
) -> Result<String, String> {
    let id = generate_firestore_id("chg");
    let writes = writes_for_submit_schedule_change(
        &id,
        &shift,
        &requester_uid,
        &requester_name,
        is_manager,
        &request_type,
        &proposed_date,
        &proposed_start_time,
        &proposed_end_time,
        &proposed_assignee_uid,
        &proposed_assignee_name,
        &reason,
    )?;
    let client = FirebaseRestClient::from_embedded_config()?;
    client
        .commit_writes(&id_token, &writes, &format!("scheduleChanges/{id}"))
        .await?;
    Ok(id)
}

#[tauri::command]
pub async fn repo_decide_schedule_change_cmd(
    id_token: String,
    req: ScheduleChangeRequest,
    linked_shift: Option<Shift>,
    decision: ApprovalStatus,
    reviewer_uid: String,
    reviewer_name: String,
    review_note: String,
) -> Result<(), String> {
    let writes = writes_for_schedule_change_decision(
        &req,
        linked_shift.as_ref(),
        decision,
        &reviewer_uid,
        &reviewer_name,
        &review_note,
    );
    let client = FirebaseRestClient::from_embedded_config()?;
    client
        .commit_writes(&id_token, &writes, &format!("scheduleChanges/{}", req.id))
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn repo_accept_all_pending_cmd(
    id_token: String,
    pending_requests: Vec<ScheduleChangeRequest>,
    shifts: Vec<Shift>,
    reviewer_uid: String,
    reviewer_name: String,
) -> Result<usize, String> {
    let (count, writes) =
        writes_for_accept_all(&pending_requests, &shifts, &reviewer_uid, &reviewer_name);
    if writes.is_empty() {
        return Ok(0);
    }
    let client = FirebaseRestClient::from_embedded_config()?;
    client
        .commit_writes(&id_token, &writes, "scheduleChanges")
        .await?;
    Ok(count)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn repo_submit_shift_report_cmd(
    id_token: String,
    shift_id: String,
    shift_title: String,
    staff_uid: String,
    staff_name: String,
    department: String,
    date: String,
    actual_start_time: String,
    actual_end_time: String,
    break_minutes: i32,
    handoff_notes: String,
) -> Result<String, String> {
    let id = generate_firestore_id("rep");
    let writes = writes_for_submit_shift_report(
        &id,
        &shift_id,
        &shift_title,
        &staff_uid,
        &staff_name,
        &department,
        &date,
        &actual_start_time,
        &actual_end_time,
        break_minutes,
        &handoff_notes,
    )?;
    let client = FirebaseRestClient::from_embedded_config()?;
    client
        .commit_writes(&id_token, &writes, &format!("shiftReports/{id}"))
        .await?;
    Ok(id)
}

#[tauri::command]
pub async fn repo_verify_or_flag_report_cmd(
    id_token: String,
    report: ShiftReport,
    status: ShiftReportStatus,
    verifier_uid: String,
    staff_entry: Option<StaffDirectoryEntry>,
    linked_shift: Option<Shift>,
) -> Result<(), String> {
    let writes = writes_for_report_review(
        &report,
        status,
        &verifier_uid,
        staff_entry.as_ref(),
        linked_shift.as_ref(),
    );
    let client = FirebaseRestClient::from_embedded_config()?;
    client
        .commit_writes(&id_token, &writes, &format!("shiftReports/{}", report.id))
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn repo_mark_notification_read_cmd(
    id_token: String,
    notification_id: String,
    is_read: bool,
) -> Result<(), String> {
    if !is_valid_id(&notification_id) {
        return Err("Invalid notification ID.".to_string());
    }
    let mut fields = Map::new();
    fields.insert("isRead".to_string(), Value::Bool(is_read));
    let client = FirebaseRestClient::from_embedded_config()?;
    client
        .commit_writes(
            &id_token,
            &[FirestoreWriteOp::UpdateMask {
                collection: "notifications".to_string(),
                doc_id: notification_id.clone(),
                fields,
                mask_paths: vec!["isRead".to_string()],
                server_timestamp_fields: vec!["updatedAt".to_string()],
                require_exists: true,
            }],
            &format!("notifications/{notification_id}"),
        )
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn repo_mark_all_notifications_read_cmd(
    id_token: String,
    notifications: Vec<PushNotificationRecord>,
) -> Result<(), String> {
    let writes: Vec<FirestoreWriteOp> = notifications
        .into_iter()
        .filter(|n| !n.is_read && is_valid_id(&n.id))
        .map(|n| {
            let mut fields = Map::new();
            fields.insert("isRead".to_string(), Value::Bool(true));
            FirestoreWriteOp::UpdateMask {
                collection: "notifications".to_string(),
                doc_id: n.id,
                fields,
                mask_paths: vec!["isRead".to_string()],
                server_timestamp_fields: vec!["updatedAt".to_string()],
                require_exists: true,
            }
        })
        .collect();
    if writes.is_empty() {
        return Ok(());
    }
    let client = FirebaseRestClient::from_embedded_config()?;
    client
        .commit_writes(&id_token, &writes, "notifications")
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn repo_send_test_notification_cmd(
    id_token: String,
    actor_uid: String,
    recipient_uid: String,
    display_name: String,
) -> Result<(), String> {
    let id = generate_firestore_id("ntf");
    let op = notification_set_op(
        &id,
        &recipient_uid,
        "Cadence Alert Test",
        &format!("Real-time notification channel active for {display_name}."),
        &NotificationCategory::ShiftAssigned,
        "",
        &actor_uid,
    );
    let client = FirebaseRestClient::from_embedded_config()?;
    client
        .commit_writes(&id_token, &[op], &format!("notifications/{id}"))
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn repo_commit_fairness_plan_cmd(
    id_token: String,
    actor_uid: String,
    shifts: Vec<Shift>,
    staff_directory: Vec<StaffDirectoryEntry>,
    time_off_requests: Vec<TimeOffRequest>,
) -> Result<usize, String> {
    let plan = build_fairness_arrangement_plan(&shifts, &staff_directory, &time_off_requests);
    let count = plan.len();
    if count == 0 {
        return Ok(0);
    }
    let writes = writes_for_fairness_plan(&plan, &actor_uid);
    let client = FirebaseRestClient::from_embedded_config()?;
    client
        .commit_writes(&id_token, &writes, "shifts")
        .await?;
    Ok(count)
}

#[tauri::command]
pub async fn repo_commit_open_shift_plan_cmd(
    id_token: String,
    actor_uid: String,
    shifts: Vec<Shift>,
    staff_directory: Vec<StaffDirectoryEntry>,
    submissions: Vec<ShiftSubmission>,
    time_off_requests: Vec<TimeOffRequest>,
    require_explicit_submission: bool,
) -> Result<usize, String> {
    let plan = build_open_shift_assignment_plan(
        &shifts,
        &staff_directory,
        &submissions,
        &time_off_requests,
        require_explicit_submission,
    );
    let count = plan.len();
    if count == 0 {
        return Ok(0);
    }
    let writes = writes_for_open_shift_plan(&plan, &actor_uid);
    let client = FirebaseRestClient::from_embedded_config()?;
    client
        .commit_writes(&id_token, &writes, "shifts")
        .await?;
    Ok(count)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn repo_generate_weekly_schedule_cmd(
    id_token: String,
    actor_uid: String,
    monday_iso: String,
    slots: Vec<WeekSlotConfig>,
    staff_directory: Vec<StaffDirectoryEntry>,
    existing_shifts: Vec<Shift>,
    submissions: Vec<ShiftSubmission>,
    time_off_requests: Vec<TimeOffRequest>,
) -> Result<WeeklyScheduleCommitResult, String> {
    let effective_slots = if slots.is_empty() {
        default_week_slots()
    } else {
        slots
    };
    let planned = generate_weekly_fairness_schedule(
        &monday_iso,
        &effective_slots,
        &staff_directory,
        &existing_shifts,
        &submissions,
        &time_off_requests,
    );
    if planned.is_empty() {
        return Ok(WeeklyScheduleCommitResult {
            assigned: 0,
            open: 0,
        });
    }
    let (summary, writes) = writes_for_weekly_schedule(&planned, &actor_uid);
    let client = FirebaseRestClient::from_embedded_config()?;
    client
        .commit_writes(&id_token, &writes, "shifts")
        .await?;
    Ok(summary)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn repo_submit_availability_batch_cmd(
    id_token: String,
    staff_uid: String,
    staff_name: String,
    department: String,
    dates: Vec<String>,
    start_time: String,
    end_time: String,
    shift_title: String,
    notes: String,
) -> Result<usize, String> {
    let mut seen = HashSet::new();
    let unique_dates: Vec<String> = dates
        .into_iter()
        .filter(|d| seen.insert(d.clone()))
        .collect();
    if unique_dates.is_empty() {
        return Ok(0);
    }
    let clean_dept = {
        let d = clamp_str(&department, MAX_DEPARTMENT);
        if d.is_empty() {
            "Operations".to_string()
        } else {
            d
        }
    };
    let clean_title = clamp_str(&shift_title, MAX_TITLE);
    let clean_notes = clamp_str(&notes, MAX_NOTES);
    let clean_name = clamp_str(&staff_name, MAX_DISPLAY_NAME);

    let mut writes = Vec::with_capacity(unique_dates.len());
    for d in &unique_dates {
        let id = generate_firestore_id("sub");
        let mut fields = Map::new();
        fields.insert("id".to_string(), Value::String(id.clone()));
        fields.insert("staffUid".to_string(), Value::String(staff_uid.clone()));
        fields.insert("staffName".to_string(), Value::String(clean_name.clone()));
        fields.insert("department".to_string(), Value::String(clean_dept.clone()));
        fields.insert("date".to_string(), Value::String(d.clone()));
        fields.insert("startTime".to_string(), Value::String(start_time.clone()));
        fields.insert("endTime".to_string(), Value::String(end_time.clone()));
        fields.insert("shiftTitle".to_string(), Value::String(clean_title.clone()));
        fields.insert("notes".to_string(), Value::String(clean_notes.clone()));
        fields.insert(
            "status".to_string(),
            Value::String(enum_to_string(&SubmissionStatus::Submitted)),
        );

        writes.push(FirestoreWriteOp::Set {
            collection: "shiftSubmissions".to_string(),
            doc_id: id,
            fields,
            server_timestamp_fields: vec!["createdAt".to_string(), "updatedAt".to_string()],
            require_not_exists: false,
        });
    }

    let client = FirebaseRestClient::from_embedded_config()?;
    client
        .commit_writes(&id_token, &writes, "shiftSubmissions")
        .await?;
    Ok(unique_dates.len())
}

#[tauri::command]
pub async fn repo_withdraw_submission_cmd(
    id_token: String,
    submission_id: String,
) -> Result<(), String> {
    if !is_valid_id(&submission_id) {
        return Err("Invalid submission ID.".to_string());
    }
    let mut fields = Map::new();
    fields.insert(
        "status".to_string(),
        Value::String(enum_to_string(&SubmissionStatus::Withdrawn)),
    );
    let client = FirebaseRestClient::from_embedded_config()?;
    client
        .commit_writes(
            &id_token,
            &[FirestoreWriteOp::UpdateMask {
                collection: "shiftSubmissions".to_string(),
                doc_id: submission_id.clone(),
                fields,
                mask_paths: vec!["status".to_string()],
                server_timestamp_fields: vec!["updatedAt".to_string()],
                require_exists: true,
            }],
            &format!("shiftSubmissions/{submission_id}"),
        )
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn repo_create_time_off_cmd(
    id_token: String,
    staff_uid: String,
    staff_name: String,
    department: String,
    start_date: String,
    end_date: String,
    reason: String,
) -> Result<String, String> {
    let outcome = validate_time_off_input(&start_date, &end_date, &reason);
    if !outcome.valid {
        return Err(outcome
            .error_message
            .unwrap_or_else(|| "Invalid time off request.".to_string()));
    }
    let id = generate_firestore_id("to");
    let clean_dept = {
        let d = clamp_str(&department, MAX_DEPARTMENT);
        if d.is_empty() {
            "Operations".to_string()
        } else {
            d
        }
    };
    let mut fields = Map::new();
    fields.insert("id".to_string(), Value::String(id.clone()));
    fields.insert("staffUid".to_string(), Value::String(staff_uid));
    fields.insert(
        "staffName".to_string(),
        Value::String(clamp_str(&staff_name, MAX_DISPLAY_NAME)),
    );
    fields.insert("department".to_string(), Value::String(clean_dept));
    fields.insert("startDate".to_string(), Value::String(start_date));
    fields.insert("endDate".to_string(), Value::String(end_date));
    fields.insert(
        "reason".to_string(),
        Value::String(clamp_str(&reason, MAX_REASON)),
    );
    fields.insert(
        "status".to_string(),
        Value::String(enum_to_string(&ApprovalStatus::Pending)),
    );
    fields.insert("reviewedByUid".to_string(), Value::String(String::new()));
    fields.insert("reviewedByName".to_string(), Value::String(String::new()));
    fields.insert("reviewNote".to_string(), Value::String(String::new()));

    let client = FirebaseRestClient::from_embedded_config()?;
    client
        .commit_writes(
            &id_token,
            &[FirestoreWriteOp::Set {
                collection: "timeOffRequests".to_string(),
                doc_id: id.clone(),
                fields,
                server_timestamp_fields: vec!["createdAt".to_string(), "updatedAt".to_string()],
                require_not_exists: false,
            }],
            &format!("timeOffRequests/{id}"),
        )
        .await?;
    Ok(id)
}

#[tauri::command]
pub async fn repo_withdraw_time_off_cmd(id_token: String, request_id: String) -> Result<(), String> {
    if !is_valid_id(&request_id) {
        return Err("Invalid time off request ID.".to_string());
    }
    let client = FirebaseRestClient::from_embedded_config()?;
    client
        .commit_writes(
            &id_token,
            &[FirestoreWriteOp::Delete {
                collection: "timeOffRequests".to_string(),
                doc_id: request_id.clone(),
            }],
            &format!("timeOffRequests/{request_id}"),
        )
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn repo_decide_time_off_cmd(
    id_token: String,
    req: TimeOffRequest,
    decision: ApprovalStatus,
    reviewer_uid: String,
    reviewer_name: String,
    review_note: String,
) -> Result<(), String> {
    let plan = plan_time_off_decision(&req, decision, &reviewer_uid, &reviewer_name, &review_note);
    let mut req_fields = Map::new();
    req_fields.insert(
        "status".to_string(),
        Value::String(enum_to_string(&plan.decision)),
    );
    req_fields.insert(
        "reviewedByUid".to_string(),
        Value::String(plan.reviewed_by_uid),
    );
    req_fields.insert(
        "reviewedByName".to_string(),
        Value::String(clamp_str(&plan.reviewed_by_name, MAX_DISPLAY_NAME)),
    );
    req_fields.insert(
        "reviewNote".to_string(),
        Value::String(clamp_str(&plan.review_note, MAX_REVIEW_NOTE)),
    );

    let notif_id = generate_firestore_id("ntf");
    let writes = vec![
        FirestoreWriteOp::UpdateMask {
            collection: "timeOffRequests".to_string(),
            doc_id: plan.request_id.clone(),
            fields: req_fields,
            mask_paths: vec![
                "status".to_string(),
                "reviewedByUid".to_string(),
                "reviewedByName".to_string(),
                "reviewNote".to_string(),
            ],
            server_timestamp_fields: vec!["updatedAt".to_string()],
            require_exists: true,
        },
        notification_set_op(
            &notif_id,
            &plan.notification.recipient_uid,
            &plan.notification.title,
            &plan.notification.message,
            &plan.notification.category,
            &plan.notification.related_shift_id,
            &reviewer_uid,
        ),
    ];

    let client = FirebaseRestClient::from_embedded_config()?;
    client
        .commit_writes(&id_token, &writes, &format!("timeOffRequests/{}", req.id))
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn repo_add_roster_staff_cmd(
    id_token: String,
    display_name: String,
    department: String,
    weekly_hours_target: f64,
    role: UserRole,
) -> Result<String, String> {
    let clean_name = clamp_str(&display_name, MAX_DISPLAY_NAME);
    if clean_name.is_empty() {
        return Err("Staff display name cannot be empty.".to_string());
    }
    let clean_dept = {
        let d = clamp_str(&department, MAX_DEPARTMENT);
        if d.is_empty() {
            "Operations".to_string()
        } else {
            d
        }
    };
    let uid = generate_firestore_id("roster");

    let mut fields = Map::new();
    fields.insert("uid".to_string(), Value::String(uid.clone()));
    fields.insert("displayName".to_string(), Value::String(clean_name));
    fields.insert("role".to_string(), Value::String(enum_to_string(&role)));
    fields.insert("department".to_string(), Value::String(clean_dept));
    fields.insert("totalHoursWorked".to_string(), serde_json::json!(0.0));
    fields.insert(
        "scheduledHoursThisWeek".to_string(),
        serde_json::json!(0.0),
    );
    fields.insert(
        "weeklyHoursTarget".to_string(),
        serde_json::json!(round2(weekly_hours_target.clamp(1.0, 80.0))),
    );
    fields.insert("lastAssignedAt".to_string(), Value::String(String::new()));
    fields.insert("isSampleRoster".to_string(), Value::Bool(false));

    let client = FirebaseRestClient::from_embedded_config()?;
    client
        .commit_writes(
            &id_token,
            &[FirestoreWriteOp::Set {
                collection: "staffDirectory".to_string(),
                doc_id: uid.clone(),
                fields,
                server_timestamp_fields: vec!["updatedAt".to_string()],
                require_not_exists: false,
            }],
            &format!("staffDirectory/{uid}"),
        )
        .await?;
    Ok(uid)
}

#[tauri::command]
pub async fn repo_toggle_manager_role_cmd(
    id_token: String,
    target_entry: StaffDirectoryEntry,
    grant_manager: bool,
    actor_uid: String,
) -> Result<(), String> {
    let client = FirebaseRestClient::from_embedded_config()?;
    let user_exists = client
        .get_document(&id_token, "users", &target_entry.uid)
        .await
        .ok()
        .flatten()
        .is_some();

    let writes =
        writes_for_toggle_manager_role(&target_entry, grant_manager, &actor_uid, user_exists)?;
    client
        .commit_writes(
            &id_token,
            &writes,
            &format!("staffDirectory/{}", target_entry.uid),
        )
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn repo_seed_sample_workspace_cmd(
    id_token: String,
    actor_uid: String,
    actor_name: String,
) -> Result<(), String> {
    let writes = writes_for_sample_workspace(&actor_uid, &actor_name);
    let client = FirebaseRestClient::from_embedded_config()?;
    client
        .commit_writes(&id_token, &writes, "staffDirectory")
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_shift(id: &str, status: ShiftStatus, assigned_uid: &str, assigned_name: &str) -> Shift {
        Shift {
            id: id.to_string(),
            title: "Morning Ops".to_string(),
            department: "Operations".to_string(),
            date: "2026-11-23".to_string(),
            start_time: "07:00".to_string(),
            end_time: "15:00".to_string(),
            duration_hours: 8.0,
            assigned_uid: assigned_uid.to_string(),
            assigned_name: assigned_name.to_string(),
            candidate_uids: vec!["u1".to_string()],
            status,
            visibility: "team".to_string(),
            fairness_note: String::new(),
            created_by: "mgr".to_string(),
        }
    }

    #[test]
    fn provision_plan_respects_rules_for_new_and_manager_users() {
        let (profile, writes, staff_sync) = build_provision_plan(
            "uid_1",
            "yatheili713@gmail.com",
            "Boris Li",
            None,
            false,
            None,
        );
        assert_eq!(profile.role, UserRole::Manager);
        assert_eq!(writes.len(), 2); // users set + staffDirectory set
        assert!(staff_sync.is_none());

        if let FirestoreWriteOp::Set {
            fields,
            server_timestamp_fields,
            ..
        } = &writes[1]
        {
            assert_eq!(server_timestamp_fields, &vec!["updatedAt".to_string()]);
            assert_eq!(fields.get("isSampleRoster"), Some(&Value::Bool(false)));
        } else {
            panic!("Expected Set op for staffDirectory");
        }
    }

    #[test]
    fn create_and_update_shift_writes_enforce_rules_keys() {
        let writes = writes_for_create_shift(
            "mgr_1",
            "shift_100",
            "Morning Dock",
            "Operations",
            "2026-11-25",
            "08:00",
            "16:00",
            "u2",
            "Liam Brooks",
            &["u2".to_string()],
            &ShiftStatus::Scheduled,
            "",
            "mgr_1",
        )
        .expect("valid shift");
        assert_eq!(writes.len(), 2); // shift + notification

        let upd = writes_for_update_shift(
            "mgr_1",
            "shift_100",
            "Morning Dock",
            "Operations",
            "2026-11-25",
            "09:00",
            "17:00",
            "u2",
            "Liam Brooks",
            &ShiftStatus::Scheduled,
            "Adjusted start",
            None,
        )
        .expect("valid update");
        if let FirestoreWriteOp::UpdateMask { mask_paths, .. } = &upd[0] {
            assert!(!mask_paths.contains(&"visibility".to_string()));
            assert!(mask_paths.contains(&"durationHours".to_string()));
        } else {
            panic!("Expected UpdateMask");
        }
    }

    #[test]
    fn accept_all_and_deny_decisions_preserve_shift_state() {
        let shift = mk_shift("sh_1", ShiftStatus::PendingChange, "u1", "Maya");
        let req = ScheduleChangeRequest {
            id: "chg_1".to_string(),
            shift_id: "sh_1".to_string(),
            shift_title: "Morning Ops".to_string(),
            requester_uid: "u1".to_string(),
            requester_name: "Maya".to_string(),
            request_type: ScheduleChangeType::Drop,
            current_date: "2026-11-23".to_string(),
            current_start_time: "07:00".to_string(),
            current_end_time: "15:00".to_string(),
            proposed_date: "2026-11-23".to_string(),
            proposed_start_time: "07:00".to_string(),
            proposed_end_time: "15:00".to_string(),
            proposed_assignee_uid: String::new(),
            proposed_assignee_name: String::new(),
            reason: "Conflict".to_string(),
            status: ApprovalStatus::Pending,
            reviewed_by_uid: String::new(),
            reviewed_by_name: String::new(),
            review_note: String::new(),
        };

        let (count, app_writes) = writes_for_accept_all(&[req.clone()], &[shift.clone()], "mgr", "Alex");
        assert_eq!(count, 1);
        assert_eq!(app_writes.len(), 3); // req + shift + notif

        let deny_writes = writes_for_schedule_change_decision(
            &req,
            Some(&shift),
            ApprovalStatus::Denied,
            "mgr",
            "Alex",
            "Needed",
        );
        assert_eq!(deny_writes.len(), 3); // req + shift status restore + notif
    }

    #[test]
    fn toggle_manager_role_writes_only_allowed_fields() {
        let member = StaffDirectoryEntry {
            uid: "u_target".to_string(),
            display_name: "Elena Chen".to_string(),
            role: UserRole::Staff,
            department: "Support".to_string(),
            total_hours_worked: 10.0,
            scheduled_hours_this_week: 0.0,
            weekly_hours_target: 36.0,
            last_assigned_at: String::new(),
            is_sample_roster: false,
        };
        let grant_writes = writes_for_toggle_manager_role(&member, true, "mgr_1", true).unwrap();
        assert_eq!(grant_writes.len(), 3);
        if let FirestoreWriteOp::Set {
            collection,
            server_timestamp_fields,
            ..
        } = &grant_writes[0]
        {
            assert_eq!(collection, "managers");
            assert_eq!(server_timestamp_fields, &vec!["createdAt".to_string()]);
        } else {
            panic!("Expected Set for managers");
        }
    }

    #[test]
    fn sample_workspace_writes_cover_all_collections() {
        let writes = writes_for_sample_workspace("mgr_1", "Alex");
        assert!(writes.len() >= 10);
    }

    #[test]
    fn role_demotion_deletes_manager_doc_and_updates_directory_role() {
        let member = StaffDirectoryEntry {
            uid: "u_mgr".to_string(),
            display_name: "Elena Chen".to_string(),
            role: UserRole::Manager,
            department: "Operations".to_string(),
            total_hours_worked: 40.0,
            scheduled_hours_this_week: 8.0,
            weekly_hours_target: 40.0,
            last_assigned_at: String::new(),
            is_sample_roster: false,
        };
        let writes = writes_for_toggle_manager_role(&member, false, "mgr_admin", false).unwrap();
        assert_eq!(writes.len(), 2);
        match &writes[0] {
            FirestoreWriteOp::Delete { collection, doc_id } => {
                assert_eq!(collection, "managers");
                assert_eq!(doc_id, "u_mgr");
            }
            _ => panic!("Expected Delete op on managers"),
        }
        match &writes[1] {
            FirestoreWriteOp::UpdateMask {
                collection, fields, ..
            } => {
                assert_eq!(collection, "staffDirectory");
                assert_eq!(fields.get("role"), Some(&Value::String("staff".to_string())));
            }
            _ => panic!("Expected UpdateMask op on staffDirectory"),
        }
    }

    #[test]
    fn bootstrap_admin_rule_check_matches_exact_email_case_insensitively() {
        let (profile, writes, _) = build_provision_plan(
            "boot_uid",
            "YATHEILI713@GMAIL.COM",
            "",
            None,
            false,
            None,
        );
        assert_eq!(profile.role, UserRole::Manager);
        assert_eq!(writes.len(), 2);
    }

    #[test]
    fn submit_shift_report_and_verify_updates_staff_hours_and_shift_status() {
        let rep_writes = writes_for_submit_shift_report(
            "rep_1",
            "sh_1",
            "Morning Ops",
            "u1",
            "Maya Patel",
            "Operations",
            "2026-11-23",
            "07:00",
            "15:30",
            30,
            "Smooth morning handoff",
        )
        .expect("valid shift report writes");
        assert_eq!(rep_writes.len(), 1);
        if let FirestoreWriteOp::Set {
            collection,
            fields,
            server_timestamp_fields,
            ..
        } = &rep_writes[0]
        {
            assert_eq!(collection, "shiftReports");
            assert_eq!(fields.get("workedHours"), Some(&serde_json::json!(8.0)));
            assert_eq!(server_timestamp_fields.len(), 2);
        } else {
            panic!("Expected Set op for shiftReports");
        }

        let report = ShiftReport {
            id: "rep_1".to_string(),
            shift_id: "sh_1".to_string(),
            shift_title: "Morning Ops".to_string(),
            staff_uid: "u1".to_string(),
            staff_name: "Maya Patel".to_string(),
            department: "Operations".to_string(),
            date: "2026-11-23".to_string(),
            actual_start_time: "07:00".to_string(),
            actual_end_time: "15:30".to_string(),
            break_minutes: 30,
            worked_hours: 8.0,
            handoff_notes: "Smooth morning handoff".to_string(),
            status: ShiftReportStatus::Submitted,
            verified_by_uid: String::new(),
        };
        let member = StaffDirectoryEntry {
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
        let linked = mk_shift("sh_1", ShiftStatus::Scheduled, "u1", "Maya Patel");

        let review_writes = writes_for_report_review(
            &report,
            ShiftReportStatus::Verified,
            "mgr_1",
            Some(&member),
            Some(&linked),
        );
        assert_eq!(review_writes.len(), 4); // report + staffDirectory + shift completed + notification
        if let FirestoreWriteOp::UpdateMask {
            collection,
            fields,
            mask_paths,
            ..
        } = &review_writes[1]
        {
            assert_eq!(collection, "staffDirectory");
            assert_eq!(mask_paths, &vec!["totalHoursWorked".to_string()]);
            assert_eq!(fields.get("totalHoursWorked"), Some(&serde_json::json!(24.0)));
        } else {
            panic!("Expected UpdateMask on staffDirectory");
        }
    }

    #[test]
    fn fairness_open_shift_and_weekly_schedule_write_planners_build_valid_commits() {
        let conflict_shift = Shift {
            candidate_uids: vec!["u1".to_string(), "u2".to_string()],
            ..mk_shift("sh_conf", ShiftStatus::Conflict, "u1", "Maya Patel")
        };
        let staff = vec![
            StaffDirectoryEntry {
                uid: "u1".to_string(),
                display_name: "Maya Patel".to_string(),
                role: UserRole::Staff,
                department: "Operations".to_string(),
                total_hours_worked: 32.0,
                scheduled_hours_this_week: 0.0,
                weekly_hours_target: 40.0,
                last_assigned_at: String::new(),
                is_sample_roster: false,
            },
            StaffDirectoryEntry {
                uid: "u2".to_string(),
                display_name: "Liam Brooks".to_string(),
                role: UserRole::Staff,
                department: "Operations".to_string(),
                total_hours_worked: 8.0,
                scheduled_hours_this_week: 0.0,
                weekly_hours_target: 40.0,
                last_assigned_at: String::new(),
                is_sample_roster: false,
            },
        ];

        let plan = build_fairness_arrangement_plan(&[conflict_shift], &staff, &[]);
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].chosen_uid, "u2");

        let fair_writes = writes_for_fairness_plan(&plan, "mgr_1");
        assert_eq!(fair_writes.len(), 3); // shift update + notification + staff lastAssignedAt

        let open_shift = mk_shift("sh_open", ShiftStatus::Open, "", "");
        let open_plan = build_open_shift_assignment_plan(&[open_shift], &staff, &[], &[], false);
        assert_eq!(open_plan.len(), 1);
        let open_writes = writes_for_open_shift_plan(&open_plan, "mgr_1");
        assert_eq!(open_writes.len(), 3);

        let submissions = vec![ShiftSubmission {
            id: "sub_mon".to_string(),
            staff_uid: "u2".to_string(),
            staff_name: "Liam Brooks".to_string(),
            department: "Operations".to_string(),
            date: "2026-11-23".to_string(),
            start_time: "07:00".to_string(),
            end_time: "15:00".to_string(),
            shift_title: "Morning".to_string(),
            notes: "Available".to_string(),
            status: SubmissionStatus::Submitted,
        }];
        let weekly_specs = generate_weekly_fairness_schedule(
            "2026-11-23",
            &default_week_slots(),
            &staff,
            &[],
            &submissions,
            &[],
        );
        let (summary, weekly_writes) = writes_for_weekly_schedule(&weekly_specs, "mgr_1");
        assert!(summary.assigned >= 1);
        assert_eq!(summary.assigned + summary.open, weekly_specs.len());
        assert!(weekly_writes.len() > weekly_specs.len());
    }

    #[test]
    fn schedule_change_submission_sets_pending_status_and_marks_own_shift() {
        let shift = mk_shift("sh_swap", ShiftStatus::Scheduled, "u1", "Maya Patel");
        let writes = writes_for_submit_schedule_change(
            "chg_99",
            &shift,
            "u1",
            "Maya Patel",
            false,
            &ScheduleChangeType::TimeChange,
            "2026-11-23",
            "08:00",
            "16:00",
            "",
            "",
            "Doctor appointment",
        )
        .expect("valid time change request");
        assert_eq!(writes.len(), 2); // scheduleChanges set + shifts status pending_change
        if let FirestoreWriteOp::UpdateMask {
            collection,
            fields,
            ..
        } = &writes[1]
        {
            assert_eq!(collection, "shifts");
            assert_eq!(
                fields.get("status"),
                Some(&Value::String("pending_change".to_string()))
            );
        } else {
            panic!("Expected shift pending_change status update");
        }
    }
}
