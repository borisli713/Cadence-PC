pub mod fairness;
pub mod ics;
pub mod models;
pub mod updater;

use std::fs;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_notification::NotificationExt;

use crate::models::{
    FairnessArrangementItem, FairnessScoreBreakdown, GeneratedShiftSpec, OpenShiftAssignmentItem,
    Shift, ShiftSubmission, StaffDirectoryEntry, TimeOffRequest, UpdateCheckResult, WeekSlotConfig,
};

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn compute_shift_hours_cmd(start_time: String, end_time: String, break_minutes: Option<i32>) -> f64 {
    fairness::compute_shift_hours(&start_time, &end_time, break_minutes.unwrap_or(0))
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
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
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
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "check_updates" => {
                        let _ = app.emit("cadence://check-updates", ());
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
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
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
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
            compute_shift_hours_cmd,
            rank_candidates_cmd,
            build_fairness_plan_cmd,
            build_open_shift_plan_cmd,
            generate_weekly_schedule_cmd,
            generate_ics_cmd,
            save_ics_file_cmd,
            send_native_notification_cmd,
            check_github_update_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Cadence desktop application");
}
