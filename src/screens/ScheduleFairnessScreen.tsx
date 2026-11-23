import { useMemo, useState } from 'react';
import {
  Calendar,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  UserCheck,
} from 'lucide-react';
import {
  addDaysIso,
  addMonthsIso,
  formatHours,
  formatIsoDate,
  getMondayIso,
} from '../domain/fairnessEngine';
import {
  CadenceTab,
  Shift,
  ShiftStatus,
  SubmissionStatus,
  UserRole,
  WorkspaceUiData,
} from '../types/cadence';
import { exportIcsFile } from '../utils/calendarExport';
import { useI18n } from '../i18n/I18nContext';
import { StaffHoursBalanceChart } from '../components/StaffHoursBalanceChart';
import {
  EmptyStatePanel,
  ShiftStatusChip,
  SubmissionStatusChip,
  SurfaceCard,
} from '../components/UiPrimitives';

interface ScheduleFairnessScreenProps {
  data: WorkspaceUiData;
  onNavigate: (tab: CadenceTab) => void;
  onInspectShift: (shift: Shift) => void;
  onOpenAddShift: (defaultDate: string) => void;
  onOpenSubmitAvailability: () => void;
  onOpenWeekSlots: () => void;
  onRequestChangeForShift: (shift: Shift) => void;
  onCommitFairnessPlan: () => Promise<number>;
  onCommitOpenShiftPlan: () => Promise<number>;
  onGenerateWeeklySchedule: (mondayIso: string) => Promise<{
    assigned: number;
    open: number;
  }>;
  onWithdrawSubmission: (id: string) => Promise<void>;
  onShowFeedback: (msg: string) => void;
}

type ScheduleSubTab = 'calendar' | 'table' | 'submissions';
type TableFilter = 'all' | 'mine' | 'open' | 'overlaps' | 'completed';

export function ScheduleFairnessScreen({
  data,
  onNavigate,
  onInspectShift,
  onOpenAddShift,
  onOpenSubmitAvailability,
  onOpenWeekSlots,
  onRequestChangeForShift,
  onCommitFairnessPlan,
  onCommitOpenShiftPlan,
  onGenerateWeeklySchedule,
  onWithdrawSubmission,
  onShowFeedback,
}: ScheduleFairnessScreenProps) {
  const { bcp47Tag, t } = useI18n();
  const [subTab, setSubTab] = useState<ScheduleSubTab>('calendar');
  const [calendarMode, setCalendarMode] = useState<'week' | 'month'>('week');
  const [anchorDate, setAnchorDate] = useState<string>(getMondayIso());
  const [myShiftsOnly, setMyShiftsOnly] = useState(false);

  const [tableFilter, setTableFilter] = useState<TableFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const isManager = data.profile.role === UserRole.MANAGER;
  const todayIso = formatIsoDate(new Date());

  const conflictCount = useMemo(
    () =>
      data.shifts.filter(
        (s) => s.status === ShiftStatus.CONFLICT || s.candidateUids.length > 1,
      ).length,
    [data.shifts],
  );
  const openCount = useMemo(
    () => data.shifts.filter((s) => s.status === ShiftStatus.OPEN).length,
    [data.shifts],
  );

  const visibleCalendarShifts = useMemo(
    () =>
      myShiftsOnly
        ? data.shifts.filter((s) => s.assignedUid === data.profile.uid)
        : data.shifts,
    [data.shifts, myShiftsOnly, data.profile.uid],
  );

  const weekDays = useMemo(() => {
    const [y, m, d] = anchorDate.split('-').map((n) => Number.parseInt(n, 10));
    const baseMonday = getMondayIso(
      y && m && d ? new Date(y, m - 1, d) : new Date(),
    );
    return Array.from({ length: 7 }, (_, idx) => addDaysIso(baseMonday, idx));
  }, [anchorDate]);

  const monthGridDays = useMemo(() => {
    const [y, m] = anchorDate.split('-').map((n) => Number.parseInt(n, 10));
    const firstOfMonth = new Date(y || 2026, (m || 1) - 1, 1);
    const gridStart = getMondayIso(firstOfMonth);
    return Array.from({ length: 35 }, (_, idx) => ({
      iso: addDaysIso(gridStart, idx),
      inCurrentMonth:
        Number.parseInt(addDaysIso(gridStart, idx).split('-')[1] ?? '0', 10) ===
        firstOfMonth.getMonth() + 1,
    }));
  }, [anchorDate]);

  const tableShifts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return data.shifts.filter((s) => {
      if (tableFilter === 'mine' && s.assignedUid !== data.profile.uid) {
        return false;
      }
      if (tableFilter === 'open' && s.status !== ShiftStatus.OPEN) {
        return false;
      }
      if (
        tableFilter === 'overlaps' &&
        !(s.status === ShiftStatus.CONFLICT || s.candidateUids.length > 1)
      ) {
        return false;
      }
      if (tableFilter === 'completed' && s.status !== ShiftStatus.COMPLETED) {
        return false;
      }
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        s.department.toLowerCase().includes(q) ||
        s.assignedName.toLowerCase().includes(q) ||
        s.date.includes(q)
      );
    });
  }, [data.shifts, data.profile.uid, tableFilter, searchQuery]);

  const activeSubmissions = useMemo(
    () =>
      data.shiftSubmissions.filter(
        (s) =>
          isManager ||
          s.staffUid === data.profile.uid,
      ),
    [data.shiftSubmissions, isManager, data.profile.uid],
  );

  const handleStepCalendar = (dir: -1 | 1) => {
    setAnchorDate((prev) =>
      calendarMode === 'week' ? addDaysIso(prev, dir * 7) : addMonthsIso(prev, dir),
    );
  };

  const handleArrangeOverlaps = async () => {
    setBusyAction('arrange');
    try {
      const count = await onCommitFairnessPlan();
      if (count === 0) {
        onShowFeedback(t('vm_banner_no_overlaps'));
        return;
      }
      onShowFeedback(t('vm_banner_overlaps_arranged', count));
    } finally {
      setBusyAction(null);
    }
  };

  const handleAssignOpen = async () => {
    setBusyAction('open');
    try {
      const count = await onCommitOpenShiftPlan();
      if (count === 0) {
        onShowFeedback(t('vm_banner_no_open_eligible'));
        return;
      }
      onShowFeedback(t('vm_banner_open_assigned', count));
    } finally {
      setBusyAction(null);
    }
  };

  const handleGenerateWeek = async () => {
    setBusyAction('generate');
    try {
      const mondayIso = addDaysIso(getMondayIso(), 7);
      const res = await onGenerateWeeklySchedule(mondayIso);
      if (res.assigned === 0 && res.open === 0) {
        onShowFeedback(t('vm_banner_week_populated'));
        return;
      }
      onShowFeedback(t('vm_banner_week_generated', res.assigned, res.open, 0));
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportTeamIcs = async () => {
    if (visibleCalendarShifts.length === 0) {
      onShowFeedback(t('win_no_shifts_export'));
      return;
    }
    const saved = await exportIcsFile(
      visibleCalendarShifts,
      'cadence-team-schedule.ics',
    );
    if (saved) {
      onShowFeedback(
        t('win_exported_shifts_format', visibleCalendarShifts.length, saved),
      );
    }
  };

  const monthHeaderDays = [
    t('win_mon'),
    t('win_tue'),
    t('win_wed'),
    t('win_thu'),
    t('win_fri'),
    t('win_sat'),
    t('win_sun'),
  ];

  return (
    <div className="space-y-5 @xl:space-y-6">
      <div className="flex flex-col @3xl:flex-row @3xl:items-start @3xl:justify-between gap-3 @xl:gap-4">
        <div className="min-w-0">
          <h1 className="text-xl @xl:text-2xl font-bold text-slate-900">
            {t('schedule_fairness_title')}
          </h1>
          <p className="text-xs @xl:text-sm text-slate-500 mt-1">
            {t('schedule_fairness_subtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenSubmitAvailability}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            <CalendarPlus className="w-3.5 h-3.5 shrink-0" />
            <span>{t('btn_submit_availability')}</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate(CadenceTab.MY_SCHEDULE)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Calendar className="w-3.5 h-3.5 text-slate-600 shrink-0" />
            <span>{t('nav_my_schedule')}</span>
          </button>

          <button
            type="button"
            onClick={handleExportTeamIcs}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5 text-slate-600 shrink-0" />
            <span>{t('btn_export_ics')}</span>
          </button>
        </div>
      </div>

      {/* Manager Fairness Controls */}
      {isManager && (
        <SurfaceCard className="space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
            {t('win_manager_fairness_automation')}
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={handleGenerateWeek}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>
                {busyAction === 'generate' ? t('win_generating') : t('btn_generate_week')}
              </span>
            </button>

            <button
              type="button"
              disabled={busyAction !== null}
              onClick={handleArrangeOverlaps}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>
                {busyAction === 'arrange'
                  ? t('win_arranging')
                  : t('btn_arrange_overlaps_count', conflictCount)}
              </span>
            </button>

            <button
              type="button"
              disabled={busyAction !== null}
              onClick={handleAssignOpen}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              <UserCheck className="w-3.5 h-3.5 shrink-0" />
              <span>
                {busyAction === 'open'
                  ? t('win_assigning')
                  : t('btn_assign_open_count', openCount)}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onOpenAddShift(todayIso)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span>{t('btn_add_shift')}</span>
            </button>

            <button
              type="button"
              onClick={onOpenWeekSlots}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Settings2 className="w-3.5 h-3.5 shrink-0" />
              <span>{t('btn_week_slots')}</span>
            </button>
          </div>
        </SurfaceCard>
      )}

      {/* Sub-Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 max-w-full overflow-x-auto cadence-scroll bg-white border border-slate-200 rounded-lg p-1">
          {(
            [
              ['calendar', t('subtab_calendar')],
              ['table', t('subtab_shift_table')],
              [
                'submissions',
                t('filter_count_format', t('subtab_submissions'), activeSubmissions.length),
              ],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSubTab(key)}
              className={`px-3.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                subTab === key
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {subTab === 'calendar' && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={myShiftsOnly}
                onChange={(e) => setMyShiftsOnly(e.target.checked)}
                className="w-3.5 h-3.5 accent-blue-600 cursor-pointer"
              />
              <span>{t('win_my_shifts_only')}</span>
            </label>

            <div className="inline-flex items-center bg-white border border-slate-200 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setCalendarMode('week')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap ${
                  calendarMode === 'week'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600'
                }`}
              >
                {t('week_label')}
              </button>
              <button
                type="button"
                onClick={() => setCalendarMode('month')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap ${
                  calendarMode === 'month'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600'
                }`}
              >
                {t('month_label')}
              </button>
            </div>

            <div className="inline-flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => handleStepCalendar(-1)}
                aria-label={t('cd_previous_period')}
                className="p-1.5 rounded-md hover:bg-slate-100 text-slate-700 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setAnchorDate(getMondayIso())}
                className="px-2.5 py-1 rounded-md hover:bg-slate-100 text-xs font-semibold text-slate-800 cursor-pointer whitespace-nowrap"
              >
                {t('today_label')}
              </button>
              <button
                type="button"
                onClick={() => handleStepCalendar(1)}
                aria-label={t('cd_next_period')}
                className="p-1.5 rounded-md hover:bg-slate-100 text-slate-700 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Calendar View */}
      {subTab === 'calendar' && calendarMode === 'week' && (
        <div className="grid grid-cols-1 @lg:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-7 gap-3">
          {weekDays.map((dayIso) => {
            const dayShifts = visibleCalendarShifts.filter(
              (s) => s.date === dayIso,
            );
            const dateObj = new Date(`${dayIso}T12:00:00`);
            const weekday = new Intl.DateTimeFormat(bcp47Tag || undefined, {
              weekday: 'short',
            }).format(dateObj);
            const dateShort = new Intl.DateTimeFormat(bcp47Tag || undefined, {
              month: 'short',
              day: 'numeric',
            }).format(dateObj);
            const isToday = dayIso === todayIso;

            return (
              <div
                key={dayIso}
                className={`bg-white border rounded-xl p-3 flex flex-col gap-2.5 min-w-0 min-h-36 @5xl:min-h-48 ${
                  isToday ? 'border-blue-400 ring-1 ring-blue-100' : 'border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div>
                    <div
                      className={`text-xs font-bold ${
                        isToday ? 'text-blue-700' : 'text-slate-900'
                      }`}
                    >
                      {weekday}
                    </div>
                    <div className="text-[11px] font-mono-tabular text-slate-500">
                      {dateShort}
                    </div>
                  </div>
                  {isManager && (
                    <button
                      type="button"
                      onClick={() => onOpenAddShift(dayIso)}
                      aria-label={`${t('btn_add_shift')} ${dayIso}`}
                      className="p-1 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {dayShifts.length === 0 ? (
                  <div className="text-[11px] text-slate-400 py-4 text-center">
                    {t('win_no_shifts')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {dayShifts.map((shift) => (
                      <button
                        key={shift.id}
                        type="button"
                        onClick={() => onInspectShift(shift)}
                        className="w-full text-left p-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer space-y-1"
                      >
                        <div className="text-xs font-semibold text-slate-900 truncate">
                          {shift.title}
                        </div>
                        <div className="text-[11px] font-mono-tabular text-slate-600">
                          {shift.startTime}–{shift.endTime}
                        </div>
                        <div className="text-[11px] text-slate-600 truncate">
                          {shift.assignedName.trim() || t('win_open_slot')}
                        </div>
                        <ShiftStatusChip status={shift.status} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {subTab === 'calendar' && calendarMode === 'month' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto cadence-scroll">
          <div className="min-w-[680px]">
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase text-slate-500">
              {monthHeaderDays.map((d, idx) => (
                <div key={idx} className="px-2.5 @3xl:px-3 py-2">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 divide-x divide-y divide-slate-200">
              {monthGridDays.map(({ iso, inCurrentMonth }) => {
                const dayShifts = visibleCalendarShifts.filter(
                  (s) => s.date === iso,
                );
                const dayNum = iso.split('-')[2];
                const isToday = iso === todayIso;
                return (
                  <div
                    key={iso}
                    className={`min-h-24 @5xl:min-h-28 p-1.5 @3xl:p-2 space-y-1.5 min-w-0 ${
                      inCurrentMonth ? 'bg-white' : 'bg-slate-50/70'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs font-mono-tabular font-semibold px-1.5 py-0.5 rounded ${
                          isToday
                            ? 'bg-blue-600 text-white'
                            : inCurrentMonth
                              ? 'text-slate-900'
                              : 'text-slate-400'
                        }`}
                      >
                        {dayNum}
                      </span>
                      {isManager && (
                        <button
                          type="button"
                          onClick={() => onOpenAddShift(iso)}
                          aria-label={`${t('btn_add_shift')} ${iso}`}
                          className="text-slate-400 hover:text-blue-600 cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <div className="space-y-1">
                      {dayShifts.slice(0, 3).map((shift) => (
                        <button
                          key={shift.id}
                          type="button"
                          onClick={() => onInspectShift(shift)}
                          className="w-full text-left px-1.5 py-1 rounded bg-slate-100 hover:bg-blue-50 text-[11px] text-slate-800 truncate cursor-pointer block"
                        >
                          <span className="font-mono-tabular font-semibold">
                            {shift.startTime}
                          </span>{' '}
                          {shift.assignedName.trim() || t('win_open_short')}
                        </button>
                      ))}
                      {dayShifts.length > 3 && (
                        <div className="text-[10px] font-semibold text-slate-500 px-1">
                          {t('win_more_format', dayShifts.length - 3)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Table View */}
      {subTab === 'table' && (
        <div className="space-y-4">
          <div className="flex flex-col @2xl:flex-row @2xl:items-center @2xl:justify-between gap-3">
            <div className="inline-flex items-center gap-1 max-w-full overflow-x-auto cadence-scroll bg-white border border-slate-200 rounded-lg p-1">
              {(
                [
                  ['all', t('filter_all')],
                  ['mine', t('filter_mine')],
                  ['open', t('filter_count_format', t('filter_open'), openCount)],
                  [
                    'overlaps',
                    t('filter_count_format', t('filter_overlaps'), conflictCount),
                  ],
                  ['completed', t('status_completed')],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTableFilter(key)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                    tableFilter === key
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="relative w-full @2xl:w-64 shrink-0">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('search_team_shifts_label')}
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
              />
            </div>
          </div>

          {tableShifts.length === 0 ? (
            <EmptyStatePanel
              icon={<Calendar className="w-5 h-5" />}
              title={t('empty_shifts_filter_title')}
              subtitle={t('empty_shifts_filter_subtitle')}
            />
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto cadence-scroll">
              <table className="w-full min-w-[620px] text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-4">{t('win_table_shift')}</th>
                    <th className="py-3 px-4">{t('win_table_date_window')}</th>
                    <th className="py-3 px-4">{t('win_table_assignee')}</th>
                    <th className="py-3 px-4">{t('win_table_status')}</th>
                    <th className="py-3 px-4 text-right">{t('win_table_action')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {tableShifts.map((shift) => {
                    const canClaimOrChange =
                      shift.status !== ShiftStatus.COMPLETED &&
                      (shift.status === ShiftStatus.OPEN ||
                        shift.assignedUid === data.profile.uid);
                    return (
                      <tr
                        key={shift.id}
                        onClick={() => onInspectShift(shift)}
                        className="hover:bg-slate-50 cursor-pointer"
                      >
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">
                            {shift.title}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {shift.department}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono-tabular text-slate-700 whitespace-nowrap">
                          {shift.date} · {shift.startTime}–{shift.endTime} (
                          {formatHours(shift.durationHours)}h)
                        </td>
                        <td className="py-3 px-4 text-slate-800">
                          {shift.assignedName.trim() || t('open_unassigned')}
                        </td>
                        <td className="py-3 px-4">
                          <ShiftStatusChip status={shift.status} />
                        </td>
                        <td
                          className="py-3 px-4 text-right whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {canClaimOrChange ? (
                            <button
                              type="button"
                              onClick={() => onRequestChangeForShift(shift)}
                              className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer whitespace-nowrap"
                            >
                              {shift.status === ShiftStatus.OPEN
                                ? t('win_claim')
                                : t('btn_request_change')}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onInspectShift(shift)}
                              className="text-xs font-semibold text-slate-600 hover:underline cursor-pointer whitespace-nowrap"
                            >
                              {t('win_inspect')}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Submissions View */}
      {subTab === 'submissions' && (
        <div className="space-y-3">
          {activeSubmissions.length === 0 ? (
            <EmptyStatePanel
              icon={<CalendarPlus className="w-5 h-5" />}
              title={t('empty_submissions_title')}
              subtitle={t('empty_submissions_subtitle')}
              action={
                <button
                  type="button"
                  onClick={onOpenSubmitAvailability}
                  className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
                >
                  {t('btn_submit_availability')}
                </button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 @2xl:grid-cols-2 @6xl:grid-cols-3 gap-3">
              {activeSubmissions.map((sub) => (
                <SurfaceCard key={sub.id} className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 truncate">
                        {sub.staffName} · {sub.shiftTitle}
                      </div>
                      <div className="text-xs text-slate-500 font-mono-tabular mt-0.5">
                        {sub.date} · {sub.startTime}–{sub.endTime} ·{' '}
                        {sub.department}
                      </div>
                    </div>
                    <SubmissionStatusChip status={sub.status} />
                  </div>
                  {sub.notes && (
                    <p className="text-xs text-slate-600">{sub.notes}</p>
                  )}
                  {sub.status === SubmissionStatus.SUBMITTED &&
                    (sub.staffUid === data.profile.uid || isManager) && (
                      <div className="pt-1 flex justify-end">
                        <button
                          type="button"
                          onClick={async () => {
                            await onWithdrawSubmission(sub.id);
                            onShowFeedback(t('vm_banner_availability_withdrawn'));
                          }}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 hover:underline cursor-pointer whitespace-nowrap"
                        >
                          <Trash2 className="w-3.5 h-3.5 shrink-0" />
                          <span>{t('btn_withdraw_submission')}</span>
                        </button>
                      </div>
                    )}
                </SurfaceCard>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Team Fairness Balance Chart */}
      <StaffHoursBalanceChart
        staffDirectory={data.staffDirectory}
        shifts={data.shifts}
        rustRows={data.rustInsights?.staffChart}
      />
    </div>
  );
}
