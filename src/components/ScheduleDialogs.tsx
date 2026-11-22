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
  SCHEDULE_CHANGE_TYPE_LABEL,
  ScheduleChangeType,
  Shift,
  SHIFT_STATUS_LABEL,
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
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-rose-700 hover:bg-rose-50 text-xs font-semibold cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{deleting ? 'Deleting...' : 'Delete'}</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => openGoogleCalendarForShift(shift)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer"
            >
              <CalendarPlus className="w-3.5 h-3.5 text-blue-600" />
              <span>Google Calendar</span>
            </button>

            {canStaffRequest && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onRequestChange(shift);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer"
              >
                <Clock className="w-3.5 h-3.5" />
                <span>
                  {shift.status === ShiftStatus.OPEN
                    ? 'Claim Shift'
                    : 'Request Change'}
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
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Edit Shift</span>
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">Status</span>
          <ShiftStatusChip status={shift.status} />
        </div>

        <div className="grid grid-cols-2 gap-3 p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
          <div>
            <div className="text-slate-500">Assigned Staff</div>
            <div className="font-semibold text-slate-900 mt-0.5">
              {shift.assignedName.trim() || 'Open / Unassigned'}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Duration</div>
            <div className="font-mono-tabular font-semibold text-slate-900 mt-0.5">
              {formatHours(shift.durationHours)} hours
            </div>
          </div>
          <div>
            <div className="text-slate-500">Date</div>
            <div className="font-mono-tabular font-semibold text-slate-900 mt-0.5">
              {shift.date}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Window</div>
            <div className="font-mono-tabular font-semibold text-slate-900 mt-0.5">
              {shift.startTime} – {shift.endTime}
            </div>
          </div>
        </div>

        {shift.fairnessNote && (
          <div className="p-3 rounded-lg bg-blue-50/70 border border-blue-200 text-xs text-blue-900">
            <span className="font-semibold">Fairness Note: </span>
            {shift.fairnessNote}
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
  const [title, setTitle] = useState('Operations Shift');
  const [department, setDepartment] = useState('Operations');
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
      setTitle('Operations Shift');
      setDepartment('Operations');
      setDate(defaultDate);
      setStartTime('09:00');
      setEndTime('17:00');
      setLeaveOpen(false);
      setSelectedCandidateUids(staffDirectory[0] ? [staffDirectory[0].uid] : []);
      setMarkAsOverlap(false);
      setErrorMsg(null);
    }
  }, [open, defaultDate, staffDirectory]);

  const toggleCandidate = (uid: string) => {
    setSelectedCandidateUids((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!DATE_PATTERN.test(date)) {
      setErrorMsg('Enter date in YYYY-MM-DD format.');
      return;
    }
    if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) {
      setErrorMsg('Enter valid HH:MM times.');
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

    const cleanTitle = title.trim() || 'Operations Shift';
    const cleanDept = department.trim() || 'Operations';

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
        setErrorMsg(rustValidation.errorMessage ?? 'Invalid shift schedule.');
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
      title="Add Team Shift"
      subtitle="Create a scheduled shift, open slot, or multi-candidate overlap"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="add-shift-form"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
          >
            {saving ? 'Saving...' : 'Create Shift'}
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
              Start Time
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
              End Time
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
            Leave Open / Unassigned (Blank Shift)
          </span>
          <input
            type="checkbox"
            checked={leaveOpen}
            onChange={(e) => setLeaveOpen(e.target.checked)}
            className="w-4 h-4 accent-blue-600 cursor-pointer"
          />
        </label>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-slate-700">
              Candidate Staff ({selectedCandidateUids.length} selected)
            </span>
            <span className="text-[11px] text-slate-500">
              Select 2+ to simulate overlap resolution
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
                    {formatHours(member.totalHoursWorked)}h logged
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {!leaveOpen && selectedCandidateUids.length >= 2 && (
          <label className="flex items-center justify-between p-2.5 rounded-lg border border-amber-200 bg-amber-50 cursor-pointer">
            <span className="text-xs font-semibold text-amber-900">
              Save as Overlap Conflict for Fairness Engine
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
      setErrorMsg('Verify date (YYYY-MM-DD) and times (HH:MM).');
      return;
    }

    const member = staffDirectory.find((m) => m.uid === assignedUid);
    const effectiveStatus = !assignedUid ? ShiftStatus.OPEN : status;
    const assignedName = member?.displayName ?? (assignedUid ? shift.assignedName : '');

    const cleanTitle = title.trim() || 'Shift';
    const cleanDept = department.trim() || 'Operations';

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
        setErrorMsg(rustValidation.errorMessage ?? 'Invalid shift details.');
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
      title="Edit Shift"
      subtitle={`Shift ID: ${shift.id}`}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="edit-shift-form"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
          >
            {saving ? 'Updating...' : 'Save Shift'}
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
              Start Time
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
              End Time
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
              Assigned Staff
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
              <option value="">Open / Unassigned</option>
              {staffDirectory.map((m) => (
                <option key={m.uid} value={m.uid}>
                  {m.displayName} ({m.department})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ShiftStatus)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
            >
              {Object.values(ShiftStatus).map((st) => (
                <option key={st} value={st}>
                  {SHIFT_STATUS_LABEL[st]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Fairness / Schedule Note
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
      setErrorMsg('No eligible shift selected.');
      return;
    }
    if (!DATE_PATTERN.test(proposedDate) || !TIME_PATTERN.test(proposedStart) || !TIME_PATTERN.test(proposedEnd)) {
      setErrorMsg('Enter valid proposed date and time.');
      return;
    }
    if (computeShiftHours(proposedStart, proposedEnd) < 0.25) {
      setErrorMsg('Shift duration must be at least 15 minutes.');
      return;
    }
    if (!reason.trim()) {
      setErrorMsg('Please include a brief reason for manager review.');
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
        setErrorMsg('Select a teammate to swap this shift with.');
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
          rustValidation.errorMessage ?? 'Schedule change request failed validation.',
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
      title="Request Schedule Change"
      subtitle="Submit a time adjustment, swap, drop, or open shift claim for manager approval"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="request-change-form"
            disabled={saving || !selectedShift}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
          >
            {saving ? 'Submitting...' : 'Submit Request'}
          </button>
        </>
      }
    >
      {eligibleShifts.length === 0 ? (
        <p className="text-xs text-slate-600 py-2">
          There are no open or assigned shifts available to request a change on.
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
              Shift
            </label>
            <select
              value={selectedShift?.id ?? ''}
              onChange={(e) => handleSelectShift(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
            >
              {eligibleShifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.date} · {s.title} ({s.startTime}–{s.endTime}) ·{' '}
                  {s.assignedName.trim() || 'Open'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Request Type
            </label>
            <div className="flex flex-wrap gap-2">
              {availableTypes.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setChangeType(t)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer transition-colors ${
                    changeType === t
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {SCHEDULE_CHANGE_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>

          {changeType === ScheduleChangeType.TIME_CHANGE && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Proposed Date
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
                  Proposed Start
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
                  Proposed End
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
                Swap With Teammate
              </label>
              <select
                value={swapUid}
                onChange={(e) => setSwapUid(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
              >
                <option value="">Select teammate...</option>
                {staffDirectory
                  .filter((m) => m.uid !== (selectedShift?.assignedUid || currentUid))
                  .map((m) => (
                    <option key={m.uid} value={m.uid}>
                      {m.displayName} ({m.department} · {formatHours(m.totalHoursWorked)}h logged)
                    </option>
                  ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Reason
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this change is needed..."
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
  const nextWeekMonday = useMemo(() => addDaysIso(getMondayIso(), 7), []);
  const weekDays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const iso = addDaysIso(nextWeekMonday, i);
        const dateObj = new Date(`${iso}T12:00:00`);
        const label = new Intl.DateTimeFormat(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        }).format(dateObj);
        return { iso, label, isWeekday: i < 5 };
      }),
    [nextWeekMonday],
  );

  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [shiftTitle, setShiftTitle] = useState('Preferred Operations Shift');
  const [department, setDepartment] = useState(defaultDepartment);
  const [startTime, setStartTime] = useState('07:00');
  const [endTime, setEndTime] = useState('15:00');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedDates(weekDays.filter((d) => d.isWeekday).map((d) => d.iso));
      setShiftTitle('Preferred Operations Shift');
      setDepartment(defaultDepartment);
      setStartTime('07:00');
      setEndTime('15:00');
      setNotes('');
      setErrorMsg(null);
    }
  }, [open, defaultDepartment, weekDays]);

  const toggleDate = (iso: string) => {
    setSelectedDates((prev) =>
      prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedDates.length === 0) {
      setErrorMsg('Select at least one day of availability.');
      return;
    }
    if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) {
      setErrorMsg('Enter valid HH:MM availability times.');
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      await onSubmitBatch({
        dates: selectedDates,
        startTime,
        endTime,
        shiftTitle: shiftTitle.trim() || 'Available Shift',
        department: department.trim() || 'Operations',
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
      title="Submit Shift Availability"
      subtitle={`Quickly post available days for week of ${formatIsoDate(new Date(`${nextWeekMonday}T12:00:00`))}`}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="availability-form"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
          >
            {saving
              ? 'Submitting...'
              : `Submit ${selectedDates.length} Day${selectedDates.length === 1 ? '' : 's'}`}
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
            Select Available Days
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setSelectedDates(
                  weekDays.filter((d) => d.isWeekday).map((d) => d.iso),
                )
              }
              className="px-2.5 py-1 rounded-md border border-slate-300 bg-slate-50 hover:bg-slate-100 text-[11px] font-semibold text-slate-700 cursor-pointer"
            >
              Next Mon–Fri
            </button>
            <button
              type="button"
              onClick={() => setSelectedDates(weekDays.map((d) => d.iso))}
              className="px-2.5 py-1 rounded-md border border-slate-300 bg-slate-50 hover:bg-slate-100 text-[11px] font-semibold text-slate-700 cursor-pointer"
            >
              Next 7 Days
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
                <div className="text-xs font-semibold">{day.label}</div>
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
              Preferred Role / Title
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Available From
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
              Available Until
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
            Notes (Optional)
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={300}
            placeholder="Preferred station, transit constraint..."
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
      title="Weekly Shift Slot Templates"
      subtitle="Configure daily Morning, Midday, and Closing shift slots used by Generate Week"
      maxWidthClass="max-w-2xl"
      footer={
        <div className="w-full flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() =>
              setDraft(DEFAULT_WEEK_SLOTS.map((s) => ({ ...s })))
            }
            className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200 cursor-pointer"
          >
            Reset Defaults
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onSaveSlots(draft);
                onClose();
              }}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
            >
              Save Templates
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
              {slot.label} Template
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Title
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
                  Department
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
                    Start
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
                    End
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
