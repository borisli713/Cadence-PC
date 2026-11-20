import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Bell,
  Calendar,
  CalendarCheck,
  CalendarOff,
  CheckCircle2,
  ClipboardCheck,
  Download,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { formatIsoDate } from './domain/fairnessEngine';
import { useCadenceWorkspace } from './hooks/useCadenceWorkspace';
import {
  ApprovalStatus,
  CadenceTab,
  Shift,
  ShiftStatus,
  UserRole,
} from './types/cadence';
import { AuthScreen } from './components/AuthScreen';
import {
  AppUpdateDialog,
  ProfileSettingsDialog,
} from './components/ProfileAndUpdateDialogs';
import {
  AddShiftDialog,
  EditShiftDialog,
  RequestChangeDialog,
  ShiftDetailDialog,
  SubmitAvailabilityDialog,
  WeekSlotsDialog,
} from './components/ScheduleDialogs';
import { StatusChip } from './components/UiPrimitives';
import { OverviewScreen } from './screens/OverviewScreen';
import { MyScheduleScreen } from './screens/MyScheduleScreen';
import { ScheduleFairnessScreen } from './screens/ScheduleFairnessScreen';
import { ShiftReportsScreen } from './screens/ShiftReportsScreen';
import { ManagerApprovalsScreen } from './screens/ManagerApprovalsScreen';
import { ShiftHistoryScreen } from './screens/ShiftHistoryScreen';
import { TeamHoursScreen } from './screens/TeamHoursScreen';
import { TimeOffRequestsScreen } from './screens/TimeOffRequestsScreen';
import { NotificationsScreen } from './screens/NotificationsScreen';

interface NavItem {
  id: CadenceTab;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

export function App() {
  const {
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
    actions,
  } = useCadenceWorkspace();

  const [activeTab, setActiveTab] = useState<CadenceTab>(CadenceTab.OVERVIEW);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Dialog & modal triggers shared across screens
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inspectedShift, setInspectedShift] = useState<Shift | null>(null);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [addShiftDefaultDate, setAddShiftDefaultDate] = useState<string | null>(
    null,
  );
  const [changeReqShift, setChangeReqShift] = useState<Shift | null>(null);
  const [changeReqOpen, setChangeReqOpen] = useState(false);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [weekSlotsOpen, setWeekSlotsOpen] = useState(false);

  const [prelinkedReportShift, setPrelinkedReportShift] =
    useState<Shift | null>(null);
  const [openReportModalOnNav, setOpenReportModalOnNav] = useState(false);

  const navItems: NavItem[] = useMemo(() => {
    const pendingChanges =
      data?.scheduleChanges.filter((c) => c.status === ApprovalStatus.PENDING)
        .length ?? 0;
    const pendingTimeOff =
      data?.timeOffRequests.filter((t) => t.status === ApprovalStatus.PENDING)
        .length ?? 0;
    const unreadNotifs =
      data?.notifications.filter((n) => !n.isRead).length ?? 0;
    const overlaps =
      data?.shifts.filter(
        (s) => s.status === ShiftStatus.CONFLICT || s.candidateUids.length > 1,
      ).length ?? 0;

    return [
      {
        id: CadenceTab.OVERVIEW,
        label: 'Overview',
        icon: <LayoutDashboard className="w-4 h-4" />,
      },
      {
        id: CadenceTab.MY_SCHEDULE,
        label: 'My Schedule',
        icon: <CalendarCheck className="w-4 h-4" />,
      },
      {
        id: CadenceTab.SCHEDULE,
        label: 'Schedule & Fairness',
        icon: <Sparkles className="w-4 h-4" />,
        badge: overlaps > 0 ? overlaps : undefined,
      },
      {
        id: CadenceTab.REPORTS,
        label: 'Shift Reports',
        icon: <ClipboardCheck className="w-4 h-4" />,
      },
      {
        id: CadenceTab.APPROVALS,
        label: 'Approvals',
        icon: <CheckCircle2 className="w-4 h-4" />,
        badge: pendingChanges > 0 ? pendingChanges : undefined,
      },
      {
        id: CadenceTab.HISTORY,
        label: 'Shift History',
        icon: <History className="w-4 h-4" />,
      },
      {
        id: CadenceTab.TEAM,
        label: 'Team Hours',
        icon: <Users className="w-4 h-4" />,
      },
      {
        id: CadenceTab.TIME_OFF,
        label: 'Time Off',
        icon: <CalendarOff className="w-4 h-4" />,
        badge: pendingTimeOff > 0 ? pendingTimeOff : undefined,
      },
      {
        id: CadenceTab.NOTIFICATIONS,
        label: 'Notifications',
        icon: <Bell className="w-4 h-4" />,
        badge: unreadNotifs > 0 ? unreadNotifs : undefined,
      },
    ];
  }, [data]);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-sm font-semibold text-slate-500">
          Initializing Cadence workspace...
        </div>
      </div>
    );
  }

  if (!authUser || !authUser.emailVerified) {
    return (
      <AuthScreen
        pendingUser={authUser}
        onVerifiedSuccess={refreshVerifiedUser}
      />
    );
  }

  if (profileState.status === 'loading' || !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl px-6 py-5 text-sm text-slate-700 font-medium">
          Syncing verified workspace profile...
        </div>
      </div>
    );
  }

  if (profileState.status === 'error') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Unable to load workspace profile
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                {profileState.message}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refreshVerifiedUser}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold cursor-pointer"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => actions.signOut()}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-xs font-semibold cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isManager = data.profile.role === UserRole.MANAGER;

  const openChangeRequestModal = (shift: Shift | null) => {
    setChangeReqShift(shift);
    setChangeReqOpen(true);
  };

  const openLogReport = (shift: Shift | null) => {
    setPrelinkedReportShift(shift);
    setOpenReportModalOnNav(true);
    setActiveTab(CadenceTab.REPORTS);
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white border-r border-slate-200">
      <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <img
            src="/cadence-icon.png"
            alt="Cadence logo"
            className="w-8 h-8 rounded-lg border border-slate-200 object-cover shrink-0"
          />
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900 truncate">
              Cadence
            </div>
            <div className="text-[11px] font-mono-tabular text-slate-500">
              v{appVersion} · Windows
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
          aria-label="Close navigation"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        {navItems.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveTab(item.id);
                setMobileNavOpen(false);
              }}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                active
                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                  : 'text-slate-700 hover:bg-slate-100 border border-transparent'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                {item.icon}
                <span className="truncate">{item.label}</span>
              </span>
              {item.badge !== undefined && (
                <span
                  className={`font-mono-tabular text-[11px] px-1.5 py-0.5 rounded-md ${
                    active
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-slate-200 space-y-2.5">
        {updateResult?.updateAvailable && (
          <button
            type="button"
            onClick={() => setUpdateDialogOpen(true)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold cursor-pointer hover:bg-emerald-100"
          >
            <span className="flex items-center gap-1.5 truncate">
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                Update v{updateResult.latest.versionName}
              </span>
            </span>
            <span>View</span>
          </button>
        )}

        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-bold text-slate-900 truncate">
              {data.profile.displayName}
            </div>
            <StatusChip
              label={isManager ? 'Manager' : 'Staff'}
              tone={isManager ? 'violet' : 'neutral'}
            />
          </div>
          <div className="text-[11px] text-slate-500 truncate mt-0.5">
            {data.profile.department}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Settings</span>
          </button>
          <button
            type="button"
            onClick={() => actions.signOut()}
            className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-rose-50 hover:text-rose-700 text-xs font-semibold text-slate-700 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden flex"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMobileNavOpen(false);
          }}
        >
          <div className="fixed inset-0 bg-slate-900/40" />
          <div className="relative z-10 w-64 max-w-[80vw] h-full">
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile Header */}
        <header className="lg:hidden sticky top-0 z-30 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="p-1.5 rounded-lg border border-slate-200 text-slate-700 cursor-pointer"
            aria-label="Open navigation"
          >
            <Menu className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <Calendar className="w-4 h-4 text-blue-600 shrink-0" />
            <span className="text-sm font-bold text-slate-900 truncate">
              {navItems.find((i) => i.id === activeTab)?.label ?? 'Cadence'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="p-1.5 rounded-lg border border-slate-200 text-slate-700 cursor-pointer"
            aria-label="Open settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </header>

        <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
          {data.streamError && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{data.streamError}</span>
            </div>
          )}

          {feedbackMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-900 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{feedbackMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => showFeedback('')}
                className="text-emerald-700 hover:text-emerald-950 font-semibold cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {activeTab === CadenceTab.OVERVIEW && (
            <OverviewScreen
              data={data}
              onNavigate={setActiveTab}
              onQuickLogReport={() => openLogReport(null)}
              onQuickRequestChange={() => openChangeRequestModal(null)}
            />
          )}

          {activeTab === CadenceTab.MY_SCHEDULE && (
            <MyScheduleScreen
              data={data}
              onNavigate={setActiveTab}
              onInspectShift={setInspectedShift}
              onRequestChange={openChangeRequestModal}
              onLogReportForShift={(shift) => openLogReport(shift)}
              onShowFeedback={showFeedback}
            />
          )}

          {activeTab === CadenceTab.SCHEDULE && (
            <ScheduleFairnessScreen
              data={data}
              weekSlots={weekSlots}
              onNavigate={setActiveTab}
              onInspectShift={setInspectedShift}
              onOpenAddShift={(defaultDate) =>
                setAddShiftDefaultDate(defaultDate)
              }
              onOpenSubmitAvailability={() => setAvailabilityOpen(true)}
              onOpenWeekSlots={() => setWeekSlotsOpen(true)}
              onRequestChangeForShift={openChangeRequestModal}
              onCommitFairnessPlan={actions.commitFairnessPlan}
              onCommitOpenShiftPlan={actions.commitOpenShiftPlan}
              onGenerateWeeklySchedule={actions.generateWeeklySchedule}
              onWithdrawSubmission={actions.withdrawSubmission}
              onShowFeedback={showFeedback}
            />
          )}

          {activeTab === CadenceTab.REPORTS && (
            <ShiftReportsScreen
              data={data}
              prelinkedShift={prelinkedReportShift}
              openLogModalInitially={openReportModalOnNav}
              onConsumedInitialModal={() => setOpenReportModalOnNav(false)}
              onSubmitReport={actions.submitShiftReport}
              onVerifyOrFlag={actions.verifyOrFlagReport}
              onShowFeedback={showFeedback}
            />
          )}

          {activeTab === CadenceTab.APPROVALS && (
            <ManagerApprovalsScreen
              data={data}
              onNavigate={setActiveTab}
              onOpenNewRequest={() => openChangeRequestModal(null)}
              onDecideChange={actions.decideScheduleChange}
              onAcceptAllPending={actions.acceptAllPending}
              onShowFeedback={showFeedback}
            />
          )}

          {activeTab === CadenceTab.HISTORY && (
            <ShiftHistoryScreen data={data} />
          )}

          {activeTab === CadenceTab.TEAM && (
            <TeamHoursScreen
              data={data}
              onAddRosterStaff={actions.addRosterStaff}
              onToggleManagerRole={actions.toggleManagerRole}
              onSeedSampleData={actions.seedSampleData}
              onShowFeedback={showFeedback}
            />
          )}

          {activeTab === CadenceTab.TIME_OFF && (
            <TimeOffRequestsScreen
              data={data}
              onCreateRequest={actions.createTimeOffRequest}
              onWithdrawRequest={actions.withdrawTimeOffRequest}
              onDecideRequest={actions.decideTimeOffRequest}
              onShowFeedback={showFeedback}
            />
          )}

          {activeTab === CadenceTab.NOTIFICATIONS && (
            <NotificationsScreen
              data={data}
              onMarkRead={actions.markNotificationRead}
              onMarkAllRead={actions.markAllNotificationsRead}
              onSendTestAlert={actions.sendTestAlert}
              onShowFeedback={showFeedback}
            />
          )}
        </main>
      </div>

      {/* Shared Modals */}
      <ProfileSettingsDialog
        open={settingsOpen}
        profile={data.profile}
        appVersion={appVersion}
        updateResult={updateResult}
        checkingUpdate={checkingUpdate}
        onClose={() => setSettingsOpen(false)}
        onSavePreferences={actions.savePreferences}
        onCheckForUpdates={async () => {
          const res = await runUpdateCheck(false);
          if (res?.updateAvailable) {
            setSettingsOpen(false);
            setUpdateDialogOpen(true);
          } else {
            showFeedback(`Cadence v${appVersion} is up to date.`);
          }
        }}
        onOpenUpdateDialog={() => setUpdateDialogOpen(true)}
        onSignOut={actions.signOut}
      />

      <AppUpdateDialog
        open={updateDialogOpen}
        updateResult={updateResult}
        onClose={() => setUpdateDialogOpen(false)}
      />

      <ShiftDetailDialog
        shift={inspectedShift}
        isManager={isManager}
        currentUid={data.profile.uid}
        onClose={() => setInspectedShift(null)}
        onRequestChange={openChangeRequestModal}
        onEditShift={setEditingShift}
        onDeleteShift={actions.deleteShift}
      />

      <AddShiftDialog
        open={addShiftDefaultDate !== null}
        defaultDate={addShiftDefaultDate ?? formatIsoDate(new Date())}
        staffDirectory={data.staffDirectory}
        onClose={() => setAddShiftDefaultDate(null)}
        onCreate={actions.createShift}
      />

      <EditShiftDialog
        shift={editingShift}
        staffDirectory={data.staffDirectory}
        onClose={() => setEditingShift(null)}
        onSave={actions.updateShift}
      />

      <RequestChangeDialog
        open={changeReqOpen}
        preselectedShift={changeReqShift}
        shifts={data.shifts}
        staffDirectory={data.staffDirectory}
        currentUid={data.profile.uid}
        currentUserName={data.profile.displayName}
        isManager={isManager}
        onClose={() => setChangeReqOpen(false)}
        onSubmit={actions.submitScheduleChange}
      />

      <SubmitAvailabilityDialog
        open={availabilityOpen}
        defaultDepartment={data.profile.department}
        onClose={() => setAvailabilityOpen(false)}
        onSubmitBatch={actions.submitAvailabilityBatch}
      />

      <WeekSlotsDialog
        open={weekSlotsOpen}
        slots={weekSlots}
        onClose={() => setWeekSlotsOpen(false)}
        onSaveSlots={saveWeekSlots}
      />
    </div>
  );
}

export default App;
