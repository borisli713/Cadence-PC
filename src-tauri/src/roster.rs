use serde::{Deserialize, Serialize};

use crate::models::{StaffDirectoryEntry, UserProfile, UserRole};
use crate::validation::{clamp_str, MAX_DEPARTMENT, MAX_DISPLAY_NAME};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeamRosterStats {
    pub total_members: usize,
    pub manager_count: usize,
    pub staff_count: usize,
    pub sample_roster_count: usize,
    pub total_weekly_target_hours: f64,
    pub total_verified_worked_hours: f64,
}

pub fn build_provisioned_user_profile(
    uid: &str,
    email: &str,
    display_name: &str,
    bootstrapped_admin_email: &str,
) -> UserProfile {
    let clean_name = clamp_str(display_name, MAX_DISPLAY_NAME);
    let final_name = if clean_name.is_empty() {
        email
            .split('@')
            .next()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or("Team Member")
            .chars()
            .take(MAX_DISPLAY_NAME)
            .collect()
    } else {
        clean_name
    };

    let is_bootstrap_admin = !bootstrapped_admin_email.trim().is_empty()
        && email.trim().eq_ignore_ascii_case(bootstrapped_admin_email.trim());

    UserProfile {
        uid: uid.to_string(),
        email: email.trim().to_string(),
        display_name: final_name,
        role: if is_bootstrap_admin {
            UserRole::Manager
        } else {
            UserRole::Staff
        },
        department: clamp_str("Operations", MAX_DEPARTMENT),
        weekly_hours_target: 40.0,
        push_notifications_enabled: true,
    }
}

pub fn can_toggle_manager_role(actor_uid: &str, member: &StaffDirectoryEntry) -> bool {
    !member.is_sample_roster
        && !member.uid.starts_with("roster_")
        && member.uid != actor_uid
}

pub fn compute_team_roster_stats(staff_directory: &[StaffDirectoryEntry]) -> TeamRosterStats {
    let mut manager_count = 0usize;
    let mut staff_count = 0usize;
    let mut sample_roster_count = 0usize;
    let mut total_weekly_target_hours = 0.0;
    let mut total_verified_worked_hours = 0.0;

    for member in staff_directory {
        match member.role {
            UserRole::Manager => manager_count += 1,
            UserRole::Staff => staff_count += 1,
        }
        if member.is_sample_roster {
            sample_roster_count += 1;
        }
        total_weekly_target_hours += member.weekly_hours_target.max(0.0);
        total_verified_worked_hours += member.total_hours_worked.max(0.0);
    }

    TeamRosterStats {
        total_members: staff_directory.len(),
        manager_count,
        staff_count,
        sample_roster_count,
        total_weekly_target_hours: (total_weekly_target_hours * 100.0).round() / 100.0,
        total_verified_worked_hours: (total_verified_worked_hours * 100.0).round() / 100.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provisions_bootstrap_admin_and_regular_staff() {
        let admin = build_provisioned_user_profile(
            "u_admin",
            "YatheiLi713@gmail.com",
            "",
            "yatheili713@gmail.com",
        );
        assert_eq!(admin.role, UserRole::Manager);
        assert_eq!(admin.display_name, "YatheiLi713");

        let staff = build_provisioned_user_profile(
            "u_staff",
            "maya@company.com",
            "Maya Patel",
            "yatheili713@gmail.com",
        );
        assert_eq!(staff.role, UserRole::Staff);
        assert_eq!(staff.display_name, "Maya Patel");
    }

    #[test]
    fn enforces_role_toggle_guardrails() {
        let real_member = StaffDirectoryEntry {
            uid: "uid_2".to_string(),
            display_name: "Liam".to_string(),
            role: UserRole::Staff,
            department: "Ops".to_string(),
            total_hours_worked: 12.0,
            scheduled_hours_this_week: 0.0,
            weekly_hours_target: 40.0,
            last_assigned_at: String::new(),
            is_sample_roster: false,
        };
        assert!(can_toggle_manager_role("uid_mgr", &real_member));
        assert!(!can_toggle_manager_role("uid_2", &real_member));

        let mut sample = real_member.clone();
        sample.is_sample_roster = true;
        assert!(!can_toggle_manager_role("uid_mgr", &sample));
    }
}
