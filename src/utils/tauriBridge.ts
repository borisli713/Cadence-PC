import type {
  DashboardKpis,
  ExternalOAuthResult,
  FairnessArrangementItem,
  FairnessScoreBreakdown,
  GeneratedShiftSpec,
  NotificationWorkPayload,
  OpenShiftAssignmentItem,
  ScheduleChangeRequest,
  ScheduleChangeType,
  Shift,
  ShiftReport,
  ShiftSubmission,
  StaffChartRow,
  StaffDirectoryEntry,
  TimeOffRequest,
  UpdateCheckResult,
  ValidationOutcome,
  WeekSlotConfig,
} from '../types/cadence';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriDesktop(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.__TAURI_INTERNALS__ !== 'undefined'
  );
}

async function tauriInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

async function tryInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  if (!isTauriDesktop()) return null;
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch {
    return null;
  }
}

export async function getDesktopAppVersion(): Promise<string> {
  return (await tryInvoke<string>('get_app_version')) ?? '1.0.0';
}

export async function invokeStartExternalGoogleLogin(): Promise<ExternalOAuthResult> {
  if (!isTauriDesktop()) {
    throw new Error('External browser OAuth bridge requires the desktop app.');
  }
  return tauriInvoke<ExternalOAuthResult>('start_external_google_login_cmd');
}

export async function invokeCancelExternalGoogleLogin(): Promise<void> {
  await tryInvoke<void>('cancel_external_google_login_cmd');
}

export const invokeBuildFairnessPlan = (
  shifts: Shift[],
  staffDirectory: StaffDirectoryEntry[],
  timeOffRequests: TimeOffRequest[],
) =>
  tryInvoke<FairnessArrangementItem[]>('build_fairness_plan_cmd', {
    shifts,
    staffDirectory,
    timeOffRequests,
  });

export const invokeBuildOpenShiftPlan = (
  shifts: Shift[],
  staffDirectory: StaffDirectoryEntry[],
  submissions: ShiftSubmission[],
  timeOffRequests: TimeOffRequest[],
  requireExplicitSubmission: boolean,
) =>
  tryInvoke<OpenShiftAssignmentItem[]>('build_open_shift_plan_cmd', {
    shifts,
    staffDirectory,
    submissions,
    timeOffRequests,
    requireExplicitSubmission,
  });

export const invokeGenerateWeeklySchedule = (
  weekStartDate: string,
  slots: WeekSlotConfig[],
  staffDirectory: StaffDirectoryEntry[],
  existingShifts: Shift[],
  submissions: ShiftSubmission[],
  timeOffRequests: TimeOffRequest[],
) =>
  tryInvoke<GeneratedShiftSpec[]>('generate_weekly_schedule_cmd', {
    weekStartDate,
    slots,
    staffDirectory,
    existingShifts,
    submissions,
    timeOffRequests,
  });

export const invokeRankCandidates = (
  candidateUids: string[],
  staffDirectory: StaffDirectoryEntry[],
  allShifts: Shift[],
  targetDate: string,
  startTime: string,
  endTime: string,
  excludeShiftId: string | null,
  timeOffRequests: TimeOffRequest[],
) =>
  tryInvoke<FairnessScoreBreakdown[]>('rank_candidates_cmd', {
    candidateUids,
    staffDirectory,
    allShifts,
    targetDate,
    startTime,
    endTime,
    excludeShiftId,
    timeOffRequests,
  });

export const invokeComputeDashboardKpis = (
  uid: string,
  weeklyHoursTarget: number,
  shifts: Shift[],
  scheduleChangesPending: number,
  timeOffRequests: TimeOffRequest[],
  staffDirectory: StaffDirectoryEntry[],
) =>
  tryInvoke<DashboardKpis>('compute_dashboard_kpis_cmd', {
    uid,
    weeklyHoursTarget,
    shifts,
    scheduleChangesPending,
    timeOffRequests,
    staffDirectory,
  });

export const invokeComputeStaffChart = (
  staffDirectory: StaffDirectoryEntry[],
  shifts: Shift[],
) =>
  tryInvoke<StaffChartRow[]>('compute_staff_chart_cmd', {
    staffDirectory,
    shifts,
  });

export const invokeValidateShift = (
  title: string,
  department: string,
  date: string,
  startTime: string,
  endTime: string,
) =>
  tryInvoke<ValidationOutcome>('validate_shift_cmd', {
    title,
    department,
    date,
    startTime,
    endTime,
  });

export const invokeValidateShiftReport = (
  shiftTitle: string,
  department: string,
  date: string,
  actualStartTime: string,
  actualEndTime: string,
  breakMinutes: number,
) =>
  tryInvoke<ValidationOutcome>('validate_shift_report_cmd', {
    shiftTitle,
    department,
    date,
    actualStartTime,
    actualEndTime,
    breakMinutes,
  });

export const invokeValidateTimeOff = (
  startDate: string,
  endDate: string,
  reason: string,
) =>
  tryInvoke<ValidationOutcome>('validate_time_off_cmd', {
    startDate,
    endDate,
    reason,
  });

export const invokeValidateScheduleChange = (
  shift: Shift,
  requesterUid: string,
  isManager: boolean,
  requestType: ScheduleChangeType,
  proposedDate: string,
  proposedStartTime: string,
  proposedEndTime: string,
  proposedAssigneeUid: string,
  reason: string,
) =>
  tryInvoke<ValidationOutcome>('validate_schedule_change_cmd', {
    shift,
    requesterUid,
    isManager,
    requestType,
    proposedDate,
    proposedStartTime,
    proposedEndTime,
    proposedAssigneeUid,
    reason,
  });

export const invokeBuildManagerWorkPayloads = (
  managerUid: string,
  scheduleChanges: ScheduleChangeRequest[],
  timeOffRequests: TimeOffRequest[],
  shiftReports: ShiftReport[],
) =>
  tryInvoke<NotificationWorkPayload[]>('build_manager_work_payloads_cmd', {
    managerUid,
    scheduleChanges,
    timeOffRequests,
    shiftReports,
  });

export async function invokeSaveIcsFile(
  shifts: Shift[],
  defaultFilename = 'cadence-shifts.ics',
): Promise<string | null | undefined> {
  if (!isTauriDesktop()) return undefined;
  return tauriInvoke<string | null>('save_ics_file_cmd', {
    shifts,
    defaultFilename,
  });
}

export const invokeSaveReportsCsv = async (
  reports: ShiftReport[],
  defaultFilename = 'cadence-shift-reports.csv',
): Promise<string | null | undefined> => {
  if (!isTauriDesktop()) return undefined;
  return tauriInvoke<string | null>('save_reports_csv_cmd', {
    reports,
    defaultFilename,
  });
};

export const invokeSaveTeamHoursCsv = async (
  staffDirectory: StaffDirectoryEntry[],
  shifts: Shift[],
  defaultFilename = 'cadence-team-hours.csv',
): Promise<string | null | undefined> => {
  if (!isTauriDesktop()) return undefined;
  return tauriInvoke<string | null>('save_team_hours_csv_cmd', {
    staffDirectory,
    shifts,
    defaultFilename,
  });
};

export const invokeFilterShiftHistory = (
  changes: ScheduleChangeRequest[],
  filter: 'all' | 'approved' | 'rejected',
  searchQuery: string,
) =>
  tryInvoke<{
    items: ScheduleChangeRequest[];
    totalResolved: number;
    approvedCount: number;
    rejectedCount: number;
  }>('filter_shift_history_cmd', { changes, filter, searchQuery });

export const invokeBuildSampleWorkspace = (
  managerUid: string,
  managerName: string,
) =>
  tryInvoke<{
    roster: StaffDirectoryEntry[];
    shifts: Shift[];
    scheduleChanges: ScheduleChangeRequest[];
    shiftReports: ShiftReport[];
    shiftSubmissions: ShiftSubmission[];
    timeOffRequests: TimeOffRequest[];
  }>('build_sample_workspace_cmd', { managerUid, managerName });

export async function invokeNativeNotification(
  title: string,
  body: string,
): Promise<boolean> {
  if (!isTauriDesktop()) return false;
  try {
    await tauriInvoke<void>('send_native_notification_cmd', { title, body });
    return true;
  } catch {
    return false;
  }
}

export const invokeCheckGitHubUpdate = () =>
  tryInvoke<UpdateCheckResult>('check_github_update_cmd');

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriDesktop()) {
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(url);
      return;
    } catch {
      // Fallback to anchor link below
    }
  }
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}
