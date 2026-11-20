import type {
  FairnessArrangementItem,
  FairnessScoreBreakdown,
  GeneratedShiftSpec,
  OpenShiftAssignmentItem,
  Shift,
  ShiftSubmission,
  StaffDirectoryEntry,
  TimeOffRequest,
  UpdateCheckResult,
  WeekSlotConfig,
} from '../types/cadence';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriDesktop(): boolean {
  return typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__ !== 'undefined';
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export async function getDesktopAppVersion(): Promise<string> {
  if (!isTauriDesktop()) return '1.0.0';
  try {
    return await tauriInvoke<string>('get_app_version');
  } catch {
    return '1.0.0';
  }
}

export async function invokeBuildFairnessPlan(
  shifts: Shift[],
  staffDirectory: StaffDirectoryEntry[],
  timeOffRequests: TimeOffRequest[],
): Promise<FairnessArrangementItem[] | null> {
  if (!isTauriDesktop()) return null;
  try {
    return await tauriInvoke<FairnessArrangementItem[]>('build_fairness_plan_cmd', {
      shifts,
      staffDirectory,
      timeOffRequests,
    });
  } catch {
    return null;
  }
}

export async function invokeBuildOpenShiftPlan(
  shifts: Shift[],
  staffDirectory: StaffDirectoryEntry[],
  submissions: ShiftSubmission[],
  timeOffRequests: TimeOffRequest[],
  requireExplicitSubmission: boolean,
): Promise<OpenShiftAssignmentItem[] | null> {
  if (!isTauriDesktop()) return null;
  try {
    return await tauriInvoke<OpenShiftAssignmentItem[]>('build_open_shift_plan_cmd', {
      shifts,
      staffDirectory,
      submissions,
      timeOffRequests,
      requireExplicitSubmission,
    });
  } catch {
    return null;
  }
}

export async function invokeGenerateWeeklySchedule(
  weekStartDate: string,
  slots: WeekSlotConfig[],
  staffDirectory: StaffDirectoryEntry[],
  existingShifts: Shift[],
  submissions: ShiftSubmission[],
  timeOffRequests: TimeOffRequest[],
): Promise<GeneratedShiftSpec[] | null> {
  if (!isTauriDesktop()) return null;
  try {
    return await tauriInvoke<GeneratedShiftSpec[]>('generate_weekly_schedule_cmd', {
      weekStartDate,
      slots,
      staffDirectory,
      existingShifts,
      submissions,
      timeOffRequests,
    });
  } catch {
    return null;
  }
}

export async function invokeRankCandidates(
  candidateUids: string[],
  staffDirectory: StaffDirectoryEntry[],
  allShifts: Shift[],
  targetDate: string,
  startTime: string,
  endTime: string,
  excludeShiftId: string | null,
  timeOffRequests: TimeOffRequest[],
): Promise<FairnessScoreBreakdown[] | null> {
  if (!isTauriDesktop()) return null;
  try {
    return await tauriInvoke<FairnessScoreBreakdown[]>('rank_candidates_cmd', {
      candidateUids,
      staffDirectory,
      allShifts,
      targetDate,
      startTime,
      endTime,
      excludeShiftId,
      timeOffRequests,
    });
  } catch {
    return null;
  }
}

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

export async function invokeNativeNotification(title: string, body: string): Promise<boolean> {
  if (!isTauriDesktop()) return false;
  try {
    await tauriInvoke<void>('send_native_notification_cmd', { title, body });
    return true;
  } catch {
    return false;
  }
}

export async function invokeCheckGitHubUpdate(): Promise<UpdateCheckResult | null> {
  if (!isTauriDesktop()) return null;
  try {
    return await tauriInvoke<UpdateCheckResult>('check_github_update_cmd');
  } catch {
    return null;
  }
}

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
