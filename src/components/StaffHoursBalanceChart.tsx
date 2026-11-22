import { useEffect, useState } from 'react';
import { computeScheduledHoursByUid, formatHours } from '../domain/fairnessEngine';
import type { Shift, StaffChartRow, StaffDirectoryEntry } from '../types/cadence';
import { invokeComputeStaffChart } from '../utils/tauriBridge';
import { SurfaceCard } from './UiPrimitives';

interface StaffHoursBalanceChartProps {
  staffDirectory: StaffDirectoryEntry[];
  shifts: Shift[];
  rustRows?: StaffChartRow[] | null;
  title?: string;
}

export function StaffHoursBalanceChart({
  staffDirectory,
  shifts,
  rustRows,
  title = 'Team Hours & Fairness Balance',
}: StaffHoursBalanceChartProps) {
  const [fetchedRows, setFetchedRows] = useState<StaffChartRow[] | null>(null);

  useEffect(() => {
    if (rustRows || staffDirectory.length === 0) return;
    let cancelled = false;
    void invokeComputeStaffChart(staffDirectory, shifts).then((res) => {
      if (!cancelled && res) setFetchedRows(res);
    });
    return () => {
      cancelled = true;
    };
  }, [rustRows, staffDirectory, shifts]);

  if (staffDirectory.length === 0) {
    return null;
  }

  const activeRows = rustRows ?? fetchedRows;
  const scheduledByUid = computeScheduledHoursByUid(shifts);

  const rows = activeRows
    ? activeRows.map((r) => ({
        uid: r.uid,
        name: r.displayName,
        department: r.department,
        logged: r.loggedHours,
        scheduled: r.scheduledHours,
        target: r.targetHours,
        combined: r.combinedHours,
        ratio: r.utilizationRatio,
      }))
    : staffDirectory
        .map((member) => {
          const logged = Math.max(0, member.totalHoursWorked);
          const scheduled = Math.max(
            0,
            scheduledByUid[member.uid] ?? member.scheduledHoursThisWeek,
          );
          const target = Math.max(1, member.weeklyHoursTarget);
          const combined = logged + scheduled;
          const ratio = combined / target;
          return {
            uid: member.uid,
            name: member.displayName,
            department: member.department,
            logged,
            scheduled,
            target,
            combined,
            ratio,
          };
        })
        .sort((a, b) => a.ratio - b.ratio);

  const maxAxisHours = Math.max(
    45,
    ...rows.map((r) => Math.max(r.combined, r.target) * 1.1),
  );

  const barWidth = 640;
  const barHeight = 14;

  return (
    <SurfaceCard className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Sorted from lowest utilization ratio upward to prioritize under-allocated teammates
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 @xl:gap-4 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" />
            Verified Logged
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-blue-600 inline-block" />
            Scheduled
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-0.5 h-3 bg-slate-900 inline-block" />
            Weekly Target
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {rows.map((row) => {
          const loggedW = Math.min(
            barWidth,
            (row.logged / maxAxisHours) * barWidth,
          );
          const schedW = Math.min(
            Math.max(0, barWidth - loggedW),
            (row.scheduled / maxAxisHours) * barWidth,
          );
          const targetX = Math.min(
            barWidth - 1,
            Math.max(2, (row.target / maxAxisHours) * barWidth),
          );
          const pct = Math.round(row.ratio * 100);

          return (
            <div
              key={row.uid}
              className="grid grid-cols-1 @xl:grid-cols-[164px_1fr_138px] @4xl:grid-cols-[190px_1fr_150px] items-stretch @xl:items-center gap-1.5 @xl:gap-4"
            >
              <div className="flex items-baseline justify-between gap-2 @xl:block min-w-0">
                <div className="text-xs font-semibold text-slate-900 truncate">
                  {row.name}
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  {row.department}
                </div>
              </div>

              <svg
                viewBox={`0 0 ${barWidth} 20`}
                preserveAspectRatio="xMinYMid meet"
                className="w-full h-5 overflow-visible"
                role="img"
                aria-label={`${row.name}: ${formatHours(row.logged)}h logged, ${formatHours(row.scheduled)}h scheduled vs ${row.target}h target`}
              >
                <rect
                  x={0}
                  y={3}
                  width={barWidth}
                  height={barHeight}
                  rx={4}
                  fill="#f1f5f9"
                />
                {loggedW > 0 && (
                  <rect
                    x={0}
                    y={3}
                    width={loggedW}
                    height={barHeight}
                    rx={schedW > 0 ? 0 : 4}
                    fill="#059669"
                  />
                )}
                {schedW > 0 && (
                  <rect
                    x={loggedW}
                    y={3}
                    width={schedW}
                    height={barHeight}
                    rx={2}
                    fill="#2563eb"
                  />
                )}
                <line
                  x1={targetX}
                  y1={0}
                  x2={targetX}
                  y2={20}
                  stroke="#0f172a"
                  strokeWidth={2}
                />
              </svg>

              <div className="flex items-center justify-between @xl:justify-end gap-2 text-xs font-mono-tabular text-slate-700">
                <span>
                  {formatHours(row.logged)}+{formatHours(row.scheduled)}/{row.target}h
                </span>
                <span
                  className={`font-semibold ${
                    pct >= 100
                      ? 'text-amber-700'
                      : pct <= 60
                        ? 'text-emerald-700'
                        : 'text-slate-700'
                  }`}
                >
                  {pct}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </SurfaceCard>
  );
}
