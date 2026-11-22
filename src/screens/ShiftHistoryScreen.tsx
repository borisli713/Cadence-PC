import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, History, Search, XCircle } from 'lucide-react';
import {
  ApprovalStatus,
  SCHEDULE_CHANGE_TYPE_LABEL,
  ScheduleChangeRequest,
  WorkspaceUiData,
} from '../types/cadence';
import { invokeFilterShiftHistory } from '../utils/tauriBridge';
import {
  ApprovalStatusChip,
  EmptyStatePanel,
  KpiTile,
  SurfaceCard,
} from '../components/UiPrimitives';
import { formatFirebaseTimestamp } from '../utils/dateFormatting';

interface ShiftHistoryScreenProps {
  data: WorkspaceUiData;
}

type HistoryFilter = 'all' | 'approved' | 'rejected';

export function ShiftHistoryScreen({ data }: ShiftHistoryScreenProps) {
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [rustHistory, setRustHistory] = useState<{
    items: ScheduleChangeRequest[];
    totalResolved: number;
    approvedCount: number;
    rejectedCount: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void invokeFilterShiftHistory(data.scheduleChanges, filter, searchQuery).then(
      (res) => {
        if (!cancelled && res) setRustHistory(res);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [data.scheduleChanges, filter, searchQuery]);

  const resolvedRequests = useMemo(
    () =>
      data.scheduleChanges.filter(
        (c) =>
          c.status === ApprovalStatus.APPROVED ||
          c.status === ApprovalStatus.DENIED,
      ),
    [data.scheduleChanges],
  );

  const approvedCount =
    rustHistory?.approvedCount ??
    resolvedRequests.filter((c) => c.status === ApprovalStatus.APPROVED).length;
  const rejectedCount =
    rustHistory?.rejectedCount ??
    resolvedRequests.filter((c) => c.status === ApprovalStatus.DENIED).length;
  const totalResolvedCount = rustHistory?.totalResolved ?? resolvedRequests.length;

  const filteredList = useMemo(() => {
    if (rustHistory) return rustHistory.items;
    const q = searchQuery.trim().toLowerCase();
    return resolvedRequests.filter((item) => {
      if (filter === 'approved' && item.status !== ApprovalStatus.APPROVED) {
        return false;
      }
      if (filter === 'rejected' && item.status !== ApprovalStatus.DENIED) {
        return false;
      }
      if (!q) return true;
      return (
        item.shiftTitle.toLowerCase().includes(q) ||
        item.requesterName.toLowerCase().includes(q) ||
        item.reviewedByName.toLowerCase().includes(q) ||
        item.proposedDate.includes(q)
      );
    });
  }, [rustHistory, resolvedRequests, filter, searchQuery]);

  return (
    <div className="space-y-5 @xl:space-y-6">
      <div>
        <h1 className="text-xl @xl:text-2xl font-bold text-slate-900">Shift History</h1>
        <p className="text-xs @xl:text-sm text-slate-500 mt-1">
          Audit archive of approved and rejected schedule changes, timestamps, and reviewer notes
        </p>
      </div>

      <div className="grid grid-cols-1 @sm:grid-cols-2 gap-3 @xl:gap-4">
        <KpiTile
          label="Approved Changes"
          value={approvedCount}
          subtext="Applied to live team schedule"
          accentClass="text-emerald-700"
          icon={<CheckCircle2 className="w-4 h-4" />}
        />
        <KpiTile
          label="Rejected Changes"
          value={rejectedCount}
          subtext="Declined with audit trail"
          accentClass="text-rose-700"
          icon={<XCircle className="w-4 h-4" />}
        />
      </div>

      <div className="flex flex-col @2xl:flex-row @2xl:items-center @2xl:justify-between gap-3">
        <div className="inline-flex items-center gap-1 max-w-full overflow-x-auto cadence-scroll bg-white border border-slate-200 rounded-lg p-1">
          {(
            [
              ['all', `All (${totalResolvedCount})`],
              ['approved', `Approved (${approvedCount})`],
              ['rejected', `Rejected (${rejectedCount})`],
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

        <div className="relative w-full @2xl:w-64 shrink-0">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search shift, staff, reviewer..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
          />
        </div>
      </div>

      {filteredList.length === 0 ? (
        <EmptyStatePanel
          icon={<History className="w-5 h-5" />}
          title="No resolved schedule changes yet"
          subtitle="Once managers approve or deny pending change requests, the full audit log appears here."
        />
      ) : (
        <div className="grid grid-cols-1 @5xl:grid-cols-2 gap-3.5">
          {filteredList.map((item) => (
            <SurfaceCard key={item.id} className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900">
                      {item.shiftTitle}
                    </h3>
                    <span className="text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">
                      {SCHEDULE_CHANGE_TYPE_LABEL[item.type]}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Requester: <span className="font-semibold text-slate-800">{item.requesterName}</span> ·
                    Submitted {formatFirebaseTimestamp(item.createdAt)} ·
                    Resolved {formatFirebaseTimestamp(item.updatedAt)}
                  </p>
                </div>
                <ApprovalStatusChip status={item.status} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                <div>
                  <div className="text-[11px] font-semibold uppercase text-slate-400">
                    Original Slot
                  </div>
                  <div className="font-mono-tabular text-slate-700 mt-0.5">
                    {item.currentDate} · {item.currentStartTime}–
                    {item.currentEndTime}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase text-slate-400">
                    Requested Slot
                  </div>
                  <div className="font-mono-tabular font-semibold text-slate-900 mt-0.5">
                    {item.proposedDate} · {item.proposedStartTime}–
                    {item.proposedEndTime}
                    {item.proposedAssigneeName
                      ? ` · ${item.proposedAssigneeName}`
                      : ''}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 pt-1">
                <span>
                  <span className="font-semibold text-slate-800">Reason: </span>
                  {item.reason || '—'}
                </span>
                <span>
                  Reviewer:{' '}
                  <span className="font-semibold text-slate-800">
                    {item.reviewedByName || 'Manager'}
                  </span>
                  {item.reviewNote ? ` · "${item.reviewNote}"` : ''}
                </span>
              </div>
            </SurfaceCard>
          ))}
        </div>
      )}
    </div>
  );
}
