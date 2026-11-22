import { useMemo, useState } from 'react';
import {
  Calendar,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Search,
} from 'lucide-react';
import { formatHours, formatIsoDate } from '../domain/fairnessEngine';
import {
  CadenceTab,
  Shift,
  ShiftStatus,
  UserRole,
  WorkspaceUiData,
} from '../types/cadence';
import { exportIcsFile, openGoogleCalendarForShift } from '../utils/calendarExport';
import {
  EmptyStatePanel,
  KpiTile,
  ShiftStatusChip,
  StatusChip,
  SurfaceCard,
} from '../components/UiPrimitives';
import { formatRelativeDayBadge } from '../utils/dateFormatting';

interface MyScheduleScreenProps {
  data: WorkspaceUiData;
  onNavigate: (tab: CadenceTab) => void;
  onInspectShift: (shift: Shift) => void;
  onRequestChange: (shift: Shift) => void;
  onLogReportForShift: (shift: Shift) => void;
  onShowFeedback: (msg: string) => void;
}

type MyFilter = 'upcoming' | 'all' | 'pending_change' | 'completed';

export function MyScheduleScreen({
  data,
  onNavigate,
  onInspectShift,
  onRequestChange,
  onLogReportForShift,
  onShowFeedback,
}: MyScheduleScreenProps) {
  const [filter, setFilter] = useState<MyFilter>('upcoming');
  const [searchQuery, setSearchQuery] = useState('');

  const todayIso = formatIsoDate(new Date());

  const myShifts = useMemo(
    () =>
      data.shifts
        .filter(
          (s) => s.assignedUid === data.profile.uid && s.status !== ShiftStatus.OPEN,
        )
        .sort((a, b) =>
          a.date !== b.date
            ? a.date.localeCompare(b.date)
            : a.startTime.localeCompare(b.startTime),
        ),
    [data.shifts, data.profile.uid],
  );

  const upcomingShifts = useMemo(
    () =>
      myShifts.filter(
        (s) => s.status !== ShiftStatus.COMPLETED && s.date >= todayIso,
      ),
    [myShifts, todayIso],
  );

  const nextUpcomingShift = upcomingShifts[0] ?? null;

  const filteredShifts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return myShifts.filter((s) => {
      if (filter === 'upcoming') {
        if (s.status === ShiftStatus.COMPLETED) return false;
      } else if (filter === 'pending_change') {
        if (s.status !== ShiftStatus.PENDING_CHANGE) return false;
      } else if (filter === 'completed') {
        if (s.status !== ShiftStatus.COMPLETED) return false;
      }
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        s.department.toLowerCase().includes(q) ||
        s.date.includes(q)
      );
    });
  }, [myShifts, filter, searchQuery]);

  const totalScheduledHours = upcomingShifts.reduce(
    (sum, s) => sum + s.durationHours,
    0,
  );

  const handleExportMyIcs = async () => {
    if (myShifts.length === 0) {
      onShowFeedback('No assigned shifts available to export.');
      return;
    }
    const saved = await exportIcsFile(myShifts, 'my-cadence-shifts.ics');
    if (saved) {
      onShowFeedback(`Exported ${myShifts.length} shifts to ${saved}`);
    }
  };

  return (
    <div className="space-y-5 @xl:space-y-6">
      <div className="flex flex-col @3xl:flex-row @3xl:items-start @3xl:justify-between gap-3 @xl:gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl @xl:text-2xl font-bold text-slate-900">My Schedule</h1>
            <StatusChip label="Live Sync" tone="success" />
          </div>
          <p className="text-xs @xl:text-sm text-slate-500 mt-1">
            Personal assigned shifts, Google Calendar export, and change requests
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleExportMyIcs}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download className="w-4 h-4 text-slate-600" />
            <span>Export My .ics</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate(CadenceTab.SCHEDULE)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            <Calendar className="w-4 h-4" />
            <span>Full Team Schedule</span>
          </button>
        </div>
      </div>

      {/* Next Upcoming Shift Spotlight */}
      {nextUpcomingShift && (
        <SurfaceCard className="bg-blue-50/40 border-blue-200 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-blue-700">
                Next Upcoming Shift
              </span>
              <StatusChip
                label={formatRelativeDayBadge(nextUpcomingShift.date)}
                tone="info"
              />
            </div>
            <ShiftStatusChip status={nextUpcomingShift.status} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                {nextUpcomingShift.title}
              </h2>
              <p className="text-xs text-slate-600 mt-0.5 font-mono-tabular">
                {nextUpcomingShift.date} · {nextUpcomingShift.startTime}–
                {nextUpcomingShift.endTime} ({formatHours(nextUpcomingShift.durationHours)}h) ·{' '}
                {nextUpcomingShift.department}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => openGoogleCalendarForShift(nextUpcomingShift)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer"
              >
                <CalendarPlus className="w-3.5 h-3.5 text-blue-600" />
                <span>Add to Google Calendar</span>
              </button>
              <button
                type="button"
                onClick={() => onRequestChange(nextUpcomingShift)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
              >
                <CalendarClock className="w-3.5 h-3.5" />
                <span>Request Change</span>
              </button>
            </div>
          </div>
        </SurfaceCard>
      )}

      {/* KPI Summary */}
      <div className="grid grid-cols-1 @sm:grid-cols-2 gap-3 @xl:gap-4">
        <KpiTile
          label="Upcoming Shifts"
          value={upcomingShifts.length}
          subtext={`${myShifts.length} total assigned to you`}
          accentClass="text-blue-700"
          icon={<Calendar className="w-4 h-4" />}
        />
        <KpiTile
          label="Scheduled Upcoming Hours"
          value={`${formatHours(totalScheduledHours)}h`}
          subtext={`Target ${data.profile.weeklyHoursTarget}h/week`}
          accentClass="text-emerald-700"
          icon={<CheckCircle2 className="w-4 h-4" />}
        />
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col @2xl:flex-row @2xl:items-center @2xl:justify-between gap-3">
        <div className="inline-flex items-center gap-1 max-w-full overflow-x-auto cadence-scroll bg-white border border-slate-200 rounded-lg p-1">
          {(
            [
              ['upcoming', 'Upcoming'],
              ['all', 'All Assigned'],
              ['pending_change', 'Pending Change'],
              ['completed', 'Completed'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                filter === key
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
            placeholder="Filter title, department, date..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-600"
          />
        </div>
      </div>

      {/* Shifts List */}
      {filteredShifts.length === 0 ? (
        <EmptyStatePanel
          icon={<Calendar className="w-5 h-5" />}
          title="No matching assigned shifts"
          subtitle="Adjust your filter or explore open team shifts in Schedule & Fairness."
        />
      ) : (
        <div className="grid grid-cols-1 @2xl:grid-cols-2 @6xl:grid-cols-3 gap-4">
          {filteredShifts.map((shift) => (
            <SurfaceCard
              key={shift.id}
              onClick={() => onInspectShift(shift)}
              className="space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900 truncate">
                      {shift.title}
                    </h3>
                    <StatusChip
                      label={formatRelativeDayBadge(shift.date)}
                      tone="neutral"
                    />
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {shift.department} ·{' '}
                    <span className="font-mono-tabular">
                      {shift.date} {shift.startTime}–{shift.endTime} (
                      {formatHours(shift.durationHours)}h)
                    </span>
                  </div>
                </div>
                <ShiftStatusChip status={shift.status} />
              </div>

              {shift.fairnessNote && (
                <p className="text-xs text-slate-600 line-clamp-2">
                  {shift.fairnessNote}
                </p>
              )}

              <div
                className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => openGoogleCalendarForShift(shift)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  <CalendarPlus className="w-3.5 h-3.5 text-blue-600" />
                  <span>Calendar</span>
                </button>
                {shift.status !== ShiftStatus.COMPLETED && (
                  <button
                    type="button"
                    onClick={() => onRequestChange(shift)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
                  >
                    <CalendarClock className="w-3.5 h-3.5 text-amber-600" />
                    <span>Request Change</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onLogReportForShift(shift)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  <ClipboardCheck className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Log Report</span>
                </button>
                {data.profile.role === UserRole.MANAGER && (
                  <button
                    type="button"
                    onClick={() => onInspectShift(shift)}
                    className="ml-auto text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
                  >
                    Details
                  </button>
                )}
              </div>
            </SurfaceCard>
          ))}
        </div>
      )}
    </div>
  );
}
