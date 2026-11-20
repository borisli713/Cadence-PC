import { invokeBuildSampleWorkspace } from '../utils/tauriBridge';
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
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { computeShiftHours, formatHours, getMondayIso, addDaysIso } from '../domain/fairnessEngine';
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
} from '../types/cadence';

export const BOOTSTRAPPED_ADMIN_EMAIL = 'yatheili713@gmail.com';
const CHUNK_SIZE = 400;

function requireUserId(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error('User must be signed in before accessing Firestore.');
  }
  return uid;
}

function newId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function asTimestamp(value: unknown): Timestamp | null {
  return value instanceof Timestamp ? value : null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
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
  const candidates = Array.isArray(data.candidateUids)
    ? data.candidateUids.filter((x): x is string => typeof x === 'string')
    : [];
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
    candidateUids: candidates,
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

function tsSeconds(ts: Timestamp | null): number {
  return ts ? ts.seconds : 0;
}

// --- Real-Time Streams ---

export function subscribeStaffDirectory(
  onData: (items: StaffDirectoryEntry[]) => void,
  onError: (err: unknown) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'staffDirectory'),
    where('role', 'in', ['staff', 'manager']),
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map(mapStaffDirectoryEntry)
        .sort((a, b) => a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'staffDirectory');
      } catch (e) {
        onError(e);
      }
    },
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
    const merged = new Map<string, Shift>();
    teamMap.forEach((v, k) => merged.set(k, v));
    assignedMap.forEach((v, k) => merged.set(k, v));
    const sorted = Array.from(merged.values()).sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.startTime.localeCompare(b.startTime);
    });
    onData(sorted);
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
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'shifts');
      } catch (e) {
        onError(e);
      }
    },
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
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'shifts');
      } catch (e) {
        onError(e);
      }
    },
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
  if (isManager) {
    return onSnapshot(
      collection(db, 'scheduleChanges'),
      (snap) => {
        const list = snap.docs
          .map(mapScheduleChange)
          .sort(
            (a, b) =>
              tsSeconds(b.updatedAt ?? b.createdAt) -
              tsSeconds(a.updatedAt ?? a.createdAt),
          );
        onData(list);
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, 'scheduleChanges');
        } catch (e) {
          onError(e);
        }
      },
    );
  }

  const reqMap = new Map<string, ScheduleChangeRequest>();
  const swapMap = new Map<string, ScheduleChangeRequest>();

  const emit = () => {
    const merged = new Map<string, ScheduleChangeRequest>();
    reqMap.forEach((v, k) => merged.set(k, v));
    swapMap.forEach((v, k) => merged.set(k, v));
    const list = Array.from(merged.values()).sort(
      (a, b) =>
        tsSeconds(b.updatedAt ?? b.createdAt) -
        tsSeconds(a.updatedAt ?? a.createdAt),
    );
    onData(list);
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
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'scheduleChanges');
      } catch (e) {
        onError(e);
      }
    },
  );

  const unsubSwap = onSnapshot(
    query(
      collection(db, 'scheduleChanges'),
      where('proposedAssigneeUid', '==', uid),
    ),
    (snap) => {
      swapMap.clear();
      snap.docs.forEach((d) => {
        const item = mapScheduleChange(d);
        swapMap.set(item.id, item);
      });
      emit();
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'scheduleChanges');
      } catch (e) {
        onError(e);
      }
    },
  );

  return () => {
    unsubReq();
    unsubSwap();
  };
}

export function subscribeShiftReports(
  uid: string,
  isManager: boolean,
  onData: (items: ShiftReport[]) => void,
  onError: (err: unknown) => void,
): Unsubscribe {
  const q = isManager
    ? collection(db, 'shiftReports')
    : query(collection(db, 'shiftReports'), where('staffUid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map(mapShiftReport)
        .sort((a, b) => b.date.localeCompare(a.date));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'shiftReports');
      } catch (e) {
        onError(e);
      }
    },
  );
}

export function subscribeShiftSubmissions(
  uid: string,
  isManager: boolean,
  onData: (items: ShiftSubmission[]) => void,
  onError: (err: unknown) => void,
): Unsubscribe {
  const q = isManager
    ? collection(db, 'shiftSubmissions')
    : query(collection(db, 'shiftSubmissions'), where('staffUid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map(mapShiftSubmission).sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.startTime.localeCompare(b.startTime);
      });
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'shiftSubmissions');
      } catch (e) {
        onError(e);
      }
    },
  );
}

export function subscribeTimeOffRequests(
  uid: string,
  isManager: boolean,
  onData: (items: TimeOffRequest[]) => void,
  onError: (err: unknown) => void,
): Unsubscribe {
  const q = isManager
    ? collection(db, 'timeOffRequests')
    : query(collection(db, 'timeOffRequests'), where('staffUid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map(mapTimeOffRequest)
        .sort((a, b) => tsSeconds(b.createdAt) - tsSeconds(a.createdAt));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'timeOffRequests');
      } catch (e) {
        onError(e);
      }
    },
  );
}

export function subscribeNotifications(
  uid: string,
  isManager: boolean,
  onData: (items: PushNotificationRecord[]) => void,
  onError: (err: unknown) => void,
): Unsubscribe {
  const q = isManager
    ? collection(db, 'notifications')
    : query(collection(db, 'notifications'), where('recipientUid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map(mapNotification)
        .sort((a, b) => tsSeconds(b.createdAt) - tsSeconds(a.createdAt));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'notifications');
      } catch (e) {
        onError(e);
      }
    },
  );
}

export function subscribeUserProfile(
  uid: string,
  email: string,
  initialProfile: UserProfile,
  onData: (profile: UserProfile) => void,
  onWarning?: (error: unknown) => void,
): Unsubscribe {
  const isBootstrapAdmin =
    email.trim().toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL;
  let latestUser: UserProfile = initialProfile;
  let hasManagerDoc = false;

  const emit = () => {
    const effectiveRole =
      isBootstrapAdmin || hasManagerDoc ? UserRole.MANAGER : latestUser.role;
    onData({ ...latestUser, role: effectiveRole });
  };

  const unsubUser = onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      const parsed = mapUserProfile(uid, snap.data());
      if (parsed) {
        latestUser = parsed;
      }
      emit();
    },
    (error) => {
      onWarning?.(error);
    },
  );

  const unsubManager = onSnapshot(
    doc(db, 'managers', uid),
    (snap) => {
      hasManagerDoc = snap.exists();
      emit();
    },
    (error) => {
      onWarning?.(error);
    },
  );

  return () => {
    unsubUser();
    unsubManager();
  };
}

// --- User Provisioning & Preferences ---

export async function ensureVerifiedUserProvisioned(
  user: User,
): Promise<UserProfile> {
  const uid = user.uid;
  const email = (user.email ?? 'staff@cadence.app').trim();
  const isBootstrapAdmin = email.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL;

  const userRef = doc(db, 'users', uid);
  const managerRef = doc(db, 'managers', uid);
  const staffRef = doc(db, 'staffDirectory', uid);

  let userSnap;
  try {
    userSnap = await getDoc(userRef);
  } catch (e) {
    handleFirestoreError(e, OperationType.GET, `users/${uid}`);
  }

  let managerExists = false;
  try {
    const mSnap = await getDoc(managerRef);
    managerExists = mSnap.exists();
  } catch {
    managerExists = false;
  }

  const existingProfile = userSnap.exists()
    ? mapUserProfile(uid, userSnap.data())
    : null;

  const effectiveRole: UserRole =
    isBootstrapAdmin || managerExists
      ? UserRole.MANAGER
      : existingProfile?.role ?? UserRole.STAFF;

  const displayName =
    existingProfile?.displayName?.trim() ||
    user.displayName?.trim() ||
    email.split('@')[0]?.trim() ||
    'Team Member';

  const cleanDisplayName = displayName.slice(0, 80);

  let profile: UserProfile;
  if (!existingProfile) {
    const batch = writeBatch(db);
    batch.set(userRef, {
      uid,
      email,
      displayName: cleanDisplayName,
      role: effectiveRole,
      department: 'Operations',
      weeklyHoursTarget: 40,
      pushNotificationsEnabled: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    try {
      await batch.commit();
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, `users/${uid}`);
    }
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
    if (existingProfile.role !== effectiveRole) {
      const batch = writeBatch(db);
      batch.update(userRef, {
        role: effectiveRole,
        updatedAt: serverTimestamp(),
      });
      try {
        await batch.commit();
      } catch (e) {
        handleFirestoreError(e, OperationType.UPDATE, `users/${uid}`);
      }
    }
    profile = { ...existingProfile, role: effectiveRole };
  }

  let staffSnap;
  try {
    staffSnap = await getDoc(staffRef);
  } catch (e) {
    handleFirestoreError(e, OperationType.GET, `staffDirectory/${uid}`);
  }

  if (!staffSnap.exists()) {
    const batch = writeBatch(db);
    batch.set(staffRef, {
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
    });
    try {
      await batch.commit();
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, `staffDirectory/${uid}`);
    }
  } else {
    const existingStaffRole = parseUserRole(staffSnap.data()?.role);
    if (existingStaffRole !== effectiveRole) {
      try {
        const batch = writeBatch(db);
        batch.update(staffRef, {
          role: effectiveRole,
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
      } catch {
        // Non-manager staff cannot mutate role; safe to ignore if restricted
      }
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
  const currentUid = requireUserId();
  if (currentUid !== uid) {
    throw new Error('Cannot update another user preferences.');
  }
  const cleanName = displayName.trim().slice(0, 80);
  const cleanDept = department.trim().slice(0, 60);
  const clampedTarget = Math.min(80, Math.max(1, weeklyHoursTarget));

  const batch = writeBatch(db);
  batch.update(doc(db, 'users', uid), {
    displayName: cleanName,
    department: cleanDept,
    weeklyHoursTarget: clampedTarget,
    pushNotificationsEnabled,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'staffDirectory', uid), {
    displayName: cleanName,
    department: cleanDept,
    weeklyHoursTarget: clampedTarget,
    updatedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (e) {
    handleFirestoreError(e, OperationType.UPDATE, `users/${uid}`);
  }
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
  const actorUid = requireUserId();
  const id = newId('shift');
  const duration = computeShiftHours(startTime, endTime);
  const effectiveUid = status === ShiftStatus.OPEN ? '' : assignedUid;
  const effectiveName = status === ShiftStatus.OPEN ? '' : assignedName;
  const cleanTitle = (title.trim() || 'Assigned Shift').slice(0, 120);

  const batch = writeBatch(db);
  batch.set(doc(db, 'shifts', id), {
    id,
    title: cleanTitle,
    department: department.trim().slice(0, 60),
    date,
    startTime,
    endTime,
    durationHours: duration,
    assignedUid: effectiveUid,
    assignedName: effectiveName,
    candidateUids: candidateUids.slice(0, 20),
    status,
    visibility: 'team',
    fairnessNote: fairnessNote.slice(0, 300),
    createdBy: createdBy || actorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (effectiveUid && effectiveUid !== actorUid && status !== ShiftStatus.OPEN) {
    const notifId = newId('ntf');
    batch.set(doc(db, 'notifications', notifId), {
      id: notifId,
      recipientUid: effectiveUid,
      title: 'New Shift Assigned',
      message: `${cleanTitle} on ${date} (${startTime}-${endTime}) was assigned to you.`.slice(0, 400),
      category: NotificationCategory.SHIFT_ASSIGNED,
      relatedShiftId: id,
      isRead: false,
      actorUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (e) {
    handleFirestoreError(e, OperationType.CREATE, `shifts/${id}`);
  }
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
  const actorUid = requireUserId();
  const docRef = doc(db, 'shifts', shiftId);
  let previousShift: Shift | null = null;
  try {
    const prevSnap = await getDoc(docRef);
    if (prevSnap.exists()) {
      previousShift = mapShift(prevSnap as QueryDocumentSnapshot<DocumentData>);
    }
  } catch {
    previousShift = null;
  }

  const duration = computeShiftHours(startTime, endTime);
  const effectiveUid = status === ShiftStatus.OPEN ? '' : assignedUid;
  const effectiveName = status === ShiftStatus.OPEN ? '' : assignedName;
  const cleanTitle = (title.trim() || 'Assigned Shift').slice(0, 120);

  const batch = writeBatch(db);
  batch.update(docRef, {
    title: cleanTitle,
    department: department.trim().slice(0, 60),
    date,
    startTime,
    endTime,
    durationHours: duration,
    assignedUid: effectiveUid,
    assignedName: effectiveName,
    status,
    fairnessNote: fairnessNote.slice(0, 300),
    updatedAt: serverTimestamp(),
  });

  if (effectiveUid && effectiveUid !== actorUid && status !== ShiftStatus.OPEN) {
    const isNewAssignment =
      !previousShift ||
      previousShift.assignedUid !== effectiveUid ||
      previousShift.status === ShiftStatus.OPEN;
    const scheduleChanged =
      !!previousShift &&
      (previousShift.date !== date ||
        previousShift.startTime !== startTime ||
        previousShift.endTime !== endTime ||
        previousShift.title !== cleanTitle);

    if (isNewAssignment || scheduleChanged) {
      const notifId = newId('ntf');
      const notifTitle = isNewAssignment
        ? 'New Shift Assigned'
        : 'Shift Schedule Updated';
      const notifMessage = isNewAssignment
        ? `${cleanTitle} on ${date} (${startTime}-${endTime}) was assigned to you.`
        : `Your shift ${cleanTitle} was updated to ${date} (${startTime}-${endTime}).`;
      batch.set(doc(db, 'notifications', notifId), {
        id: notifId,
        recipientUid: effectiveUid,
        title: notifTitle,
        message: notifMessage.slice(0, 400),
        category: NotificationCategory.SHIFT_ASSIGNED,
        relatedShiftId: shiftId,
        isRead: false,
        actorUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }

  try {
    await batch.commit();
  } catch (e) {
    handleFirestoreError(e, OperationType.UPDATE, `shifts/${shiftId}`);
  }
}

export async function deleteShift(shiftId: string): Promise<void> {
  requireUserId();
  const batch = writeBatch(db);
  batch.delete(doc(db, 'shifts', shiftId));
  try {
    await batch.commit();
  } catch (e) {
    handleFirestoreError(e, OperationType.DELETE, `shifts/${shiftId}`);
  }
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
): Promise<string> {
  requireUserId();
  const id = newId('chg');
  const batch = writeBatch(db);
  batch.set(doc(db, 'scheduleChanges', id), {
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
  });

  if (type !== ScheduleChangeType.CLAIM && shift.assignedUid === requesterUid) {
    batch.update(doc(db, 'shifts', shift.id), {
      status: ShiftStatus.PENDING_CHANGE,
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (e) {
    handleFirestoreError(e, OperationType.CREATE, `scheduleChanges/${id}`);
  }
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
  requireUserId();
  const batch = writeBatch(db);
  const typeLabel = req.type.replace('_', ' ');

  batch.update(doc(db, 'scheduleChanges', req.id), {
    status: decision,
    reviewedByUid: reviewerUid,
    reviewedByName: reviewerName,
    reviewNote: reviewNote.trim().slice(0, 300),
    updatedAt: serverTimestamp(),
  });

  if (shift) {
    const shiftRef = doc(db, 'shifts', shift.id);
    if (decision === ApprovalStatus.APPROVED) {
      batch.update(shiftRef, buildShiftApprovalUpdates(req, shift));
    } else {
      const restored = shift.assignedUid.trim()
        ? ShiftStatus.SCHEDULED
        : ShiftStatus.OPEN;
      batch.update(shiftRef, {
        status: restored,
        updatedAt: serverTimestamp(),
      });
    }
  }

  const isApproved = decision === ApprovalStatus.APPROVED;
  const notifId = newId('ntf');
  batch.set(doc(db, 'notifications', notifId), {
    id: notifId,
    recipientUid: req.requesterUid,
    title: isApproved ? 'Schedule Change Approved' : 'Schedule Change Denied',
    message: (isApproved
      ? `Your ${typeLabel} for ${req.shiftTitle} (${req.proposedDate} ${req.proposedStartTime}-${req.proposedEndTime}) was approved by ${reviewerName}.`
      : `Your ${typeLabel} for ${req.shiftTitle} was denied by ${reviewerName}.${reviewNote.trim() ? ` Note: ${reviewNote.trim()}` : ''}`
    ).slice(0, 400),
    category: isApproved
      ? NotificationCategory.SHIFT_APPROVED
      : NotificationCategory.SHIFT_DENIED,
    relatedShiftId: req.shiftId,
    isRead: false,
    actorUid: reviewerUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (
    isApproved &&
    req.proposedAssigneeUid &&
    req.proposedAssigneeUid !== req.requesterUid
  ) {
    const swapNotifId = newId('ntf');
    batch.set(doc(db, 'notifications', swapNotifId), {
      id: swapNotifId,
      recipientUid: req.proposedAssigneeUid,
      title: 'Shift Reassigned to You',
      message: `${req.shiftTitle} on ${req.proposedDate} (${req.proposedStartTime}-${req.proposedEndTime}) was approved for you by ${reviewerName}.`.slice(
        0,
        400,
      ),
      category: NotificationCategory.SHIFT_ASSIGNED,
      relatedShiftId: req.shiftId,
      isRead: false,
      actorUid: reviewerUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, `scheduleChanges/${req.id}`);
  }
}

export async function acceptAllPendingChanges(
  pendingRequests: ScheduleChangeRequest[],
  shifts: Shift[],
  reviewerUid: string,
  reviewerName: string,
): Promise<number> {
  requireUserId();
  if (pendingRequests.length === 0) return 0;
  const shiftMap = new Map(shifts.map((s) => [s.id, s]));

  let batch = writeBatch(db);
  let opCount = 0;

  const flushIfNeeded = async (needed: number) => {
    if (opCount + needed > CHUNK_SIZE) {
      await batch.commit();
      batch = writeBatch(db);
      opCount = 0;
    }
  };

  try {
    for (const req of pendingRequests) {
      const shift = shiftMap.get(req.shiftId);
      const extraNotif =
        Boolean(req.proposedAssigneeUid) &&
        req.proposedAssigneeUid !== req.requesterUid;
      const opsNeeded = 2 + (shift ? 1 : 0) + (extraNotif ? 1 : 0);
      await flushIfNeeded(opsNeeded);

      batch.update(doc(db, 'scheduleChanges', req.id), {
        status: ApprovalStatus.APPROVED,
        reviewedByUid: reviewerUid,
        reviewedByName: reviewerName,
        reviewNote: 'Approved via Accept All',
        updatedAt: serverTimestamp(),
      });
      opCount++;

      if (shift) {
        batch.update(
          doc(db, 'shifts', shift.id),
          buildShiftApprovalUpdates(req, shift),
        );
        opCount++;
      }

      const notifId = newId('ntf');
      batch.set(doc(db, 'notifications', notifId), {
        id: notifId,
        recipientUid: req.requesterUid,
        title: 'Schedule Change Approved',
        message: `Your ${req.type.replace('_', ' ')} for ${req.shiftTitle} (${req.proposedDate} ${req.proposedStartTime}-${req.proposedEndTime}) was batch-approved by ${reviewerName}.`.slice(
          0,
          400,
        ),
        category: NotificationCategory.SHIFT_APPROVED,
        relatedShiftId: req.shiftId,
        isRead: false,
        actorUid: reviewerUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      opCount++;

      if (extraNotif) {
        const swapNotifId = newId('ntf');
        batch.set(doc(db, 'notifications', swapNotifId), {
          id: swapNotifId,
          recipientUid: req.proposedAssigneeUid,
          title: 'Shift Reassigned to You',
          message: `${req.shiftTitle} on ${req.proposedDate} (${req.proposedStartTime}-${req.proposedEndTime}) was approved for you by ${reviewerName}.`.slice(
            0,
            400,
          ),
          category: NotificationCategory.SHIFT_ASSIGNED,
          relatedShiftId: req.shiftId,
          isRead: false,
          actorUid: reviewerUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        opCount++;
      }
    }
    if (opCount > 0) {
      await batch.commit();
    }
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, 'scheduleChanges');
  }
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
  requireUserId();
  const id = newId('rep');
  const clampedBreak = Math.min(180, Math.max(0, Math.round(breakMinutes)));
  const workedHours = computeShiftHours(actualStartTime, actualEndTime, clampedBreak);

  const batch = writeBatch(db);
  batch.set(doc(db, 'shiftReports', id), {
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
    workedHours,
    handoffNotes: handoffNotes.trim().slice(0, 600),
    status: ShiftReportStatus.SUBMITTED,
    verifiedByUid: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (e) {
    handleFirestoreError(e, OperationType.CREATE, `shiftReports/${id}`);
  }
  return id;
}

export async function verifyOrFlagShiftReport(
  report: ShiftReport,
  status: ShiftReportStatus,
  verifierUid: string,
  staffEntry: StaffDirectoryEntry | undefined,
  linkedShift: Shift | undefined,
): Promise<void> {
  requireUserId();
  const batch = writeBatch(db);
  batch.update(doc(db, 'shiftReports', report.id), {
    status,
    verifiedByUid: verifierUid,
    updatedAt: serverTimestamp(),
  });

  if (
    status === ShiftReportStatus.VERIFIED &&
    report.status !== ShiftReportStatus.VERIFIED
  ) {
    if (staffEntry) {
      batch.update(doc(db, 'staffDirectory', staffEntry.uid), {
        totalHoursWorked: round2(staffEntry.totalHoursWorked + report.workedHours),
        updatedAt: serverTimestamp(),
      });
    }
    if (linkedShift && linkedShift.status !== ShiftStatus.COMPLETED) {
      batch.update(doc(db, 'shifts', linkedShift.id), {
        status: ShiftStatus.COMPLETED,
        updatedAt: serverTimestamp(),
      });
    }
  }

  const notifId = newId('ntf');
  batch.set(doc(db, 'notifications', notifId), {
    id: notifId,
    recipientUid: report.staffUid,
    title:
      status === ShiftReportStatus.VERIFIED
        ? 'Shift Report Verified'
        : 'Shift Report Flagged',
    message: (status === ShiftReportStatus.VERIFIED
      ? `Your ${formatHours(report.workedHours)}h shift report for ${report.shiftTitle} (${report.date}) was verified.`
      : `Your shift report for ${report.shiftTitle} (${report.date}) was flagged for review.`
    ).slice(0, 400),
    category: NotificationCategory.REPORT_VERIFIED,
    relatedShiftId: report.shiftId,
    isRead: false,
    actorUid: verifierUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (e) {
    handleFirestoreError(e, OperationType.UPDATE, `shiftReports/${report.id}`);
  }
}

// --- Notifications ---

export async function markNotificationRead(
  notificationId: string,
  isRead: boolean,
): Promise<void> {
  requireUserId();
  const batch = writeBatch(db);
  batch.update(doc(db, 'notifications', notificationId), {
    isRead,
    updatedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (e) {
    handleFirestoreError(
      e,
      OperationType.UPDATE,
      `notifications/${notificationId}`,
    );
  }
}

export async function markAllNotificationsRead(
  notifications: PushNotificationRecord[],
): Promise<void> {
  requireUserId();
  const unread = notifications.filter((n) => !n.isRead);
  if (unread.length === 0) return;
  try {
    for (let i = 0; i < unread.length; i += CHUNK_SIZE) {
      const chunk = unread.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const n of chunk) {
        batch.update(doc(db, 'notifications', n.id), {
          isRead: true,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }
  } catch (e) {
    handleFirestoreError(e, OperationType.UPDATE, 'notifications');
  }
}

export async function sendTestPushNotification(
  uid: string,
  displayName: string,
): Promise<void> {
  const actorUid = requireUserId();
  const id = newId('ntf');
  const batch = writeBatch(db);
  batch.set(doc(db, 'notifications', id), {
    id,
    recipientUid: uid,
    title: 'Cadence Alert Test',
    message: `Real-time notification channel active for ${displayName}.`.slice(0, 400),
    category: NotificationCategory.SHIFT_ASSIGNED,
    relatedShiftId: '',
    isRead: false,
    actorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (e) {
    handleFirestoreError(e, OperationType.CREATE, `notifications/${id}`);
  }
}

// --- Fairness Plans & Weekly Schedule ---

export async function commitFairnessArrangementPlan(
  plan: FairnessArrangementItem[],
  actorUid: string,
): Promise<number> {
  requireUserId();
  if (plan.length === 0) return 0;
  const nowIso = new Date().toISOString();
  let batch = writeBatch(db);
  let ops = 0;

  const flushIfNeeded = async (needed: number) => {
    if (ops + needed > CHUNK_SIZE) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  };

  try {
    for (const item of plan) {
      await flushIfNeeded(3);
      batch.update(doc(db, 'shifts', item.shift.id), {
        assignedUid: item.chosenUid,
        assignedName: item.chosenName,
        status: ShiftStatus.SCHEDULED,
        fairnessNote: item.reason.slice(0, 300),
        updatedAt: serverTimestamp(),
      });
      ops++;

      batch.update(doc(db, 'staffDirectory', item.chosenUid), {
        lastAssignedAt: nowIso,
        updatedAt: serverTimestamp(),
      });
      ops++;

      const notifId = newId('ntf');
      batch.set(doc(db, 'notifications', notifId), {
        id: notifId,
        recipientUid: item.chosenUid,
        title: 'Overlap Resolved by Fairness',
        message: `${item.shift.title} (${item.shift.date} ${item.shift.startTime}-${item.shift.endTime}) assigned to you. ${item.reason}`.slice(
          0,
          400,
        ),
        category: NotificationCategory.FAIRNESS_REBALANCED,
        relatedShiftId: item.shift.id,
        isRead: false,
        actorUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      ops++;
    }
    if (ops > 0) await batch.commit();
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, 'shifts');
  }
  return plan.length;
}

export async function commitOpenShiftAssignmentPlan(
  plan: OpenShiftAssignmentItem[],
  actorUid: string,
): Promise<number> {
  requireUserId();
  if (plan.length === 0) return 0;
  const nowIso = new Date().toISOString();
  let batch = writeBatch(db);
  let ops = 0;

  const flushIfNeeded = async (needed: number) => {
    if (ops + needed > CHUNK_SIZE) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  };

  try {
    for (const item of plan) {
      await flushIfNeeded(3);
      batch.update(doc(db, 'shifts', item.shift.id), {
        assignedUid: item.chosenUid,
        assignedName: item.chosenName,
        status: ShiftStatus.SCHEDULED,
        fairnessNote: item.reason.slice(0, 300),
        updatedAt: serverTimestamp(),
      });
      ops++;

      batch.update(doc(db, 'staffDirectory', item.chosenUid), {
        lastAssignedAt: nowIso,
        updatedAt: serverTimestamp(),
      });
      ops++;

      const notifId = newId('ntf');
      batch.set(doc(db, 'notifications', notifId), {
        id: notifId,
        recipientUid: item.chosenUid,
        title: 'Open Shift Assigned',
        message: `${item.shift.title} on ${item.shift.date} (${item.shift.startTime}-${item.shift.endTime}) assigned to you.`.slice(
          0,
          400,
        ),
        category: NotificationCategory.SHIFT_ASSIGNED,
        relatedShiftId: item.shift.id,
        isRead: false,
        actorUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      ops++;
    }
    if (ops > 0) await batch.commit();
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, 'shifts');
  }
  return plan.length;
}

export async function commitWeeklyScheduleBatch(
  planned: GeneratedShiftSpec[],
  actorUid: string,
): Promise<{ assigned: number; open: number }> {
  requireUserId();
  if (planned.length === 0) return { assigned: 0, open: 0 };
  const nowIso = new Date().toISOString();
  let batch = writeBatch(db);
  let ops = 0;
  let assigned = 0;
  let open = 0;
  const touchedStaff = new Set<string>();

  const flushIfNeeded = async (needed: number) => {
    if (ops + needed > CHUNK_SIZE) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  };

  try {
    for (const spec of planned) {
      const shiftId = newId('shift');
      const hasAssignee =
        spec.status !== ShiftStatus.OPEN && spec.assignedUid.trim().length > 0;
      if (hasAssignee) assigned++;
      else open++;

      await flushIfNeeded(hasAssignee ? 2 : 1);
      batch.set(doc(db, 'shifts', shiftId), {
        id: shiftId,
        title: spec.title,
        department: spec.department,
        date: spec.date,
        startTime: spec.startTime,
        endTime: spec.endTime,
        durationHours: spec.durationHours,
        assignedUid: hasAssignee ? spec.assignedUid : '',
        assignedName: hasAssignee ? spec.assignedName : '',
        candidateUids: spec.candidateUids.slice(0, 20),
        status: spec.status,
        visibility: 'team',
        fairnessNote: spec.fairnessNote.slice(0, 300),
        createdBy: actorUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      ops++;

      if (hasAssignee) {
        touchedStaff.add(spec.assignedUid);
        const notifId = newId('ntf');
        batch.set(doc(db, 'notifications', notifId), {
          id: notifId,
          recipientUid: spec.assignedUid,
          title: 'Weekly Schedule Published',
          message: `You were scheduled for ${spec.title} on ${spec.date} (${spec.startTime}-${spec.endTime}).`.slice(
            0,
            400,
          ),
          category: NotificationCategory.SHIFT_ASSIGNED,
          relatedShiftId: shiftId,
          isRead: false,
          actorUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        ops++;
      }
    }

    for (const uid of touchedStaff) {
      await flushIfNeeded(1);
      batch.update(doc(db, 'staffDirectory', uid), {
        lastAssignedAt: nowIso,
        updatedAt: serverTimestamp(),
      });
      ops++;
    }

    if (ops > 0) await batch.commit();
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, 'shifts');
  }
  return { assigned, open };
}

// --- Shift Submissions ---

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
  requireUserId();
  const uniqueDates = Array.from(new Set(dates));
  if (uniqueDates.length === 0) return 0;

  try {
    for (let i = 0; i < uniqueDates.length; i += CHUNK_SIZE) {
      const chunk = uniqueDates.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const d of chunk) {
        const id = newId('sub');
        batch.set(doc(db, 'shiftSubmissions', id), {
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
        });
      }
      await batch.commit();
    }
  } catch (e) {
    handleFirestoreError(e, OperationType.CREATE, 'shiftSubmissions');
  }
  return uniqueDates.length;
}

export async function withdrawShiftSubmission(submissionId: string): Promise<void> {
  requireUserId();
  const batch = writeBatch(db);
  batch.update(doc(db, 'shiftSubmissions', submissionId), {
    status: SubmissionStatus.WITHDRAWN,
    updatedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (e) {
    handleFirestoreError(
      e,
      OperationType.UPDATE,
      `shiftSubmissions/${submissionId}`,
    );
  }
}

// --- Time Off Requests ---

export async function createTimeOffRequest(
  staffUid: string,
  staffName: string,
  department: string,
  startDate: string,
  endDate: string,
  reason: string,
): Promise<string> {
  requireUserId();
  const id = newId('to');
  const batch = writeBatch(db);
  batch.set(doc(db, 'timeOffRequests', id), {
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
  });
  try {
    await batch.commit();
  } catch (e) {
    handleFirestoreError(e, OperationType.CREATE, `timeOffRequests/${id}`);
  }
  return id;
}

export async function withdrawTimeOffRequest(requestId: string): Promise<void> {
  requireUserId();
  const batch = writeBatch(db);
  batch.delete(doc(db, 'timeOffRequests', requestId));
  try {
    await batch.commit();
  } catch (e) {
    handleFirestoreError(e, OperationType.DELETE, `timeOffRequests/${requestId}`);
  }
}

export async function decideTimeOffRequest(
  req: TimeOffRequest,
  decision: ApprovalStatus,
  reviewerUid: string,
  reviewerName: string,
  reviewNote: string,
): Promise<void> {
  requireUserId();
  const batch = writeBatch(db);
  batch.update(doc(db, 'timeOffRequests', req.id), {
    status: decision,
    reviewedByUid: reviewerUid,
    reviewedByName: reviewerName,
    reviewNote: reviewNote.trim().slice(0, 300),
    updatedAt: serverTimestamp(),
  });

  const isApproved = decision === ApprovalStatus.APPROVED;
  const notifId = newId('ntf');
  batch.set(doc(db, 'notifications', notifId), {
    id: notifId,
    recipientUid: req.staffUid,
    title: isApproved ? 'Time Off Approved' : 'Time Off Denied',
    message: (isApproved
      ? `Your time off request (${req.startDate} to ${req.endDate}) was approved by ${reviewerName}.`
      : `Your time off request (${req.startDate} to ${req.endDate}) was denied by ${reviewerName}.${reviewNote.trim() ? ` Note: ${reviewNote.trim()}` : ''}`
    ).slice(0, 400),
    category: isApproved
      ? NotificationCategory.TIME_OFF_APPROVED
      : NotificationCategory.TIME_OFF_DENIED,
    relatedShiftId: '',
    isRead: false,
    actorUid: reviewerUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (e) {
    handleFirestoreError(e, OperationType.UPDATE, `timeOffRequests/${req.id}`);
  }
}

// --- Team Roster & Roles ---

export async function addRosterStaffMember(
  displayName: string,
  department: string,
  weeklyHoursTarget: number,
  role: UserRole,
): Promise<string> {
  requireUserId();
  const uid = newId('roster');
  const batch = writeBatch(db);
  batch.set(doc(db, 'staffDirectory', uid), {
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
  });
  try {
    await batch.commit();
  } catch (e) {
    handleFirestoreError(e, OperationType.CREATE, `staffDirectory/${uid}`);
  }
  return uid;
}

export async function toggleManagerRole(
  targetEntry: StaffDirectoryEntry,
  grantManager: boolean,
  actorUid: string,
): Promise<void> {
  requireUserId();
  const newRole = grantManager ? UserRole.MANAGER : UserRole.STAFF;
  const batch = writeBatch(db);
  const managerRef = doc(db, 'managers', targetEntry.uid);
  const staffRef = doc(db, 'staffDirectory', targetEntry.uid);

  if (grantManager) {
    batch.set(managerRef, {
      uid: targetEntry.uid,
      grantedBy: actorUid,
      createdAt: serverTimestamp(),
    });
  } else {
    batch.delete(managerRef);
  }

  batch.update(staffRef, {
    role: newRole,
    updatedAt: serverTimestamp(),
  });

  const userRef = doc(db, 'users', targetEntry.uid);
  try {
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      batch.update(userRef, {
        role: newRole,
        updatedAt: serverTimestamp(),
      });
    }
  } catch {
    // Non-fatal if user profile isn't readable
  }

  try {
    await batch.commit();
  } catch (e) {
    handleFirestoreError(
      e,
      OperationType.WRITE,
      `staffDirectory/${targetEntry.uid}`,
    );
  }
}

export async function seedSampleWorkspaceData(
  actorUid: string,
  actorName: string,
): Promise<void> {
  requireUserId();
  const rustBundle = await invokeBuildSampleWorkspace(actorUid, actorName);
  if (rustBundle) {
    const batch = writeBatch(db);
    for (const member of rustBundle.roster) {
      batch.set(doc(db, 'staffDirectory', member.uid), {
        ...member,
        updatedAt: serverTimestamp(),
      });
    }
    for (const shift of rustBundle.shifts) {
      batch.set(doc(db, 'shifts', shift.id), {
        ...shift,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    for (const req of rustBundle.scheduleChanges) {
      batch.set(doc(db, 'scheduleChanges', req.id), {
        ...req,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    for (const rep of rustBundle.shiftReports) {
      batch.set(doc(db, 'shiftReports', rep.id), {
        ...rep,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    for (const sub of rustBundle.shiftSubmissions) {
      batch.set(doc(db, 'shiftSubmissions', sub.id), {
        ...sub,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    for (const to of rustBundle.timeOffRequests) {
      batch.set(doc(db, 'timeOffRequests', to.id), {
        ...to,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    try {
      await batch.commit();
      return;
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'staffDirectory');
    }
  }

  const day0 = getMondayIso();
  const day1 = addDaysIso(day0, 1);
  const day2 = addDaysIso(day0, 2);
  const day3 = addDaysIso(day0, 3);
  const day4 = addDaysIso(day0, 4);
  const day5 = addDaysIso(day0, 5);

  const batch = writeBatch(db);

  const sampleStaff = [
    {
      uid: 'sample_maya_patel',
      displayName: 'Maya Patel',
      role: 'staff',
      department: 'Operations',
      totalHoursWorked: 18,
      scheduledHoursThisWeek: 8,
      weeklyHoursTarget: 40,
      lastAssignedAt: '2026-10-01T08:00:00Z',
      isSampleRoster: true,
      updatedAt: serverTimestamp(),
    },
    {
      uid: 'sample_liam_brooks',
      displayName: 'Liam Brooks',
      role: 'staff',
      department: 'Support',
      totalHoursWorked: 36,
      scheduledHoursThisWeek: 16,
      weeklyHoursTarget: 40,
      lastAssignedAt: '2026-11-10T08:00:00Z',
      isSampleRoster: true,
      updatedAt: serverTimestamp(),
    },
    {
      uid: 'sample_noah_kim',
      displayName: 'Noah Kim',
      role: 'staff',
      department: 'Operations',
      totalHoursWorked: 24.5,
      scheduledHoursThisWeek: 8,
      weeklyHoursTarget: 32,
      lastAssignedAt: '2026-11-05T08:00:00Z',
      isSampleRoster: true,
      updatedAt: serverTimestamp(),
    },
  ];

  for (const member of sampleStaff) {
    batch.set(doc(db, 'staffDirectory', member.uid), member);
  }

  const shift1Id = 'sample_shift_overlap_1';
  batch.set(doc(db, 'shifts', shift1Id), {
    id: shift1Id,
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
    visibility: 'team',
    fairnessNote: '2 overlapping candidates — ready for fairness arrange',
    createdBy: actorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const shift2Id = 'sample_shift_overlap_2';
  batch.set(doc(db, 'shifts', shift2Id), {
    id: shift2Id,
    title: 'Midday Floor Support',
    department: 'Support',
    date: day2,
    startTime: '11:00',
    endTime: '19:00',
    durationHours: 8,
    assignedUid: 'sample_liam_brooks',
    assignedName: 'Liam Brooks',
    candidateUids: ['sample_liam_brooks', 'sample_noah_kim', 'sample_maya_patel'],
    status: ShiftStatus.CONFLICT,
    visibility: 'team',
    fairnessNote: '3 overlapping candidates — ready for fairness arrange',
    createdBy: actorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const shift3Id = 'sample_shift_pending_change';
  batch.set(doc(db, 'shifts', shift3Id), {
    id: shift3Id,
    title: 'Closing Desk Coverage',
    department: 'Operations',
    date: day0,
    startTime: '15:00',
    endTime: '23:00',
    durationHours: 8,
    assignedUid: 'sample_noah_kim',
    assignedName: 'Noah Kim',
    candidateUids: ['sample_noah_kim'],
    status: ShiftStatus.PENDING_CHANGE,
    visibility: 'team',
    fairnessNote: 'Change request pending manager decision',
    createdBy: actorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const shift4Id = 'sample_shift_open_slot';
  batch.set(doc(db, 'shifts', shift4Id), {
    id: shift4Id,
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
    visibility: 'team',
    fairnessNote: 'Open shift awaiting fairness assignment',
    createdBy: actorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'scheduleChanges', 'sample_change_req_1'), {
    id: 'sample_change_req_1',
    shiftId: shift3Id,
    shiftTitle: 'Closing Desk Coverage',
    requesterUid: 'sample_noah_kim',
    requesterName: 'Noah Kim',
    type: ScheduleChangeType.SWAP,
    currentDate: day0,
    currentStartTime: '15:00',
    currentEndTime: '23:00',
    proposedDate: day0,
    proposedStartTime: '15:00',
    proposedEndTime: '23:00',
    proposedAssigneeUid: 'sample_maya_patel',
    proposedAssigneeName: 'Maya Patel',
    reason: 'Swapping with Maya to balance weekly hours.',
    status: ApprovalStatus.PENDING,
    reviewedByUid: '',
    reviewedByName: '',
    reviewNote: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'scheduleChanges', 'sample_change_req_2'), {
    id: 'sample_change_req_2',
    shiftId: shift1Id,
    shiftTitle: 'Morning Operations Lead',
    requesterUid: 'sample_liam_brooks',
    requesterName: 'Liam Brooks',
    type: ScheduleChangeType.TIME_CHANGE,
    currentDate: day1,
    currentStartTime: '07:00',
    currentEndTime: '15:00',
    proposedDate: day1,
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
  });

  batch.set(doc(db, 'shiftReports', 'sample_report_1'), {
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
  });

  batch.set(doc(db, 'timeOffRequests', 'sample_timeoff_1'), {
    id: 'sample_timeoff_1',
    staffUid: 'sample_maya_patel',
    staffName: 'Maya Patel',
    department: 'Operations',
    startDate: day4,
    endDate: day5,
    reason: 'Family weekend out of town.',
    status: ApprovalStatus.PENDING,
    reviewedByUid: '',
    reviewedByName: '',
    reviewNote: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, 'staffDirectory');
  }
}
