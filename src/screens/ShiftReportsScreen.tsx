import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  Download,
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
import { invokeSaveReportsCsv } from '../utils/tauriBridge';
import { useI18n } from '../i18n/I18nContext';
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
  const { t } = useI18n();
  const isManager = data.profile.role === UserRole.MANAGER;
  const [filter, setFilter] = useState<ReportFilter>('all');
  const [modalOpen, setModalOpen] = useState(false);

  const myLinkableShifts = useMemo(
    () =>
      data.shifts.filter((s) => s.assignedUid === data.profile.uid),
    [data.shifts, data.profile.uid],
  );

  const [linkedShiftId, setLinkedShiftId] = useState('');
  const [title, setTitle] = useState(() => t('default_shift_morning'));
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
        setTitle(t('default_shift_morning'));
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
    t,
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
      setErrorMsg(t('win_err_report_datetime'));
      return;
    }
    if (!title.trim()) {
      setErrorMsg(t('win_err_enter_shift_title'));
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      await onSubmitReport({
        shiftId: linkedShiftId,
        shiftTitle: title.trim(),
        department: department.trim() || t('default_dept_operations'),
        date,
        actualStartTime: startTime,
        actualEndTime: endTime,
        breakMinutes: parsedBreak,
        handoffNotes: handoffNotes.trim(),
      });
      setModalOpen(false);
      onShowFeedback(t('vm_banner_report_submitted'));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 @xl:space-y-6">
      <div className="flex flex-col @3xl:flex-row @3xl:items-start @3xl:justify-between gap-3 @xl:gap-4">
        <div className="min-w-0">
          <h1 className="text-xl @xl:text-2xl font-bold text-slate-900">
            {t('shift_reports_title')}
          </h1>
          <p className="text-xs @xl:text-sm text-slate-500 mt-1">
            {t('shift_reports_subtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {filteredReports.length > 0 && (
            <button
              type="button"
              onClick={async () => {
                const savedPath = await invokeSaveReportsCsv(filteredReports);
                if (typeof savedPath === 'string') {
                  onShowFeedback(t('win_saved_csv_format', savedPath));
                } else if (savedPath === undefined) {
                  const csv = [
                    'Date,Staff,Department,Shift,Start,End,BreakMin,WorkedHours,Status',
                    ...filteredReports.map((r) =>
                      [
                        r.date,
                        `"${r.staffName.replace(/"/g, '""')}"`,
                        `"${r.department.replace(/"/g, '""')}"`,
                        `"${r.shiftTitle.replace(/"/g, '""')}"`,
                        r.actualStartTime,
                        r.actualEndTime,
                        r.breakMinutes,
                        r.workedHours.toFixed(2),
                        r.status,
                      ].join(','),
                    ),
                  ].join('\n');
                  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'cadence-shift-reports.csv';
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                  onShowFeedback(t('win_exported_csv_notice'));
                }
              }}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download className="w-4 h-4 text-slate-600 shrink-0" />
              <span>{t('win_export_csv')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setLinkedShiftId('');
              setTitle(t('default_shift_morning'));
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
            <Plus className="w-4 h-4 shrink-0" />
            <span>{t('btn_log_report_short')}</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="inline-flex items-center gap-1 max-w-full overflow-x-auto cadence-scroll bg-white border border-slate-200 rounded-lg p-1">
        {(
          [
            ['all', t('win_all_count_format', data.shiftReports.length)],
            [ShiftReportStatus.SUBMITTED, t('report_status_submitted')],
            [ShiftReportStatus.VERIFIED, t('report_status_verified')],
            [ShiftReportStatus.FLAGGED, t('report_status_flagged')],
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
          title={t('empty_reports_title')}
          subtitle={t('empty_reports_subtitle')}
        />
      ) : (
        <div className="grid grid-cols-1 @2xl:grid-cols-2 @6xl:grid-cols-3 gap-4">
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
                  <div className="text-[11px] text-slate-500">{t('win_date_col')}</div>
                  <div className="font-mono-tabular font-semibold text-slate-900">
                    {rep.date}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">{t('win_clock_col')}</div>
                  <div className="font-mono-tabular font-semibold text-slate-900">
                    {rep.actualStartTime}–{rep.actualEndTime}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">{t('win_net_worked_col')}</div>
                  <div className="font-mono-tabular font-semibold text-emerald-700">
                    {formatHours(rep.workedHours)}h ({t('win_break_short_format', rep.breakMinutes)})
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
                        t(
                          'vm_banner_report_verified',
                          rep.staffName,
                          formatHours(rep.workedHours),
                        ),
                      );
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>{t('btn_verify_hours_format', formatHours(rep.workedHours))}</span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await onVerifyOrFlag(rep, ShiftReportStatus.FLAGGED);
                      onShowFeedback(
                        t('vm_banner_report_flagged', rep.staffName),
                      );
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Flag className="w-3.5 h-3.5 shrink-0" />
                    <span>{t('btn_flag')}</span>
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
        title={t('dialog_log_report')}
        subtitle={t('shift_reports_subtitle')}
        footer={
          <>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer whitespace-nowrap shrink-0"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              form="log-shift-report-form"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              {saving ? t('win_submitting') : t('submit_report')}
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
                {t('link_scheduled_shift_optional')}
              </label>
              <select
                value={linkedShiftId}
                onChange={(e) => handleLinkShiftChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
              >
                <option value="">{t('custom_unlinked_shift')}</option>
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
                {t('shift_title_label')}
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
                {t('department_label')}
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
                {t('date_label')}
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
                {t('clock_in_hhmm')}
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
                {t('clock_out_hhmm')}
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
                {t('break_minutes_range')}
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
              {t('computed_net_hours_format', formatHours(computedHours))}
            </span>
            <span className="font-mono-tabular font-bold text-emerald-700 text-sm">
              {formatHours(computedHours)}h
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {t('handoff_notes_label')}
            </label>
            <textarea
              value={handoffNotes}
              onChange={(e) => setHandoffNotes(e.target.value)}
              maxLength={600}
              rows={3}
              placeholder={t('win_handoff_placeholder')}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900"
            />
          </div>
        </form>
      </ModalShell>
    </div>
  );
}
