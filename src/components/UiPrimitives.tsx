import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import {
  ApprovalStatus,
  SHIFT_REPORT_STATUS_LABEL,
  SHIFT_STATUS_LABEL,
  ShiftReportStatus,
  ShiftStatus,
  APPROVAL_STATUS_LABEL,
  SUBMISSION_STATUS_LABEL,
  SubmissionStatus,
  NOTIFICATION_CATEGORY_LABEL,
  NotificationCategory,
} from '../types/cadence';

export type StatusTone =
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'violet'
  | 'neutral';

const TONE_CLASSES: Record<StatusTone, string> = {
  info: 'bg-blue-50 text-blue-700 border-blue-200',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  danger: 'bg-rose-50 text-rose-700 border-rose-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  neutral: 'bg-slate-100 text-slate-700 border-slate-200',
};

export function StatusChip({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: StatusTone;
}) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-semibold whitespace-nowrap shrink-0 ${TONE_CLASSES[tone]}`}
    >
      {label}
    </span>
  );
}

function shiftStatusTone(status: ShiftStatus): StatusTone {
  switch (status) {
    case ShiftStatus.SCHEDULED:
      return 'info';
    case ShiftStatus.OPEN:
      return 'violet';
    case ShiftStatus.COMPLETED:
      return 'success';
    case ShiftStatus.CONFLICT:
      return 'danger';
    case ShiftStatus.PENDING_CHANGE:
      return 'warning';
  }
}

export function ShiftStatusChip({ status }: { status: ShiftStatus }) {
  return (
    <StatusChip
      label={SHIFT_STATUS_LABEL[status]}
      tone={shiftStatusTone(status)}
    />
  );
}

export function ApprovalStatusChip({ status }: { status: ApprovalStatus }) {
  const tone: StatusTone =
    status === ApprovalStatus.APPROVED
      ? 'success'
      : status === ApprovalStatus.DENIED
        ? 'danger'
        : 'warning';
  return <StatusChip label={APPROVAL_STATUS_LABEL[status]} tone={tone} />;
}

export function ReportStatusChip({ status }: { status: ShiftReportStatus }) {
  const tone: StatusTone =
    status === ShiftReportStatus.VERIFIED
      ? 'success'
      : status === ShiftReportStatus.FLAGGED
        ? 'danger'
        : 'info';
  return <StatusChip label={SHIFT_REPORT_STATUS_LABEL[status]} tone={tone} />;
}

export function SubmissionStatusChip({ status }: { status: SubmissionStatus }) {
  return (
    <StatusChip
      label={SUBMISSION_STATUS_LABEL[status]}
      tone={status === SubmissionStatus.SUBMITTED ? 'info' : 'neutral'}
    />
  );
}

export function NotificationCategoryChip({
  category,
}: {
  category: NotificationCategory;
}) {
  const tone: StatusTone =
    category === NotificationCategory.SHIFT_APPROVED ||
    category === NotificationCategory.REPORT_VERIFIED ||
    category === NotificationCategory.TIME_OFF_APPROVED
      ? 'success'
      : category === NotificationCategory.SHIFT_DENIED ||
          category === NotificationCategory.TIME_OFF_DENIED
        ? 'danger'
        : category === NotificationCategory.FAIRNESS_REBALANCED
          ? 'violet'
          : 'info';
  return (
    <StatusChip label={NOTIFICATION_CATEGORY_LABEL[category]} tone={tone} />
  );
}

export function SurfaceCard({
  children,
  className = '',
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  if (onClick) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
        className={`bg-white border border-slate-200 rounded-xl p-3.5 sm:p-5 transition-colors hover:border-slate-300 cursor-pointer min-w-0 ${className}`}
      >
        {children}
      </div>
    );
  }
  return (
    <div
      className={`bg-white border border-slate-200 rounded-xl p-3.5 sm:p-5 min-w-0 ${className}`}
    >
      {children}
    </div>
  );
}

export function KpiTile({
  label,
  value,
  subtext,
  accentClass = 'text-slate-900',
  icon,
}: {
  label: string;
  value: string | number;
  subtext?: string;
  accentClass?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 flex flex-col justify-between gap-2 min-w-0">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-slate-500 truncate">
          {label}
        </span>
        {icon && <span className="text-slate-400 shrink-0">{icon}</span>}
      </div>
      <div className={`text-xl sm:text-2xl font-bold font-mono-tabular ${accentClass}`}>
        {value}
      </div>
      {subtext && (
        <div className="text-xs text-slate-500 truncate">{subtext}</div>
      )}
    </div>
  );
}

export function EmptyStatePanel({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 text-center flex flex-col items-center justify-center gap-3">
      <div className="w-11 h-11 rounded-lg bg-slate-100 border border-slate-200 text-slate-500 flex items-center justify-center">
        {icon}
      </div>
      <div className="space-y-1 max-w-md">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        <p className="text-xs text-slate-500 leading-relaxed">{subtitle}</p>
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}

export function ModalShell({
  open,
  title,
  subtitle,
  onClose,
  maxWidthClass = 'max-w-lg',
  children,
  footer,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  maxWidthClass?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-slate-900/45 backdrop-blur-[1px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${maxWidthClass} bg-white border border-slate-200 rounded-xl shadow-xl flex flex-col max-h-[92dvh] overflow-hidden`}
      >
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 truncate">
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs text-slate-500 mt-0.5 truncate">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-5 overflow-y-auto cadence-scroll space-y-4 text-sm text-slate-700">
          {children}
        </div>

        {footer && (
          <div className="px-4 sm:px-5 py-3 sm:py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-end gap-2 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
