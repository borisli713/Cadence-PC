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
  ShiftStatus,
  UserRole,
  WorkspaceUiData,
} from '../types/cadence';
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
  const { profile, shifts, scheduleChanges, shiftReports, timeOffRequests } = data;
  const isManager = profile.role === UserRole.MANAGER;

  const myShifts = shifts.filter(
    (s) => s.assignedUid === profile.uid && s.status !== ShiftStatus.OPEN,
  );
  const myUpcomingShifts = myShifts
    .filter((s) => s.status !== ShiftStatus.COMPLETED)
    .slice(0, 4);

  const pendingApprovalsCount = scheduleChanges.filter(
    (c) => c.status === ApprovalStatus.PENDING,
  ).length;
  const pendingTimeOffCount = timeOffRequests.filter(
    (t) => t.status === ApprovalStatus.PENDING,
  ).length;
  const conflictShiftsCount = shifts.filter(
    (s) => s.status === ShiftStatus.CONFLICT || s.candidateUids.length > 1,
  ).length;

  const currentStaffEntry = data.staffDirectory.find(
    (s) => s.uid === profile.uid,
  );
  const totalLoggedHours = currentStaffEntry?.totalHoursWorked ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Welcome back, {profile.displayName}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {profile.department} ·{' '}
            {isManager ? 'Manager Console' : 'Staff Workspace'} ·{' '}
            Target {profile.weeklyHoursTarget}h/week
          </p>
        </div>
      </div>

      {/* Quick Actions */}
      <SurfaceCard className="space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Quick Actions
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onQuickLogReport}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            <ClipboardCheck className="w-4 h-4" />
            <span>Log Shift Report</span>
          </button>

          {isManager && (
            <button
              type="button"
              onClick={() => onNavigate(CadenceTab.APPROVALS)}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Review Approvals ({pendingApprovalsCount})</span>
            </button>
          )}

          <button
            type="button"
            onClick={onQuickRequestChange}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            <CalendarClock className="w-4 h-4 text-slate-600" />
            <span>Request Shift Change</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate(CadenceTab.MY_SCHEDULE)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            <Calendar className="w-4 h-4 text-slate-600" />
            <span>My Schedule</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate(CadenceTab.SCHEDULE)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-4 h-4 text-slate-600" />
            <span>Schedule &amp; Fairness</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate(CadenceTab.TIME_OFF)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            <CalendarOff className="w-4 h-4 text-slate-600" />
            <span>Time Off ({pendingTimeOffCount})</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate(CadenceTab.HISTORY)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            <History className="w-4 h-4 text-slate-600" />
            <span>Shift History</span>
          </button>
        </div>
      </SurfaceCard>

      {/* KPI Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiTile
          label="My Shifts"
          value={myShifts.length}
          subtext={`${myUpcomingShifts.length} upcoming active`}
          accentClass="text-blue-700"
          icon={<Calendar className="w-4 h-4" />}
        />
        <KpiTile
          label="Pending Approvals"
          value={pendingApprovalsCount}
          subtext={`${pendingTimeOffCount} pending time off`}
          accentClass={
            pendingApprovalsCount > 0 ? 'text-amber-700' : 'text-slate-900'
          }
          icon={<CheckCircle2 className="w-4 h-4" />}
        />
        <KpiTile
          label="Overlap Conflicts"
          value={conflictShiftsCount}
          subtext={
            conflictShiftsCount > 0
              ? 'Ready for fairness arrangement'
              : 'All team shifts resolved'
          }
          accentClass={
            conflictShiftsCount > 0 ? 'text-rose-700' : 'text-emerald-700'
          }
          icon={<AlertTriangle className="w-4 h-4" />}
        />
        <KpiTile
          label="My Verified Hours"
          value={`${formatHours(totalLoggedHours)}h`}
          subtext={`Target ${profile.weeklyHoursTarget}h/week`}
          accentClass="text-emerald-700"
          icon={<ClipboardCheck className="w-4 h-4" />}
        />
      </div>

      {/* Main Preview Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* My Assigned Shifts Preview */}
        <SurfaceCard className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900">
              My Assigned Shifts
            </h2>
            <button
              type="button"
              onClick={() => onNavigate(CadenceTab.MY_SCHEDULE)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
            >
              <span>View all</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {myUpcomingShifts.length === 0 ? (
            <EmptyStatePanel
              icon={<Calendar className="w-5 h-5" />}
              title="No active assigned shifts"
              subtitle="Check open shifts in Schedule & Fairness or submit availability."
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
                    <div className="text-[11px] text-slate-500 font-mono-tabular mt-0.5">
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
            <h2 className="text-sm font-bold text-slate-900">
              Active Team Schedule
            </h2>
            <button
              type="button"
              onClick={() => onNavigate(CadenceTab.SCHEDULE)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
            >
              <span>Open calendar</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {shifts.length === 0 ? (
            <EmptyStatePanel
              icon={<Sparkles className="w-5 h-5" />}
              title="No team shifts scheduled yet"
              subtitle="Add shifts or generate a weekly schedule from staff submissions."
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
                      {shift.assignedName.trim() || 'Open Shift'} ·{' '}
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
            <h2 className="text-sm font-bold text-slate-900">
              Recent Schedule Change Updates
            </h2>
            <button
              type="button"
              onClick={() => onNavigate(CadenceTab.APPROVALS)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
            >
              <span>Approvals</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {scheduleChanges.length === 0 ? (
            <EmptyStatePanel
              icon={<CalendarClock className="w-5 h-5" />}
              title="No recent change requests"
              subtitle="Shift swaps, drops, time changes, and open claims appear here."
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
                      {req.requesterName} · {req.type.replace('_', ' ')} ·{' '}
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
            <h2 className="text-sm font-bold text-slate-900">
              Latest Shift Reports
            </h2>
            <button
              type="button"
              onClick={() => onNavigate(CadenceTab.REPORTS)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
            >
              <span>All reports</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {shiftReports.length === 0 ? (
            <EmptyStatePanel
              icon={<ClipboardCheck className="w-5 h-5" />}
              title="No shift reports logged yet"
              subtitle="Log worked hours and handoff notes after completing a shift."
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
                        {rep.date} · {formatHours(rep.workedHours)}h net
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
