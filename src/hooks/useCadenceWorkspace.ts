import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, unwrapFirestoreErrorMessage } from '../firebase';
import { DEFAULT_WEEK_SLOTS } from '../domain/fairnessEngine';
import {
  acceptAllPendingChanges,
  addRosterStaffMember,
  commitFairnessPlanInRust,
  commitOpenShiftPlanInRust,
  createShift,
  createTimeOffRequest,
  decideScheduleChange,
  decideTimeOffRequest,
  deleteShift,
  ensureVerifiedUserProvisioned,
  generateWeeklyScheduleInRust,
  markAllNotificationsRead,
  markNotificationRead,
  seedSampleWorkspaceData,
  sendTestPushNotification,
  submitScheduleChangeRequest,
  submitShiftAvailabilityBatch,
  submitShiftReport,
  subscribeNotifications,
  subscribeScheduleChanges,
  subscribeShiftReports,
  subscribeShifts,
  subscribeShiftSubmissions,
  subscribeStaffDirectory,
  subscribeTimeOffRequests,
  subscribeUserProfile,
  toggleManagerRole,
  updateShift,
  updateUserPreferences,
  verifyOrFlagShiftReport,
  withdrawShiftSubmission,
  withdrawTimeOffRequest,
} from '../services/cadenceRepository';
import { signOutUser } from '../services/authService';
import {
  ApprovalStatus,
  DerivedWorkspaceInsights,
  ProfileUiState,
  PushNotificationRecord,
  ScheduleChangeRequest,
  ScheduleChangeType,
  Shift,
  ShiftReport,
  ShiftReportStatus,
  ShiftStatus,
  ShiftSubmission,
  StaffDirectoryEntry,
  TimeOffRequest,
  UpdateCheckResult,
  UserProfile,
  UserRole,
  WeekSlotConfig,
  WorkspaceUiData,
} from '../types/cadence';
import {
  buildManagerWorkPayloads,
  dispatchOsNotification,
  filterNewManagerWorkAlertsWithRust,
  filterUnnotifiedAlertsWithRust,
} from '../utils/notificationHelper';
import {
  getDesktopAppVersion,
  invokeBuildManagerWorkPayloads,
  invokeLoadWeekSlots,
  invokeSaveWeekSlots,
  invokeSyncWorkspaceSnapshot,
  isTauriDesktop,
} from '../utils/tauriBridge';
import { checkForGitHubUpdate } from '../utils/updateChecker';
import { translateStatic } from '../i18n/I18nContext';

const WEEK_SLOTS_STORAGE_KEY = 'cadence_week_slots_v1';

function loadSavedWeekSlots(): WeekSlotConfig[] {
  try {
    const raw = localStorage.getItem(WEEK_SLOTS_STORAGE_KEY);
    if (!raw) return DEFAULT_WEEK_SLOTS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as WeekSlotConfig[];
    }
  } catch {
    // Fallback to default templates
  }
  return DEFAULT_WEEK_SLOTS;
}

export function useCadenceWorkspace() {
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authRevision, setAuthRevision] = useState(0);

  const [profileState, setProfileState] = useState<ProfileUiState>({
    status: 'loading',
  });

  const [staffDirectory, setStaffDirectory] = useState<StaffDirectoryEntry[]>(
    [],
  );
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [scheduleChanges, setScheduleChanges] = useState<
    ScheduleChangeRequest[]
  >([]);
  const [shiftReports, setShiftReports] = useState<ShiftReport[]>([]);
  const [shiftSubmissions, setShiftSubmissions] = useState<ShiftSubmission[]>(
    [],
  );
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [notifications, setNotifications] = useState<PushNotificationRecord[]>(
    [],
  );
  const [rustInsights, setRustInsights] =
    useState<DerivedWorkspaceInsights | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  const [appVersion, setAppVersion] = useState('1.1.0');
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(
    null,
  );
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [weekSlots, setWeekSlots] = useState<WeekSlotConfig[]>(loadSavedWeekSlots);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const showFeedback = useCallback((msg: string) => {
    setFeedbackMsg(msg);
  }, []);

  useEffect(() => {
    if (!feedbackMsg) return;
    const timer = window.setTimeout(() => setFeedbackMsg(null), 4500);
    return () => window.clearTimeout(timer);
  }, [feedbackMsg]);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setAuthReady(true);
      if (!user || !user.emailVerified) {
        setProfileState({ status: 'loading' });
        setStaffDirectory([]);
        setShifts([]);
        setScheduleChanges([]);
        setShiftReports([]);
        setShiftSubmissions([]);
        setTimeOffRequests([]);
        setNotifications([]);
        setRustInsights(null);
        setStreamError(null);
      }
    });
    return unsub;
  }, []);

  // Provision verified user and attach profile + manager role stream
  useEffect(() => {
    if (!authUser || !authUser.emailVerified) return;

    let cancelled = false;
    let unsubProfile: (() => void) | null = null;

    setProfileState({ status: 'loading' });

    ensureVerifiedUserProvisioned(authUser)
      .then((initialProfile) => {
        if (cancelled) return;
        setProfileState({ status: 'ready', profile: initialProfile });
        unsubProfile = subscribeUserProfile(
          authUser.uid,
          authUser.email ?? '',
          initialProfile,
          (updated) => {
            if (!cancelled) {
              setProfileState({ status: 'ready', profile: updated });
            }
          },
          (err) => {
            if (!cancelled) {
              setStreamError(unwrapFirestoreErrorMessage(err));
            }
          },
        );
      })
      .catch((err) => {
        if (!cancelled) {
          setProfileState({
            status: 'error',
            message: unwrapFirestoreErrorMessage(err),
          });
        }
      });

    return () => {
      cancelled = true;
      unsubProfile?.();
    };
  }, [authUser, authRevision]);

  const activeProfile: UserProfile | null =
    profileState.status === 'ready' ? profileState.profile : null;
  const activeUid = activeProfile?.uid ?? null;
  const isManager = activeProfile?.role === UserRole.MANAGER;

  // Attach Firestore workspace streams strictly when user is verified and provisioned
  useEffect(() => {
    if (!authUser || !authUser.emailVerified || !activeUid) return;

    const handleErr = (err: unknown) => {
      setStreamError(unwrapFirestoreErrorMessage(err));
    };

    const unsubs = [
      subscribeStaffDirectory(setStaffDirectory, handleErr),
      subscribeShifts(activeUid, setShifts, handleErr),
      subscribeScheduleChanges(activeUid, isManager, setScheduleChanges, handleErr),
      subscribeShiftReports(activeUid, isManager, setShiftReports, handleErr),
      subscribeShiftSubmissions(
        activeUid,
        isManager,
        setShiftSubmissions,
        handleErr,
      ),
      subscribeTimeOffRequests(
        activeUid,
        isManager,
        setTimeOffRequests,
        handleErr,
      ),
      subscribeNotifications(activeUid, isManager, setNotifications, handleErr),
    ];

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [authUser, activeUid, isManager]);

  // Mirror live Firestore snapshot into Rust WorkspaceCacheState to derive KPIs, conflicts & roster stats
  useEffect(() => {
    if (!activeProfile || !isTauriDesktop()) {
      setRustInsights(null);
      return;
    }
    let cancelled = false;
    void invokeSyncWorkspaceSnapshot({
      profile: activeProfile,
      staffDirectory,
      shifts,
      scheduleChanges,
      shiftReports,
      shiftSubmissions,
      timeOffRequests,
      notifications,
    }).then((derived) => {
      if (!cancelled && derived) {
        setRustInsights(derived);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    activeProfile,
    staffDirectory,
    shifts,
    scheduleChanges,
    shiftReports,
    shiftSubmissions,
    timeOffRequests,
    notifications,
  ]);

  // OS / Windows desktop toast dispatch for unread notifications (deduplicated in Rust LocalStoreState)
  useEffect(() => {
    if (!activeProfile) return;
    let cancelled = false;
    void filterUnnotifiedAlertsWithRust(
      activeProfile.uid,
      notifications,
      activeProfile.pushNotificationsEnabled,
    ).then((fresh) => {
      if (cancelled) return;
      fresh.slice(0, 3).forEach((item) => {
        void dispatchOsNotification(item.title, item.message);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [notifications, activeProfile]);

  // OS / Windows toast alerts for manager queues (pending changes, time off, submitted reports)
  useEffect(() => {
    if (!activeProfile || activeProfile.role !== UserRole.MANAGER) return;
    let cancelled = false;
    const dispatchPayloads = async () => {
      const rustPayloads = await invokeBuildManagerWorkPayloads(
        activeProfile.uid,
        scheduleChanges,
        timeOffRequests,
        shiftReports,
      );
      if (cancelled) return;
      const payloads =
        rustPayloads ??
        buildManagerWorkPayloads(
          activeProfile.uid,
          scheduleChanges,
          timeOffRequests,
          shiftReports,
        );
      const fresh = await filterNewManagerWorkAlertsWithRust(
        activeProfile.uid,
        payloads,
        activeProfile.pushNotificationsEnabled,
      );
      if (cancelled) return;
      fresh.slice(0, 3).forEach((item) => {
        void dispatchOsNotification(item.title, item.message);
      });
    };
    void dispatchPayloads();
    return () => {
      cancelled = true;
    };
  }, [activeProfile, scheduleChanges, timeOffRequests, shiftReports]);

  const runUpdateCheck = useCallback(async (openIfUpdateFound = false) => {
    setCheckingUpdate(true);
    try {
      const res = await checkForGitHubUpdate();
      if (res) {
        setUpdateResult(res);
        if (openIfUpdateFound && res.updateAvailable) {
          setUpdateDialogOpen(true);
        }
      }
      return res;
    } finally {
      setCheckingUpdate(false);
    }
  }, []);

  // Load app version, Rust-persisted week slots, update check, and tray events
  useEffect(() => {
    void getDesktopAppVersion().then(setAppVersion);
    if (isTauriDesktop()) {
      void invokeLoadWeekSlots().then((loaded) => {
        if (Array.isArray(loaded) && loaded.length > 0) {
          setWeekSlots(loaded);
        }
      });
    }
    void runUpdateCheck(true);

    let unlisten: (() => void) | null = null;
    if (isTauriDesktop()) {
      void import('@tauri-apps/api/event').then(async ({ listen }) => {
        unlisten = await listen('cadence://check-updates', () => {
          void runUpdateCheck(true).then((res) => {
            if (res && !res.updateAvailable) {
              setUpdateDialogOpen(true);
            }
          });
        });
      });
    }
    return () => {
      unlisten?.();
    };
  }, [runUpdateCheck]);

  const refreshVerifiedUser = useCallback(() => {
    setAuthUser(auth.currentUser);
    setAuthRevision((r) => r + 1);
  }, []);

  const saveWeekSlots = useCallback(
    async (slots: WeekSlotConfig[]) => {
      try {
        const persisted = isTauriDesktop()
          ? await invokeSaveWeekSlots(slots)
          : slots;
        setWeekSlots(persisted);
        try {
          localStorage.setItem(WEEK_SLOTS_STORAGE_KEY, JSON.stringify(persisted));
        } catch {
          // Storage unavailable
        }
        showFeedback(translateStatic('vm_banner_slots_updated'));
      } catch (err) {
        showFeedback(unwrapFirestoreErrorMessage(err));
      }
    },
    [showFeedback],
  );

  const data: WorkspaceUiData | null = activeProfile
    ? {
        profile: activeProfile,
        staffDirectory,
        shifts,
        scheduleChanges,
        shiftReports,
        shiftSubmissions,
        timeOffRequests,
        notifications,
        rustInsights,
        streamError,
      }
    : null;

  return {
    authReady,
    authUser,
    profileState,
    data,
    appVersion,
    updateResult,
    checkingUpdate,
    updateDialogOpen,
    setUpdateDialogOpen,
    weekSlots,
    feedbackMsg,
    showFeedback,
    refreshVerifiedUser,
    saveWeekSlots,
    runUpdateCheck,
    actions: {
      signOut: signOutUser,
      savePreferences: async (
        displayName: string,
        department: string,
        weeklyHoursTarget: number,
        pushNotificationsEnabled: boolean,
      ) => {
        if (!activeProfile) return;
        await updateUserPreferences(
          activeProfile.uid,
          displayName,
          department,
          weeklyHoursTarget,
          pushNotificationsEnabled,
        );
        showFeedback(translateStatic('vm_banner_prefs_saved'));
      },
      createShift: async (params: {
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
      }) => {
        if (!activeProfile) return;
        await createShift(
          params.title,
          params.department,
          params.date,
          params.startTime,
          params.endTime,
          params.assignedUid,
          params.assignedName,
          params.candidateUids,
          params.status,
          params.fairnessNote,
          activeProfile.uid,
        );
        showFeedback(translateStatic('vm_banner_shift_scheduled', params.title));
      },
      updateShift: async (params: {
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
      }) => {
        await updateShift(
          params.shiftId,
          params.title,
          params.department,
          params.date,
          params.startTime,
          params.endTime,
          params.assignedUid,
          params.assignedName,
          params.status,
          params.fairnessNote,
        );
        showFeedback(translateStatic('vm_banner_shift_updated', params.title));
      },
      deleteShift: async (shiftId: string) => {
        await deleteShift(shiftId);
        showFeedback(translateStatic('vm_banner_shift_removed'));
      },
      submitScheduleChange: async (params: {
        shift: Shift;
        type: ScheduleChangeType;
        proposedDate: string;
        proposedStartTime: string;
        proposedEndTime: string;
        proposedAssigneeUid: string;
        proposedAssigneeName: string;
        reason: string;
      }) => {
        if (!activeProfile) return;
        await submitScheduleChangeRequest(
          params.shift,
          activeProfile.uid,
          activeProfile.displayName,
          params.type,
          params.proposedDate,
          params.proposedStartTime,
          params.proposedEndTime,
          params.proposedAssigneeUid,
          params.proposedAssigneeName,
          params.reason,
          activeProfile.role === UserRole.MANAGER,
        );
        showFeedback(translateStatic('vm_banner_change_submitted'));
      },
      decideScheduleChange: async (
        req: ScheduleChangeRequest,
        decision: ApprovalStatus,
        reviewNote: string,
      ) => {
        if (!activeProfile) return;
        const shift = shifts.find((s) => s.id === req.shiftId);
        await decideScheduleChange(
          req,
          shift,
          decision,
          activeProfile.uid,
          activeProfile.displayName,
          reviewNote,
        );
      },
      acceptAllPending: async () => {
        if (!activeProfile) return 0;
        const pending = scheduleChanges.filter(
          (c) => c.status === ApprovalStatus.PENDING,
        );
        return acceptAllPendingChanges(
          pending,
          shifts,
          activeProfile.uid,
          activeProfile.displayName,
        );
      },
      submitShiftReport: async (params: {
        shiftId: string;
        shiftTitle: string;
        department: string;
        date: string;
        actualStartTime: string;
        actualEndTime: string;
        breakMinutes: number;
        handoffNotes: string;
      }) => {
        if (!activeProfile) return;
        await submitShiftReport(
          params.shiftId,
          params.shiftTitle,
          activeProfile.uid,
          activeProfile.displayName,
          params.department,
          params.date,
          params.actualStartTime,
          params.actualEndTime,
          params.breakMinutes,
          params.handoffNotes,
        );
      },
      verifyOrFlagReport: async (
        report: ShiftReport,
        status: ShiftReportStatus,
      ) => {
        if (!activeProfile) return;
        const staffEntry = staffDirectory.find(
          (s) => s.uid === report.staffUid,
        );
        const linkedShift = shifts.find((s) => s.id === report.shiftId);
        await verifyOrFlagShiftReport(
          report,
          status,
          activeProfile.uid,
          staffEntry,
          linkedShift,
        );
      },
      markNotificationRead: markNotificationRead,
      markAllNotificationsRead: () => markAllNotificationsRead(notifications),
      sendTestAlert: async () => {
        if (!activeProfile) return;
        await sendTestPushNotification(
          activeProfile.uid,
          activeProfile.displayName,
        );
      },
      commitFairnessPlan: async () => {
        if (!activeProfile) return 0;
        return commitFairnessPlanInRust(
          shifts,
          staffDirectory,
          timeOffRequests,
          activeProfile.uid,
        );
      },
      commitOpenShiftPlan: async () => {
        if (!activeProfile) return 0;
        return commitOpenShiftPlanInRust(
          shifts,
          staffDirectory,
          shiftSubmissions,
          timeOffRequests,
          false,
          activeProfile.uid,
        );
      },
      generateWeeklySchedule: async (mondayIso: string) => {
        if (!activeProfile) return { assigned: 0, open: 0 };
        return generateWeeklyScheduleInRust(
          mondayIso,
          weekSlots,
          staffDirectory,
          shifts,
          shiftSubmissions,
          timeOffRequests,
          activeProfile.uid,
        );
      },
      submitAvailabilityBatch: async (params: {
        dates: string[];
        startTime: string;
        endTime: string;
        shiftTitle: string;
        department: string;
        notes: string;
      }) => {
        if (!activeProfile) return;
        const count = await submitShiftAvailabilityBatch(
          activeProfile.uid,
          activeProfile.displayName,
          params.department,
          params.dates,
          params.startTime,
          params.endTime,
          params.shiftTitle,
          params.notes,
        );
        showFeedback(translateStatic('vm_banner_availability_submitted', count));
      },
      withdrawSubmission: withdrawShiftSubmission,
      createTimeOffRequest: async (
        startDate: string,
        endDate: string,
        reason: string,
      ) => {
        if (!activeProfile) return;
        await createTimeOffRequest(
          activeProfile.uid,
          activeProfile.displayName,
          activeProfile.department,
          startDate,
          endDate,
          reason,
        );
      },
      withdrawTimeOffRequest: withdrawTimeOffRequest,
      decideTimeOffRequest: async (
        req: TimeOffRequest,
        decision: ApprovalStatus,
        reviewNote: string,
      ) => {
        if (!activeProfile) return;
        await decideTimeOffRequest(
          req,
          decision,
          activeProfile.uid,
          activeProfile.displayName,
          reviewNote,
        );
      },
      addRosterStaff: async (
        displayName: string,
        department: string,
        weeklyHoursTarget: number,
        role: UserRole,
      ) => {
        await addRosterStaffMember(
          displayName,
          department,
          weeklyHoursTarget,
          role,
        );
      },
      toggleManagerRole: async (
        member: StaffDirectoryEntry,
        grantManager: boolean,
      ) => {
        if (!activeProfile) return;
        await toggleManagerRole(member, grantManager, activeProfile.uid);
      },
      seedSampleData: async () => {
        if (!activeProfile) return;
        await seedSampleWorkspaceData(
          activeProfile.uid,
          activeProfile.displayName,
        );
      },
    },
  };
}
