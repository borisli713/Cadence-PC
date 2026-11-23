import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CalendarClock,
  CalendarOff,
  CheckCircle2,
  ClipboardCheck,
  History,
  Sparkles,
} from 'lucide-react';
import { formatHours } from '../domain/fairnessEngine';
import {
  ApprovalStatus,
  CadenceTab,
  DashboardKpis,
  ShiftStatus,
  UserRole,
  WorkspaceUiData,
} from '../types/cadence';
import { invokeComputeDashboardKpis } from '../utils/tauriBridge';
import { useI18n } from '../i18n/I18nContext';
import {
  ApprovalStatusChip,
  EmptyStatePanel,
  KpiTile,
  ReportStatusChip,
  ShiftStatusChip,
  SurfaceCard,
} from '../components/UiPrimitives';

interface OverviewScreenProps {
  data: WorkspaceUiData;
  onNavigate: (tab: CadenceTab) => void;
  onQuickLogReport: () => void;
  onQuickRequestChange: () => void;
}

export function OverviewScreen({
  data,
  onNavigate,
  onQuickLogReport,
  onQuickRequestChange,
}: OverviewScreenProps) {
  const { t } = useI18n();
  const { profile, shifts, scheduleChanges, shiftReports, timeOffRequests } = data;
  const isManager = profile.role === UserRole.MANAGER;
  const [rustKpis, setRustKpis] = useState<DashboardKpis | null>(null);

  const myShifts = shifts.filter(
    (s) => s.assignedUid === profile.uid && s.status !== ShiftStatus.OPEN,
  );
  const myUpcomingShifts = myShifts
    .filter((s) => s.status !== ShiftStatus.COMPLETED)
    .slice(0, 4);

  const fallbackPendingApprovals = scheduleChanges.filter(
    (c) => c.status === ApprovalStatus.PENDING,
  ).length;
  const fallbackPendingTimeOff = timeOffRequests.filter(
    (tReq) => tReq.status === ApprovalStatus.PENDING,
  ).length;
  const fallbackConflictShifts = shifts.filter(
    (s) => s.status === ShiftStatus.CONFLICT || s.candidateUids.length > 1,
  ).length;

  const precomputedKpis = data.rustInsights?.kpis ?? null;

  useEffect(() => {
    if (precomputedKpis) return;
    let cancelled = false;
    void invokeComputeDashboardKpis(
      profile.uid,
      profile.weeklyHoursTarget,
      shifts,
      fallbackPendingApprovals,
      timeOffRequests,
      data.staffDirectory,
    ).then((res) => {
      if (!cancelled && res) setRustKpis(res);
    });
    return () => {
      cancelled = true;
    };
  }, [
    precomputedKpis,
    profile.uid,
    profile.weeklyHoursTarget,
    shifts,
    fallbackPendingApprovals,
    timeOffRequests,
    data.staffDirectory,
  ]);

  const activeKpis = precomputedKpis ?? rustKpis;
  const currentStaffEntry = data.staffDirectory.find(
    (s) => s.uid === profile.uid,
  );
  const myShiftsCount = activeKpis?.myShiftsCount ?? myShifts.length;
  const pendingApprovalsCount =
    activeKpis?.pendingApprovalsCount ?? fallbackPendingApprovals;
  const pendingTimeOffCount =
    activeKpis?.pendingTimeOffCount ?? fallbackPendingTimeOff;
  const conflictShiftsCount =
    activeKpis?.conflictShiftsCount ?? fallbackConflictShifts;
  const totalLoggedHours =
    activeKpis?.myVerifiedHours ?? currentStaffEntry?.totalHoursWorked ?? 0;

  return (
    <div className="space-y-5 @xl:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl @xl:text-2xl font-bold text-slate-900">
            {t('welcome_back_format', profile.displayName)}
          </h1>
          <p className="text-xs @xl:text-sm text-slate-500 mt-1">
            {profile.department} ·{' '}
            {isManager ? t('manager_workspace') : t('staff_member')} ·{' '}
            {t('win_target_week_format', profile.weeklyHoursTarget)}
          </p>
        </div>
      </div>

      {/* Quick Actions */}
      <SurfaceCard className="space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
          {t('win_quick_actions')}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onQuickLogReport}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            <ClipboardCheck className="w-4 h-4 shrink-0" />
            <span>{t('btn_log_shift_report')}</span>
          </button>

          {isManager && (
            <button
              type="button"
              onClick={() => onNavigate(CadenceTab.APPROVALS)}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{t('btn_review_approvals_format', pendingApprovalsCount)}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onQuickRequestChange}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            <CalendarClock className="w-4 h-4 text-slate-600 shrink-0" />
            <span>{t('btn_request_shift_change')}</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate(CadenceTab.MY_SCHEDULE)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            <Calendar className="w-4 h-4 text-slate-600 shrink-0" />
            <span>{t('nav_my_schedule')}</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate(CadenceTab.SCHEDULE)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-4 h-4 text-slate-600 shrink-0" />
            <span>{t('nav_schedule')}</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate(CadenceTab.TIME_OFF)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            <CalendarOff className="w-4 h-4 text-slate-600 shrink-0" />
            <span>{t('btn_time_off_count', pendingTimeOffCount)}</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate(CadenceTab.HISTORY)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            <History className="w-4 h-4 text-slate-600 shrink-0" />
            <span>{t('nav_history')}</span>
          </button>
        </div>
      </SurfaceCard>

      {/* KPI Tiles */}
      <div className="grid grid-cols-1 @sm:grid-cols-2 @4xl:grid-cols-4 gap-3 @xl:gap-4">
        <KpiTile
          label={t('win_kpi_my_shifts')}
          value={myShiftsCount}
          subtext={t('win_kpi_upcoming_active_format', myUpcomingShifts.length)}
          accentClass="text-blue-700"
          icon={<Calendar className="w-4 h-4" />}
        />
        <KpiTile
          label={t('kpi_pending_changes')}
          value={pendingApprovalsCount}
          subtext={t('win_kpi_pending_time_off_format', pendingTimeOffCount)}
          accentClass={
            pendingApprovalsCount > 0 ? 'text-amber-700' : 'text-slate-900'
          }
          icon={<CheckCircle2 className="w-4 h-4" />}
        />
        <KpiTile
          label={t('kpi_overlap_conflicts')}
          value={conflictShiftsCount}
          subtext={
            conflictShiftsCount > 0
              ? t('kpi_tap_schedule_resolve')
              : t('kpi_zero_overlaps')
          }
          accentClass={
            conflictShiftsCount > 0 ? 'text-rose-700' : 'text-emerald-700'
          }
          icon={<AlertTriangle className="w-4 h-4" />}
        />
        <KpiTile
          label={t('kpi_my_hours_target')}
          value={t('kpi_hours_value_format', formatHours(totalLoggedHours))}
          subtext={t('win_target_week_format', profile.weeklyHoursTarget)}
          accentClass="text-emerald-700"
          icon={<ClipboardCheck className="w-4 h-4" />}
        />
      </div>

      {/* Main Preview Columns */}
      <div className="grid grid-cols-1 @3xl:grid-cols-2 gap-4 @xl:gap-5">
        {/* My Assigned Shifts Preview */}
        <SurfaceCard className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900 truncate">
              {t('section_my_assigned_shifts')}
            </h2>
            <button
              type="button"
              onClick={() => onNavigate(CadenceTab.MY_SCHEDULE)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>{t('btn_view_all_count', myShiftsCount)}</span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" />
            </button>
          </div>

          {myUpcomingShifts.length === 0 ? (
            <EmptyStatePanel
              icon={<Calendar className="w-5 h-5" />}
              title={t('empty_my_shifts_title')}
              subtitle={t('empty_my_shifts_subtitle')}
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {myUpcomingShifts.map((shift) => (
                <div
                  key={shift.id}
                  className="py-2.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 truncate">
                      {shift.title}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono-tabular mt-0.5 truncate">
                      {shift.date} · {shift.startTime}–{shift.endTime} ·{' '}
                      {shift.department}
                    </div>
                  </div>
                  <ShiftStatusChip status={shift.status} />
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>

        {/* Active Team Schedule Preview */}
        <SurfaceCard className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900 truncate">
              {t('section_active_team_schedule')}
            </h2>
            <button
              type="button"
              onClick={() => onNavigate(CadenceTab.SCHEDULE)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>{t('win_open_calendar')}</span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" />
            </button>
          </div>

          {shifts.length === 0 ? (
            <EmptyStatePanel
              icon={<Sparkles className="w-5 h-5" />}
              title={t('empty_no_shifts_title')}
              subtitle={
                isManager
                  ? t('empty_no_shifts_manager')
                  : t('empty_no_shifts_staff')
              }
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {shifts.slice(0, 5).map((shift) => (
                <div
                  key={shift.id}
                  className="py-2.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 truncate">
                      {shift.title}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                      {shift.assignedName.trim() || t('win_open_slot')} ·{' '}
                      <span className="font-mono-tabular">
                        {shift.date} {shift.startTime}–{shift.endTime}
                      </span>
                    </div>
                  </div>
                  <ShiftStatusChip status={shift.status} />
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>

        {/* Recent Status Updates */}
        <SurfaceCard className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900 truncate">
              {t('section_recent_status_updates')}
            </h2>
            <button
              type="button"
              onClick={() => onNavigate(CadenceTab.APPROVALS)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>{t('nav_approvals')}</span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" />
            </button>
          </div>

          {scheduleChanges.length === 0 ? (
            <EmptyStatePanel
              icon={<CalendarClock className="w-5 h-5" />}
              title={t('empty_no_notifs_title')}
              subtitle={t('empty_no_notifs_subtitle')}
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {scheduleChanges.slice(0, 4).map((req) => (
                <div
                  key={req.id}
                  className="py-2.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 truncate">
                      {req.shiftTitle}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                      {req.requesterName} · {t(`change_type_${req.type}`)} ·{' '}
                      <span className="font-mono-tabular">
                        {req.proposedDate} {req.proposedStartTime}–
                        {req.proposedEndTime}
                      </span>
                    </div>
                  </div>
                  <ApprovalStatusChip status={req.status} />
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>

        {/* Latest Shift Reports */}
        <SurfaceCard className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900 truncate">
              {t('section_latest_shift_reports')}
            </h2>
            <button
              type="button"
              onClick={() => onNavigate(CadenceTab.REPORTS)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>{t('win_all_reports')}</span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" />
            </button>
          </div>

          {shiftReports.length === 0 ? (
            <EmptyStatePanel
              icon={<ClipboardCheck className="w-5 h-5" />}
              title={t('empty_no_reports_title')}
              subtitle={t('empty_no_reports_subtitle')}
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {shiftReports.slice(0, 4).map((rep) => (
                <div
                  key={rep.id}
                  className="py-2.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 truncate">
                      {rep.shiftTitle}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                      {rep.staffName} ·{' '}
                      <span className="font-mono-tabular">
                        {rep.date} · {t('win_hours_net_format', formatHours(rep.workedHours))}
                      </span>
                    </div>
                  </div>
                  <ReportStatusChip status={rep.status} />
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
}
