import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarPlus,
  Clock,
  Edit3,
  Trash2,
} from 'lucide-react';
import {
  addDaysIso,
  computeShiftHours,
  DEFAULT_WEEK_SLOTS,
  formatHours,
  formatIsoDate,
  getMondayIso,
} from '../domain/fairnessEngine';
import {
  DATE_PATTERN,
  ScheduleChangeType,
  Shift,
  ShiftStatus,
  StaffDirectoryEntry,
  TIME_PATTERN,
  WeekSlotConfig,
} from '../types/cadence';
import { openGoogleCalendarForShift } from '../utils/calendarExport';
import {
  invokeValidateScheduleChange,
  invokeValidateShift,
} from '../utils/tauriBridge';
import { useI18n } from '../i18n/I18nContext';
import { ModalShell, ShiftStatusChip } from './UiPrimitives';

interface ShiftDetailDialogProps {
  shift: Shift | null;
  isManager: boolean;
  currentUid: string;
  onClose: () => void;
  onRequestChange: (shift: Shift) => void;
  onEditShift: (shift: Shift) => void;
  onDeleteShift: (shiftId: string) => Promise<void>;
}

export function ShiftDetailDialog({
  shift,
  isManager,
  currentUid,
  onClose,
  onRequestChange,
  onEditShift,
  onDeleteShift,
}: ShiftDetailDialogProps) {
  const { t } = useI18n();
  const [deleting, setDeleting] = useState(false);

  if (!shift) return null;

  const canStaffRequest =
    shift.status !== ShiftStatus.COMPLETED &&
    (shift.status === ShiftStatus.OPEN || shift.assignedUid === currentUid);

  return (
    <ModalShell
      open={Boolean(shift)}
      onClose={onClose}
      title={shift.title}
      subtitle={`${shift.department} · ${shift.date} (${shift.startTime}–${shift.endTime})`}
      footer={
        <div className="w-full flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {isManager && (
              <button
                type="button"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    await onDeleteShift(shift.id);
                    onClose();
                  } finally {
                    setDeleting(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-rose-700 hover:bg-rose-50 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                <span>{deleting ? t('win_deleting') : t('btn_delete')}</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => openGoogleCalendarForShift(shift)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer whitespace-nowrap shrink-0"
            >
              <CalendarPlus className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span>{t('btn_google_calendar')}</span>
            </button>

            {canStaffRequest && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onRequestChange(shift);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
              >
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {shift.status === ShiftStatus.OPEN
                    ? t('btn_claim_open_shift')
                    : t('btn_request_change_swap')}
                </span>
              </button>
            )}

            {isManager && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onEditShift(shift);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
              >
                <Edit3 className="w-3.5 h-3.5 shrink-0" />
                <span>{t('btn_edit')}</span>
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">{t('win_status_label')}</span>
          <ShiftStatusChip status={shift.status} />
        </div>

        <div className="grid grid-cols-2 gap-3 p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
          <div>
            <div className="text-slate-500">{t('assigned_staff_label')}</div>
            <div className="font-semibold text-slate-900 mt-0.5">
              {shift.assignedName.trim() || t('open_unassigned')}
            </div>
          </div>
          <div>
            <div className="text-slate-500">{t('win_duration_label')}</div>
            <div className="font-mono-tabular font-semibold text-slate-900 mt-0.5">
              {t('duration_hours_format', formatHours(shift.durationHours))}
            </div>
          </div>
          <div>
            <div className="text-slate-500">{t('date_label')}</div>
            <div className="font-mono-tabular font-semibold text-slate-900 mt-0.5">
              {shift.date}
            </div>
          </div>
          <div>
            <div className="text-slate-500">{t('win_window_label')}</div>
            <div className="font-mono-tabular font-semibold text-slate-900 mt-0.5">
              {shift.startTime} – {shift.endTime}
            </div>
          </div>
        </div>

        {shift.fairnessNote && (
          <div className="p-3 rounded-lg bg-blue-50/70 border border-blue-200 text-xs text-blue-900">
            {t('fairness_note_format', shift.fairnessNote)}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

interface AddShiftDialogProps {
  open: boolean;
  defaultDate: string;
  staffDirectory: StaffDirectoryEntry[];
  onClose: () => void;
  onCreate: (params: {
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
  }) => Promise<void>;
}

export function AddShiftDialog({
  open,
  defaultDate,
  staffDirectory,
  onClose,
  onCreate,
}: AddShiftDialogProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState(() => t('default_shift_morning'));
  const [department, setDepartment] = useState(() => t('default_dept_operations'));
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [selectedCandidateUids, setSelectedCandidateUids] = useState<string[]>([]);
  const [markAsOverlap, setMarkAsOverlap] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(t('default_shift_morning'));
      setDepartment(t('default_dept_operations'));
      setDate(defaultDate);
      setStartTime('09:00');
      setEndTime('17:00');
      setLeaveOpen(false);
      setSelectedCandidateUids(staffDirectory[0] ? [staffDirectory[0].uid] : []);
      setMarkAsOverlap(false);
      setErrorMsg(null);
    }
  }, [open, defaultDate, staffDirectory, t]);

  const toggleCandidate = (uid: string) => {
    setSelectedCandidateUids((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!DATE_PATTERN.test(date)) {
      setErrorMsg(t('win_err_enter_date_format'));
      return;
    }
    if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) {
      setErrorMsg(t('win_err_enter_time_format'));
      return;
    }

    const candidates = selectedCandidateUids;
    const isOpen = leaveOpen || candidates.length === 0;
    const isConflict = !isOpen && markAsOverlap && candidates.length >= 2;

    const firstStaff = staffDirectory.find((s) => s.uid === candidates[0]);
    const assignedUid = isOpen ? '' : firstStaff?.uid ?? '';
    const assignedName = isOpen ? '' : firstStaff?.displayName ?? '';
    const status = isOpen
      ? ShiftStatus.OPEN
      : isConflict
        ? ShiftStatus.CONFLICT
        : ShiftStatus.SCHEDULED;

    const fairnessNote = isConflict
      ? `${candidates.length} overlapping candidates — ready for fairness arrange`
      : isOpen
        ? 'Open shift posted to team calendar'
        : `Assigned directly (${formatHours(computeShiftHours(startTime, endTime))}h)`;

    const cleanTitle = title.trim() || t('default_shift_morning');
    const cleanDept = department.trim() || t('default_dept_operations');

    setSaving(true);
    setErrorMsg(null);
    try {
      const rustValidation = await invokeValidateShift(
        cleanTitle,
        cleanDept,
        date,
        startTime,
        endTime,
      );
      if (rustValidation && !rustValidation.valid) {
        setErrorMsg(rustValidation.errorMessage ?? t('win_err_enter_time_format'));
        setSaving(false);
        return;
      }

      await onCreate({
        title: cleanTitle,
        department: cleanDept,
        date,
        startTime,
        endTime,
        assignedUid,
        assignedName,
        candidateUids: candidates,
        status,
        fairnessNote,
      });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={t('dialog_create_shift')}
      subtitle={t('win_add_shift_subtitle')}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer whitespace-nowrap shrink-0"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            form="add-shift-form"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            {saving ? t('win_saving') : t('win_create_shift')}
          </button>
        </>
      }
    >
      <form id="add-shift-form" onSubmit={handleSubmit} className="space-y-3.5">
        {errorMsg && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
            {errorMsg}
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
              {t('start_label')}
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
              {t('end_label')}
            </label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-tabular text-sm text-slate-900"
            />
          </div>
        </div>

        <label className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
          <span className="text-xs font-semibold text-slate-800">
            {t('leave_open_blank')}
          </span>
          <input
            type="checkbox"
            checked={leaveOpen}
            onChange={(e) => setLeaveOpen(e.target.checked)}
            className="w-4 h-4 accent-blue-600 cursor-pointer"
          />
        </label>

        <div>
          <div className="flex items-center justify-between mb-1.5 gap-2">
            <span className="text-xs font-semibold text-slate-700">
              {t('candidate_staff_count', selectedCandidateUids.length)}
            </span>
            <span className="text-[11px] text-slate-500">
              {t('win_select_2_plus_hint')}
            </span>
          </div>
          <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
            {staffDirectory.map((member) => {
              const checked = selectedCandidateUids.includes(member.uid);
              return (
                <label
                  key={member.uid}
                  className="flex items-center justify-between px-3 py-2 hover:bg-slate-50 cursor-pointer text-xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleCandidate(member.uid)}
                      className="w-4 h-4 accent-blue-600 cursor-pointer"
                    />
                    <span className="font-medium text-slate-900 truncate">
                      {member.displayName}
                    </span>
                    <span className="text-slate-400 truncate">
                      {member.department}
                    </span>
                  </div>
                  <span className="font-mono-tabular text-slate-500 shrink-0">
                    {t('win_logged_hours_format', formatHours(member.totalHoursWorked))}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {!leaveOpen && selectedCandidateUids.length >= 2 && (
          <label className="flex items-center justify-between p-2.5 rounded-lg border border-amber-200 bg-amber-50 cursor-pointer">
            <span className="text-xs font-semibold text-amber-900">
              {t('save_as_overlap_conflict')}
            </span>
            <input
              type="checkbox"
              checked={markAsOverlap}
              onChange={(e) => setMarkAsOverlap(e.target.checked)}
              className="w-4 h-4 accent-amber-600 cursor-pointer"
            />
          </label>
        )}
      </form>
    </ModalShell>
  );
}

interface EditShiftDialogProps {
  shift: Shift | null;
  staffDirectory: StaffDirectoryEntry[];
  onClose: () => void;
  onSave: (params: {
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
  }) => Promise<void>;
}

export function EditShiftDialog({
  shift,
  staffDirectory,
  onClose,
  onSave,
}: EditShiftDialogProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [assignedUid, setAssignedUid] = useState('');
  const [status, setStatus] = useState<ShiftStatus>(ShiftStatus.SCHEDULED);
  const [fairnessNote, setFairnessNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (shift) {
      setTitle(shift.title);
      setDepartment(shift.department);
      setDate(shift.date);
      setStartTime(shift.startTime);
      setEndTime(shift.endTime);
      setAssignedUid(shift.assignedUid);
      setStatus(shift.status);
      setFairnessNote(shift.fairnessNote);
      setErrorMsg(null);
    }
  }, [shift]);

  if (!shift) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!DATE_PATTERN.test(date) || !TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) {
      setErrorMsg(t('win_err_report_datetime'));
      return;
    }

    const member = staffDirectory.find((m) => m.uid === assignedUid);
    const effectiveStatus = !assignedUid ? ShiftStatus.OPEN : status;
    const assignedName = member?.displayName ?? (assignedUid ? shift.assignedName : '');

    const cleanTitle = title.trim() || t('win_table_shift');
    const cleanDept = department.trim() || t('default_dept_operations');

    setSaving(true);
    setErrorMsg(null);
    try {
      const rustValidation = await invokeValidateShift(
        cleanTitle,
        cleanDept,
        date,
        startTime,
        endTime,
      );
      if (rustValidation && !rustValidation.valid) {
        setErrorMsg(rustValidation.errorMessage ?? t('win_err_report_datetime'));
        setSaving(false);
        return;
      }

      await onSave({
        shiftId: shift.id,
        title: cleanTitle,
        department: cleanDept,
        date,
        startTime,
        endTime,
        assignedUid: effectiveStatus === ShiftStatus.OPEN ? '' : assignedUid,
        assignedName: effectiveStatus === ShiftStatus.OPEN ? '' : assignedName,
        status: effectiveStatus,
        fairnessNote: fairnessNote.trim(),
      });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open={Boolean(shift)}
      onClose={onClose}
      title={t('dialog_edit_shift')}
      subtitle={t('win_shift_id_format', shift.id)}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer whitespace-nowrap shrink-0"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            form="edit-shift-form"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            {saving ? t('win_updating') : t('win_save_shift')}
          </button>
        </>
      }
    >
      <form id="edit-shift-form" onSubmit={handleSubmit} className="space-y-3.5">
        {errorMsg && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
            {errorMsg}
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
              {t('start_label')}
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
              {t('end_label')}
            </label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-tabular text-sm text-slate-900"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {t('assigned_staff_label')}
            </label>
            <select
              value={assignedUid}
              onChange={(e) => {
                const v = e.target.value;
                setAssignedUid(v);
                if (!v) setStatus(ShiftStatus.OPEN);
                else if (status === ShiftStatus.OPEN) setStatus(ShiftStatus.SCHEDULED);
              }}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
            >
              <option value="">{t('open_unassigned')}</option>
              {staffDirectory.map((m) => (
                <option key={m.uid} value={m.uid}>
                  {t('staff_dept_option_format', m.displayName, m.department)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {t('win_status_label')}
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ShiftStatus)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
            >
              {Object.values(ShiftStatus).map((st) => (
                <option key={st} value={st}>
                  {t(`status_${st}`)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            {t('fairness_shift_note_label')}
          </label>
          <textarea
            value={fairnessNote}
            onChange={(e) => setFairnessNote(e.target.value)}
            maxLength={300}
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900"
          />
        </div>
      </form>
    </ModalShell>
  );
}

interface RequestChangeDialogProps {
  open: boolean;
  preselectedShift: Shift | null;
  shifts: Shift[];
  staffDirectory: StaffDirectoryEntry[];
  currentUid: string;
  currentUserName: string;
  isManager: boolean;
  onClose: () => void;
  onSubmit: (params: {
    shift: Shift;
    type: ScheduleChangeType;
    proposedDate: string;
    proposedStartTime: string;
    proposedEndTime: string;
    proposedAssigneeUid: string;
    proposedAssigneeName: string;
    reason: string;
  }) => Promise<void>;
}

export function RequestChangeDialog({
  open,
  preselectedShift,
  shifts,
  staffDirectory,
  currentUid,
  currentUserName,
  isManager,
  onClose,
  onSubmit,
}: RequestChangeDialogProps) {
  const { t } = useI18n();
  const eligibleShifts = useMemo(
    () =>
      shifts.filter((s) => {
        if (s.status === ShiftStatus.COMPLETED) return false;
        if (isManager) return true;
        return s.status === ShiftStatus.OPEN || s.assignedUid === currentUid;
      }),
    [shifts, isManager, currentUid],
  );

  const [shiftId, setShiftId] = useState('');
  const [changeType, setChangeType] = useState<ScheduleChangeType>(
    ScheduleChangeType.TIME_CHANGE,
  );
  const [proposedDate, setProposedDate] = useState('');
  const [proposedStart, setProposedStart] = useState('');
  const [proposedEnd, setProposedEnd] = useState('');
  const [swapUid, setSwapUid] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedShift = useMemo(
    () => eligibleShifts.find((s) => s.id === shiftId) ?? eligibleShifts[0] ?? null,
    [eligibleShifts, shiftId],
  );

  useEffect(() => {
    if (!open) return;
    const initial =
      preselectedShift &&
      eligibleShifts.some((s) => s.id === preselectedShift.id)
        ? preselectedShift
        : eligibleShifts[0] ?? null;

    if (initial) {
      setShiftId(initial.id);
      setProposedDate(initial.date);
      setProposedStart(initial.startTime);
      setProposedEnd(initial.endTime);
      setChangeType(
        initial.status === ShiftStatus.OPEN
          ? ScheduleChangeType.CLAIM
          : ScheduleChangeType.TIME_CHANGE,
      );
    } else {
      setShiftId('');
    }
    setSwapUid(
      staffDirectory.find((s) => s.uid !== currentUid)?.uid ?? '',
    );
    setReason('');
    setErrorMsg(null);
  }, [open, preselectedShift, eligibleShifts, staffDirectory, currentUid]);

  const handleSelectShift = (newId: string) => {
    setShiftId(newId);
    const s = eligibleShifts.find((item) => item.id === newId);
    if (s) {
      setProposedDate(s.date);
      setProposedStart(s.startTime);
      setProposedEnd(s.endTime);
      setChangeType(
        s.status === ShiftStatus.OPEN
          ? ScheduleChangeType.CLAIM
          : ScheduleChangeType.TIME_CHANGE,
      );
    }
  };

  const availableTypes: ScheduleChangeType[] = selectedShift
    ? selectedShift.status === ShiftStatus.OPEN
      ? [ScheduleChangeType.CLAIM]
      : [
          ScheduleChangeType.TIME_CHANGE,
          ScheduleChangeType.SWAP,
          ScheduleChangeType.DROP,
        ]
    : [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedShift) {
      setErrorMsg(t('win_err_no_eligible_shift'));
      return;
    }
    if (!DATE_PATTERN.test(proposedDate) || !TIME_PATTERN.test(proposedStart) || !TIME_PATTERN.test(proposedEnd)) {
      setErrorMsg(t('win_err_enter_time_format'));
      return;
    }
    if (computeShiftHours(proposedStart, proposedEnd) < 0.25) {
      setErrorMsg(t('win_err_min_duration'));
      return;
    }
    if (!reason.trim()) {
      setErrorMsg(t('win_err_enter_reason'));
      return;
    }

    let proposedAssigneeUid = '';
    let proposedAssigneeName = '';

    if (changeType === ScheduleChangeType.CLAIM) {
      proposedAssigneeUid = currentUid;
      proposedAssigneeName = currentUserName;
    } else if (changeType === ScheduleChangeType.SWAP) {
      const target = staffDirectory.find((m) => m.uid === swapUid);
      if (!target) {
        setErrorMsg(t('win_err_select_teammate'));
        return;
      }
      proposedAssigneeUid = target.uid;
      proposedAssigneeName = target.displayName;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      const rustValidation = await invokeValidateScheduleChange(
        selectedShift,
        currentUid,
        isManager,
        changeType,
        proposedDate,
        proposedStart,
        proposedEnd,
        proposedAssigneeUid,
        reason.trim(),
      );
      if (rustValidation && !rustValidation.valid) {
        setErrorMsg(
          rustValidation.errorMessage ?? t('win_err_enter_time_format'),
        );
        setSaving(false);
        return;
      }

      await onSubmit({
        shift: selectedShift,
        type: changeType,
        proposedDate,
        proposedStartTime: proposedStart,
        proposedEndTime: proposedEnd,
        proposedAssigneeUid,
        proposedAssigneeName,
        reason: reason.trim(),
      });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={t('dialog_request_change')}
      subtitle={t('win_req_change_subtitle')}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer whitespace-nowrap shrink-0"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            form="request-change-form"
            disabled={saving || !selectedShift}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            {saving ? t('win_submitting') : t('submit_request')}
          </button>
        </>
      }
    >
      {eligibleShifts.length === 0 ? (
        <p className="text-xs text-slate-600 py-2">
          {t('win_no_eligible_shifts')}
        </p>
      ) : (
        <form id="request-change-form" onSubmit={handleSubmit} className="space-y-3.5">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
              {errorMsg}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {t('select_shift_label')}
            </label>
            <select
              value={selectedShift?.id ?? ''}
              onChange={(e) => handleSelectShift(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
            >
              {eligibleShifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.date} · {s.title} ({s.startTime}–{s.endTime}) ·{' '}
                  {s.assignedName.trim() || t('win_open_short')}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              {t('win_req_type_label')}
            </label>
            <div className="flex flex-wrap gap-2">
              {availableTypes.map((typeOption) => (
                <button
                  key={typeOption}
                  type="button"
                  onClick={() => setChangeType(typeOption)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                    changeType === typeOption
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {t(`change_type_${typeOption}`)}
                </button>
              ))}
            </div>
          </div>

          {changeType === ScheduleChangeType.TIME_CHANGE && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t('proposed_date_iso')}
                </label>
                <input
                  type="date"
                  value={proposedDate}
                  onChange={(e) => setProposedDate(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-tabular text-sm text-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t('win_proposed_start')}
                </label>
                <input
                  type="time"
                  value={proposedStart}
                  onChange={(e) => setProposedStart(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-tabular text-sm text-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t('win_proposed_end')}
                </label>
                <input
                  type="time"
                  value={proposedEnd}
                  onChange={(e) => setProposedEnd(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-tabular text-sm text-slate-900"
                />
              </div>
            </div>
          )}

          {changeType === ScheduleChangeType.SWAP && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {t('swap_with_label')}
              </label>
              <select
                value={swapUid}
                onChange={(e) => setSwapUid(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
              >
                <option value="">{t('select_swap_teammate')}</option>
                {staffDirectory
                  .filter((m) => m.uid !== (selectedShift?.assignedUid || currentUid))
                  .map((m) => (
                    <option key={m.uid} value={m.uid}>
                      {m.displayName} ({m.department} · {t('win_logged_hours_format', formatHours(m.totalHoursWorked))})
                    </option>
                  ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {t('reason_label')}
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('reason_placeholder')}
              maxLength={400}
              rows={3}
              required
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900"
            />
          </div>
        </form>
      )}
    </ModalShell>
  );
}

interface SubmitAvailabilityDialogProps {
  open: boolean;
  defaultDepartment: string;
  onClose: () => void;
  onSubmitBatch: (params: {
    dates: string[];
    startTime: string;
    endTime: string;
    shiftTitle: string;
    department: string;
    notes: string;
  }) => Promise<void>;
}

export function SubmitAvailabilityDialog({
  open,
  defaultDepartment,
  onClose,
  onSubmitBatch,
}: SubmitAvailabilityDialogProps) {
  const { bcp47Tag, t } = useI18n();
  const nextWeekMonday = useMemo(() => addDaysIso(getMondayIso(), 7), []);
  const weekDays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const iso = addDaysIso(nextWeekMonday, i);
        const dateObj = new Date(`${iso}T12:00:00`);
        const label = new Intl.DateTimeFormat(bcp47Tag || undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        }).format(dateObj);
        return { iso, label, isWeekday: i < 5 };
      }),
    [nextWeekMonday, bcp47Tag],
  );

  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [shiftTitle, setShiftTitle] = useState(() => t('default_avail_title'));
  const [department, setDepartment] = useState(defaultDepartment);
  const [startTime, setStartTime] = useState('07:00');
  const [endTime, setEndTime] = useState('15:00');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedDates(weekDays.filter((d) => d.isWeekday).map((d) => d.iso));
      setShiftTitle(t('default_avail_title'));
      setDepartment(defaultDepartment);
      setStartTime('07:00');
      setEndTime('15:00');
      setNotes('');
      setErrorMsg(null);
    }
  }, [open, defaultDepartment, weekDays, t]);

  const toggleDate = (iso: string) => {
    setSelectedDates((prev) =>
      prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedDates.length === 0) {
      setErrorMsg(t('win_err_select_avail_day'));
      return;
    }
    if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) {
      setErrorMsg(t('win_err_enter_time_format'));
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      await onSubmitBatch({
        dates: selectedDates,
        startTime,
        endTime,
        shiftTitle: shiftTitle.trim() || t('availability_default_title'),
        department: department.trim() || t('default_dept_operations'),
        notes: notes.trim(),
      });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={t('dialog_submit_availability')}
      subtitle={t(
        'win_next_week_avail_sub_format',
        formatIsoDate(new Date(`${nextWeekMonday}T12:00:00`)),
      )}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer whitespace-nowrap shrink-0"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            form="availability-form"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            {saving
              ? t('win_submitting')
              : selectedDates.length === 1
                ? t('win_submit_days_singular')
                : t('win_submit_days_plural', selectedDates.length)}
          </button>
        </>
      }
    >
      <form id="availability-form" onSubmit={handleSubmit} className="space-y-3.5">
        {errorMsg && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
            {errorMsg}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-700">
            {t('win_select_avail_days')}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setSelectedDates(
                  weekDays.filter((d) => d.isWeekday).map((d) => d.iso),
                )
              }
              className="px-2.5 py-1 rounded-md border border-slate-300 bg-slate-50 hover:bg-slate-100 text-[11px] font-semibold text-slate-700 cursor-pointer whitespace-nowrap shrink-0"
            >
              {t('next_mon_fri')}
            </button>
            <button
              type="button"
              onClick={() => setSelectedDates(weekDays.map((d) => d.iso))}
              className="px-2.5 py-1 rounded-md border border-slate-300 bg-slate-50 hover:bg-slate-100 text-[11px] font-semibold text-slate-700 cursor-pointer whitespace-nowrap shrink-0"
            >
              {t('next_7_days')}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {weekDays.map((day) => {
            const active = selectedDates.includes(day.iso);
            return (
              <button
                key={day.iso}
                type="button"
                onClick={() => toggleDate(day.iso)}
                className={`p-2 rounded-lg border text-left transition-colors cursor-pointer ${
                  active
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="text-xs font-semibold truncate">{day.label}</div>
                <div
                  className={`text-[11px] font-mono-tabular ${
                    active ? 'text-blue-100' : 'text-slate-400'
                  }`}
                >
                  {day.iso}
                </div>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {t('preferred_role_title')}
            </label>
            <input
              type="text"
              value={shiftTitle}
              onChange={(e) => setShiftTitle(e.target.value)}
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {t('win_available_from')}
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
              {t('win_available_until')}
            </label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-tabular text-sm text-slate-900"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            {t('notes_optional')}
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={300}
            placeholder={t('win_avail_notes_placeholder')}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900"
          />
        </div>
      </form>
    </ModalShell>
  );
}

interface WeekSlotsDialogProps {
  open: boolean;
  slots: WeekSlotConfig[];
  onClose: () => void;
  onSaveSlots: (slots: WeekSlotConfig[]) => void;
}

export function WeekSlotsDialog({
  open,
  slots,
  onClose,
  onSaveSlots,
}: WeekSlotsDialogProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<WeekSlotConfig[]>(slots);

  useEffect(() => {
    if (open) {
      setDraft(slots.map((s) => ({ ...s })));
    }
  }, [open, slots]);

  const updateSlot = (
    idx: number,
    field: keyof WeekSlotConfig,
    value: string,
  ) => {
    setDraft((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)),
    );
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={t('dialog_week_slots')}
      subtitle={t('win_week_slots_subtitle')}
      maxWidthClass="max-w-2xl"
      footer={
        <div className="w-full flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() =>
              setDraft(DEFAULT_WEEK_SLOTS.map((s) => ({ ...s })))
            }
            className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200 cursor-pointer whitespace-nowrap shrink-0"
          >
            {t('win_reset_defaults')}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer whitespace-nowrap shrink-0"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={() => {
                onSaveSlots(draft);
                onClose();
              }}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              {t('save_templates')}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {draft.map((slot, idx) => (
          <div
            key={slot.id}
            className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 space-y-2.5"
          >
            <div className="text-xs font-bold text-slate-900">
              {t('slot_label_format', slot.label)}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  {t('title_label')}
                </label>
                <input
                  type="text"
                  value={slot.title}
                  onChange={(e) => updateSlot(idx, 'title', e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  {t('department_label')}
                </label>
                <input
                  type="text"
                  value={slot.department}
                  onChange={(e) =>
                    updateSlot(idx, 'department', e.target.value)
                  }
                  className="w-full px-2.5 py-1.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900"
                />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {t('start_label')}
                  </label>
                  <input
                    type="time"
                    value={slot.startTime}
                    onChange={(e) =>
                      updateSlot(idx, 'startTime', e.target.value)
                    }
                    className="w-full px-2 py-1.5 rounded-md border border-slate-300 bg-white font-mono-tabular text-xs text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {t('end_label')}
                  </label>
                  <input
                    type="time"
                    value={slot.endTime}
                    onChange={(e) => updateSlot(idx, 'endTime', e.target.value)}
                    className="w-full px-2 py-1.5 rounded-md border border-slate-300 bg-white font-mono-tabular text-xs text-slate-900"
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </ModalShell>
  );
}
