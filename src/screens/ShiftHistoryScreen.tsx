import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, History, Search, XCircle } from 'lucide-react';
import {
  ApprovalStatus,
  ScheduleChangeRequest,
  UserRole,
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
import { useI18n } from '../i18n/I18nContext';

interface ShiftHistoryScreenProps {
  data: WorkspaceUiData;
}

type HistoryFilter = 'all' | 'approved' | 'rejected';

export function ShiftHistoryScreen({ data }: ShiftHistoryScreenProps) {
  const { t } = useI18n();
  const isManager = data.profile.role === UserRole.MANAGER;
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

  const hasActiveFilter = filter !== 'all' || searchQuery.trim().length > 0;

  return (
    <div className="space-y-5 @xl:space-y-6">
      <div>
        <h1 className="text-xl @xl:text-2xl font-bold text-slate-900">
          {t('nav_history')}
        </h1>
        <p className="text-xs @xl:text-sm text-slate-500 mt-1">
          {isManager ? t('history_subtitle_manager') : t('history_subtitle_staff')}
        </p>
      </div>

      <div className="grid grid-cols-1 @sm:grid-cols-2 gap-3 @xl:gap-4">
        <KpiTile
          label={t('kpi_approved_requests')}
          value={approvedCount}
          subtext={t('applied_to_schedule')}
          accentClass="text-emerald-700"
          icon={<CheckCircle2 className="w-4 h-4" />}
        />
        <KpiTile
          label={t('kpi_rejected_requests')}
          value={rejectedCount}
          subtext={t('declined_by_manager')}
          accentClass="text-rose-700"
          icon={<XCircle className="w-4 h-4" />}
        />
      </div>

      <div className="flex flex-col @2xl:flex-row @2xl:items-center @2xl:justify-between gap-3">
        <div className="inline-flex items-center gap-1 max-w-full overflow-x-auto cadence-scroll bg-white border border-slate-200 rounded-lg p-1">
          {(
            [
              ['all', t('win_all_count_format', totalResolvedCount)],
              ['approved', t('win_approved_count_format', approvedCount)],
              ['rejected', t('win_rejected_count_format', rejectedCount)],
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
            placeholder={t('search_history_label')}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 bg-white text-xs text-slate-900"
          />
        </div>
      </div>

      {filteredList.length === 0 ? (
        <EmptyStatePanel
          icon={<History className="w-5 h-5" />}
          title={
            hasActiveFilter
              ? t('empty_history_filtered_title')
              : t('empty_history_none_title')
          }
          subtitle={
            hasActiveFilter
              ? t('empty_history_filtered_subtitle')
              : t('empty_history_none_subtitle')
          }
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
                      {t(`change_type_${item.type}`)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {t('requested_by_format', item.requesterName)} ·{' '}
                    {t(
                      'submitted_time_format',
                      formatFirebaseTimestamp(item.createdAt),
                    )}{' '}
                    ·{' '}
                    {t(
                      'win_resolved_label',
                      formatFirebaseTimestamp(item.updatedAt),
                    )}
                  </p>
                </div>
                <ApprovalStatusChip status={item.status} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                <div>
                  <div className="text-[11px] font-semibold uppercase text-slate-400">
                    {t('win_original_slot')}
                  </div>
                  <div className="font-mono-tabular text-slate-700 mt-0.5">
                    {item.currentDate} · {item.currentStartTime}–
                    {item.currentEndTime}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase text-slate-400">
                    {t('win_requested_slot')}
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
                <span>{t('reason_line_format', item.reason || '—')}</span>
                <span>
                  {item.reviewNote
                    ? t(
                        'reviewed_by_note_format',
                        item.reviewedByName || t('win_manager_fallback'),
                        item.reviewNote,
                      )
                    : t(
                        'reviewed_by_format',
                        item.reviewedByName || t('win_manager_fallback'),
                      )}
                </span>
              </div>
            </SurfaceCard>
          ))}
        </div>
      )}
    </div>
  );
}
