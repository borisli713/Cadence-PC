import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Query,
  type QueryDocumentSnapshot,
  type Unsubscribe,
  type WriteBatch,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import {
  buildFairnessArrangementPlan,
  buildOpenShiftAssignmentPlan,
  computeShiftHours,
  formatHours,
  generateWeeklyFairnessSchedule,
  getMondayIso,
  addDaysIso,
} from '../domain/fairnessEngine';
import {
  ApprovalStatus,
  FairnessArrangementItem,
  GeneratedShiftSpec,
  NotificationCategory,
  OpenShiftAssignmentItem,
  parseApprovalStatus,
  parseNotificationCategory,
  parseScheduleChangeType,
  parseShiftReportStatus,
  parseShiftStatus,
  parseSubmissionStatus,
  parseUserRole,
  PushNotificationRecord,
  ScheduleChangeRequest,
  ScheduleChangeType,
  Shift,
  ShiftReport,
  ShiftReportStatus,
  ShiftStatus,
  ShiftSubmission,
  StaffDirectoryEntry,
  SubmissionStatus,
  TimeOffRequest,
  UserProfile,
  UserRole,
  WeekSlotConfig,
} from '../types/cadence';
import {
  invokeRepoAcceptAllPending,
  invokeRepoAddRosterStaff,
  invokeRepoCommitFairnessPlan,
  invokeRepoCommitOpenShiftPlan,
  invokeRepoCreateShift,
  invokeRepoCreateTimeOff,
  invokeRepoDecideScheduleChange,
  invokeRepoDecideTimeOff,
  invokeRepoDeleteShift,
  invokeRepoEnsureVerifiedUserProvisioned,
  invokeRepoGenerateWeeklySchedule,
  invokeRepoMarkAllNotificationsRead,
  invokeRepoMarkNotificationRead,
  invokeRepoSeedSampleWorkspace,
  invokeRepoSendTestNotification,
  invokeRepoSubmitAvailabilityBatch,
  invokeRepoSubmitScheduleChange,
  invokeRepoSubmitShiftReport,
  invokeRepoToggleManagerRole,
  invokeRepoUpdateShift,
  invokeRepoUpdateUserPreferences,
  invokeRepoVerifyOrFlagReport,
  invokeRepoWithdrawSubmission,
  invokeRepoWithdrawTimeOff,
  isTauriDesktop,
} from '../utils/tauriBridge';

export const BOOTSTRAPPED_ADMIN_EMAIL = 'yatheili713@gmail.com';
const CHUNK_SIZE = 400;

function requireUserId(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('User must be signed in before accessing Firestore.');
  return uid;
}

async function requireDesktopToken(): Promise<{ uid: string; idToken: string } | null> {
  if (!isTauriDesktop()) return null;
  const current = auth.currentUser;
  if (!current) throw new Error('User must be signed in before accessing Firestore.');
  return { uid: current.uid, idToken: await current.getIdToken() };
}

function newId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
const asTimestamp = (v: unknown): Timestamp | null => (v instanceof Timestamp ? v : null);
const asString = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const asNumber = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const asBool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);
const tsSeconds = (ts: Timestamp | null): number => (ts ? ts.seconds : 0);

type BatchOp =
  | { kind: 'set'; ref: DocumentReference; data: Record<string, unknown> }
  | { kind: 'update'; ref: DocumentReference; data: Record<string, unknown> }
  | { kind: 'delete'; ref: DocumentReference };

function applyOp(batch: WriteBatch, op: BatchOp): void {
  if (op.kind === 'set') batch.set(op.ref, op.data);
  else if (op.kind === 'update') batch.update(op.ref, op.data);
  else batch.delete(op.ref);
}

async function commitOpsInChunks(
  ops: BatchOp[],
  errorOp: OperationType,
  errorPath: string,
): Promise<void> {
  if (ops.length === 0) return;
  try {
    for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
      const batch = writeBatch(db);
      for (const op of ops.slice(i, i + CHUNK_SIZE)) {
        applyOp(batch, op);
      }
      await batch.commit();
    }
  } catch (e) {
    handleFirestoreError(e, errorOp, errorPath);
  }
}

function makeNotificationOp(
  recipientUid: string,
  title: string,
  message: string,
  category: NotificationCategory,
  relatedShiftId: string,
  actorUid: string,
): BatchOp {
  const id = newId('ntf');
  return {
    kind: 'set',
    ref: doc(db, 'notifications', id),
    data: {
      id,
      recipientUid,
      title,
      message: message.slice(0, 400),
      category,
      relatedShiftId,
      isRead: false,
      actorUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
  };
}

function makeShiftData(params: {
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
  fairnessNote: string;
  createdBy: string;
  includeCreatedAt: boolean;
}): Record<string, unknown> {
  const isOpen = params.status === ShiftStatus.OPEN;
  const base: Record<string, unknown> = {
    title: (params.title.trim() || 'Assigned Shift').slice(0, 120),
    department: params.department.trim().slice(0, 60),
    date: params.date,
    startTime: params.startTime,
    endTime: params.endTime,
    durationHours: params.durationHours,
    assignedUid: isOpen ? '' : params.assignedUid,
    assignedName: isOpen ? '' : params.assignedName,
    status: params.status,
    fairnessNote: params.fairnessNote.slice(0, 300),
    updatedAt: serverTimestamp(),
  };
  if (params.includeCreatedAt) {
    base.id = params.id;
    base.candidateUids = params.candidateUids.slice(0, 20);
    base.visibility = 'team';
    base.createdBy = params.createdBy;
    base.createdAt = serverTimestamp();
  }
  return base;
}

function mapUserProfile(id: string, data: DocumentData | undefined): UserProfile | null {
  if (!data) return null;
  return {
    uid: asString(data.uid, id),
    email: asString(data.email),
    displayName: asString(data.displayName, 'Team Member'),
    role: parseUserRole(data.role),
    department: asString(data.department, 'Operations'),
    weeklyHoursTarget: asNumber(data.weeklyHoursTarget, 40),
    pushNotificationsEnabled: asBool(data.pushNotificationsEnabled, true),
    createdAt: asTimestamp(data.createdAt),
    updatedAt: asTimestamp(data.updatedAt),
  };
}

function mapStaffDirectoryEntry(docSnap: QueryDocumentSnapshot<DocumentData>): StaffDirectoryEntry {
  const data = docSnap.data();
  return {
    uid: asString(data.uid, docSnap.id),
    displayName: asString(data.displayName, 'Team Member'),
    role: parseUserRole(data.role),
    department: asString(data.department, 'Operations'),
    totalHoursWorked: asNumber(data.totalHoursWorked, 0),
    scheduledHoursThisWeek: asNumber(data.scheduledHoursThisWeek, 0),
    weeklyHoursTarget: asNumber(data.weeklyHoursTarget, 40),
    lastAssignedAt: asString(data.lastAssignedAt),
    isSampleRoster: asBool(data.isSampleRoster, false),
    updatedAt: asTimestamp(data.updatedAt),
  };
}

function mapShift(docSnap: QueryDocumentSnapshot<DocumentData>): Shift {
  const data = docSnap.data();
  return {
    id: asString(data.id, docSnap.id),
    title: asString(data.title, 'Shift'),
    department: asString(data.department, 'Operations'),
    date: asString(data.date),
    startTime: asString(data.startTime, '09:00'),
    endTime: asString(data.endTime, '17:00'),
    durationHours: asNumber(data.durationHours, 8),
    assignedUid: asString(data.assignedUid),
    assignedName: asString(data.assignedName),
    candidateUids: Array.isArray(data.candidateUids)
      ? data.candidateUids.filter((x): x is string => typeof x === 'string')
      : [],
    status: parseShiftStatus(data.status),
    visibility: asString(data.visibility, 'team'),
    fairnessNote: asString(data.fairnessNote),
    createdBy: asString(data.createdBy),
    createdAt: asTimestamp(data.createdAt),
    updatedAt: asTimestamp(data.updatedAt),
  };
}

function mapScheduleChange(docSnap: QueryDocumentSnapshot<DocumentData>): ScheduleChangeRequest {
  const data = docSnap.data();
  return {
    id: asString(data.id, docSnap.id),
    shiftId: asString(data.shiftId),
    shiftTitle: asString(data.shiftTitle, 'Shift'),
    requesterUid: asString(data.requesterUid),
    requesterName: asString(data.requesterName),
    type: parseScheduleChangeType(data.type),
    currentDate: asString(data.currentDate),
    currentStartTime: asString(data.currentStartTime),
    currentEndTime: asString(data.currentEndTime),
    proposedDate: asString(data.proposedDate),
    proposedStartTime: asString(data.proposedStartTime),
    proposedEndTime: asString(data.proposedEndTime),
    proposedAssigneeUid: asString(data.proposedAssigneeUid),
    proposedAssigneeName: asString(data.proposedAssigneeName),
    reason: asString(data.reason),
    status: parseApprovalStatus(data.status),
    reviewedByUid: asString(data.reviewedByUid),
    reviewedByName: asString(data.reviewedByName),
    reviewNote: asString(data.reviewNote),
    createdAt: asTimestamp(data.createdAt),
    updatedAt: asTimestamp(data.updatedAt),
  };
}

function mapShiftReport(docSnap: QueryDocumentSnapshot<DocumentData>): ShiftReport {
  const data = docSnap.data();
  return {
    id: asString(data.id, docSnap.id),
    shiftId: asString(data.shiftId),
    shiftTitle: asString(data.shiftTitle, 'Shift Report'),
    staffUid: asString(data.staffUid),
    staffName: asString(data.staffName),
    department: asString(data.department, 'Operations'),
    date: asString(data.date),
    actualStartTime: asString(data.actualStartTime),
    actualEndTime: asString(data.actualEndTime),
    breakMinutes: asNumber(data.breakMinutes, 0),
    workedHours: asNumber(data.workedHours, 0),
    handoffNotes: asString(data.handoffNotes),
    status: parseShiftReportStatus(data.status),
    verifiedByUid: asString(data.verifiedByUid),
    createdAt: asTimestamp(data.createdAt),
    updatedAt: asTimestamp(data.updatedAt),
  };
}

function mapShiftSubmission(docSnap: QueryDocumentSnapshot<DocumentData>): ShiftSubmission {
  const data = docSnap.data();
  return {
    id: asString(data.id, docSnap.id),
    staffUid: asString(data.staffUid),
    staffName: asString(data.staffName),
    department: asString(data.department, 'Operations'),
    date: asString(data.date),
    startTime: asString(data.startTime),
    endTime: asString(data.endTime),
    shiftTitle: asString(data.shiftTitle),
    notes: asString(data.notes),
    status: parseSubmissionStatus(data.status),
    createdAt: asTimestamp(data.createdAt),
    updatedAt: asTimestamp(data.updatedAt),
  };
}

function mapTimeOffRequest(docSnap: QueryDocumentSnapshot<DocumentData>): TimeOffRequest {
  const data = docSnap.data();
  return {
    id: asString(data.id, docSnap.id),
    staffUid: asString(data.staffUid),
    staffName: asString(data.staffName),
    department: asString(data.department, 'Operations'),
    startDate: asString(data.startDate),
    endDate: asString(data.endDate),
    reason: asString(data.reason),
    status: parseApprovalStatus(data.status),
    reviewedByUid: asString(data.reviewedByUid),
    reviewedByName: asString(data.reviewedByName),
    reviewNote: asString(data.reviewNote),
    createdAt: asTimestamp(data.createdAt),
    updatedAt: asTimestamp(data.updatedAt),
  };
}

function mapNotification(docSnap: QueryDocumentSnapshot<DocumentData>): PushNotificationRecord {
  const data = docSnap.data();
  return {
    id: asString(data.id, docSnap.id),
    recipientUid: asString(data.recipientUid),
    title: asString(data.title),
    message: asString(data.message),
    category: parseNotificationCategory(data.category),
    relatedShiftId: asString(data.relatedShiftId),
    isRead: asBool(data.isRead, false),
    actorUid: asString(data.actorUid),
    createdAt: asTimestamp(data.createdAt),
    updatedAt: asTimestamp(data.updatedAt),
  };
}

// --- Real-Time Firestore Streams (Shared Live Sync Across Windows, Android & Web) ---

function subscribeCollection<T>(
  q: Query<DocumentData>,
  path: string,
  mapper: (docSnap: QueryDocumentSnapshot<DocumentData>) => T,
  sorter: (a: T, b: T) => number,
  onData: (items: T[]) => void,
  onError: (err: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map(mapper).sort(sorter)),
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (e) {
        onError(e);
      }
    },
  );
}

export function subscribeStaffDirectory(
  onData: (items: StaffDirectoryEntry[]) => void,
  onError: (err: unknown) => void,
): Unsubscribe {
  return subscribeCollection(
    query(collection(db, 'staffDirectory'), where('role', 'in', ['staff', 'manager'])),
    'staffDirectory',
    mapStaffDirectoryEntry,
    (a, b) => a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()),
    onData,
    onError,
  );
}

export function subscribeShifts(
  uid: string,
  onData: (items: Shift[]) => void,
  onError: (err: unknown) => void,
): Unsubscribe {
  const teamMap = new Map<string, Shift>();
  const assignedMap = new Map<string, Shift>();
  const emit = () => {
    const merged = new Map<string, Shift>([...teamMap, ...assignedMap]);
    onData(
      Array.from(merged.values()).sort((a, b) =>
        a.date !== b.date ? a.date.localeCompare(b.date) : a.startTime.localeCompare(b.startTime),
      ),
    );
  };
  const onErr = (error: unknown) => {
    try {
      handleFirestoreError(error, OperationType.LIST, 'shifts');
    } catch (e) {
      onError(e);
    }
  };
  const unsubTeam = onSnapshot(
    query(collection(db, 'shifts'), where('visibility', '==', 'team')),
    (snap) => {
      teamMap.clear();
      snap.docs.forEach((d) => {
        const s = mapShift(d);
        teamMap.set(s.id, s);
      });
      emit();
    },
    onErr,
  );
  const unsubAssigned = onSnapshot(
    query(collection(db, 'shifts'), where('assignedUid', '==', uid)),
    (snap) => {
      assignedMap.clear();
      snap.docs.forEach((d) => {
        const s = mapShift(d);
        assignedMap.set(s.id, s);
      });
      emit();
    },
    onErr,
  );
  return () => {
    unsubTeam();
    unsubAssigned();
  };
}

export function subscribeScheduleChanges(
  uid: string,
  isManager: boolean,
  onData: (items: ScheduleChangeRequest[]) => void,
  onError: (err: unknown) => void,
): Unsubscribe {
  const byUpdatedDesc = (a: ScheduleChangeRequest, b: ScheduleChangeRequest) =>
    tsSeconds(b.updatedAt ?? b.createdAt) - tsSeconds(a.updatedAt ?? a.createdAt);

  if (isManager) {
    return subscribeCollection(
      collection(db, 'scheduleChanges'),
      'scheduleChanges',
      mapScheduleChange,
      byUpdatedDesc,
      onData,
      onError,
    );
  }

  const reqMap = new Map<string, ScheduleChangeRequest>();
  const swapMap = new Map<string, ScheduleChangeRequest>();
  const emit = () => {
    const merged = new Map<string, ScheduleChangeRequest>([...reqMap, ...swapMap]);
    onData(Array.from(merged.values()).sort(byUpdatedDesc));
  };
  const onErr = (error: unknown) => {
    try {
      handleFirestoreError(error, OperationType.LIST, 'scheduleChanges');
    } catch (e) {
      onError(e);
    }
  };
  const unsubReq = onSnapshot(
    query(collection(db, 'scheduleChanges'), where('requesterUid', '==', uid)),
    (snap) => {
      reqMap.clear();
      snap.docs.forEach((d) => {
        const item = mapScheduleChange(d);
        reqMap.set(item.id, item);
      });
      emit();
    },
    onErr,
  );
  const unsubSwap = onSnapshot(
    query(collection(db, 'scheduleChanges'), where('proposedAssigneeUid', '==', uid)),
    (snap) => {
      swapMap.clear();
      snap.docs.forEach((d) => {
        const item = mapScheduleChange(d);
        swapMap.set(item.id, item);
      });
      emit();
    },
    onErr,
  );
  return () => {
    unsubReq();
    unsubSwap();
  };
}

export const subscribeShiftReports = (
  uid: string,
  isManager: boolean,
  onData: (items: ShiftReport[]) => void,
  onError: (err: unknown) => void,
): Unsubscribe =>
  subscribeCollection(
    isManager ? collection(db, 'shiftReports') : query(collection(db, 'shiftReports'), where('staffUid', '==', uid)),
    'shiftReports',
    mapShiftReport,
    (a, b) => b.date.localeCompare(a.date),
    onData,
    onError,
  );

export const subscribeShiftSubmissions = (
  uid: string,
  isManager: boolean,
  onData: (items: ShiftSubmission[]) => void,
  onError: (err: unknown) => void,
): Unsubscribe =>
  subscribeCollection(
    isManager ? collection(db, 'shiftSubmissions') : query(collection(db, 'shiftSubmissions'), where('staffUid', '==', uid)),
    'shiftSubmissions',
    mapShiftSubmission,
    (a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.startTime.localeCompare(b.startTime)),
    onData,
    onError,
  );

export const subscribeTimeOffRequests = (
  uid: string,
  isManager: boolean,
  onData: (items: TimeOffRequest[]) => void,
  onError: (err: unknown) => void,
): Unsubscribe =>
  subscribeCollection(
    isManager ? collection(db, 'timeOffRequests') : query(collection(db, 'timeOffRequests'), where('staffUid', '==', uid)),
    'timeOffRequests',
    mapTimeOffRequest,
    (a, b) => tsSeconds(b.createdAt) - tsSeconds(a.createdAt),
    onData,
    onError,
  );

export const subscribeNotifications = (
  uid: string,
  isManager: boolean,
  onData: (items: PushNotificationRecord[]) => void,
  onError: (err: unknown) => void,
): Unsubscribe =>
  subscribeCollection(
    isManager ? collection(db, 'notifications') : query(collection(db, 'notifications'), where('recipientUid', '==', uid)),
    'notifications',
    mapNotification,
    (a, b) => tsSeconds(b.createdAt) - tsSeconds(a.createdAt),
    onData,
    onError,
  );

export function subscribeUserProfile(
  uid: string,
  email: string,
  initialProfile: UserProfile,
  onData: (profile: UserProfile) => void,
  onWarning?: (error: unknown) => void,
): Unsubscribe {
  const isBootstrapAdmin = email.trim().toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL;
  let latestUser: UserProfile = initialProfile;
  let hasManagerDoc = false;
  const emit = () => {
    const role = isBootstrapAdmin || hasManagerDoc ? UserRole.MANAGER : latestUser.role;
    onData({ ...latestUser, role });
  };
  const unsubUser = onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      const parsed = mapUserProfile(uid, snap.data());
      if (parsed) latestUser = parsed;
      emit();
    },
    (error) => onWarning?.(error),
  );
  const unsubManager = onSnapshot(
    doc(db, 'managers', uid),
    (snap) => {
      hasManagerDoc = snap.exists();
      emit();
    },
    (error) => onWarning?.(error),
  );
  return () => {
    unsubUser();
    unsubManager();
  };
}

// --- Provisioning & Preferences (Rust-Native on Desktop, Web SDK Fallback) ---

export async function ensureVerifiedUserProvisioned(user: User): Promise<UserProfile> {
  const email = (user.email ?? 'staff@cadence.app').trim();
  if (isTauriDesktop()) {
    const idToken = await user.getIdToken();
    const rustProfile = await invokeRepoEnsureVerifiedUserProvisioned({
      idToken,
      uid: user.uid,
      email,
      displayName: user.displayName ?? '',
    });
    return { ...rustProfile, createdAt: null, updatedAt: null };
  }

  const uid = user.uid;
  const userRef = doc(db, 'users', uid);
  const staffRef = doc(db, 'staffDirectory', uid);

  let userSnap;
  try {
    userSnap = await getDoc(userRef);
  } catch (e) {
    handleFirestoreError(e, OperationType.GET, `users/${uid}`);
  }

  let managerExists = false;
  try {
    managerExists = (await getDoc(doc(db, 'managers', uid))).exists();
  } catch {
    managerExists = false;
  }

  const existing = userSnap.exists() ? mapUserProfile(uid, userSnap.data()) : null;
  const effectiveRole: UserRole =
    email.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL || managerExists
      ? UserRole.MANAGER
      : existing?.role ?? UserRole.STAFF;

  const cleanDisplayName = (
    existing?.displayName?.trim() ||
    user.displayName?.trim() ||
    email.split('@')[0]?.trim() ||
    'Team Member'
  ).slice(0, 80);

  let profile: UserProfile;
  if (!existing) {
    await commitOpsInChunks(
      [
        {
          kind: 'set',
          ref: userRef,
          data: {
            uid,
            email,
            displayName: cleanDisplayName,
            role: effectiveRole,
            department: 'Operations',
            weeklyHoursTarget: 40,
            pushNotificationsEnabled: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
        },
      ],
      OperationType.CREATE,
      `users/${uid}`,
    );
    profile = {
      uid,
      email,
      displayName: cleanDisplayName,
      role: effectiveRole,
      department: 'Operations',
      weeklyHoursTarget: 40,
      pushNotificationsEnabled: true,
      createdAt: null,
      updatedAt: null,
    };
  } else {
    if (existing.role !== effectiveRole) {
      await commitOpsInChunks(
        [{ kind: 'update', ref: userRef, data: { role: effectiveRole, updatedAt: serverTimestamp() } }],
        OperationType.UPDATE,
        `users/${uid}`,
      );
    }
    profile = { ...existing, role: effectiveRole };
  }

  let staffSnap;
  try {
    staffSnap = await getDoc(staffRef);
  } catch (e) {
    handleFirestoreError(e, OperationType.GET, `staffDirectory/${uid}`);
  }

  if (!staffSnap.exists()) {
    await commitOpsInChunks(
      [
        {
          kind: 'set',
          ref: staffRef,
          data: {
            uid,
            displayName: profile.displayName,
            role: effectiveRole,
            department: profile.department,
            totalHoursWorked: 0,
            scheduledHoursThisWeek: 0,
            weeklyHoursTarget: profile.weeklyHoursTarget,
            lastAssignedAt: '',
            isSampleRoster: false,
            updatedAt: serverTimestamp(),
          },
        },
      ],
      OperationType.CREATE,
      `staffDirectory/${uid}`,
    );
  } else if (parseUserRole(staffSnap.data()?.role) !== effectiveRole) {
    try {
      const batch = writeBatch(db);
      batch.update(staffRef, { role: effectiveRole, updatedAt: serverTimestamp() });
      await batch.commit();
    } catch {
      // Non-manager staff cannot mutate role directly
    }
  }

  return profile;
}

export async function updateUserPreferences(
  uid: string,
  displayName: string,
  department: string,
  weeklyHoursTarget: number,
  pushNotificationsEnabled: boolean,
): Promise<void> {
  const desktop = await requireDesktopToken();
  if (desktop) {
    await invokeRepoUpdateUserPreferences({
      idToken: desktop.idToken,
      actorUid: desktop.uid,
      uid,
      displayName,
      department,
      weeklyHoursTarget,
      pushNotificationsEnabled,
    });
    return;
  }
  if (requireUserId() !== uid) throw new Error('Cannot update another user preferences.');
  const cleanName = displayName.trim().slice(0, 80);
  const cleanDept = department.trim().slice(0, 60);
  const clampedTarget = Math.min(80, Math.max(1, weeklyHoursTarget));
  await commitOpsInChunks(
    [
      {
        kind: 'update',
        ref: doc(db, 'users', uid),
        data: {
          displayName: cleanName,
          department: cleanDept,
          weeklyHoursTarget: clampedTarget,
          pushNotificationsEnabled,
          updatedAt: serverTimestamp(),
        },
      },
      {
        kind: 'update',
        ref: doc(db, 'staffDirectory', uid),
        data: {
          displayName: cleanName,
          department: cleanDept,
          weeklyHoursTarget: clampedTarget,
          updatedAt: serverTimestamp(),
        },
      },
    ],
    OperationType.UPDATE,
    `users/${uid}`,
  );
}

// --- Shifts ---

export async function createShift(
  title: string,
  department: string,
  date: string,
  startTime: string,
  endTime: string,
  assignedUid: string,
  assignedName: string,
  candidateUids: string[],
  status: ShiftStatus,
  fairnessNote: string,
  createdBy: string,
): Promise<string> {
  const desktop = await requireDesktopToken();
  if (desktop) {
    return invokeRepoCreateShift({
      idToken: desktop.idToken,
      actorUid: desktop.uid,
      title,
      department,
      date,
      startTime,
      endTime,
      assignedUid,
      assignedName,
      candidateUids,
      status,
      fairnessNote,
      createdBy,
    });
  }
  const actorUid = requireUserId();
  const id = newId('shift');
  const cleanTitle = (title.trim() || 'Assigned Shift').slice(0, 120);
  const effectiveUid = status === ShiftStatus.OPEN ? '' : assignedUid;
  const ops: BatchOp[] = [
    {
      kind: 'set',
      ref: doc(db, 'shifts', id),
      data: makeShiftData({
        id,
        title: cleanTitle,
        department,
        date,
        startTime,
        endTime,
        durationHours: computeShiftHours(startTime, endTime),
        assignedUid,
        assignedName,
        candidateUids,
        status,
        fairnessNote,
        createdBy: createdBy || actorUid,
        includeCreatedAt: true,
      }),
    },
  ];
  if (effectiveUid && effectiveUid !== actorUid && status !== ShiftStatus.OPEN) {
    ops.push(
      makeNotificationOp(
        effectiveUid,
        'New Shift Assigned',
        `${cleanTitle} on ${date} (${startTime}-${endTime}) was assigned to you.`,
        NotificationCategory.SHIFT_ASSIGNED,
        id,
        actorUid,
      ),
    );
  }
  await commitOpsInChunks(ops, OperationType.CREATE, `shifts/${id}`);
  return id;
}

export async function updateShift(
  shiftId: string,
  title: string,
  department: string,
  date: string,
  startTime: string,
  endTime: string,
  assignedUid: string,
  assignedName: string,
  status: ShiftStatus,
  fairnessNote: string,
): Promise<void> {
  const desktop = await requireDesktopToken();
  if (desktop) {
    await invokeRepoUpdateShift({
      idToken: desktop.idToken,
      actorUid: desktop.uid,
      shiftId,
      title,
      department,
      date,
      startTime,
      endTime,
      assignedUid,
      assignedName,
      status,
      fairnessNote,
    });
    return;
  }
  const actorUid = requireUserId();
  const docRef = doc(db, 'shifts', shiftId);
  let prev: Shift | null = null;
  try {
    const prevSnap = await getDoc(docRef);
    if (prevSnap.exists()) prev = mapShift(prevSnap as QueryDocumentSnapshot<DocumentData>);
  } catch {
    prev = null;
  }
  const effectiveUid = status === ShiftStatus.OPEN ? '' : assignedUid;
  const cleanTitle = (title.trim() || 'Assigned Shift').slice(0, 120);
  const ops: BatchOp[] = [
    {
      kind: 'update',
      ref: docRef,
      data: makeShiftData({
        id: shiftId,
        title: cleanTitle,
        department,
        date,
        startTime,
        endTime,
        durationHours: computeShiftHours(startTime, endTime),
        assignedUid,
        assignedName,
        candidateUids: [],
        status,
        fairnessNote,
        createdBy: actorUid,
        includeCreatedAt: false,
      }),
    },
  ];
  if (effectiveUid && effectiveUid !== actorUid && status !== ShiftStatus.OPEN) {
    const isNew = !prev || prev.assignedUid !== effectiveUid || prev.status === ShiftStatus.OPEN;
    const changed =
      !!prev &&
      (prev.date !== date || prev.startTime !== startTime || prev.endTime !== endTime || prev.title !== cleanTitle);
    if (isNew || changed) {
      ops.push(
        makeNotificationOp(
          effectiveUid,
          isNew ? 'New Shift Assigned' : 'Shift Schedule Updated',
          isNew
            ? `${cleanTitle} on ${date} (${startTime}-${endTime}) was assigned to you.`
            : `Your shift ${cleanTitle} was updated to ${date} (${startTime}-${endTime}).`,
          NotificationCategory.SHIFT_ASSIGNED,
          shiftId,
          actorUid,
        ),
      );
    }
  }
  await commitOpsInChunks(ops, OperationType.UPDATE, `shifts/${shiftId}`);
}

export async function deleteShift(shiftId: string): Promise<void> {
  const desktop = await requireDesktopToken();
  if (desktop) {
    await invokeRepoDeleteShift({ idToken: desktop.idToken, shiftId });
    return;
  }
  requireUserId();
  await commitOpsInChunks(
    [{ kind: 'delete', ref: doc(db, 'shifts', shiftId) }],
    OperationType.DELETE,
    `shifts/${shiftId}`,
  );
}

// --- Schedule Change Requests & Approvals ---

export async function submitScheduleChangeRequest(
  shift: Shift,
  requesterUid: string,
  requesterName: string,
  type: ScheduleChangeType,
  proposedDate: string,
  proposedStartTime: string,
  proposedEndTime: string,
  proposedAssigneeUid: string,
  proposedAssigneeName: string,
  reason: string,
  isManager = false,
): Promise<string> {
  const desktop = await requireDesktopToken();
  if (desktop) {
    return invokeRepoSubmitScheduleChange({
      idToken: desktop.idToken,
      shift,
      requesterUid,
      requesterName,
      isManager,
      requestType: type,
      proposedDate,
      proposedStartTime,
      proposedEndTime,
      proposedAssigneeUid,
      proposedAssigneeName,
      reason,
    });
  }
  requireUserId();
  const id = newId('chg');
  const ops: BatchOp[] = [
    {
      kind: 'set',
      ref: doc(db, 'scheduleChanges', id),
      data: {
        id,
        shiftId: shift.id,
        shiftTitle: shift.title,
        requesterUid,
        requesterName,
        type,
        currentDate: shift.date,
        currentStartTime: shift.startTime,
        currentEndTime: shift.endTime,
        proposedDate,
        proposedStartTime,
        proposedEndTime,
        proposedAssigneeUid,
        proposedAssigneeName,
        reason: reason.trim().slice(0, 400),
        status: ApprovalStatus.PENDING,
        reviewedByUid: '',
        reviewedByName: '',
        reviewNote: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    },
  ];
  if (type !== ScheduleChangeType.CLAIM && shift.assignedUid === requesterUid) {
    ops.push({
      kind: 'update',
      ref: doc(db, 'shifts', shift.id),
      data: { status: ShiftStatus.PENDING_CHANGE, updatedAt: serverTimestamp() },
    });
  }
  await commitOpsInChunks(ops, OperationType.CREATE, `scheduleChanges/${id}`);
  return id;
}

function buildShiftApprovalUpdates(
  req: ScheduleChangeRequest,
  shift: Shift | undefined,
): Record<string, unknown> {
  const duration = computeShiftHours(req.proposedStartTime, req.proposedEndTime);
  if (req.type === ScheduleChangeType.DROP) {
    return {
      status: ShiftStatus.OPEN,
      assignedUid: '',
      assignedName: '',
      fairnessNote: 'Opened via approved drop request',
      updatedAt: serverTimestamp(),
    };
  }
  if (req.proposedAssigneeUid && req.proposedAssigneeName) {
    return {
      date: req.proposedDate,
      startTime: req.proposedStartTime,
      endTime: req.proposedEndTime,
      durationHours: duration,
      assignedUid: req.proposedAssigneeUid,
      assignedName: req.proposedAssigneeName,
      status: ShiftStatus.SCHEDULED,
      fairnessNote: `Updated via approved ${req.type.replace('_', ' ')}`,
      updatedAt: serverTimestamp(),
    };
  }
  return {
    date: req.proposedDate,
    startTime: req.proposedStartTime,
    endTime: req.proposedEndTime,
    durationHours: duration,
    status: ShiftStatus.SCHEDULED,
    fairnessNote: `Time updated via approved request (was ${shift?.startTime ?? req.currentStartTime}-${shift?.endTime ?? req.currentEndTime})`,
    updatedAt: serverTimestamp(),
  };
}

export async function decideScheduleChange(
  req: ScheduleChangeRequest,
  shift: Shift | undefined,
  decision: ApprovalStatus,
  reviewerUid: string,
  reviewerName: string,
  reviewNote: string,
): Promise<void> {
  const desktop = await requireDesktopToken();
  if (desktop) {
    await invokeRepoDecideScheduleChange({
      idToken: desktop.idToken,
      req,
      linkedShift: shift ?? null,
      decision,
      reviewerUid,
      reviewerName,
      reviewNote,
    });
    return;
  }
  requireUserId();
  const typeLabel = req.type.replace('_', ' ');
  const isApproved = decision === ApprovalStatus.APPROVED;
  const ops: BatchOp[] = [
    {
      kind: 'update',
      ref: doc(db, 'scheduleChanges', req.id),
      data: {
        status: decision,
        reviewedByUid: reviewerUid,
        reviewedByName: reviewerName,
        reviewNote: reviewNote.trim().slice(0, 300),
        updatedAt: serverTimestamp(),
      },
    },
  ];
  if (shift) {
    ops.push({
      kind: 'update',
      ref: doc(db, 'shifts', shift.id),
      data: isApproved
        ? buildShiftApprovalUpdates(req, shift)
        : {
            status: shift.assignedUid.trim() ? ShiftStatus.SCHEDULED : ShiftStatus.OPEN,
            updatedAt: serverTimestamp(),
          },
    });
  }
  ops.push(
    makeNotificationOp(
      req.requesterUid,
      isApproved ? 'Schedule Change Approved' : 'Schedule Change Denied',
      isApproved
        ? `Your ${typeLabel} for ${req.shiftTitle} (${req.proposedDate} ${req.proposedStartTime}-${req.proposedEndTime}) was approved by ${reviewerName}.`
        : `Your ${typeLabel} for ${req.shiftTitle} was denied by ${reviewerName}.${reviewNote.trim() ? ` Note: ${reviewNote.trim()}` : ''}`,
      isApproved ? NotificationCategory.SHIFT_APPROVED : NotificationCategory.SHIFT_DENIED,
      req.shiftId,
      reviewerUid,
    ),
  );
  if (isApproved && req.proposedAssigneeUid && req.proposedAssigneeUid !== req.requesterUid) {
    ops.push(
      makeNotificationOp(
        req.proposedAssigneeUid,
        'Shift Reassigned to You',
        `${req.shiftTitle} on ${req.proposedDate} (${req.proposedStartTime}-${req.proposedEndTime}) was approved for you by ${reviewerName}.`,
        NotificationCategory.SHIFT_ASSIGNED,
        req.shiftId,
        reviewerUid,
      ),
    );
  }
  await commitOpsInChunks(ops, OperationType.WRITE, `scheduleChanges/${req.id}`);
}

export async function acceptAllPendingChanges(
  pendingRequests: ScheduleChangeRequest[],
  shifts: Shift[],
  reviewerUid: string,
  reviewerName: string,
): Promise<number> {
  const desktop = await requireDesktopToken();
  if (desktop) {
    return invokeRepoAcceptAllPending({
      idToken: desktop.idToken,
      pendingRequests,
      shifts,
      reviewerUid,
      reviewerName,
    });
  }
  requireUserId();
  if (pendingRequests.length === 0) return 0;
  const shiftMap = new Map(shifts.map((s) => [s.id, s]));
  const ops: BatchOp[] = [];
  for (const req of pendingRequests) {
    const shift = shiftMap.get(req.shiftId);
    ops.push({
      kind: 'update',
      ref: doc(db, 'scheduleChanges', req.id),
      data: {
        status: ApprovalStatus.APPROVED,
        reviewedByUid: reviewerUid,
        reviewedByName: reviewerName,
        reviewNote: 'Approved via Accept All',
        updatedAt: serverTimestamp(),
      },
    });
    if (shift) {
      ops.push({ kind: 'update', ref: doc(db, 'shifts', shift.id), data: buildShiftApprovalUpdates(req, shift) });
    }
    ops.push(
      makeNotificationOp(
        req.requesterUid,
        'Schedule Change Approved',
        `Your ${req.type.replace('_', ' ')} for ${req.shiftTitle} (${req.proposedDate} ${req.proposedStartTime}-${req.proposedEndTime}) was batch-approved by ${reviewerName}.`,
        NotificationCategory.SHIFT_APPROVED,
        req.shiftId,
        reviewerUid,
      ),
    );
    if (req.proposedAssigneeUid && req.proposedAssigneeUid !== req.requesterUid) {
      ops.push(
        makeNotificationOp(
          req.proposedAssigneeUid,
          'Shift Reassigned to You',
          `${req.shiftTitle} on ${req.proposedDate} (${req.proposedStartTime}-${req.proposedEndTime}) was approved for you by ${reviewerName}.`,
          NotificationCategory.SHIFT_ASSIGNED,
          req.shiftId,
          reviewerUid,
        ),
      );
    }
  }
  await commitOpsInChunks(ops, OperationType.WRITE, 'scheduleChanges');
  return pendingRequests.length;
}

// --- Shift Reports ---

export async function submitShiftReport(
  shiftId: string,
  shiftTitle: string,
  staffUid: string,
  staffName: string,
  department: string,
  date: string,
  actualStartTime: string,
  actualEndTime: string,
  breakMinutes: number,
  handoffNotes: string,
): Promise<string> {
  const desktop = await requireDesktopToken();
  if (desktop) {
    return invokeRepoSubmitShiftReport({
      idToken: desktop.idToken,
      shiftId,
      shiftTitle,
      staffUid,
      staffName,
      department,
      date,
      actualStartTime,
      actualEndTime,
      breakMinutes,
      handoffNotes,
    });
  }
  requireUserId();
  const id = newId('rep');
  const clampedBreak = Math.min(180, Math.max(0, Math.round(breakMinutes)));
  await commitOpsInChunks(
    [
      {
        kind: 'set',
        ref: doc(db, 'shiftReports', id),
        data: {
          id,
          shiftId,
          shiftTitle: shiftTitle.trim().slice(0, 120),
          staffUid,
          staffName,
          department: department.trim().slice(0, 60),
          date,
          actualStartTime,
          actualEndTime,
          breakMinutes: clampedBreak,
          workedHours: computeShiftHours(actualStartTime, actualEndTime, clampedBreak),
          handoffNotes: handoffNotes.trim().slice(0, 600),
          status: ShiftReportStatus.SUBMITTED,
          verifiedByUid: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      },
    ],
    OperationType.CREATE,
    `shiftReports/${id}`,
  );
  return id;
}

export async function verifyOrFlagShiftReport(
  report: ShiftReport,
  status: ShiftReportStatus,
  verifierUid: string,
  staffEntry: StaffDirectoryEntry | undefined,
  linkedShift: Shift | undefined,
): Promise<void> {
  const desktop = await requireDesktopToken();
  if (desktop) {
    await invokeRepoVerifyOrFlagReport({
      idToken: desktop.idToken,
      report,
      status,
      verifierUid,
      staffEntry: staffEntry ?? null,
      linkedShift: linkedShift ?? null,
    });
    return;
  }
  requireUserId();
  const ops: BatchOp[] = [
    {
      kind: 'update',
      ref: doc(db, 'shiftReports', report.id),
      data: { status, verifiedByUid: verifierUid, updatedAt: serverTimestamp() },
    },
  ];
  if (status === ShiftReportStatus.VERIFIED && report.status !== ShiftReportStatus.VERIFIED) {
    if (staffEntry) {
      ops.push({
        kind: 'update',
        ref: doc(db, 'staffDirectory', staffEntry.uid),
        data: { totalHoursWorked: round2(staffEntry.totalHoursWorked + report.workedHours), updatedAt: serverTimestamp() },
      });
    }
    if (linkedShift && linkedShift.status !== ShiftStatus.COMPLETED) {
      ops.push({
        kind: 'update',
        ref: doc(db, 'shifts', linkedShift.id),
        data: { status: ShiftStatus.COMPLETED, updatedAt: serverTimestamp() },
      });
    }
  }
  ops.push(
    makeNotificationOp(
      report.staffUid,
      status === ShiftReportStatus.VERIFIED ? 'Shift Report Verified' : 'Shift Report Flagged',
      status === ShiftReportStatus.VERIFIED
        ? `Your ${formatHours(report.workedHours)}h shift report for ${report.shiftTitle} (${report.date}) was verified.`
        : `Your shift report for ${report.shiftTitle} (${report.date}) was flagged for review.`,
      NotificationCategory.REPORT_VERIFIED,
      report.shiftId,
      verifierUid,
    ),
  );
  await commitOpsInChunks(ops, OperationType.UPDATE, `shiftReports/${report.id}`);
}

// --- Notifications ---

export async function markNotificationRead(notificationId: string, isRead: boolean): Promise<void> {
  const desktop = await requireDesktopToken();
  if (desktop) {
    await invokeRepoMarkNotificationRead({ idToken: desktop.idToken, notificationId, isRead });
    return;
  }
  requireUserId();
  await commitOpsInChunks(
    [{ kind: 'update', ref: doc(db, 'notifications', notificationId), data: { isRead, updatedAt: serverTimestamp() } }],
    OperationType.UPDATE,
    `notifications/${notificationId}`,
  );
}

export async function markAllNotificationsRead(notifications: PushNotificationRecord[]): Promise<void> {
  const desktop = await requireDesktopToken();
  if (desktop) {
    await invokeRepoMarkAllNotificationsRead({ idToken: desktop.idToken, notifications });
    return;
  }
  requireUserId();
  const ops: BatchOp[] = notifications
    .filter((n) => !n.isRead)
    .map((n) => ({
      kind: 'update',
      ref: doc(db, 'notifications', n.id),
      data: { isRead: true, updatedAt: serverTimestamp() },
    }));
  await commitOpsInChunks(ops, OperationType.UPDATE, 'notifications');
}

export async function sendTestPushNotification(uid: string, displayName: string): Promise<void> {
  const desktop = await requireDesktopToken();
  if (desktop) {
    await invokeRepoSendTestNotification({
      idToken: desktop.idToken,
      actorUid: desktop.uid,
      recipientUid: uid,
      displayName,
    });
    return;
  }
  const actorUid = requireUserId();
  const op = makeNotificationOp(
    uid,
    'Cadence Alert Test',
    `Real-time notification channel active for ${displayName}.`,
    NotificationCategory.SHIFT_ASSIGNED,
    '',
    actorUid,
  );
  await commitOpsInChunks([op], OperationType.CREATE, 'notifications');
}

// --- Fairness Plans & Weekly Schedule (Rust Atomic Commit on Desktop) ---

async function commitAssignmentPlanBatch(
  items: Array<FairnessArrangementItem | OpenShiftAssignmentItem>,
  actorUid: string,
  title: string,
  category: NotificationCategory,
  buildMsg: (item: FairnessArrangementItem | OpenShiftAssignmentItem) => string,
): Promise<number> {
  requireUserId();
  if (items.length === 0) return 0;
  const nowIso = new Date().toISOString();
  const ops: BatchOp[] = [];
  for (const item of items) {
    ops.push(
      {
        kind: 'update',
        ref: doc(db, 'shifts', item.shift.id),
        data: {
          assignedUid: item.chosenUid,
          assignedName: item.chosenName,
          status: ShiftStatus.SCHEDULED,
          fairnessNote: item.reason.slice(0, 300),
          updatedAt: serverTimestamp(),
        },
      },
      {
        kind: 'update',
        ref: doc(db, 'staffDirectory', item.chosenUid),
        data: { lastAssignedAt: nowIso, updatedAt: serverTimestamp() },
      },
      makeNotificationOp(item.chosenUid, title, buildMsg(item), category, item.shift.id, actorUid),
    );
  }
  await commitOpsInChunks(ops, OperationType.WRITE, 'shifts');
  return items.length;
}

export async function commitFairnessPlanInRust(
  shifts: Shift[],
  staffDirectory: StaffDirectoryEntry[],
  timeOffRequests: TimeOffRequest[],
  actorUid: string,
): Promise<number> {
  const desktop = await requireDesktopToken();
  if (desktop) {
    return invokeRepoCommitFairnessPlan({
      idToken: desktop.idToken,
      actorUid: desktop.uid,
      shifts,
      staffDirectory,
      timeOffRequests,
    });
  }
  const plan = buildFairnessArrangementPlan(shifts, staffDirectory, timeOffRequests);
  return commitFairnessArrangementPlan(plan, actorUid);
}

export async function commitOpenShiftPlanInRust(
  shifts: Shift[],
  staffDirectory: StaffDirectoryEntry[],
  submissions: ShiftSubmission[],
  timeOffRequests: TimeOffRequest[],
  requireExplicitSubmission: boolean,
  actorUid: string,
): Promise<number> {
  const desktop = await requireDesktopToken();
  if (desktop) {
    return invokeRepoCommitOpenShiftPlan({
      idToken: desktop.idToken,
      actorUid: desktop.uid,
      shifts,
      staffDirectory,
      submissions,
      timeOffRequests,
      requireExplicitSubmission,
    });
  }
  const plan = buildOpenShiftAssignmentPlan(
    shifts,
    staffDirectory,
    submissions,
    timeOffRequests,
    requireExplicitSubmission,
  );
  return commitOpenShiftAssignmentPlan(plan, actorUid);
}

export async function generateWeeklyScheduleInRust(
  mondayIso: string,
  slots: WeekSlotConfig[],
  staffDirectory: StaffDirectoryEntry[],
  existingShifts: Shift[],
  submissions: ShiftSubmission[],
  timeOffRequests: TimeOffRequest[],
  actorUid: string,
): Promise<{ assigned: number; open: number }> {
  const desktop = await requireDesktopToken();
  if (desktop) {
    return invokeRepoGenerateWeeklySchedule({
      idToken: desktop.idToken,
      actorUid: desktop.uid,
      mondayIso,
      slots,
      staffDirectory,
      existingShifts,
      submissions,
      timeOffRequests,
    });
  }
  const planned = generateWeeklyFairnessSchedule(
    mondayIso,
    slots,
    staffDirectory,
    existingShifts,
    submissions,
    timeOffRequests,
  );
  return commitWeeklyScheduleBatch(planned, actorUid);
}

export const commitFairnessArrangementPlan = (plan: FairnessArrangementItem[], actorUid: string) =>
  commitAssignmentPlanBatch(
    plan,
    actorUid,
    'Overlap Resolved by Fairness',
    NotificationCategory.FAIRNESS_REBALANCED,
    (i) => `${i.shift.title} (${i.shift.date} ${i.shift.startTime}-${i.shift.endTime}) assigned to you. ${i.reason}`,
  );

export const commitOpenShiftAssignmentPlan = (plan: OpenShiftAssignmentItem[], actorUid: string) =>
  commitAssignmentPlanBatch(
    plan,
    actorUid,
    'Open Shift Assigned',
    NotificationCategory.SHIFT_ASSIGNED,
    (i) => `${i.shift.title} on ${i.shift.date} (${i.shift.startTime}-${i.shift.endTime}) assigned to you.`,
  );

export async function commitWeeklyScheduleBatch(
  planned: GeneratedShiftSpec[],
  actorUid: string,
): Promise<{ assigned: number; open: number }> {
  requireUserId();
  if (planned.length === 0) return { assigned: 0, open: 0 };
  const nowIso = new Date().toISOString();
  const ops: BatchOp[] = [];
  let assigned = 0;
  let open = 0;
  const touched = new Set<string>();

  for (const spec of planned) {
    const shiftId = newId('shift');
    const hasAssignee = spec.status !== ShiftStatus.OPEN && spec.assignedUid.trim().length > 0;
    if (hasAssignee) assigned++;
    else open++;
    ops.push({
      kind: 'set',
      ref: doc(db, 'shifts', shiftId),
      data: makeShiftData({
        id: shiftId,
        title: spec.title,
        department: spec.department,
        date: spec.date,
        startTime: spec.startTime,
        endTime: spec.endTime,
        durationHours: spec.durationHours,
        assignedUid: spec.assignedUid,
        assignedName: spec.assignedName,
        candidateUids: spec.candidateUids,
        status: spec.status,
        fairnessNote: spec.fairnessNote,
        createdBy: actorUid,
        includeCreatedAt: true,
      }),
    });
    if (hasAssignee) {
      touched.add(spec.assignedUid);
      ops.push(
        makeNotificationOp(
          spec.assignedUid,
          'Weekly Schedule Published',
          `You were scheduled for ${spec.title} on ${spec.date} (${spec.startTime}-${spec.endTime}).`,
          NotificationCategory.SHIFT_ASSIGNED,
          shiftId,
          actorUid,
        ),
      );
    }
  }
  for (const uid of touched) {
    ops.push({
      kind: 'update',
      ref: doc(db, 'staffDirectory', uid),
      data: { lastAssignedAt: nowIso, updatedAt: serverTimestamp() },
    });
  }
  await commitOpsInChunks(ops, OperationType.WRITE, 'shifts');
  return { assigned, open };
}

// --- Shift Submissions & Time Off ---

export async function submitShiftAvailabilityBatch(
  staffUid: string,
  staffName: string,
  department: string,
  dates: string[],
  startTime: string,
  endTime: string,
  shiftTitle: string,
  notes: string,
): Promise<number> {
  const desktop = await requireDesktopToken();
  if (desktop) {
    return invokeRepoSubmitAvailabilityBatch({
      idToken: desktop.idToken,
      staffUid,
      staffName,
      department,
      dates,
      startTime,
      endTime,
      shiftTitle,
      notes,
    });
  }
  requireUserId();
  const uniqueDates = Array.from(new Set(dates));
  const ops: BatchOp[] = uniqueDates.map((d) => {
    const id = newId('sub');
    return {
      kind: 'set',
      ref: doc(db, 'shiftSubmissions', id),
      data: {
        id,
        staffUid,
        staffName,
        department: department.trim().slice(0, 60),
        date: d,
        startTime,
        endTime,
        shiftTitle: shiftTitle.trim().slice(0, 120),
        notes: notes.trim().slice(0, 300),
        status: SubmissionStatus.SUBMITTED,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    };
  });
  await commitOpsInChunks(ops, OperationType.CREATE, 'shiftSubmissions');
  return uniqueDates.length;
}

export async function withdrawShiftSubmission(submissionId: string): Promise<void> {
  const desktop = await requireDesktopToken();
  if (desktop) {
    await invokeRepoWithdrawSubmission({ idToken: desktop.idToken, submissionId });
    return;
  }
  requireUserId();
  await commitOpsInChunks(
    [{ kind: 'update', ref: doc(db, 'shiftSubmissions', submissionId), data: { status: SubmissionStatus.WITHDRAWN, updatedAt: serverTimestamp() } }],
    OperationType.UPDATE,
    `shiftSubmissions/${submissionId}`,
  );
}

export async function createTimeOffRequest(
  staffUid: string,
  staffName: string,
  department: string,
  startDate: string,
  endDate: string,
  reason: string,
): Promise<string> {
  const desktop = await requireDesktopToken();
  if (desktop) {
    return invokeRepoCreateTimeOff({
      idToken: desktop.idToken,
      staffUid,
      staffName,
      department,
      startDate,
      endDate,
      reason,
    });
  }
  requireUserId();
  const id = newId('to');
  await commitOpsInChunks(
    [
      {
        kind: 'set',
        ref: doc(db, 'timeOffRequests', id),
        data: {
          id,
          staffUid,
          staffName,
          department: department.trim().slice(0, 60),
          startDate,
          endDate,
          reason: reason.trim().slice(0, 400),
          status: ApprovalStatus.PENDING,
          reviewedByUid: '',
          reviewedByName: '',
          reviewNote: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      },
    ],
    OperationType.CREATE,
    `timeOffRequests/${id}`,
  );
  return id;
}

export async function withdrawTimeOffRequest(requestId: string): Promise<void> {
  const desktop = await requireDesktopToken();
  if (desktop) {
    await invokeRepoWithdrawTimeOff({ idToken: desktop.idToken, requestId });
    return;
  }
  requireUserId();
  await commitOpsInChunks(
    [{ kind: 'delete', ref: doc(db, 'timeOffRequests', requestId) }],
    OperationType.DELETE,
    `timeOffRequests/${requestId}`,
  );
}

export async function decideTimeOffRequest(
  req: TimeOffRequest,
  decision: ApprovalStatus,
  reviewerUid: string,
  reviewerName: string,
  reviewNote: string,
): Promise<void> {
  const desktop = await requireDesktopToken();
  if (desktop) {
    await invokeRepoDecideTimeOff({
      idToken: desktop.idToken,
      req,
      decision,
      reviewerUid,
      reviewerName,
      reviewNote,
    });
    return;
  }
  requireUserId();
  const isApproved = decision === ApprovalStatus.APPROVED;
  await commitOpsInChunks(
    [
      {
        kind: 'update',
        ref: doc(db, 'timeOffRequests', req.id),
        data: {
          status: decision,
          reviewedByUid: reviewerUid,
          reviewedByName: reviewerName,
          reviewNote: reviewNote.trim().slice(0, 300),
          updatedAt: serverTimestamp(),
        },
      },
      makeNotificationOp(
        req.staffUid,
        isApproved ? 'Time Off Approved' : 'Time Off Denied',
        isApproved
          ? `Your time off request (${req.startDate} to ${req.endDate}) was approved by ${reviewerName}.`
          : `Your time off request (${req.startDate} to ${req.endDate}) was denied by ${reviewerName}.${reviewNote.trim() ? ` Note: ${reviewNote.trim()}` : ''}`,
        isApproved ? NotificationCategory.TIME_OFF_APPROVED : NotificationCategory.TIME_OFF_DENIED,
        '',
        reviewerUid,
      ),
    ],
    OperationType.UPDATE,
    `timeOffRequests/${req.id}`,
  );
}

// --- Team Roster, Roles & Sample Seeding ---

export async function addRosterStaffMember(
  displayName: string,
  department: string,
  weeklyHoursTarget: number,
  role: UserRole,
): Promise<string> {
  const desktop = await requireDesktopToken();
  if (desktop) {
    return invokeRepoAddRosterStaff({
      idToken: desktop.idToken,
      displayName,
      department,
      weeklyHoursTarget,
      role,
    });
  }
  requireUserId();
  const uid = newId('roster');
  await commitOpsInChunks(
    [
      {
        kind: 'set',
        ref: doc(db, 'staffDirectory', uid),
        data: {
          uid,
          displayName: displayName.trim().slice(0, 80),
          role,
          department: department.trim().slice(0, 60),
          totalHoursWorked: 0,
          scheduledHoursThisWeek: 0,
          weeklyHoursTarget: Math.min(80, Math.max(1, weeklyHoursTarget)),
          lastAssignedAt: '',
          isSampleRoster: false,
          updatedAt: serverTimestamp(),
        },
      },
    ],
    OperationType.CREATE,
    `staffDirectory/${uid}`,
  );
  return uid;
}

export async function toggleManagerRole(
  targetEntry: StaffDirectoryEntry,
  grantManager: boolean,
  actorUid: string,
): Promise<void> {
  const desktop = await requireDesktopToken();
  if (desktop) {
    await invokeRepoToggleManagerRole({
      idToken: desktop.idToken,
      targetEntry,
      grantManager,
      actorUid,
    });
    return;
  }
  requireUserId();
  const newRole = grantManager ? UserRole.MANAGER : UserRole.STAFF;
  const ops: BatchOp[] = [
    grantManager
      ? {
          kind: 'set',
          ref: doc(db, 'managers', targetEntry.uid),
          data: { uid: targetEntry.uid, grantedBy: actorUid, createdAt: serverTimestamp() },
        }
      : { kind: 'delete', ref: doc(db, 'managers', targetEntry.uid) },
    {
      kind: 'update',
      ref: doc(db, 'staffDirectory', targetEntry.uid),
      data: { role: newRole, updatedAt: serverTimestamp() },
    },
  ];
  try {
    const userSnap = await getDoc(doc(db, 'users', targetEntry.uid));
    if (userSnap.exists()) {
      ops.push({
        kind: 'update',
        ref: doc(db, 'users', targetEntry.uid),
        data: { role: newRole, updatedAt: serverTimestamp() },
      });
    }
  } catch {
    // Non-fatal if user profile isn't readable
  }
  await commitOpsInChunks(ops, OperationType.WRITE, `staffDirectory/${targetEntry.uid}`);
}

export async function seedSampleWorkspaceData(
  actorUid: string,
  actorName: string,
): Promise<void> {
  const desktop = await requireDesktopToken();
  if (desktop) {
    await invokeRepoSeedSampleWorkspace({
      idToken: desktop.idToken,
      actorUid: desktop.uid,
      actorName,
    });
    return;
  }
  requireUserId();
  const day0 = getMondayIso();
  const day1 = addDaysIso(day0, 1);
  const day2 = addDaysIso(day0, 2);
  const day3 = addDaysIso(day0, 3);
  const ops: BatchOp[] = [
    ...([
      ['sample_maya_patel', 'Maya Patel', 'Operations', 18, 8, 40, '2026-10-01T08:00:00Z'],
      ['sample_liam_brooks', 'Liam Brooks', 'Support', 36, 16, 40, '2026-11-10T08:00:00Z'],
      ['sample_noah_kim', 'Noah Kim', 'Operations', 24.5, 8, 32, '2026-11-05T08:00:00Z'],
    ] as const).map(
      ([uid, displayName, department, totalHoursWorked, scheduledHoursThisWeek, weeklyHoursTarget, lastAssignedAt]): BatchOp => ({
        kind: 'set',
        ref: doc(db, 'staffDirectory', uid),
        data: {
          uid,
          displayName,
          role: 'staff',
          department,
          totalHoursWorked,
          scheduledHoursThisWeek,
          weeklyHoursTarget,
          lastAssignedAt,
          isSampleRoster: true,
          updatedAt: serverTimestamp(),
        },
      }),
    ),
    {
      kind: 'set',
      ref: doc(db, 'shifts', 'sample_shift_overlap_1'),
      data: makeShiftData({
        id: 'sample_shift_overlap_1',
        title: 'Morning Operations Lead',
        department: 'Operations',
        date: day1,
        startTime: '07:00',
        endTime: '15:00',
        durationHours: 8,
        assignedUid: 'sample_liam_brooks',
        assignedName: 'Liam Brooks',
        candidateUids: ['sample_liam_brooks', 'sample_maya_patel'],
        status: ShiftStatus.CONFLICT,
        fairnessNote: '2 overlapping candidates — ready for fairness arrange',
        createdBy: actorUid,
        includeCreatedAt: true,
      }),
    },
    {
      kind: 'set',
      ref: doc(db, 'shifts', 'sample_shift_open_slot'),
      data: makeShiftData({
        id: 'sample_shift_open_slot',
        title: 'Evening Dispatch',
        department: 'Operations',
        date: day3,
        startTime: '15:00',
        endTime: '23:00',
        durationHours: 8,
        assignedUid: '',
        assignedName: '',
        candidateUids: ['sample_maya_patel', 'sample_noah_kim'],
        status: ShiftStatus.OPEN,
        fairnessNote: 'Open shift awaiting fairness assignment',
        createdBy: actorUid,
        includeCreatedAt: true,
      }),
    },
    {
      kind: 'set',
      ref: doc(db, 'scheduleChanges', 'sample_change_req_2'),
      data: {
        id: 'sample_change_req_2',
        shiftId: 'sample_shift_overlap_1',
        shiftTitle: 'Morning Operations Lead',
        requesterUid: 'sample_liam_brooks',
        requesterName: 'Liam Brooks',
        type: ScheduleChangeType.TIME_CHANGE,
        currentDate: day1,
        currentStartTime: '07:00',
        currentEndTime: '15:00',
        proposedDate: day2,
        proposedStartTime: '08:00',
        proposedEndTime: '16:00',
        proposedAssigneeUid: '',
        proposedAssigneeName: '',
        reason: 'Transit schedule starts 1 hour later.',
        status: ApprovalStatus.PENDING,
        reviewedByUid: '',
        reviewedByName: '',
        reviewNote: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    },
    {
      kind: 'set',
      ref: doc(db, 'shiftReports', 'sample_report_1'),
      data: {
        id: 'sample_report_1',
        shiftId: '',
        shiftTitle: 'Morning Operations Lead',
        staffUid: actorUid,
        staffName: actorName,
        department: 'Operations',
        date: day0,
        actualStartTime: '07:00',
        actualEndTime: '15:30',
        breakMinutes: 30,
        workedHours: 8,
        handoffNotes: 'Checklist complete; inventory restocked for midday team.',
        status: ShiftReportStatus.SUBMITTED,
        verifiedByUid: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    },
  ];
  await commitOpsInChunks(ops, OperationType.WRITE, 'staffDirectory');
}
