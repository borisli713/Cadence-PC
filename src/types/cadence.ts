import type { Timestamp } from 'firebase/firestore';

export enum UserRole {
  STAFF = 'staff',
  MANAGER = 'manager',
}

export enum ShiftStatus {
  SCHEDULED = 'scheduled',
  OPEN = 'open',
  COMPLETED = 'completed',
  CONFLICT = 'conflict',
  PENDING_CHANGE = 'pending_change',
}

export enum ScheduleChangeType {
  TIME_CHANGE = 'time_change',
  SWAP = 'swap',
  DROP = 'drop',
  CLAIM = 'claim',
}

export enum ApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  DENIED = 'denied',
}

export enum ShiftReportStatus {
  SUBMITTED = 'submitted',
  VERIFIED = 'verified',
  FLAGGED = 'flagged',
}

export enum NotificationCategory {
  SHIFT_APPROVED = 'shift_approved',
  SHIFT_DENIED = 'shift_denied',
  FAIRNESS_REBALANCED = 'fairness_rebalanced',
  REPORT_VERIFIED = 'report_verified',
  SHIFT_ASSIGNED = 'shift_assigned',
  TIME_OFF_APPROVED = 'time_off_approved',
  TIME_OFF_DENIED = 'time_off_denied',
}

export enum SubmissionStatus {
  SUBMITTED = 'submitted',
  WITHDRAWN = 'withdrawn',
}

export enum CadenceTab {
  OVERVIEW = 'overview',
  MY_SCHEDULE = 'my_schedule',
  SCHEDULE = 'schedule',
  REPORTS = 'reports',
  APPROVALS = 'approvals',
  HISTORY = 'history',
  TEAM = 'team',
  TIME_OFF = 'time_off',
  NOTIFICATIONS = 'notifications',
}

export const SHIFT_STATUS_LABEL: Record<ShiftStatus, string> = {
  [ShiftStatus.SCHEDULED]: 'Scheduled',
  [ShiftStatus.OPEN]: 'Open / Blank',
  [ShiftStatus.COMPLETED]: 'Completed',
  [ShiftStatus.CONFLICT]: 'Overlap Conflict',
  [ShiftStatus.PENDING_CHANGE]: 'Pending Change',
};

export const SCHEDULE_CHANGE_TYPE_LABEL: Record<ScheduleChangeType, string> = {
  [ScheduleChangeType.TIME_CHANGE]: 'Time Change',
  [ScheduleChangeType.SWAP]: 'Swap Assignee',
  [ScheduleChangeType.DROP]: 'Drop Shift',
  [ScheduleChangeType.CLAIM]: 'Claim Open Shift',
};

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  [ApprovalStatus.PENDING]: 'Pending',
  [ApprovalStatus.APPROVED]: 'Approved',
  [ApprovalStatus.DENIED]: 'Denied',
};

export const SHIFT_REPORT_STATUS_LABEL: Record<ShiftReportStatus, string> = {
  [ShiftReportStatus.SUBMITTED]: 'Submitted',
  [ShiftReportStatus.VERIFIED]: 'Verified',
  [ShiftReportStatus.FLAGGED]: 'Flagged',
};

export const NOTIFICATION_CATEGORY_LABEL: Record<NotificationCategory, string> = {
  [NotificationCategory.SHIFT_APPROVED]: 'Approved',
  [NotificationCategory.SHIFT_DENIED]: 'Denied',
  [NotificationCategory.FAIRNESS_REBALANCED]: 'Fairness Rebalance',
  [NotificationCategory.REPORT_VERIFIED]: 'Report Verified',
  [NotificationCategory.SHIFT_ASSIGNED]: 'Shift Assigned',
  [NotificationCategory.TIME_OFF_APPROVED]: 'Time Off Approved',
  [NotificationCategory.TIME_OFF_DENIED]: 'Time Off Denied',
};

export const SUBMISSION_STATUS_LABEL: Record<SubmissionStatus, string> = {
  [SubmissionStatus.SUBMITTED]: 'Submitted',
  [SubmissionStatus.WITHDRAWN]: 'Withdrawn',
};

export const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_PATTERN = /^\d{2}:\d{2}$/;

export const MAX_LEN = {
  displayName: 80,
  department: 60,
  title: 120,
  fairnessNote: 300,
  reason: 400,
  reviewNote: 300,
  handoffNotes: 600,
  notes: 300,
  notifTitle: 120,
  notifMessage: 400,
} as const;

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  department: string;
  weeklyHoursTarget: number;
  pushNotificationsEnabled: boolean;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface StaffDirectoryEntry {
  uid: string;
  displayName: string;
  role: UserRole;
  department: string;
  totalHoursWorked: number;
  scheduledHoursThisWeek: number;
  weeklyHoursTarget: number;
  lastAssignedAt: string;
  isSampleRoster: boolean;
  updatedAt: Timestamp | null;
}

export interface Shift {
  id: string;
  title: string;
  department: string;
  date: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  assignedUid: string;
  assignedName: string;
  candidateUids: string[];
  status: ShiftStatus;
  visibility: string;
  fairnessNote: string;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface ScheduleChangeRequest {
  id: string;
  shiftId: string;
  shiftTitle: string;
  requesterUid: string;
  requesterName: string;
  type: ScheduleChangeType;
  currentDate: string;
  currentStartTime: string;
  currentEndTime: string;
  proposedDate: string;
  proposedStartTime: string;
  proposedEndTime: string;
  proposedAssigneeUid: string;
  proposedAssigneeName: string;
  reason: string;
  status: ApprovalStatus;
  reviewedByUid: string;
  reviewedByName: string;
  reviewNote: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface ShiftReport {
  id: string;
  shiftId: string;
  shiftTitle: string;
  staffUid: string;
  staffName: string;
  department: string;
  date: string;
  actualStartTime: string;
  actualEndTime: string;
  breakMinutes: number;
  workedHours: number;
  handoffNotes: string;
  status: ShiftReportStatus;
  verifiedByUid: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface PushNotificationRecord {
  id: string;
  recipientUid: string;
  title: string;
  message: string;
  category: NotificationCategory;
  relatedShiftId: string;
  isRead: boolean;
  actorUid: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface ShiftSubmission {
  id: string;
  staffUid: string;
  staffName: string;
  department: string;
  date: string;
  startTime: string;
  endTime: string;
  shiftTitle: string;
  notes: string;
  status: SubmissionStatus;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface TimeOffRequest {
  id: string;
  staffUid: string;
  staffName: string;
  department: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: ApprovalStatus;
  reviewedByUid: string;
  reviewedByName: string;
  reviewNote: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface WeekSlotConfig {
  id: string;
  label: string;
  title: string;
  department: string;
  startTime: string;
  endTime: string;
}

export interface FairnessScoreBreakdown {
  uid: string;
  displayName: string;
  department: string;
  totalHoursWorked: number;
  scheduledHoursThisWeek: number;
  weeklyHoursTarget: number;
  utilizationRatio: number;
  shiftsThisWeekCount: number;
  lastAssignedAt: string;
  hasConflict: boolean;
  hasApprovedTimeOff: boolean;
  timeOffReason: string | null;
}

export interface FairnessArrangementItem {
  shift: Shift;
  previousUid: string;
  previousName: string;
  chosenUid: string;
  chosenName: string;
  reason: string;
}

export interface OpenShiftAssignmentItem {
  shift: Shift;
  chosenUid: string;
  chosenName: string;
  reason: string;
}

export interface GeneratedShiftSpec {
  title: string;
  department: string;
  date: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  assignedUid: string;
  assignedName: string;
  candidateUids: string[];
  status: ShiftStatus;
  fairnessNote: string;
}

export interface RemoteReleaseInfo {
  versionName: string;
  releaseNotes: string;
  downloadPageUrl: string;
  windowsAssetUrl: string | null;
  windowsAssetName: string | null;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latest: RemoteReleaseInfo;
  updateAvailable: boolean;
}

export interface WorkspaceUiData {
  profile: UserProfile;
  staffDirectory: StaffDirectoryEntry[];
  shifts: Shift[];
  scheduleChanges: ScheduleChangeRequest[];
  shiftReports: ShiftReport[];
  shiftSubmissions: ShiftSubmission[];
  timeOffRequests: TimeOffRequest[];
  notifications: PushNotificationRecord[];
  streamError: string | null;
}

export type ProfileUiState =
  | { status: 'loading' }
  | { status: 'ready'; profile: UserProfile }
  | { status: 'error'; message: string };

export function parseUserRole(raw: unknown): UserRole {
  return raw === UserRole.MANAGER ? UserRole.MANAGER : UserRole.STAFF;
}

export function parseShiftStatus(raw: unknown): ShiftStatus {
  const values = Object.values(ShiftStatus) as string[];
  return typeof raw === 'string' && values.includes(raw)
    ? (raw as ShiftStatus)
    : ShiftStatus.SCHEDULED;
}

export function parseScheduleChangeType(raw: unknown): ScheduleChangeType {
  const values = Object.values(ScheduleChangeType) as string[];
  return typeof raw === 'string' && values.includes(raw)
    ? (raw as ScheduleChangeType)
    : ScheduleChangeType.TIME_CHANGE;
}

export function parseApprovalStatus(raw: unknown): ApprovalStatus {
  const values = Object.values(ApprovalStatus) as string[];
  return typeof raw === 'string' && values.includes(raw)
    ? (raw as ApprovalStatus)
    : ApprovalStatus.PENDING;
}

export function parseShiftReportStatus(raw: unknown): ShiftReportStatus {
  const values = Object.values(ShiftReportStatus) as string[];
  return typeof raw === 'string' && values.includes(raw)
    ? (raw as ShiftReportStatus)
    : ShiftReportStatus.SUBMITTED;
}

export function parseNotificationCategory(raw: unknown): NotificationCategory {
  const values = Object.values(NotificationCategory) as string[];
  return typeof raw === 'string' && values.includes(raw)
    ? (raw as NotificationCategory)
    : NotificationCategory.SHIFT_ASSIGNED;
}

export function parseSubmissionStatus(raw: unknown): SubmissionStatus {
  const values = Object.values(SubmissionStatus) as string[];
  return typeof raw === 'string' && values.includes(raw)
    ? (raw as SubmissionStatus)
    : SubmissionStatus.SUBMITTED;
}
