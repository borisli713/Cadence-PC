use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UserRole {
    Staff,
    Manager,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShiftStatus {
    Scheduled,
    Open,
    Completed,
    Conflict,
    PendingChange,
}

impl ShiftStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            ShiftStatus::Scheduled => "scheduled",
            ShiftStatus::Open => "open",
            ShiftStatus::Completed => "completed",
            ShiftStatus::Conflict => "conflict",
            ShiftStatus::PendingChange => "pending_change",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleChangeType {
    TimeChange,
    Swap,
    Drop,
    Claim,
}

impl ScheduleChangeType {
    pub fn label(&self) -> &'static str {
        match self {
            ScheduleChangeType::TimeChange => "time change",
            ScheduleChangeType::Swap => "swap",
            ScheduleChangeType::Drop => "drop",
            ScheduleChangeType::Claim => "claim",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalStatus {
    Pending,
    Approved,
    Denied,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShiftReportStatus {
    Submitted,
    Verified,
    Flagged,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationCategory {
    ShiftApproved,
    ShiftDenied,
    FairnessRebalanced,
    ReportVerified,
    ShiftAssigned,
    TimeOffApproved,
    TimeOffDenied,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubmissionStatus {
    Submitted,
    Withdrawn,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub uid: String,
    pub email: String,
    pub display_name: String,
    pub role: UserRole,
    pub department: String,
    pub weekly_hours_target: f64,
    #[serde(default = "default_true")]
    pub push_notifications_enabled: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffDirectoryEntry {
    pub uid: String,
    pub display_name: String,
    pub role: UserRole,
    pub department: String,
    #[serde(default)]
    pub total_hours_worked: f64,
    #[serde(default)]
    pub scheduled_hours_this_week: f64,
    #[serde(default = "default_weekly_target")]
    pub weekly_hours_target: f64,
    #[serde(default)]
    pub last_assigned_at: String,
    #[serde(default)]
    pub is_sample_roster: bool,
}

fn default_weekly_target() -> f64 {
    40.0
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Shift {
    pub id: String,
    pub title: String,
    pub department: String,
    pub date: String,
    pub start_time: String,
    pub end_time: String,
    #[serde(default)]
    pub duration_hours: f64,
    #[serde(default)]
    pub assigned_uid: String,
    #[serde(default)]
    pub assigned_name: String,
    #[serde(default)]
    pub candidate_uids: Vec<String>,
    pub status: ShiftStatus,
    #[serde(default = "default_visibility")]
    pub visibility: String,
    #[serde(default)]
    pub fairness_note: String,
    #[serde(default)]
    pub created_by: String,
}

fn default_visibility() -> String {
    "team".to_string()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleChangeRequest {
    pub id: String,
    pub shift_id: String,
    pub shift_title: String,
    pub requester_uid: String,
    pub requester_name: String,
    #[serde(rename = "type")]
    pub request_type: ScheduleChangeType,
    pub current_date: String,
    pub current_start_time: String,
    pub current_end_time: String,
    pub proposed_date: String,
    pub proposed_start_time: String,
    pub proposed_end_time: String,
    #[serde(default)]
    pub proposed_assignee_uid: String,
    #[serde(default)]
    pub proposed_assignee_name: String,
    #[serde(default)]
    pub reason: String,
    pub status: ApprovalStatus,
    #[serde(default)]
    pub reviewed_by_uid: String,
    #[serde(default)]
    pub reviewed_by_name: String,
    #[serde(default)]
    pub review_note: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftReport {
    pub id: String,
    #[serde(default)]
    pub shift_id: String,
    pub shift_title: String,
    pub staff_uid: String,
    pub staff_name: String,
    pub department: String,
    pub date: String,
    pub actual_start_time: String,
    pub actual_end_time: String,
    #[serde(default)]
    pub break_minutes: i32,
    #[serde(default)]
    pub worked_hours: f64,
    #[serde(default)]
    pub handoff_notes: String,
    pub status: ShiftReportStatus,
    #[serde(default)]
    pub verified_by_uid: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushNotificationRecord {
    pub id: String,
    pub recipient_uid: String,
    pub title: String,
    pub message: String,
    pub category: NotificationCategory,
    #[serde(default)]
    pub related_shift_id: String,
    #[serde(default)]
    pub is_read: bool,
    #[serde(default)]
    pub actor_uid: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftSubmission {
    pub id: String,
    pub staff_uid: String,
    pub staff_name: String,
    pub department: String,
    pub date: String,
    pub start_time: String,
    pub end_time: String,
    #[serde(default)]
    pub shift_title: String,
    #[serde(default)]
    pub notes: String,
    pub status: SubmissionStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeOffRequest {
    pub id: String,
    pub staff_uid: String,
    pub staff_name: String,
    pub department: String,
    pub start_date: String,
    pub end_date: String,
    pub reason: String,
    pub status: ApprovalStatus,
    #[serde(default)]
    pub reviewed_by_uid: String,
    #[serde(default)]
    pub reviewed_by_name: String,
    #[serde(default)]
    pub review_note: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekSlotConfig {
    pub id: String,
    pub label: String,
    pub title: String,
    pub department: String,
    pub start_time: String,
    pub end_time: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeOffConflict {
    pub has_time_off: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FairnessScoreBreakdown {
    pub uid: String,
    pub display_name: String,
    pub department: String,
    pub total_hours_worked: f64,
    pub scheduled_hours_this_week: f64,
    pub weekly_hours_target: f64,
    pub utilization_ratio: f64,
    pub shifts_this_week_count: usize,
    pub last_assigned_at: String,
    pub has_conflict: bool,
    pub has_approved_time_off: bool,
    pub time_off_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FairnessArrangementItem {
    pub shift: Shift,
    pub previous_uid: String,
    pub previous_name: String,
    pub chosen_uid: String,
    pub chosen_name: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenShiftAssignmentItem {
    pub shift: Shift,
    pub chosen_uid: String,
    pub chosen_name: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedShiftSpec {
    pub title: String,
    pub department: String,
    pub date: String,
    pub start_time: String,
    pub end_time: String,
    pub duration_hours: f64,
    pub assigned_uid: String,
    pub assigned_name: String,
    pub candidate_uids: Vec<String>,
    pub status: ShiftStatus,
    pub fairness_note: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteReleaseInfo {
    pub version_name: String,
    pub release_notes: String,
    pub download_page_url: String,
    pub windows_asset_url: Option<String>,
    pub windows_asset_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest: RemoteReleaseInfo,
    pub update_available: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalOAuthResult {
    pub id_token: String,
    pub access_token: Option<String>,
    pub email: Option<String>,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardKpis {
    pub my_shifts_count: usize,
    pub my_upcoming_count: usize,
    pub my_scheduled_hours: f64,
    pub my_verified_hours: f64,
    pub pending_approvals_count: usize,
    pub pending_time_off_count: usize,
    pub conflict_shifts_count: usize,
    pub open_shifts_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffChartRow {
    pub uid: String,
    pub display_name: String,
    pub department: String,
    pub logged_hours: f64,
    pub scheduled_hours: f64,
    pub target_hours: f64,
    pub combined_hours: f64,
    pub utilization_ratio: f64,
    pub utilization_percent: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationWorkPayload {
    pub key: String,
    pub title: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationOutcome {
    pub valid: bool,
    pub error_message: Option<String>,
}
