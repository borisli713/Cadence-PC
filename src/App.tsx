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
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { formatIsoDate } from './domain/fairnessEngine';
import { useCadenceWorkspace } from './hooks/useCadenceWorkspace';
import { useI18n } from './i18n/I18nContext';
import {
  ApprovalStatus,
  CadenceTab,
  Shift,
  ShiftStatus,
  UserRole,
} from './types/cadence';
import { AuthScreen } from './components/AuthScreen';
import { LoadingScreen } from './components/LoadingScreen';
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
  const { t } = useI18n();

  const [activeTab, setActiveTab] = useState<CadenceTab>(CadenceTab.OVERVIEW);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('cadence_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('cadence_sidebar_collapsed', String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

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
        label: t('nav_overview'),
        icon: <LayoutDashboard className="w-4 h-4" />,
      },
      {
        id: CadenceTab.MY_SCHEDULE,
        label: t('nav_my_schedule'),
        icon: <CalendarCheck className="w-4 h-4" />,
      },
      {
        id: CadenceTab.SCHEDULE,
        label: t('nav_schedule'),
        icon: <Sparkles className="w-4 h-4" />,
        badge: overlaps > 0 ? overlaps : undefined,
      },
      {
        id: CadenceTab.REPORTS,
        label: t('nav_reports'),
        icon: <ClipboardCheck className="w-4 h-4" />,
      },
      {
        id: CadenceTab.APPROVALS,
        label: t('nav_approvals'),
        icon: <CheckCircle2 className="w-4 h-4" />,
        badge: pendingChanges > 0 ? pendingChanges : undefined,
      },
      {
        id: CadenceTab.HISTORY,
        label: t('nav_history'),
        icon: <History className="w-4 h-4" />,
      },
      {
        id: CadenceTab.TEAM,
        label: t('nav_team'),
        icon: <Users className="w-4 h-4" />,
      },
      {
        id: CadenceTab.TIME_OFF,
        label: t('nav_timeoff'),
        icon: <CalendarOff className="w-4 h-4" />,
        badge: pendingTimeOff > 0 ? pendingTimeOff : undefined,
      },
      {
        id: CadenceTab.NOTIFICATIONS,
        label: t('nav_alerts'),
        icon: <Bell className="w-4 h-4" />,
        badge: unreadNotifs > 0 ? unreadNotifs : undefined,
      },
    ];
  }, [data, t]);

  if (!authReady) {
    return <LoadingScreen stage="initializing" appVersion={appVersion} />;
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
      <LoadingScreen
        stage="syncing"
        appVersion={appVersion}
        userEmail={authUser.email}
      />
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
                {t('win_profile_load_error')}
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
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              {t('retry')}
            </button>
            <button
              type="button"
              onClick={() => actions.signOut()}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              {t('sign_out')}
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

  const renderSidebar = (compact: boolean, inDrawer = false) => (
    <div className="flex flex-col h-full bg-white border-r border-slate-200 select-none">
      <div
        className={`${
          compact ? 'px-2.5 py-3.5 justify-center' : 'px-4 py-3.5 justify-between'
        } border-b border-slate-200 flex items-center gap-2 shrink-0`}
      >
        <div className={`flex items-center ${compact ? '' : 'gap-2.5 min-w-0'}`}>
          <img
            src="/cadence-icon.png"
            alt={t('app_name')}
            className="w-8 h-8 rounded-lg border border-slate-200 object-cover shrink-0"
          />
          {!compact && (
            <div className="min-w-0">
              <div className="text-sm font-bold text-slate-900 truncate">
                {t('app_name')}
              </div>
              <div className="text-[11px] font-mono-tabular text-slate-500">
                v{appVersion} · {t('win_windows')}
              </div>
            </div>
          )}
        </div>

        {inDrawer ? (
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
            aria-label={t('win_close_nav')}
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          !compact && (
            <button
              type="button"
              onClick={toggleSidebarCollapsed}
              title={t('win_collapse_sidebar')}
              aria-label={t('win_collapse_sidebar')}
              className="hidden lg:inline-flex p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )
        )}
      </div>

      {compact && !inDrawer && (
        <div className="hidden lg:flex justify-center pt-2.5 px-2 shrink-0">
          <button
            type="button"
            onClick={toggleSidebarCollapsed}
            title={t('win_expand_sidebar')}
            aria-label={t('win_expand_sidebar')}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        </div>
      )}

      <nav className="flex-1 min-h-0 overflow-y-auto cadence-scroll p-2.5 space-y-1">
        {navItems.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              title={compact ? item.label : undefined}
              aria-label={compact ? item.label : undefined}
              onClick={() => {
                setActiveTab(item.id);
                setMobileNavOpen(false);
              }}
              className={`relative w-full flex items-center ${
                compact ? 'justify-center px-2 py-2.5' : 'justify-between gap-2 px-3 py-2'
              } rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                active
                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                  : 'text-slate-700 hover:bg-slate-100 border border-transparent'
              }`}
            >
              <span
                className={`flex items-center ${
                  compact ? 'justify-center' : 'gap-2.5 min-w-0'
                }`}
              >
                {item.icon}
                {!compact && <span className="truncate">{item.label}</span>}
              </span>
              {item.badge !== undefined &&
                (compact ? (
                  <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-blue-600 text-white font-mono-tabular text-[10px] leading-4 text-center">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                ) : (
                  <span
                    className={`font-mono-tabular text-[11px] px-1.5 py-0.5 rounded-md ${
                      active
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {item.badge}
                  </span>
                ))}
            </button>
          );
        })}
      </nav>

      <div className="p-2.5 border-t border-slate-200 space-y-2 shrink-0">
        {updateResult?.updateAvailable &&
          (compact ? (
            <button
              type="button"
              onClick={() => setUpdateDialogOpen(true)}
              title={t('win_update_badge_format', updateResult.latest.versionName)}
              aria-label={t('win_update_badge_format', updateResult.latest.versionName)}
              className="w-full flex items-center justify-center p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 cursor-pointer"
            >
              <Download className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setUpdateDialogOpen(true)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold cursor-pointer hover:bg-emerald-100"
            >
              <span className="flex items-center gap-1.5 truncate">
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {t('win_update_badge_format', updateResult.latest.versionName)}
                </span>
              </span>
              <span className="whitespace-nowrap shrink-0">{t('win_view')}</span>
            </button>
          ))}

        {!compact && (
          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-bold text-slate-900 truncate">
                {data.profile.displayName}
              </div>
              <StatusChip
                label={isManager ? t('role_manager') : t('role_staff')}
                tone={isManager ? 'violet' : 'neutral'}
              />
            </div>
            <div className="text-[11px] text-slate-500 truncate mt-0.5">
              {data.profile.department}
            </div>
          </div>
        )}

        <div className={compact ? 'space-y-1.5' : 'grid grid-cols-2 gap-2'}>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title={compact ? t('win_settings') : undefined}
            aria-label={t('win_settings')}
            className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer whitespace-nowrap"
          >
            <Settings className="w-3.5 h-3.5 shrink-0" />
            {!compact && <span className="truncate">{t('win_settings')}</span>}
          </button>
          <button
            type="button"
            onClick={() => actions.signOut()}
            title={compact ? t('sign_out') : undefined}
            aria-label={t('sign_out')}
            className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-rose-50 hover:text-rose-700 text-xs font-semibold text-slate-700 cursor-pointer whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            {!compact && <span className="truncate">{t('sign_out')}</span>}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-slate-50 flex">
      {/* Medium Windowed Rail (768px–1023px) */}
      <aside className="hidden md:block lg:hidden w-[68px] shrink-0 sticky top-0 h-dvh">
        {renderSidebar(true)}
      </aside>

      {/* Desktop Sidebar (>= 1024px, collapsible) */}
      <aside
        className={`hidden lg:block shrink-0 sticky top-0 h-dvh transition-[width] duration-150 ease-out ${
          sidebarCollapsed ? 'w-[68px]' : 'w-60 xl:w-64'
        }`}
      >
        {renderSidebar(sidebarCollapsed)}
      </aside>

      {/* Narrow Window / Mobile Slide-Over Drawer (< 768px) */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden flex"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMobileNavOpen(false);
          }}
        >
          <div className="fixed inset-0 bg-slate-900/40" />
          <div className="relative z-10 w-64 max-w-[82vw] h-full">
            {renderSidebar(false, true)}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Compact Header (< 768px) */}
        <header className="md:hidden sticky top-0 z-30 bg-white border-b border-slate-200 px-3.5 py-2.5 flex items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="p-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer shrink-0"
            aria-label={t('win_open_nav')}
          >
            <Menu className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <Calendar className="w-4 h-4 text-blue-600 shrink-0" />
            <span className="text-sm font-bold text-slate-900 truncate">
              {navItems.find((i) => i.id === activeTab)?.label ?? t('app_name')}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="p-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer shrink-0"
            aria-label={t('win_settings')}
          >
            <Settings className="w-4 h-4" />
          </button>
        </header>

        <main className="flex-1 min-w-0 @container w-full max-w-[1600px] mx-auto px-3.5 sm:px-5 lg:px-7 py-4 sm:py-6 space-y-5">
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
                className="text-emerald-700 hover:text-emerald-950 font-semibold cursor-pointer whitespace-nowrap shrink-0"
              >
                {t('win_dismiss')}
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
            showFeedback(t('win_up_to_date_banner', appVersion));
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
