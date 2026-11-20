use cadence_lib::approvals::plan_accept_all_changes;
use cadence_lib::deep_link::parse_cadence_deep_link;
use cadence_lib::fairness::{
    build_fairness_arrangement_plan, default_week_slots, generate_weekly_fairness_schedule,
};
use cadence_lib::history::{filter_shift_history, HistoryFilterKind};
use cadence_lib::ics::generate_ics_content;
use cadence_lib::models::{ApprovalStatus, ShiftReportStatus};
use cadence_lib::reports::{export_shift_reports_csv, plan_report_review};
use cadence_lib::seeder::build_sample_workspace_bundle;
use cadence_lib::updater::{is_windows_release, normalize_version_name, select_latest_windows_release, GitHubReleaseAsset, GitHubReleaseEntry};
use cadence_lib::validation::{validate_schedule_change_request, validate_shift_report_input};
use chrono::NaiveDate;

#[test]
fn end_to_end_fairness_approvals_reports_and_export_pipeline() {
    let anchor = NaiveDate::from_ymd_opt(2026, 11, 20).unwrap();
    let bundle = build_sample_workspace_bundle("mgr_1", "Alex Manager", anchor);

    // 1. Resolve overlapping conflict shift by lowest-utilization fairness
    let conflict_plan = build_fairness_arrangement_plan(
        &bundle.shifts,
        &bundle.roster,
        &bundle.time_off_requests,
    );
    assert_eq!(conflict_plan.len(), 1);
    assert_eq!(conflict_plan[0].chosen_uid, "sample_maya");

    // 2. Accept all pending schedule changes in Rust
    let accept_plan = plan_accept_all_changes(
        &bundle.schedule_changes,
        &bundle.shifts,
        "mgr_1",
        "Alex Manager",
        "",
    );
    assert_eq!(accept_plan.approved_count, 2);
    assert_eq!(accept_plan.skipped_count, 0);

    // 3. Validate and verify shift report
    let rep = &bundle.shift_reports[0];
    let val = validate_shift_report_input(
        &rep.shift_title,
        &rep.department,
        &rep.date,
        &rep.actual_start_time,
        &rep.actual_end_time,
        rep.break_minutes,
    );
    assert!(val.valid);

    let review = plan_report_review(
        rep,
        ShiftReportStatus::Verified,
        "mgr_1",
        Some(&bundle.roster[0]),
        None,
    );
    assert_eq!(review.hours_delta, 8.0);
    assert_eq!(review.updated_staff_total_hours, 22.0);

    // 4. Generate weekly schedule & ICS + CSV exports
    let generated = generate_weekly_fairness_schedule(
        "2026-11-30",
        &default_week_slots(),
        &bundle.roster,
        &bundle.shifts,
        &bundle.shift_submissions,
        &bundle.time_off_requests,
    );
    assert_eq!(generated.len(), 21);

    let ics = generate_ics_content(&bundle.shifts);
    assert!(ics.contains("BEGIN:VCALENDAR"));
    assert!(ics.contains("Morning Dock Control"));

    let csv = export_shift_reports_csv(&bundle.shift_reports);
    assert!(csv.contains("Morning Inbound Check"));

    // 5. History filter returns empty when all sample items remain pending
    let hist = filter_shift_history(&bundle.schedule_changes, &HistoryFilterKind::All, "");
    assert_eq!(hist.total_resolved, 0);

    // 6. Schedule change validation enforces authorization
    let claim_check = validate_schedule_change_request(
        &bundle.shifts[1],
        "sample_maya",
        false,
        &bundle.schedule_changes[1].request_type,
        &bundle.schedule_changes[1].proposed_date,
        &bundle.schedule_changes[1].proposed_start_time,
        &bundle.schedule_changes[1].proposed_end_time,
        "sample_maya",
        "Can close",
    );
    assert!(claim_check.valid);
    assert_eq!(bundle.schedule_changes[0].status, ApprovalStatus::Pending);
}

#[test]
fn separates_windows_desktop_releases_from_android_releases_and_parses_deep_link() {
    let releases = vec![
        GitHubReleaseEntry {
            tag_name: "v1.1.9".to_string(),
            html_url: None,
            body: Some("- feat: implement server-side security".to_string()),
            draft: false,
            prerelease: false,
            assets: vec![GitHubReleaseAsset {
                name: "cadence-android-v1.1.9.apk".to_string(),
                browser_download_url: "https://example.com/android.apk".to_string(),
            }],
        },
        GitHubReleaseEntry {
            tag_name: "windows-v1.0.1".to_string(),
            html_url: None,
            body: Some("- Windows external browser OAuth".to_string()),
            draft: false,
            prerelease: false,
            assets: vec![GitHubReleaseAsset {
                name: "Cadence-v1.0.1-windows-x64-setup.exe".to_string(),
                browser_download_url: "https://example.com/setup.exe".to_string(),
            }],
        },
    ];

    assert!(!is_windows_release(&releases[0]));
    assert!(is_windows_release(&releases[1]));
    let latest_win = select_latest_windows_release(&releases).unwrap();
    assert_eq!(normalize_version_name(&latest_win.tag_name), "1.0.1");

    let deep = parse_cadence_deep_link("cadence://auth?status=success").unwrap();
    assert_eq!(deep.host, "auth");
    assert_eq!(deep.status.as_deref(), Some("success"));
}
