import { useMemo, useState } from 'react';
import {
  CheckCheck,
  CheckCircle2,
  History,
  Plus,
  XCircle,
} from 'lucide-react';
import {
  ApprovalStatus,
  CadenceTab,
  SCHEDULE_CHANGE_TYPE_LABEL,
  ScheduleChangeRequest,
  UserRole,
  WorkspaceUiData,
} from '../types/cadence';
import {
  ApprovalStatusChip,
  EmptyStatePanel,
  SurfaceCard,
} from '../components/UiPrimitives';
import { formatFirebaseTimestamp } from '../utils/dateFormatting';

interface ManagerApprovalsScreenProps {
  data: WorkspaceUiData;
  onNavigate: (tab: CadenceTab) => void;
  onOpenNewRequest: () => void;
  onDecideChange: (
    req: ScheduleChangeRequest,
    decision: ApprovalStatus,
    reviewNote: string,
  ) => Promise<void>;
  onAcceptAllPending: () => Promise<number>;
  onShowFeedback: (msg: string) => void;
}

type ApprovalFilter = 'pending' | 'approved' | 'denied' | 'all';

export function ManagerApprovalsScreen({
  data,
  onNavigate,
  onOpenNewRequest,
  onDecideChange,
  onAcceptAllPending,
  onShowFeedback,
}: ManagerApprovalsScreenProps) {
  const isManager = data.profile.role === UserRole.MANAGER;
  const [filter, setFilter] = useState<ApprovalFilter>('pending');
  const [notesByReqId, setNotesByReqId] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [acceptingAll, setAcceptingAll] = useState(false);

  const pendingList = useMemo(
    () =>
      data.scheduleChanges.filter((c) => c.status === ApprovalStatus.PENDING),
    [data.scheduleChanges],
  );

  const filteredList = useMemo(() => {
    if (filter === 'all') return data.scheduleChanges;
    return data.scheduleChanges.filter((c) => c.status === filter);
  }, [data.scheduleChanges, filter]);

  const handleAcceptAll = async () => {
    if (pendingList.length === 0) return;
    setAcceptingAll(true);
    try {
      const count = await onAcceptAllPending();
      onShowFeedback(
        `Approved ${count} pending schedule change${count === 1 ? '' : 's'} with one click.`,
      );
    } finally {
      setAcceptingAll(false);
    }
  };

  const handleDecision = async (
    req: ScheduleChangeRequest,
    decision: ApprovalStatus,
  ) => {
    setBusyId(req.id);
    try {
      await onDecideChange(req, decision, notesByReqId[req.id] ?? '');
      onShowFeedback(
        `${
          decision === ApprovalStatus.APPROVED ? 'Approved' : 'Denied'
        } ${req.requesterName}'s request.`,
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Schedule Change Approvals
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Review time adjustments, swaps, drops, and open shift claims
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isManager && pendingList.length > 0 && (
            <button
              type="button"
              disabled={acceptingAll}
              onClick={handleAcceptAll}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              <CheckCheck className="w-4 h-4" />
              <span>
                {acceptingAll
                  ? 'Accepting...'
                  : `Accept All (${pendingList.length})`}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenNewRequest}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>New Change Request</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate(CadenceTab.HISTORY)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer whitespace-nowrap shrink-0"
          >
            <History className="w-4 h-4 text-slate-600" />
            <span>Shift History</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="inline-flex flex-wrap items-center gap-1 bg-white border border-slate-200 rounded-lg p-1">
        {(
          [
            ['pending', `Pending (${pendingList.length})`],
            ['approved', 'Approved'],
            ['denied', 'Denied'],
            ['all', `All (${data.scheduleChanges.length})`],
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

      {filteredList.length === 0 ? (
        <EmptyStatePanel
          icon={<CheckCircle2 className="w-5 h-5" />}
          title="No requests in this queue"
          subtitle="Schedule change requests submitted by staff will appear here for review."
        />
      ) : (
        <div className="space-y-4">
          {filteredList.map((req) => (
            <SurfaceCard key={req.id} className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900">
                      {req.shiftTitle}
                    </h3>
                    <span className="text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
                      {SCHEDULE_CHANGE_TYPE_LABEL[req.type]}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Requested by{' '}
                    <span className="font-semibold text-slate-800">
                      {req.requesterName}
                    </span>{' '}
                    · {formatFirebaseTimestamp(req.createdAt)}
                  </p>
                </div>
                <ApprovalStatusChip status={req.status} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                <div>
                  <div className="text-[11px] font-semibold uppercase text-slate-400">
                    Current Shift
                  </div>
                  <div className="font-mono-tabular text-slate-800 mt-0.5">
                    {req.currentDate} · {req.currentStartTime}–
                    {req.currentEndTime}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase text-slate-400">
                    Proposed
                  </div>
                  <div className="font-mono-tabular font-semibold text-slate-900 mt-0.5">
                    {req.proposedDate} · {req.proposedStartTime}–
                    {req.proposedEndTime}
                    {req.proposedAssigneeName
                      ? ` · Assignee: ${req.proposedAssigneeName}`
                      : ''}
                  </div>
                </div>
              </div>

              {req.reason && (
                <p className="text-xs text-slate-700 leading-relaxed">
                  <span className="font-semibold text-slate-900">Reason: </span>
                  {req.reason}
                </p>
              )}

              {req.status === ApprovalStatus.PENDING && isManager ? (
                <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-100">
                  <input
                    type="text"
                    value={notesByReqId[req.id] ?? ''}
                    onChange={(e) =>
                      setNotesByReqId((prev) => ({
                        ...prev,
                        [req.id]: e.target.value,
                      }))
                    }
                    placeholder="Optional review note..."
                    maxLength={300}
                    className="flex-1 min-w-52 px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900"
                  />
                  <button
                    type="button"
                    disabled={busyId === req.id}
                    onClick={() => handleDecision(req, ApprovalStatus.APPROVED)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Approve</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyId === req.id}
                    onClick={() => handleDecision(req, ApprovalStatus.DENIED)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 disabled:opacity-60 text-rose-700 text-xs font-semibold cursor-pointer"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Deny</span>
                  </button>
                </div>
              ) : (
                req.reviewedByName && (
                  <div className="text-xs text-slate-500 pt-2 border-t border-slate-100">
                    Reviewed by{' '}
                    <span className="font-semibold text-slate-700">
                      {req.reviewedByName}
                    </span>
                    {req.reviewNote ? ` · "${req.reviewNote}"` : ''}
                  </div>
                )
              )}
            </SurfaceCard>
          ))}
        </div>
      )}
    </div>
  );
}
