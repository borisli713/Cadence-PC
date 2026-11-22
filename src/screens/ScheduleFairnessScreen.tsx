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
        onShowFeedback('No overlapping candidate shifts require arrangement.');
        return;
      }
      onShowFeedback(
        `Fairness Engine resolved ${count} overlapping shift${count === 1 ? '' : 's'}.`,
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleAssignOpen = async () => {
    setBusyAction('open');
    try {
      const count = await onCommitOpenShiftPlan();
      if (count === 0) {
        onShowFeedback('No open shifts could be matched cleanly.');
        return;
      }
      onShowFeedback(
        `Assigned ${count} open shift${count === 1 ? '' : 's'} by fairness balance.`,
      );
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
        onShowFeedback(
          `All shift slots for week of ${mondayIso} already exist on the calendar.`,
        );
        return;
      }
      onShowFeedback(
        `Generated week of ${mondayIso}: ${res.assigned} assigned, ${res.open} open.`,
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportTeamIcs = async () => {
    if (visibleCalendarShifts.length === 0) {
      onShowFeedback('No shifts to export.');
      return;
    }
    const saved = await exportIcsFile(
      visibleCalendarShifts,
      'cadence-team-schedule.ics',
    );
    if (saved) {
      onShowFeedback(
        `Exported ${visibleCalendarShifts.length} shifts to ${saved}`,
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Schedule &amp; Fairness
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Team calendar, staff availability submissions, and Rust-powered fairness overlap allocation
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenSubmitAvailability}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            <CalendarPlus className="w-3.5 h-3.5" />
            <span>Submit Availability</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate(CadenceTab.MY_SCHEDULE)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Calendar className="w-3.5 h-3.5 text-slate-600" />
            <span>My Schedule</span>
          </button>

          <button
            type="button"
            onClick={handleExportTeamIcs}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5 text-slate-600" />
            <span>Export .ics</span>
          </button>
        </div>
      </div>

      {/* Manager Fairness Controls */}
      {isManager && (
        <SurfaceCard className="space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Manager Fairness Automation
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={handleGenerateWeek}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>
                {busyAction === 'generate' ? 'Generating...' : 'Generate Week'}
              </span>
            </button>

            <button
              type="button"
              disabled={busyAction !== null}
              onClick={handleArrangeOverlaps}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>
                {busyAction === 'arrange'
                  ? 'Arranging...'
                  : `Arrange Overlaps (${conflictCount})`}
              </span>
            </button>

            <button
              type="button"
              disabled={busyAction !== null}
              onClick={handleAssignOpen}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>
                {busyAction === 'open'
                  ? 'Assigning...'
                  : `Assign Open (${openCount})`}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onOpenAddShift(todayIso)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Shift</span>
            </button>

            <button
              type="button"
              onClick={onOpenWeekSlots}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span>Week Slots</span>
            </button>
          </div>
        </SurfaceCard>
      )}

      {/* Sub-Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-1">
          {(
            [
              ['calendar', 'Calendar'],
              ['table', 'Shift Table'],
              ['submissions', `Submissions (${activeSubmissions.length})`],
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
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={myShiftsOnly}
                onChange={(e) => setMyShiftsOnly(e.target.checked)}
                className="w-3.5 h-3.5 accent-blue-600 cursor-pointer"
              />
              <span>My Shifts Only</span>
            </label>

            <div className="inline-flex items-center bg-white border border-slate-200 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setCalendarMode('week')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                  calendarMode === 'week'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600'
                }`}
              >
                Week
              </button>
              <button
                type="button"
                onClick={() => setCalendarMode('month')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                  calendarMode === 'month'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600'
                }`}
              >
                Month
              </button>
            </div>

            <div className="inline-flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => handleStepCalendar(-1)}
                aria-label="Previous period"
                className="p-1.5 rounded-md hover:bg-slate-100 text-slate-700 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setAnchorDate(getMondayIso())}
                className="px-2.5 py-1 rounded-md hover:bg-slate-100 text-xs font-semibold text-slate-800 cursor-pointer"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => handleStepCalendar(1)}
                aria-label="Next period"
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
        <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
          {weekDays.map((dayIso) => {
            const dayShifts = visibleCalendarShifts.filter(
              (s) => s.date === dayIso,
            );
            const dateObj = new Date(`${dayIso}T12:00:00`);
            const weekday = new Intl.DateTimeFormat(undefined, {
              weekday: 'short',
            }).format(dateObj);
            const dateShort = new Intl.DateTimeFormat(undefined, {
              month: 'short',
              day: 'numeric',
            }).format(dateObj);
            const isToday = dayIso === todayIso;

            return (
              <div
                key={dayIso}
                className={`bg-white border rounded-xl p-3 flex flex-col gap-2.5 min-h-48 ${
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
                      aria-label={`Add shift on ${dayIso}`}
                      className="p-1 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {dayShifts.length === 0 ? (
                  <div className="text-[11px] text-slate-400 py-4 text-center">
                    No shifts
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
                          {shift.assignedName.trim() || 'Open Slot'}
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
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase text-slate-500">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="px-3 py-2">
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
                  className={`min-h-28 p-2 space-y-1.5 ${
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
                        {shift.assignedName.trim() || 'Open'}
                      </button>
                    ))}
                    {dayShifts.length > 3 && (
                      <div className="text-[10px] font-semibold text-slate-500 px-1">
                        +{dayShifts.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Table View */}
      {subTab === 'table' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5 bg-white border border-slate-200 rounded-lg p-1">
              {(
                [
                  ['all', 'All'],
                  ['mine', 'Mine'],
                  ['open', `Open (${openCount})`],
                  ['overlaps', `Overlaps (${conflictCount})`],
                  ['completed', 'Completed'],
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

            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search shifts, staff, date..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
              />
            </div>
          </div>

          {tableShifts.length === 0 ? (
            <EmptyStatePanel
              icon={<Calendar className="w-5 h-5" />}
              title="No shifts match your filters"
              subtitle="Change your table filter or add a new team shift."
            />
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-4">Shift</th>
                    <th className="py-3 px-4">Date &amp; Window</th>
                    <th className="py-3 px-4">Assignee</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
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
                          {shift.assignedName.trim() || 'Open / Unassigned'}
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
                              className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
                            >
                              {shift.status === ShiftStatus.OPEN
                                ? 'Claim'
                                : 'Request Change'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onInspectShift(shift)}
                              className="text-xs font-semibold text-slate-600 hover:underline cursor-pointer"
                            >
                              Inspect
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
              title="No availability submissions yet"
              subtitle="Submit your preferred upcoming shift days so the Fairness Engine can assign weekly slots."
              action={
                <button
                  type="button"
                  onClick={onOpenSubmitAvailability}
                  className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                >
                  Submit Availability
                </button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                            onShowFeedback('Availability submission withdrawn.');
                          }}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 hover:underline cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Withdraw</span>
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
