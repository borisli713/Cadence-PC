import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  Flag,
  Plus,
} from 'lucide-react';
import {
  computeShiftHours,
  formatHours,
  formatIsoDate,
} from '../domain/fairnessEngine';
import {
  DATE_PATTERN,
  Shift,
  ShiftReport,
  ShiftReportStatus,
  TIME_PATTERN,
  UserRole,
  WorkspaceUiData,
} from '../types/cadence';
import {
  EmptyStatePanel,
  ModalShell,
  ReportStatusChip,
  SurfaceCard,
} from '../components/UiPrimitives';

interface ShiftReportsScreenProps {
  data: WorkspaceUiData;
  prelinkedShift: Shift | null;
  openLogModalInitially: boolean;
  onConsumedInitialModal: () => void;
  onSubmitReport: (params: {
    shiftId: string;
    shiftTitle: string;
    department: string;
    date: string;
    actualStartTime: string;
    actualEndTime: string;
    breakMinutes: number;
    handoffNotes: string;
  }) => Promise<void>;
  onVerifyOrFlag: (
    report: ShiftReport,
    status: ShiftReportStatus,
  ) => Promise<void>;
  onShowFeedback: (msg: string) => void;
}

type ReportFilter = 'all' | ShiftReportStatus;

export function ShiftReportsScreen({
  data,
  prelinkedShift,
  openLogModalInitially,
  onConsumedInitialModal,
  onSubmitReport,
  onVerifyOrFlag,
  onShowFeedback,
}: ShiftReportsScreenProps) {
  const isManager = data.profile.role === UserRole.MANAGER;
  const [filter, setFilter] = useState<ReportFilter>('all');
  const [modalOpen, setModalOpen] = useState(false);

  const myLinkableShifts = useMemo(
    () =>
      data.shifts.filter((s) => s.assignedUid === data.profile.uid),
    [data.shifts, data.profile.uid],
  );

  const [linkedShiftId, setLinkedShiftId] = useState('');
  const [title, setTitle] = useState('Operations Shift');
  const [department, setDepartment] = useState(data.profile.department);
  const [date, setDate] = useState(formatIsoDate(new Date()));
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [breakMinutes, setBreakMinutes] = useState('30');
  const [handoffNotes, setHandoffNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (openLogModalInitially) {
      if (prelinkedShift) {
        setLinkedShiftId(prelinkedShift.id);
        setTitle(prelinkedShift.title);
        setDepartment(prelinkedShift.department);
        setDate(prelinkedShift.date);
        setStartTime(prelinkedShift.startTime);
        setEndTime(prelinkedShift.endTime);
      } else {
        setLinkedShiftId('');
        setTitle('Operations Shift');
        setDepartment(data.profile.department);
        setDate(formatIsoDate(new Date()));
        setStartTime('09:00');
        setEndTime('17:00');
      }
      setBreakMinutes('30');
      setHandoffNotes('');
      setErrorMsg(null);
      setModalOpen(true);
      onConsumedInitialModal();
    }
  }, [
    openLogModalInitially,
    prelinkedShift,
    data.profile.department,
    onConsumedInitialModal,
  ]);

  const handleLinkShiftChange = (id: string) => {
    setLinkedShiftId(id);
    const found = myLinkableShifts.find((s) => s.id === id);
    if (found) {
      setTitle(found.title);
      setDepartment(found.department);
      setDate(found.date);
      setStartTime(found.startTime);
      setEndTime(found.endTime);
    }
  };

  const parsedBreak = Math.min(
    180,
    Math.max(0, Number.parseInt(breakMinutes, 10) || 0),
  );
  const computedHours = useMemo(
    () =>
      TIME_PATTERN.test(startTime) && TIME_PATTERN.test(endTime)
        ? computeShiftHours(startTime, endTime, parsedBreak)
        : 0,
    [startTime, endTime, parsedBreak],
  );

  const filteredReports = useMemo(
    () =>
      filter === 'all'
        ? data.shiftReports
        : data.shiftReports.filter((r) => r.status === filter),
    [data.shiftReports, filter],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!DATE_PATTERN.test(date) || !TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) {
      setErrorMsg('Enter valid date (YYYY-MM-DD) and clock in/out times.');
      return;
    }
    if (!title.trim()) {
      setErrorMsg('Enter a shift title.');
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      await onSubmitReport({
        shiftId: linkedShiftId,
        shiftTitle: title.trim(),
        department: department.trim() || 'Operations',
        date,
        actualStartTime: startTime,
        actualEndTime: endTime,
        breakMinutes: parsedBreak,
        handoffNotes: handoffNotes.trim(),
      });
      setModalOpen(false);
      onShowFeedback('Shift report submitted for verification.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Shift Reports</h1>
          <p className="text-sm text-slate-500 mt-1">
            Verified clock-in/out logs, break deductions, and manager verification
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setLinkedShiftId('');
            setTitle('Operations Shift');
            setDepartment(data.profile.department);
            setDate(formatIsoDate(new Date()));
            setStartTime('09:00');
            setEndTime('17:00');
            setBreakMinutes('30');
            setHandoffNotes('');
            setErrorMsg(null);
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Log Shift Report</span>
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="inline-flex flex-wrap items-center gap-1 bg-white border border-slate-200 rounded-lg p-1">
        {(
          [
            ['all', `All (${data.shiftReports.length})`],
            [ShiftReportStatus.SUBMITTED, 'Submitted'],
            [ShiftReportStatus.VERIFIED, 'Verified'],
            [ShiftReportStatus.FLAGGED, 'Flagged'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
              filter === key
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {filteredReports.length === 0 ? (
        <EmptyStatePanel
          icon={<ClipboardCheck className="w-5 h-5" />}
          title="No shift reports in this view"
          subtitle="Click Log Shift Report to submit actual worked hours and handoff notes."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredReports.map((rep) => (
            <SurfaceCard key={rep.id} className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900 truncate">
                    {rep.shiftTitle}
                  </h3>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {rep.staffName} · {rep.department}
                  </div>
                </div>
                <ReportStatusChip status={rep.status} />
              </div>

              <div className="grid grid-cols-3 gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                <div>
                  <div className="text-[11px] text-slate-500">Date</div>
                  <div className="font-mono-tabular font-semibold text-slate-900">
                    {rep.date}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Clock</div>
                  <div className="font-mono-tabular font-semibold text-slate-900">
                    {rep.actualStartTime}–{rep.actualEndTime}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Net Worked</div>
                  <div className="font-mono-tabular font-semibold text-emerald-700">
                    {formatHours(rep.workedHours)}h ({rep.breakMinutes}m brk)
                  </div>
                </div>
              </div>

              {rep.handoffNotes && (
                <p className="text-xs text-slate-600 leading-relaxed">
                  {rep.handoffNotes}
                </p>
              )}

              {isManager && rep.status === ShiftReportStatus.SUBMITTED && (
                <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={async () => {
                      await onVerifyOrFlag(rep, ShiftReportStatus.VERIFIED);
                      onShowFeedback(
                        `Verified +${formatHours(rep.workedHours)}h for ${rep.staffName}.`,
                      );
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Verify (+{formatHours(rep.workedHours)}h)</span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await onVerifyOrFlag(rep, ShiftReportStatus.FLAGGED);
                      onShowFeedback(
                        `Flagged shift report for ${rep.staffName}.`,
                      );
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold cursor-pointer"
                  >
                    <Flag className="w-3.5 h-3.5" />
                    <span>Flag</span>
                  </button>
                </div>
              )}
            </SurfaceCard>
          ))}
        </div>
      )}

      {/* Log Report Modal */}
      <ModalShell
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Log Verified Shift Report"
        subtitle="Record actual clock-in/out times, break minutes, and handoff notes"
        footer={
          <>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="log-shift-report-form"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
            >
              {saving ? 'Submitting...' : 'Submit Report'}
            </button>
          </>
        }
      >
        <form
          id="log-shift-report-form"
          onSubmit={handleSubmit}
          className="space-y-3.5"
        >
          {errorMsg && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
              {errorMsg}
            </div>
          )}

          {myLinkableShifts.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Link Scheduled Shift (Optional)
              </label>
              <select
                value={linkedShiftId}
                onChange={(e) => handleLinkShiftChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
              >
                <option value="">Standalone shift report</option>
                {myLinkableShifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.date} · {s.title} ({s.startTime}–{s.endTime})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Shift Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                required
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Department
              </label>
              <input
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                maxLength={60}
                required
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-tabular text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Clock In
              </label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-tabular text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Clock Out
              </label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-tabular text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Break (min)
              </label>
              <input
                type="number"
                min={0}
                max={180}
                value={breakMinutes}
                onChange={(e) => setBreakMinutes(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-tabular text-sm text-slate-900"
              />
            </div>
          </div>

          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-between text-xs">
            <span className="font-semibold text-emerald-900">
              Computed Net Worked Hours
            </span>
            <span className="font-mono-tabular font-bold text-emerald-700 text-sm">
              {formatHours(computedHours)}h
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Handoff Notes
            </label>
            <textarea
              value={handoffNotes}
              onChange={(e) => setHandoffNotes(e.target.value)}
              maxLength={600}
              rows={3}
              placeholder="Tasks completed, equipment status, or notes for next shift..."
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900"
            />
          </div>
        </form>
      </ModalShell>
    </div>
  );
}
