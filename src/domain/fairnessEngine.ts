import {
  ApprovalStatus,
  FairnessArrangementItem,
  FairnessScoreBreakdown,
  GeneratedShiftSpec,
  OpenShiftAssignmentItem,
  Shift,
  ShiftStatus,
  ShiftSubmission,
  StaffDirectoryEntry,
  SubmissionStatus,
  TimeOffRequest,
  WeekSlotConfig,
} from '../types/cadence';

export const DEFAULT_WEEK_SLOTS: WeekSlotConfig[] = [
  {
    id: 'morning',
    label: 'Morning',
    title: 'Morning Operations',
    department: 'Operations',
    startTime: '07:00',
    endTime: '15:00',
  },
  {
    id: 'midday',
    label: 'Midday',
    title: 'Midday Floor Support',
    department: 'Support',
    startTime: '11:00',
    endTime: '19:00',
  },
  {
    id: 'closing',
    label: 'Closing',
    title: 'Closing Operations',
    department: 'Operations',
    startTime: '15:00',
    endTime: '23:00',
  },
];

export function parseTimeToMinutes(hhmm: string): number {
  const parts = hhmm.trim().split(':');
  const h = Number.parseInt(parts[0] ?? '0', 10);
  const m = Number.parseInt(parts[1] ?? '0', 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

export function computeShiftHours(
  startTime: string,
  endTime: string,
  breakMinutes = 0,
): number {
  const s = parseTimeToMinutes(startTime);
  let e = parseTimeToMinutes(endTime);
  if (e <= s) e += 24 * 60;
  const netMinutes = Math.max(15, e - s - breakMinutes);
  return Math.round((netMinutes / 60) * 100) / 100;
}

export function shiftsTimeOverlap(
  dateA: string,
  startA: string,
  endA: string,
  dateB: string,
  startB: string,
  endB: string,
): boolean {
  if (dateA !== dateB) return false;
  const sA = parseTimeToMinutes(startA);
  let eA = parseTimeToMinutes(endA);
  if (eA <= sA) eA += 24 * 60;

  const sB = parseTimeToMinutes(startB);
  let eB = parseTimeToMinutes(endB);
  if (eB <= sB) eB += 24 * 60;

  return sA < eB && sB < eA;
}

export function findStaffConflicts(
  shifts: Shift[],
  targetUid: string,
  date: string,
  startTime: string,
  endTime: string,
  excludeShiftId: string | null = null,
): Shift[] {
  if (!targetUid.trim()) return [];
  return shifts.filter(
    (s) =>
      s.id !== excludeShiftId &&
      s.status !== ShiftStatus.OPEN &&
      s.assignedUid === targetUid &&
      shiftsTimeOverlap(s.date, s.startTime, s.endTime, date, startTime, endTime),
  );
}

export function isStaffOnApprovedTimeOff(
  staffUid: string,
  date: string,
  timeOffRequests: TimeOffRequest[],
): { hasTimeOff: boolean; reason: string | null } {
  if (!staffUid.trim() || !date.trim() || timeOffRequests.length === 0) {
    return { hasTimeOff: false, reason: null };
  }
  const match = timeOffRequests.find(
    (req) =>
      req.staffUid === staffUid &&
      req.status === ApprovalStatus.APPROVED &&
      date >= req.startDate &&
      date <= req.endDate,
  );
  return match
    ? { hasTimeOff: true, reason: match.reason }
    : { hasTimeOff: false, reason: null };
}

export function computeScheduledHoursByUid(shifts: Shift[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const s of shifts) {
    if (s.assignedUid.trim() && s.status !== ShiftStatus.OPEN) {
      map[s.assignedUid] = (map[s.assignedUid] ?? 0) + s.durationHours;
    }
  }
  return map;
}

export function rankCandidatesByFairness(
  candidateUids: string[],
  staffDirectory: StaffDirectoryEntry[],
  allShifts: Shift[],
  targetDate: string,
  startTime: string,
  endTime: string,
  excludeShiftId: string | null = null,
  timeOffRequests: TimeOffRequest[] = [],
): FairnessScoreBreakdown[] {
  const scheduledByUid = computeScheduledHoursByUid(allShifts);
  const countByUid: Record<string, number> = {};
  for (const s of allShifts) {
    if (s.assignedUid.trim() && s.status !== ShiftStatus.OPEN) {
      countByUid[s.assignedUid] = (countByUid[s.assignedUid] ?? 0) + 1;
    }
  }

  const candidateSet = new Set(candidateUids);
  const pool =
    candidateUids.length > 0
      ? staffDirectory.filter((s) => candidateSet.has(s.uid))
      : staffDirectory;

  const ranked: FairnessScoreBreakdown[] = pool.map((staff) => {
    const scheduled = scheduledByUid[staff.uid] ?? staff.scheduledHoursThisWeek;
    const target = Math.max(1, staff.weeklyHoursTarget);
    const ratio = (staff.totalHoursWorked + scheduled) / target;
    const hasConflict =
      findStaffConflicts(
        allShifts,
        staff.uid,
        targetDate,
        startTime,
        endTime,
        excludeShiftId,
      ).length > 0;
    const timeOff = isStaffOnApprovedTimeOff(staff.uid, targetDate, timeOffRequests);
    return {
      uid: staff.uid,
      displayName: staff.displayName,
      department: staff.department,
      totalHoursWorked: staff.totalHoursWorked,
      scheduledHoursThisWeek: Math.round(scheduled * 10) / 10,
      weeklyHoursTarget: target,
      utilizationRatio: ratio,
      shiftsThisWeekCount: countByUid[staff.uid] ?? 0,
      lastAssignedAt: staff.lastAssignedAt,
      hasConflict,
      hasApprovedTimeOff: timeOff.hasTimeOff,
      timeOffReason: timeOff.reason,
    };
  });

  ranked.sort((a, b) => {
    const aBlocked = a.hasConflict || a.hasApprovedTimeOff ? 1 : 0;
    const bBlocked = b.hasConflict || b.hasApprovedTimeOff ? 1 : 0;
    if (aBlocked !== bBlocked) return aBlocked - bBlocked;

    if (Math.abs(a.utilizationRatio - b.utilizationRatio) > 0.001) {
      return a.utilizationRatio - b.utilizationRatio;
    }
    if (a.shiftsThisWeekCount !== b.shiftsThisWeekCount) {
      return a.shiftsThisWeekCount - b.shiftsThisWeekCount;
    }
    if (Math.abs(a.totalHoursWorked - b.totalHoursWorked) > 0.001) {
      return a.totalHoursWorked - b.totalHoursWorked;
    }
    const aTime = a.lastAssignedAt.trim() || '0000';
    const bTime = b.lastAssignedAt.trim() || '0000';
    if (aTime !== bTime) return aTime.localeCompare(bTime);
    return a.displayName.localeCompare(b.displayName);
  });

  return ranked;
}

export function buildFairnessArrangementPlan(
  shifts: Shift[],
  staffDirectory: StaffDirectoryEntry[],
  timeOffRequests: TimeOffRequest[] = [],
): FairnessArrangementItem[] {
  const simulatedDirectory = staffDirectory.map((s) => ({ ...s }));
  const plan: FairnessArrangementItem[] = [];

  for (const shift of shifts) {
    if (!(shift.status === ShiftStatus.CONFLICT || shift.candidateUids.length > 1)) {
      continue;
    }
    const ranked = rankCandidatesByFairness(
      shift.candidateUids,
      simulatedDirectory,
      shifts,
      shift.date,
      shift.startTime,
      shift.endTime,
      shift.id,
      timeOffRequests,
    );
    const best =
      ranked.find((item) => !item.hasConflict && !item.hasApprovedTimeOff) ??
      ranked[0];
    if (!best) continue;

    const idx = simulatedDirectory.findIndex((m) => m.uid === best.uid);
    if (idx >= 0) {
      simulatedDirectory[idx] = {
        ...simulatedDirectory[idx],
        totalHoursWorked: simulatedDirectory[idx].totalHoursWorked + shift.durationHours,
        scheduledHoursThisWeek:
          simulatedDirectory[idx].scheduledHoursThisWeek + shift.durationHours,
      };
    }

    const pct = Math.round(best.utilizationRatio * 100);
    const reason = `Assigned to ${best.displayName} (${formatHours(best.totalHoursWorked)}h logged, ${best.shiftsThisWeekCount} shifts, ${pct}% target ratio)`;
    plan.push({
      shift,
      previousUid: shift.assignedUid,
      previousName: shift.assignedName,
      chosenUid: best.uid,
      chosenName: best.displayName,
      reason,
    });
  }

  return plan;
}

export function buildOpenShiftAssignmentPlan(
  shifts: Shift[],
  staffDirectory: StaffDirectoryEntry[],
  submissions: ShiftSubmission[] = [],
  timeOffRequests: TimeOffRequest[] = [],
  requireExplicitSubmission = false,
): OpenShiftAssignmentItem[] {
  if (staffDirectory.length === 0) return [];
  const openShifts = shifts.filter((s) => s.status === ShiftStatus.OPEN);
  if (openShifts.length === 0) return [];

  const simulatedDirectory = staffDirectory.map((s) => ({ ...s }));
  const simulatedShifts = shifts.map((s) => ({ ...s }));
  const plan: OpenShiftAssignmentItem[] = [];
  const activeSubmissions = submissions.filter(
    (s) => s.status === SubmissionStatus.SUBMITTED,
  );

  for (const shift of openShifts) {
    const submittedUids = Array.from(
      new Set(
        activeSubmissions
          .filter(
            (sub) =>
              sub.date === shift.date &&
              shiftsTimeOverlap(
                sub.date,
                sub.startTime,
                sub.endTime,
                shift.date,
                shift.startTime,
                shift.endTime,
              ),
          )
          .map((sub) => sub.staffUid),
      ),
    );

    if (requireExplicitSubmission && submittedUids.length === 0) continue;

    const candidatePool =
      submittedUids.length > 0
        ? submittedUids
        : shift.candidateUids.length > 0
          ? shift.candidateUids
          : simulatedDirectory.map((m) => m.uid);

    const ranked = rankCandidatesByFairness(
      candidatePool,
      simulatedDirectory,
      simulatedShifts,
      shift.date,
      shift.startTime,
      shift.endTime,
      shift.id,
      timeOffRequests,
    );
    const best = ranked.find((item) => !item.hasConflict && !item.hasApprovedTimeOff);
    if (!best) continue;

    const idx = simulatedDirectory.findIndex((m) => m.uid === best.uid);
    if (idx >= 0) {
      simulatedDirectory[idx] = {
        ...simulatedDirectory[idx],
        totalHoursWorked: simulatedDirectory[idx].totalHoursWorked + shift.durationHours,
        scheduledHoursThisWeek:
          simulatedDirectory[idx].scheduledHoursThisWeek + shift.durationHours,
      };
    }

    const sIdx = simulatedShifts.findIndex((s) => s.id === shift.id);
    if (sIdx >= 0) {
      simulatedShifts[sIdx] = {
        ...simulatedShifts[sIdx],
        assignedUid: best.uid,
        assignedName: best.displayName,
        status: ShiftStatus.SCHEDULED,
      };
    }

    const pct = Math.round(best.utilizationRatio * 100);
    const subNote = submittedUids.length > 0 ? 'Matched staff shift submission • ' : '';
    const reason = `${subNote}Assigned to ${best.displayName} (${formatHours(best.totalHoursWorked)}h logged, ${best.shiftsThisWeekCount} shifts, ${pct}% target ratio)`;
    plan.push({
      shift,
      chosenUid: best.uid,
      chosenName: best.displayName,
      reason,
    });
  }

  return plan;
}

export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map((n) => Number.parseInt(n, 10));
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

export function formatIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysIso(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setDate(d.getDate() + days);
  return formatIsoDate(d);
}

export function addMonthsIso(iso: string, months: number): string {
  const d = parseIsoDate(iso);
  d.setMonth(d.getMonth() + months);
  return formatIsoDate(d);
}

export function getMondayOfWeek(date: Date = new Date()): Date {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = copy.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

export function getMondayIso(date: Date = new Date()): string {
  return formatIsoDate(getMondayOfWeek(date));
}

export function generateWeeklyFairnessSchedule(
  weekStartDate: string,
  slots: WeekSlotConfig[] = DEFAULT_WEEK_SLOTS,
  staffDirectory: StaffDirectoryEntry[],
  existingShifts: Shift[],
  submissions: ShiftSubmission[],
  timeOffRequests: TimeOffRequest[],
): GeneratedShiftSpec[] {
  const baseMondayIso = /^\d{4}-\d{2}-\d{2}$/.test(weekStartDate)
    ? weekStartDate
    : getMondayIso();

  const activeSubmissions = submissions.filter(
    (s) => s.status === SubmissionStatus.SUBMITTED,
  );
  const simulatedDirectory = staffDirectory.map((s) => ({ ...s }));
  const simulatedShifts = existingShifts.map((s) => ({ ...s }));
  const planned: GeneratedShiftSpec[] = [];

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const dateStr = addDaysIso(baseMondayIso, dayOffset);

    for (const slot of slots) {
      const alreadyExists = simulatedShifts.some(
        (s) =>
          s.date === dateStr &&
          s.startTime === slot.startTime &&
          s.endTime === slot.endTime &&
          s.title.toLowerCase() === slot.title.toLowerCase(),
      );
      if (alreadyExists) continue;

      const durationHours = computeShiftHours(slot.startTime, slot.endTime);

      const matchingSubmissions = activeSubmissions.filter(
        (sub) =>
          sub.date === dateStr &&
          shiftsTimeOverlap(
            sub.date,
            sub.startTime,
            sub.endTime,
            dateStr,
            slot.startTime,
            slot.endTime,
          ),
      );
      const submittedUids = Array.from(
        new Set(matchingSubmissions.map((sub) => sub.staffUid)),
      );

      const ranked =
        submittedUids.length > 0
          ? rankCandidatesByFairness(
              submittedUids,
              simulatedDirectory,
              simulatedShifts,
              dateStr,
              slot.startTime,
              slot.endTime,
              null,
              timeOffRequests,
            )
          : [];

      const best = ranked.find(
        (item) => !item.hasConflict && !item.hasApprovedTimeOff,
      );

      if (!best) {
        const note =
          submittedUids.length === 0
            ? 'No staff shift submissions received for this slot; left open.'
            : 'All submitting candidates had shift conflicts or approved time off; left open.';
        planned.push({
          title: slot.title,
          department: slot.department,
          date: dateStr,
          startTime: slot.startTime,
          endTime: slot.endTime,
          durationHours,
          assignedUid: '',
          assignedName: '',
          candidateUids: submittedUids,
          status: ShiftStatus.OPEN,
          fairnessNote: note,
        });
        simulatedShifts.push({
          id: `sim_${dateStr}_${slot.id}`,
          title: slot.title,
          department: slot.department,
          date: dateStr,
          startTime: slot.startTime,
          endTime: slot.endTime,
          durationHours,
          assignedUid: '',
          assignedName: '',
          candidateUids: submittedUids,
          status: ShiftStatus.OPEN,
          visibility: 'team',
          fairnessNote: note,
          createdBy: 'planner',
          createdAt: null,
          updatedAt: null,
        });
      } else {
        const pct = Math.round(best.utilizationRatio * 100);
        const matchedSub = matchingSubmissions.find(
          (sub) => sub.staffUid === best.uid,
        );
        const noteSuffix =
          matchedSub && matchedSub.notes.trim()
            ? ` — "${matchedSub.notes.trim()}"`
            : '';
        const note = `Matched submission • Assigned to ${best.displayName} (${formatHours(best.totalHoursWorked)}h logged, ${pct}% target ratio)${noteSuffix}`;

        const idx = simulatedDirectory.findIndex((m) => m.uid === best.uid);
        if (idx >= 0) {
          simulatedDirectory[idx] = {
            ...simulatedDirectory[idx],
            totalHoursWorked: simulatedDirectory[idx].totalHoursWorked + durationHours,
            scheduledHoursThisWeek:
              simulatedDirectory[idx].scheduledHoursThisWeek + durationHours,
          };
        }

        planned.push({
          title: slot.title,
          department: slot.department,
          date: dateStr,
          startTime: slot.startTime,
          endTime: slot.endTime,
          durationHours,
          assignedUid: best.uid,
          assignedName: best.displayName,
          candidateUids: submittedUids,
          status: ShiftStatus.SCHEDULED,
          fairnessNote: note,
        });
        simulatedShifts.push({
          id: `sim_${dateStr}_${slot.id}`,
          title: slot.title,
          department: slot.department,
          date: dateStr,
          startTime: slot.startTime,
          endTime: slot.endTime,
          durationHours,
          assignedUid: best.uid,
          assignedName: best.displayName,
          candidateUids: submittedUids,
          status: ShiftStatus.SCHEDULED,
          visibility: 'team',
          fairnessNote: note,
          createdBy: 'planner',
          createdAt: null,
          updatedAt: null,
        });
      }
    }
  }

  return planned;
}

export function formatHours(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}
