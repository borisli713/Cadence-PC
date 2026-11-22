import type { Shift } from '../types/cadence';
import { addDaysIso, parseTimeToMinutes } from '../domain/fairnessEngine';
import { invokeGenerateIcs, invokeSaveIcsFile, openExternalUrl } from './tauriBridge';

function toIcsTimestamp(dateIso: string, hhmm: string): string {
  const ymd = dateIso.replace(/-/g, '');
  const parts = hhmm.split(':');
  const h = (parts[0] ?? '09').padStart(2, '0');
  const m = (parts[1] ?? '00').padStart(2, '0');
  return `${ymd}T${h}${m}00`;
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export function generateIcsContent(shifts: Shift[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cadence//Shift Operations Windows//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const shift of shifts) {
    const startMin = parseTimeToMinutes(shift.startTime);
    const endMin = parseTimeToMinutes(shift.endTime);
    const endDate = endMin <= startMin ? addDaysIso(shift.date, 1) : shift.date;

    const dtStart = toIcsTimestamp(shift.date, shift.startTime);
    const dtEnd = toIcsTimestamp(endDate, shift.endTime);
    const assignee = shift.assignedName.trim() || 'Open / Unassigned';
    const desc = [
      `Department: ${shift.department}`,
      `Assigned: ${assignee}`,
      `Status: ${shift.status}`,
      shift.fairnessNote ? `Fairness: ${shift.fairnessNote}` : '',
    ]
      .filter(Boolean)
      .join(' | ');

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${shift.id}@cadence.shifts`);
    lines.push(`DTSTART:${dtStart}`);
    lines.push(`DTEND:${dtEnd}`);
    lines.push(`SUMMARY:${escapeIcsText(`${shift.title} — ${assignee}`)}`);
    lines.push(`DESCRIPTION:${escapeIcsText(desc)}`);
    lines.push(`LOCATION:${escapeIcsText(shift.department)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

export async function exportIcsFile(
  shifts: Shift[],
  filename = 'cadence-shifts.ics',
): Promise<string | null> {
  if (shifts.length === 0) return null;

  const desktopSaved = await invokeSaveIcsFile(shifts, filename);
  if (desktopSaved !== undefined) {
    return desktopSaved;
  }

  const content = (await invokeGenerateIcs(shifts)) ?? generateIcsContent(shifts);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

export async function openGoogleCalendarForShift(shift: Shift): Promise<void> {
  const startMin = parseTimeToMinutes(shift.startTime);
  const endMin = parseTimeToMinutes(shift.endTime);
  const endDate = endMin <= startMin ? addDaysIso(shift.date, 1) : shift.date;

  const startStamp = toIcsTimestamp(shift.date, shift.startTime);
  const endStamp = toIcsTimestamp(endDate, shift.endTime);
  const assignee = shift.assignedName.trim() || 'Open Shift';

  const details = [
    `Department: ${shift.department}`,
    `Assigned: ${assignee}`,
    shift.fairnessNote,
  ]
    .filter(Boolean)
    .join('\n');

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Cadence Shift: ${shift.title}`,
    dates: `${startStamp}/${endStamp}`,
    details,
    location: shift.department,
  });

  await openExternalUrl(
    `https://calendar.google.com/calendar/render?${params.toString()}`,
  );
}
