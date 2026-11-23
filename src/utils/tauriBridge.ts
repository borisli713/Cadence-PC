import type {
  ApprovalStatus,
  ConflictReportItem,
  DashboardKpis,
  DepartmentCoverageSummary,
  DerivedWorkspaceInsights,
  DesktopRuntimeInfo,
  ExternalOAuthResult,
  FairnessArrangementItem,
  FairnessScoreBreakdown,
  GeneratedShiftSpec,
  NotificationWorkPayload,
  OpenShiftAssignmentItem,
  PushNotificationRecord,
  ScheduleChangeRequest,
  ScheduleChangeType,
  Shift,
  ShiftReport,
  ShiftReportStatus,
  ShiftStatus,
  ShiftSubmission,
  StaffChartRow,
  StaffDirectoryEntry,
  TeamRosterStats,
  TimeOffRequest,
  UpdateCheckResult,
  UserProfile,
  UserRole,
  ValidationOutcome,
  WeekSlotConfig,
  WeeklyScheduleCommitResult,
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
  return (await tryInvoke<string>('get_app_version')) ?? '1.1.0';
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

export const invokeDetectScheduleConflicts = (
  shifts: Shift[],
  timeOffRequests: TimeOffRequest[],
) =>
  tryInvoke<ConflictReportItem[]>('detect_schedule_conflicts_cmd', {
    shifts,
    timeOffRequests,
  });

export const invokeSummarizeDepartmentCoverage = (shifts: Shift[]) =>
  tryInvoke<DepartmentCoverageSummary[]>('summarize_department_coverage_cmd', {
    shifts,
  });

export const invokeComputeTeamRosterStats = (
  staffDirectory: StaffDirectoryEntry[],
) =>
  tryInvoke<TeamRosterStats>('compute_team_roster_stats_cmd', {
    staffDirectory,
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

export const invokeGenerateIcs = (shifts: Shift[]) =>
  tryInvoke<string>('generate_ics_cmd', { shifts });

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

export const invokeSyncWorkspaceSnapshot = (snapshot: {
  profile: UserProfile | null;
  staffDirectory: StaffDirectoryEntry[];
  shifts: Shift[];
  scheduleChanges: ScheduleChangeRequest[];
  shiftReports: ShiftReport[];
  shiftSubmissions: ShiftSubmission[];
  timeOffRequests: TimeOffRequest[];
  notifications: PushNotificationRecord[];
}) =>
  tryInvoke<DerivedWorkspaceInsights>('sync_workspace_snapshot_cmd', {
    snapshot,
  });

export const invokeGetWorkspaceInsights = () =>
  tryInvoke<DerivedWorkspaceInsights>('get_workspace_insights_cmd');

export const invokeLoadWeekSlots = () =>
  tryInvoke<WeekSlotConfig[]>('load_week_slots_cmd');

export const invokeSaveWeekSlots = (slots: WeekSlotConfig[]) =>
  isTauriDesktop()
    ? tauriInvoke<WeekSlotConfig[]>('save_week_slots_cmd', { slots })
    : Promise.resolve(slots);

export const invokeFilterUnnotifiedAlerts = (
  uid: string,
  notifications: PushNotificationRecord[],
  pushEnabled: boolean,
) =>
  tryInvoke<PushNotificationRecord[]>('filter_unnotified_alerts_cmd', {
    uid,
    notifications,
    pushEnabled,
  });

export const invokeFilterNewManagerWorkAlerts = (
  uid: string,
  items: NotificationWorkPayload[],
  pushEnabled: boolean,
) =>
  tryInvoke<NotificationWorkPayload[]>('filter_new_manager_work_alerts_cmd', {
    uid,
    items,
    pushEnabled,
  });

export const invokeGetDesktopRuntimeInfo = () =>
  tryInvoke<DesktopRuntimeInfo>('get_desktop_runtime_info_cmd');

export const invokeAnalyzeWorkforceCompliance = (
  minRestHours?: number,
  maxDailyHours?: number,
) =>
  tryInvoke<{
    minRestHours: number;
    maxDailyHours: number;
    totalViolations: number;
    criticalCount: number;
    warningCount: number;
  }>('analyze_workforce_compliance_cmd', { minRestHours, maxDailyHours });

export const invokeReconcileWorkspaceSync = () =>
  tryInvoke<{
    projectId: string;
    firestoreDatabaseId: string;
    isSyncedTargetValid: boolean;
    totalStaffChecked: number;
    totalShiftsChecked: number;
    healthy: boolean;
  }>('reconcile_workspace_sync_cmd');

export const invokeRepairScheduledHoursDrift = (
  idToken: string,
  staffDirectory: StaffDirectoryEntry[],
  shifts: Shift[],
) =>
  isTauriDesktop()
    ? tauriInvoke<number>('repair_scheduled_hours_drift_cmd', {
        idToken,
        staffDirectory,
        shifts,
      })
    : Promise.resolve(0);

export const invokeSavePayrollSummary = async (
  periodLabel = 'Active Workspace',
  defaultFilename = 'cadence-payroll-summary.html',
): Promise<string | null | undefined> => {
  if (!isTauriDesktop()) return undefined;
  return tauriInvoke<string | null>('save_payroll_summary_cmd', {
    periodLabel,
    defaultFilename,
  });
};

export interface OfflineMutationInput {
  kind: 'set' | 'update_mask' | 'delete';
  collection: string;
  docId: string;
  fields?: Record<string, unknown>;
  maskPaths?: string[];
  serverTimestampFields?: string[];
  requireExists?: boolean;
  requireNotExists?: boolean;
  description?: string;
}

export interface QueuedFirestoreMutation extends OfflineMutationInput {
  mutationId: string;
  queuedAtEpochMs: number;
  retryCount: number;
  lastError?: string | null;
}

export interface OfflineQueueSummary {
  pendingCount: number;
  totalRetries: number;
  oldestQueuedEpochMs?: number | null;
  items: QueuedFirestoreMutation[];
}

export interface FlushOfflineQueueResult {
  flushedCount: number;
  remainingCount: number;
  batchesCommitted: number;
  lastError?: string | null;
}

export const invokeQueueOfflineMutation = (input: OfflineMutationInput) =>
  tauriInvoke<QueuedFirestoreMutation>('queue_offline_mutation_cmd', { input });

export const invokeListOfflineMutations = () =>
  tryInvoke<OfflineQueueSummary>('list_offline_mutations_cmd');

export const invokeClearOfflineMutation = (mutationId: string) =>
  tryInvoke<boolean>('clear_offline_mutation_cmd', { mutationId });

export const invokeFlushOfflineMutations = (idToken: string) =>
  tauriInvoke<FlushOfflineQueueResult>('flush_offline_mutations_cmd', { idToken });

export interface ShiftRotationTemplate {
  id: string;
  name: string;
  description: string;
  activeDaysPerWeek: number;
  slots: WeekSlotConfig[];
  isBuiltin: boolean;
}

export interface TemplateCapacityProjection {
  templateId: string;
  templateName: string;
  slotsPerDay: number;
  weeklyShiftsCount: number;
  requiredWeeklyHours: number;
  teamWeeklyCapacityHours: number;
  coverageRatioPercent: number;
  deficitOrSurplusHours: number;
  sustainable: boolean;
}

export const invokeListShiftTemplates = () =>
  tryInvoke<ShiftRotationTemplate[]>('list_shift_templates_cmd');

export const invokeSaveShiftTemplate = (template: ShiftRotationTemplate) =>
  tauriInvoke<ShiftRotationTemplate[]>('save_shift_template_cmd', { template });

export const invokeDeleteShiftTemplate = (templateId: string) =>
  tauriInvoke<boolean>('delete_shift_template_cmd', { templateId });

export const invokeProjectTemplateCapacity = (
  template: ShiftRotationTemplate,
  staffDirectory: StaffDirectoryEntry[],
) =>
  tryInvoke<TemplateCapacityProjection>('project_template_capacity_cmd', {
    template,
    staffDirectory,
  });

export const invokeVerifyAuditChain = () =>
  tryInvoke<boolean>('verify_audit_chain_cmd');

export const invokeExportAuditLog = async (
  defaultFilename = 'cadence-audit-log.md',
): Promise<string | null | undefined> => {
  if (!isTauriDesktop()) return undefined;
  return tauriInvoke<string | null>('export_audit_log_cmd', { defaultFilename });
};

export interface CalendarDayCell {
  date: string;
  dayOfMonth: number;
  isCurrentMonth: boolean;
  totalShifts: number;
  scheduledCount: number;
  openCount: number;
  conflictCount: number;
  completedCount: number;
}

export interface WeeklyCoverageDay {
  date: string;
  weekdayLabel: string;
  totalShifts: number;
  assignedShifts: number;
  openShifts: number;
  conflictShifts: number;
  scheduledHours: number;
}

export const invokeBuildMonthCalendarGrid = (year: number, month: number) =>
  tryInvoke<CalendarDayCell[]>('build_month_calendar_grid_cmd', { year, month });

export const invokeBuildWeeklyCoverageMatrix = (mondayIso: string) =>
  tryInvoke<WeeklyCoverageDay[]>('build_weekly_coverage_matrix_cmd', { mondayIso });

export const invokeExportWorkspaceBackup = async (
  defaultFilename = 'cadence-workspace-backup.json',
): Promise<string | null | undefined> => {
  if (!isTauriDesktop()) return undefined;
  return tauriInvoke<string | null>('export_workspace_backup_cmd', { defaultFilename });
};

export interface PayrollPolicyConfig {
  weeklyOvertimeThreshold: number;
  baseHourlyRate: number;
  overtimeMultiplier: number;
  nightDifferentialBonus: number;
  weekendDifferentialBonus: number;
}

export interface StaffPayrollLine {
  uid: string;
  displayName: string;
  department: string;
  regularHours: number;
  overtimeHours: number;
  nightHours: number;
  weekendHours: number;
  totalCreditHours: number;
  estimatedGrossPay: number;
}

export const invokeComputePayrollBreakdown = (policy?: PayrollPolicyConfig) =>
  tryInvoke<{
    totalRegularHours: number;
    totalOvertimeHours: number;
    totalNightHours: number;
    totalWeekendHours: number;
    totalEstimatedPayroll: number;
    staffLines: StaffPayrollLine[];
  }>('compute_payroll_breakdown_cmd', { policy });

// --- Rust Native Firestore REST Commit Repository Commands ---

export const invokeRepoEnsureVerifiedUserProvisioned = (params: {
  idToken: string;
  uid: string;
  email: string;
  displayName: string;
}) => tauriInvoke<UserProfile>('repo_ensure_verified_user_provisioned_cmd', params);

export const invokeRepoUpdateUserPreferences = (params: {
  idToken: string;
  actorUid: string;
  uid: string;
  displayName: string;
  department: string;
  weeklyHoursTarget: number;
  pushNotificationsEnabled: boolean;
}) => tauriInvoke<void>('repo_update_user_preferences_cmd', params);

export const invokeRepoCreateShift = (params: {
  idToken: string;
  actorUid: string;
  title: string;
  department: string;
  date: string;
  startTime: string;
  endTime: string;
  assignedUid: string;
  assignedName: string;
  candidateUids: string[];
  status: ShiftStatus;
  fairnessNote: string;
  createdBy: string;
}) => tauriInvoke<string>('repo_create_shift_cmd', params);

export const invokeRepoUpdateShift = (params: {
  idToken: string;
  actorUid: string;
  shiftId: string;
  title: string;
  department: string;
  date: string;
  startTime: string;
  endTime: string;
  assignedUid: string;
  assignedName: string;
  status: ShiftStatus;
  fairnessNote: string;
}) => tauriInvoke<void>('repo_update_shift_cmd', params);

export const invokeRepoDeleteShift = (params: {
  idToken: string;
  shiftId: string;
}) => tauriInvoke<void>('repo_delete_shift_cmd', params);

export const invokeRepoSubmitScheduleChange = (params: {
  idToken: string;
  shift: Shift;
  requesterUid: string;
  requesterName: string;
  isManager: boolean;
  requestType: ScheduleChangeType;
  proposedDate: string;
  proposedStartTime: string;
  proposedEndTime: string;
  proposedAssigneeUid: string;
  proposedAssigneeName: string;
  reason: string;
}) => tauriInvoke<string>('repo_submit_schedule_change_cmd', params);

export const invokeRepoDecideScheduleChange = (params: {
  idToken: string;
  req: ScheduleChangeRequest;
  linkedShift: Shift | null;
  decision: ApprovalStatus;
  reviewerUid: string;
  reviewerName: string;
  reviewNote: string;
}) => tauriInvoke<void>('repo_decide_schedule_change_cmd', params);

export const invokeRepoAcceptAllPending = (params: {
  idToken: string;
  pendingRequests: ScheduleChangeRequest[];
  shifts: Shift[];
  reviewerUid: string;
  reviewerName: string;
}) => tauriInvoke<number>('repo_accept_all_pending_cmd', params);

export const invokeRepoSubmitShiftReport = (params: {
  idToken: string;
  shiftId: string;
  shiftTitle: string;
  staffUid: string;
  staffName: string;
  department: string;
  date: string;
  actualStartTime: string;
  actualEndTime: string;
  breakMinutes: number;
  handoffNotes: string;
}) => tauriInvoke<string>('repo_submit_shift_report_cmd', params);

export const invokeRepoVerifyOrFlagReport = (params: {
  idToken: string;
  report: ShiftReport;
  status: ShiftReportStatus;
  verifierUid: string;
  staffEntry: StaffDirectoryEntry | null;
  linkedShift: Shift | null;
}) => tauriInvoke<void>('repo_verify_or_flag_report_cmd', params);

export const invokeRepoMarkNotificationRead = (params: {
  idToken: string;
  notificationId: string;
  isRead: boolean;
}) => tauriInvoke<void>('repo_mark_notification_read_cmd', params);

export const invokeRepoMarkAllNotificationsRead = (params: {
  idToken: string;
  notifications: PushNotificationRecord[];
}) => tauriInvoke<void>('repo_mark_all_notifications_read_cmd', params);

export const invokeRepoSendTestNotification = (params: {
  idToken: string;
  actorUid: string;
  recipientUid: string;
  displayName: string;
}) => tauriInvoke<void>('repo_send_test_notification_cmd', params);

export const invokeRepoCommitFairnessPlan = (params: {
  idToken: string;
  actorUid: string;
  shifts: Shift[];
  staffDirectory: StaffDirectoryEntry[];
  timeOffRequests: TimeOffRequest[];
}) => tauriInvoke<number>('repo_commit_fairness_plan_cmd', params);

export const invokeRepoCommitOpenShiftPlan = (params: {
  idToken: string;
  actorUid: string;
  shifts: Shift[];
  staffDirectory: StaffDirectoryEntry[];
  submissions: ShiftSubmission[];
  timeOffRequests: TimeOffRequest[];
  requireExplicitSubmission: boolean;
}) => tauriInvoke<number>('repo_commit_open_shift_plan_cmd', params);

export const invokeRepoGenerateWeeklySchedule = (params: {
  idToken: string;
  actorUid: string;
  mondayIso: string;
  slots: WeekSlotConfig[];
  staffDirectory: StaffDirectoryEntry[];
  existingShifts: Shift[];
  submissions: ShiftSubmission[];
  timeOffRequests: TimeOffRequest[];
}) =>
  tauriInvoke<WeeklyScheduleCommitResult>(
    'repo_generate_weekly_schedule_cmd',
    params,
  );

export const invokeRepoSubmitAvailabilityBatch = (params: {
  idToken: string;
  staffUid: string;
  staffName: string;
  department: string;
  dates: string[];
  startTime: string;
  endTime: string;
  shiftTitle: string;
  notes: string;
}) => tauriInvoke<number>('repo_submit_availability_batch_cmd', params);

export const invokeRepoWithdrawSubmission = (params: {
  idToken: string;
  submissionId: string;
}) => tauriInvoke<void>('repo_withdraw_submission_cmd', params);

export const invokeRepoCreateTimeOff = (params: {
  idToken: string;
  staffUid: string;
  staffName: string;
  department: string;
  startDate: string;
  endDate: string;
  reason: string;
}) => tauriInvoke<string>('repo_create_time_off_cmd', params);

export const invokeRepoWithdrawTimeOff = (params: {
  idToken: string;
  requestId: string;
}) => tauriInvoke<void>('repo_withdraw_time_off_cmd', params);

export const invokeRepoDecideTimeOff = (params: {
  idToken: string;
  req: TimeOffRequest;
  decision: ApprovalStatus;
  reviewerUid: string;
  reviewerName: string;
  reviewNote: string;
}) => tauriInvoke<void>('repo_decide_time_off_cmd', params);

export const invokeRepoAddRosterStaff = (params: {
  idToken: string;
  displayName: string;
  department: string;
  weeklyHoursTarget: number;
  role: UserRole;
}) => tauriInvoke<string>('repo_add_roster_staff_cmd', params);

export const invokeRepoToggleManagerRole = (params: {
  idToken: string;
  targetEntry: StaffDirectoryEntry;
  grantManager: boolean;
  actorUid: string;
}) => tauriInvoke<void>('repo_toggle_manager_role_cmd', params);

export const invokeRepoSeedSampleWorkspace = (params: {
  idToken: string;
  actorUid: string;
  actorName: string;
}) => tauriInvoke<void>('repo_seed_sample_workspace_cmd', params);

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

export interface RustLanguageOption {
  code: string;
  nativeLabel: string;
  labelKey: string;
  bcp47Tag: string;
}

export interface RustI18nBundlePayload {
  preference: string;
  resolvedLanguage: string;
  bcp47Tag: string;
  strings: Record<string, string>;
  fallbackStrings: Record<string, string>;
  supportedLanguages: RustLanguageOption[];
}

export const invokeGetI18nBundle = (
  preference?: string,
  clientHint?: string,
) =>
  tryInvoke<RustI18nBundlePayload>('get_i18n_bundle_cmd', {
    preference: preference ?? null,
    clientHint: clientHint ?? null,
  });

export const invokeSaveLanguagePreference = (
  language: string,
  clientHint?: string,
) =>
  tryInvoke<RustI18nBundlePayload>('save_language_preference_cmd', {
    language,
    clientHint: clientHint ?? null,
  });

