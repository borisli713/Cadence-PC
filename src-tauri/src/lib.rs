pub mod analytics;
pub mod approvals;
pub mod audit_log;
pub mod auth_oauth;
pub mod availability_planner;
pub mod backup_snapshot;
pub mod calendar_grid;
pub mod compliance;
pub mod deep_link;
pub mod desktop_runtime;
pub mod diagnostics;
pub mod fairness;
pub mod firebase_client;
pub mod history;
pub mod ics;
pub mod local_store;
pub mod models;
pub mod notifications;
pub mod offline_queue;
pub mod payroll_rules;
pub mod reports;
pub mod repository;
pub mod roster;
pub mod schedule_export;
pub mod scheduler;
pub mod seeder;
pub mod shift_templates;
pub mod swap_matcher;
pub mod sync_reconciler;
pub mod team_digest;
pub mod time_off_planner;
pub mod updater;
pub mod validation;
pub mod workspace_cache;

use std::fs;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, State,
};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_notification::NotificationExt;

use crate::approvals::{AcceptAllPlan, PlannedChangeDecision, PlannedTimeOffDecision};
use crate::auth_oauth::OAuthFlowState;
use crate::history::{HistoryFilterKind, HistoryQueryResult};
use crate::local_store::LocalStoreState;
use crate::models::{
    ApprovalStatus, DashboardKpis, ExternalOAuthResult, FairnessArrangementItem,
    FairnessScoreBreakdown, GeneratedShiftSpec, NotificationWorkPayload, OpenShiftAssignmentItem,
    ScheduleChangeRequest, ScheduleChangeType, Shift, ShiftReport, ShiftReportStatus,
    ShiftSubmission, StaffChartRow, StaffDirectoryEntry, TimeOffRequest, UpdateCheckResult,
    ValidationOutcome, WeekSlotConfig,
};
use crate::reports::PlannedReportReview;
use crate::seeder::SampleWorkspaceBundle;
use crate::workspace_cache::WorkspaceCacheState;

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
async fn start_external_google_login_cmd(
    app: tauri::AppHandle,
    oauth_state: State<'_, OAuthFlowState>,
) -> Result<ExternalOAuthResult, String> {
    auth_oauth::start_external_google_login(app, &oauth_state).await
}

#[tauri::command]
fn cancel_external_google_login_cmd(oauth_state: State<'_, OAuthFlowState>) {
    oauth_state.cancel_active();
}

#[tauri::command]
fn compute_shift_hours_cmd(start_time: String, end_time: String, break_minutes: Option<i32>) -> f64 {
    reports::compute_net_worked_hours(&start_time, &end_time, break_minutes.unwrap_or(0))
}

#[tauri::command]
fn rank_candidates_cmd(
    candidate_uids: Vec<String>,
    staff_directory: Vec<StaffDirectoryEntry>,
    all_shifts: Vec<Shift>,
    target_date: String,
    start_time: String,
    end_time: String,
    exclude_shift_id: Option<String>,
    time_off_requests: Vec<TimeOffRequest>,
) -> Vec<FairnessScoreBreakdown> {
    fairness::rank_candidates_by_fairness(
        &candidate_uids,
        &staff_directory,
        &all_shifts,
        &target_date,
        &start_time,
        &end_time,
        exclude_shift_id.as_deref(),
        &time_off_requests,
    )
}

#[tauri::command]
fn build_fairness_plan_cmd(
    shifts: Vec<Shift>,
    staff_directory: Vec<StaffDirectoryEntry>,
    time_off_requests: Vec<TimeOffRequest>,
) -> Vec<FairnessArrangementItem> {
    fairness::build_fairness_arrangement_plan(&shifts, &staff_directory, &time_off_requests)
}

#[tauri::command]
fn build_open_shift_plan_cmd(
    shifts: Vec<Shift>,
    staff_directory: Vec<StaffDirectoryEntry>,
    submissions: Vec<ShiftSubmission>,
    time_off_requests: Vec<TimeOffRequest>,
    require_explicit_submission: bool,
) -> Vec<OpenShiftAssignmentItem> {
    fairness::build_open_shift_assignment_plan(
        &shifts,
        &staff_directory,
        &submissions,
        &time_off_requests,
        require_explicit_submission,
    )
}

#[tauri::command]
fn generate_weekly_schedule_cmd(
    week_start_date: String,
    slots: Vec<WeekSlotConfig>,
    staff_directory: Vec<StaffDirectoryEntry>,
    existing_shifts: Vec<Shift>,
    submissions: Vec<ShiftSubmission>,
    time_off_requests: Vec<TimeOffRequest>,
) -> Vec<GeneratedShiftSpec> {
    let effective_slots = if slots.is_empty() {
        fairness::default_week_slots()
    } else {
        slots
    };
    fairness::generate_weekly_fairness_schedule(
        &week_start_date,
        &effective_slots,
        &staff_directory,
        &existing_shifts,
        &submissions,
        &time_off_requests,
    )
}

#[tauri::command]
fn compute_dashboard_kpis_cmd(
    uid: String,
    weekly_hours_target: f64,
    shifts: Vec<Shift>,
    schedule_changes_pending: usize,
    time_off_requests: Vec<TimeOffRequest>,
    staff_directory: Vec<StaffDirectoryEntry>,
) -> DashboardKpis {
    analytics::compute_dashboard_kpis(
        &uid,
        weekly_hours_target,
        &shifts,
        schedule_changes_pending,
        &time_off_requests,
        &staff_directory,
    )
}

#[tauri::command]
fn compute_staff_chart_cmd(
    staff_directory: Vec<StaffDirectoryEntry>,
    shifts: Vec<Shift>,
) -> Vec<StaffChartRow> {
    analytics::build_staff_chart_rows(&staff_directory, &shifts)
}

#[tauri::command]
fn validate_shift_cmd(
    title: String,
    department: String,
    date: String,
    start_time: String,
    end_time: String,
) -> ValidationOutcome {
    validation::validate_shift_input(&title, &department, &date, &start_time, &end_time)
}

#[tauri::command]
fn validate_shift_report_cmd(
    shift_title: String,
    department: String,
    date: String,
    actual_start_time: String,
    actual_end_time: String,
    break_minutes: i32,
) -> ValidationOutcome {
    validation::validate_shift_report_input(
        &shift_title,
        &department,
        &date,
        &actual_start_time,
        &actual_end_time,
        break_minutes,
    )
}

#[tauri::command]
fn validate_time_off_cmd(
    start_date: String,
    end_date: String,
    reason: String,
) -> ValidationOutcome {
    validation::validate_time_off_input(&start_date, &end_date, &reason)
}

#[tauri::command]
fn validate_schedule_change_cmd(
    shift: Shift,
    requester_uid: String,
    is_manager: bool,
    request_type: ScheduleChangeType,
    proposed_date: String,
    proposed_start_time: String,
    proposed_end_time: String,
    proposed_assignee_uid: String,
    reason: String,
) -> ValidationOutcome {
    validation::validate_schedule_change_request(
        &shift,
        &requester_uid,
        is_manager,
        &request_type,
        &proposed_date,
        &proposed_start_time,
        &proposed_end_time,
        &proposed_assignee_uid,
        &reason,
    )
}

#[tauri::command]
fn plan_schedule_change_decision_cmd(
    req: ScheduleChangeRequest,
    linked_shift: Option<Shift>,
    decision: ApprovalStatus,
    reviewer_uid: String,
    reviewer_name: String,
    review_note: String,
) -> PlannedChangeDecision {
    approvals::plan_schedule_change_decision(
        &req,
        linked_shift.as_ref(),
        decision,
        &reviewer_uid,
        &reviewer_name,
        &review_note,
    )
}

#[tauri::command]
fn plan_accept_all_cmd(
    requests: Vec<ScheduleChangeRequest>,
    shifts: Vec<Shift>,
    reviewer_uid: String,
    reviewer_name: String,
    note: String,
) -> AcceptAllPlan {
    approvals::plan_accept_all_changes(&requests, &shifts, &reviewer_uid, &reviewer_name, &note)
}

#[tauri::command]
fn plan_time_off_decision_cmd(
    req: TimeOffRequest,
    decision: ApprovalStatus,
    reviewer_uid: String,
    reviewer_name: String,
    review_note: String,
) -> PlannedTimeOffDecision {
    approvals::plan_time_off_decision(
        &req,
        decision,
        &reviewer_uid,
        &reviewer_name,
        &review_note,
    )
}

#[tauri::command]
fn plan_report_review_cmd(
    report: ShiftReport,
    next_status: ShiftReportStatus,
    reviewer_uid: String,
    staff_entry: Option<StaffDirectoryEntry>,
    linked_shift: Option<Shift>,
) -> PlannedReportReview {
    reports::plan_report_review(
        &report,
        next_status,
        &reviewer_uid,
        staff_entry.as_ref(),
        linked_shift.as_ref(),
    )
}

#[tauri::command]
fn build_manager_work_payloads_cmd(
    manager_uid: String,
    schedule_changes: Vec<ScheduleChangeRequest>,
    time_off_requests: Vec<TimeOffRequest>,
    shift_reports: Vec<ShiftReport>,
) -> Vec<NotificationWorkPayload> {
    notifications::build_manager_work_payloads(
        &manager_uid,
        &schedule_changes,
        &time_off_requests,
        &shift_reports,
    )
}

#[tauri::command]
async fn save_reports_csv_cmd(
    app: tauri::AppHandle,
    reports: Vec<ShiftReport>,
    default_filename: Option<String>,
) -> Result<Option<String>, String> {
    let csv = reports::export_shift_reports_csv(&reports);
    let file_name = default_filename.unwrap_or_else(|| "cadence-shift-reports.csv".to_string());
    let selected = app
        .dialog()
        .file()
        .add_filter("CSV", &["csv"])
        .set_file_name(&file_name)
        .blocking_save_file();

    match selected {
        Some(FilePath::Path(path)) => {
            fs::write(&path, csv.as_bytes())
                .map_err(|e| format!("Failed to save CSV report: {e}"))?;
            Ok(Some(path.to_string_lossy().to_string()))
        }
        Some(FilePath::Url(url)) => Ok(Some(url.to_string())),
        None => Ok(None),
    }
}

#[tauri::command]
fn filter_shift_history_cmd(
    changes: Vec<ScheduleChangeRequest>,
    filter: HistoryFilterKind,
    search_query: String,
) -> HistoryQueryResult {
    history::filter_shift_history(&changes, &filter, &search_query)
}

#[tauri::command]
fn build_sample_workspace_cmd(
    manager_uid: String,
    manager_name: String,
) -> SampleWorkspaceBundle {
    seeder::build_default_sample_bundle_today(&manager_uid, &manager_name)
}

#[tauri::command]
fn detect_schedule_conflicts_cmd(
    shifts: Vec<Shift>,
    time_off_requests: Vec<TimeOffRequest>,
) -> Vec<scheduler::ConflictReportItem> {
    scheduler::detect_schedule_conflicts(&shifts, &time_off_requests)
}

#[tauri::command]
fn summarize_department_coverage_cmd(
    shifts: Vec<Shift>,
) -> Vec<scheduler::DepartmentCoverageSummary> {
    scheduler::summarize_department_coverage(&shifts)
}

#[tauri::command]
fn compute_team_roster_stats_cmd(
    staff_directory: Vec<StaffDirectoryEntry>,
) -> roster::TeamRosterStats {
    roster::compute_team_roster_stats(&staff_directory)
}

#[tauri::command]
async fn save_team_hours_csv_cmd(
    app: tauri::AppHandle,
    staff_directory: Vec<StaffDirectoryEntry>,
    shifts: Vec<Shift>,
    default_filename: Option<String>,
) -> Result<Option<String>, String> {
    let csv = reports::export_team_hours_csv(&staff_directory, &shifts);
    let file_name = default_filename.unwrap_or_else(|| "cadence-team-hours.csv".to_string());
    let selected = app
        .dialog()
        .file()
        .add_filter("CSV", &["csv"])
        .set_file_name(&file_name)
        .blocking_save_file();

    match selected {
        Some(FilePath::Path(path)) => {
            fs::write(&path, csv.as_bytes())
                .map_err(|e| format!("Failed to save team hours CSV: {e}"))?;
            Ok(Some(path.to_string_lossy().to_string()))
        }
        Some(FilePath::Url(url)) => Ok(Some(url.to_string())),
        None => Ok(None),
    }
}

#[tauri::command]
fn generate_ics_cmd(shifts: Vec<Shift>) -> String {
    ics::generate_ics_content(&shifts)
}

#[tauri::command]
async fn save_ics_file_cmd(
    app: tauri::AppHandle,
    shifts: Vec<Shift>,
    default_filename: Option<String>,
) -> Result<Option<String>, String> {
    let content = ics::generate_ics_content(&shifts);
    let file_name = default_filename.unwrap_or_else(|| "cadence-shifts.ics".to_string());

    let selected = app
        .dialog()
        .file()
        .add_filter("iCalendar", &["ics"])
        .set_file_name(&file_name)
        .blocking_save_file();

    match selected {
        Some(FilePath::Path(path)) => {
            fs::write(&path, content.as_bytes())
                .map_err(|e| format!("Failed to save calendar file: {e}"))?;
            Ok(Some(path.to_string_lossy().to_string()))
        }
        Some(FilePath::Url(url)) => Ok(Some(url.to_string())),
        None => Ok(None),
    }
}

#[tauri::command]
fn send_native_notification_cmd(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| format!("Failed to show Windows notification: {e}"))
}

#[tauri::command]
async fn check_github_update_cmd() -> Result<UpdateCheckResult, String> {
    let current = env!("CARGO_PKG_VERSION");
    updater::check_for_github_update(current).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(OAuthFlowState::default())
        .manage(WorkspaceCacheState::default())
        .manage(LocalStoreState::default())
        .manage(offline_queue::OfflineQueueState::default())
        .manage(audit_log::AuditLogState::default())
        .manage(shift_templates::ShiftTemplatesState::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let handled_auth = deep_link::handle_cli_args_for_deep_link(app, &args);
            deep_link::focus_main_window(app);
            if handled_auth {
                let _ = app.emit("cadence://deep-link", args);
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let _ = deep_link::register_windows_url_protocol();

            let startup_args: Vec<String> = std::env::args().collect();
            let _ = deep_link::handle_cli_args_for_deep_link(app.handle(), &startup_args);

            let show_item = MenuItem::with_id(app, "show", "Open Cadence", true, None::<&str>)?;
            let update_item =
                MenuItem::with_id(app, "check_updates", "Check for Updates", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Cadence", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &update_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Cadence — Shift Reporting & Fair Scheduling")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        deep_link::focus_main_window(app);
                    }
                    "check_updates" => {
                        let _ = app.emit("cadence://check-updates", ());
                        deep_link::focus_main_window(app);
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        deep_link::focus_main_window(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            let _ = tray_builder.build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            start_external_google_login_cmd,
            cancel_external_google_login_cmd,
            compute_shift_hours_cmd,
            rank_candidates_cmd,
            build_fairness_plan_cmd,
            build_open_shift_plan_cmd,
            generate_weekly_schedule_cmd,
            compute_dashboard_kpis_cmd,
            compute_staff_chart_cmd,
            validate_shift_cmd,
            validate_shift_report_cmd,
            validate_time_off_cmd,
            validate_schedule_change_cmd,
            plan_schedule_change_decision_cmd,
            plan_accept_all_cmd,
            plan_time_off_decision_cmd,
            plan_report_review_cmd,
            build_manager_work_payloads_cmd,
            filter_shift_history_cmd,
            build_sample_workspace_cmd,
            detect_schedule_conflicts_cmd,
            summarize_department_coverage_cmd,
            compute_team_roster_stats_cmd,
            save_reports_csv_cmd,
            save_team_hours_csv_cmd,
            generate_ics_cmd,
            save_ics_file_cmd,
            send_native_notification_cmd,
            check_github_update_cmd,
            repository::repo_ensure_verified_user_provisioned_cmd,
            repository::repo_update_user_preferences_cmd,
            repository::repo_create_shift_cmd,
            repository::repo_update_shift_cmd,
            repository::repo_delete_shift_cmd,
            repository::repo_submit_schedule_change_cmd,
            repository::repo_decide_schedule_change_cmd,
            repository::repo_accept_all_pending_cmd,
            repository::repo_submit_shift_report_cmd,
            repository::repo_verify_or_flag_report_cmd,
            repository::repo_mark_notification_read_cmd,
            repository::repo_mark_all_notifications_read_cmd,
            repository::repo_send_test_notification_cmd,
            repository::repo_commit_fairness_plan_cmd,
            repository::repo_commit_open_shift_plan_cmd,
            repository::repo_generate_weekly_schedule_cmd,
            repository::repo_submit_availability_batch_cmd,
            repository::repo_withdraw_submission_cmd,
            repository::repo_create_time_off_cmd,
            repository::repo_withdraw_time_off_cmd,
            repository::repo_decide_time_off_cmd,
            repository::repo_add_roster_staff_cmd,
            repository::repo_toggle_manager_role_cmd,
            repository::repo_seed_sample_workspace_cmd,
            workspace_cache::sync_workspace_snapshot_cmd,
            workspace_cache::get_workspace_insights_cmd,
            local_store::load_week_slots_cmd,
            local_store::save_week_slots_cmd,
            local_store::filter_unnotified_alerts_cmd,
            local_store::filter_new_manager_work_alerts_cmd,
            desktop_runtime::get_desktop_runtime_info_cmd,
            compliance::analyze_workforce_compliance_cmd,
            schedule_export::generate_schedule_markdown_cmd,
            schedule_export::generate_payroll_report_html_cmd,
            schedule_export::save_payroll_summary_cmd,
            sync_reconciler::reconcile_workspace_sync_cmd,
            sync_reconciler::verify_three_way_sync_integrity_cmd,
            sync_reconciler::repair_scheduled_hours_drift_cmd,
            offline_queue::queue_offline_mutation_cmd,
            offline_queue::list_offline_mutations_cmd,
            offline_queue::clear_offline_mutation_cmd,
            offline_queue::flush_offline_mutations_cmd,
            audit_log::append_audit_event_cmd,
            audit_log::query_audit_log_cmd,
            audit_log::verify_audit_chain_cmd,
            audit_log::export_audit_log_cmd,
            shift_templates::list_shift_templates_cmd,
            shift_templates::save_shift_template_cmd,
            shift_templates::delete_shift_template_cmd,
            shift_templates::project_template_capacity_cmd,
            calendar_grid::build_month_calendar_grid_cmd,
            calendar_grid::build_weekly_coverage_matrix_cmd,
            calendar_grid::compute_staff_availability_overlap_cmd,
            backup_snapshot::validate_workspace_backup_cmd,
            backup_snapshot::export_workspace_backup_cmd,
            payroll_rules::compute_payroll_breakdown_cmd,
            payroll_rules::export_payroll_breakdown_csv_cmd,
            diagnostics::run_desktop_preflight_cmd,
            team_digest::build_weekly_team_briefing_cmd,
            team_digest::save_weekly_briefing_markdown_cmd,
            availability_planner::plan_staff_availability_batch_cmd,
            availability_planner::evaluate_availability_coverage_cmd,
            availability_planner::render_availability_heatmap_cmd,
            swap_matcher::recommend_swap_candidates_cmd,
            swap_matcher::simulate_swap_impact_cmd,
            time_off_planner::analyze_time_off_shift_conflicts_cmd,
            time_off_planner::compute_department_absence_calendar_cmd,
            time_off_planner::evaluate_time_off_request_impact_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Cadence desktop application");
}
