import React, { useMemo, useState } from 'react';
import {
  CalendarOff,
  CheckCircle2,
  Plus,
  Trash2,
  XCircle,
} from 'lucide-react';
import { formatIsoDate, parseIsoDate } from '../domain/fairnessEngine';
import {
  ApprovalStatus,
  DATE_PATTERN,
  TimeOffRequest,
  UserRole,
  WorkspaceUiData,
} from '../types/cadence';
import {
  ApprovalStatusChip,
  EmptyStatePanel,
  ModalShell,
  SurfaceCard,
} from '../components/UiPrimitives';

interface TimeOffRequestsScreenProps {
  data: WorkspaceUiData;
  onCreateRequest: (
    startDate: string,
    endDate: string,
    reason: string,
  ) => Promise<void>;
  onWithdrawRequest: (requestId: string) => Promise<void>;
  onDecideRequest: (
    req: TimeOffRequest,
    decision: ApprovalStatus,
    reviewNote: string,
  ) => Promise<void>;
  onShowFeedback: (msg: string) => void;
}

type TimeOffFilter = 'pending' | 'approved' | 'denied' | 'all';

function countDaysInclusive(startIso: string, endIso: string): number {
  if (!DATE_PATTERN.test(startIso) || !DATE_PATTERN.test(endIso)) return 1;
  const s = parseIsoDate(startIso);
  const e = parseIsoDate(endIso);
  const diff = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(1, diff + 1);
}

export function TimeOffRequestsScreen({
  data,
  onCreateRequest,
  onWithdrawRequest,
  onDecideRequest,
  onShowFeedback,
}: TimeOffRequestsScreenProps) {
  const isManager = data.profile.role === UserRole.MANAGER;
  const [filter, setFilter] = useState<TimeOffFilter>('pending');
  const [modalOpen, setModalOpen] = useState(false);

  const todayIso = formatIsoDate(new Date());
  const [startDate, setStartDate] = useState(todayIso);
  const [endDate, setEndDate] = useState(todayIso);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const pendingCount = useMemo(
    () =>
      data.timeOffRequests.filter((t) => t.status === ApprovalStatus.PENDING)
        .length,
    [data.timeOffRequests],
  );

  const filteredRequests = useMemo(() => {
    if (filter === 'all') return data.timeOffRequests;
    return data.timeOffRequests.filter((t) => t.status === filter);
  }, [data.timeOffRequests, filter]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(endDate)) {
      setErrorMsg('Enter valid YYYY-MM-DD dates.');
      return;
    }
    if (endDate < startDate) {
      setErrorMsg('End date must be on or after start date.');
      return;
    }
    if (!reason.trim()) {
      setErrorMsg('Please enter a reason for time off.');
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      await onCreateRequest(startDate, endDate, reason.trim());
      setModalOpen(false);
      setReason('');
      onShowFeedback('Time off request submitted.');
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
            Time Off Requests
          </h1>
          <p className="text-xs @xl:text-sm text-slate-500 mt-1">
            Approved dates automatically protect staff from fairness shift assignments
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setStartDate(todayIso);
            setEndDate(todayIso);
            setReason('');
            setErrorMsg(null);
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 self-start"
        >
          <Plus className="w-4 h-4" />
          <span>Request Time Off</span>
        </button>
      </div>

      <div className="inline-flex items-center gap-1 max-w-full overflow-x-auto cadence-scroll bg-white border border-slate-200 rounded-lg p-1">
        {(
          [
            ['pending', `Pending (${pendingCount})`],
            ['approved', 'Approved'],
            ['denied', 'Denied'],
            ['all', `All (${data.timeOffRequests.length})`],
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

      {filteredRequests.length === 0 ? (
        <EmptyStatePanel
          icon={<CalendarOff className="w-5 h-5" />}
          title="No time off requests here"
          subtitle="Submit a new time off request when you need protected dates."
        />
      ) : (
        <div className="grid grid-cols-1 @5xl:grid-cols-2 gap-3.5">
          {filteredRequests.map((req) => {
            const days = countDaysInclusive(req.startDate, req.endDate);
            const isOwner = req.staffUid === data.profile.uid;

            return (
              <SurfaceCard key={req.id} className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      {req.staffName}{' '}
                      <span className="font-normal text-slate-500">
                        · {req.department}
                      </span>
                    </h3>
                    <div className="text-xs font-mono-tabular text-slate-600 mt-0.5">
                      {req.startDate} → {req.endDate} ({days}{' '}
                      {days === 1 ? 'day' : 'days'})
                    </div>
                  </div>
                  <ApprovalStatusChip status={req.status} />
                </div>

                <p className="text-xs text-slate-700 leading-relaxed">
                  {req.reason}
                </p>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                  {req.status === ApprovalStatus.PENDING && isManager ? (
                    <div className="w-full flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={reviewNotes[req.id] ?? ''}
                        onChange={(e) =>
                          setReviewNotes((prev) => ({
                            ...prev,
                            [req.id]: e.target.value,
                          }))
                        }
                        placeholder="Optional review note..."
                        maxLength={300}
                        className="w-full @lg:flex-1 @lg:min-w-44 px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900"
                      />
                      <button
                        type="button"
                        disabled={busyId === req.id}
                        onClick={async () => {
                          setBusyId(req.id);
                          try {
                            await onDecideRequest(
                              req,
                              ApprovalStatus.APPROVED,
                              reviewNotes[req.id] ?? '',
                            );
                            onShowFeedback(
                              `Approved time off for ${req.staffName}.`,
                            );
                          } finally {
                            setBusyId(null);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Approve</span>
                      </button>
                      <button
                        type="button"
                        disabled={busyId === req.id}
                        onClick={async () => {
                          setBusyId(req.id);
                          try {
                            await onDecideRequest(
                              req,
                              ApprovalStatus.DENIED,
                              reviewNotes[req.id] ?? '',
                            );
                            onShowFeedback(
                              `Denied time off for ${req.staffName}.`,
                            );
                          } finally {
                            setBusyId(null);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold cursor-pointer"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Deny</span>
                      </button>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">
                      {req.reviewedByName
                        ? `Reviewed by ${req.reviewedByName}${
                            req.reviewNote ? ` · "${req.reviewNote}"` : ''
                          }`
                        : 'Awaiting manager decision'}
                    </div>
                  )}

                  {req.status === ApprovalStatus.PENDING && isOwner && (
                    <button
                      type="button"
                      onClick={async () => {
                        await onWithdrawRequest(req.id);
                        onShowFeedback('Time off request withdrawn.');
                      }}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 hover:underline cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Withdraw</span>
                    </button>
                  )}
                </div>
              </SurfaceCard>
            );
          })}
        </div>
      )}

      {/* Create Request Modal */}
      <ModalShell
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Request Time Off"
        subtitle="Select your start and end dates and provide context for manager approval"
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
              form="time-off-form"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
            >
              {saving ? 'Submitting...' : 'Submit Request'}
            </button>
          </>
        }
      >
        <form id="time-off-form" onSubmit={handleSubmit} className="space-y-3.5">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
              {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-tabular text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-tabular text-sm text-slate-900"
              />
            </div>
          </div>

          <div className="text-xs text-slate-500 font-mono-tabular">
            Total duration: {countDaysInclusive(startDate, endDate)} day(s)
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Reason
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={400}
              rows={3}
              required
              placeholder="Medical appointment, personal travel, family event..."
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900"
            />
          </div>
        </form>
      </ModalShell>
    </div>
  );
}
