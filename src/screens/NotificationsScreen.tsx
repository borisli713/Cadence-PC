import { useState } from 'react';
import { Bell, BellRing, Check, CheckCheck, Send } from 'lucide-react';
import type { PushNotificationRecord, WorkspaceUiData } from '../types/cadence';
import {
  getNotificationPermissionState,
  requestOsNotificationPermission,
} from '../utils/notificationHelper';
import {
  EmptyStatePanel,
  NotificationCategoryChip,
  StatusChip,
  SurfaceCard,
} from '../components/UiPrimitives';
import { formatFirebaseTimestamp } from '../utils/dateFormatting';

interface NotificationsScreenProps {
  data: WorkspaceUiData;
  onMarkRead: (id: string, isRead: boolean) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  onSendTestAlert: () => Promise<void>;
  onShowFeedback: (msg: string) => void;
}

export function NotificationsScreen({
  data,
  onMarkRead,
  onMarkAllRead,
  onSendTestAlert,
  onShowFeedback,
}: NotificationsScreenProps) {
  const [permState, setPermState] = useState(getNotificationPermissionState);
  const [sendingTest, setSendingTest] = useState(false);

  const unreadCount = data.notifications.filter((n) => !n.isRead).length;

  const handleEnableAlerts = async () => {
    const granted = await requestOsNotificationPermission();
    setPermState(getNotificationPermissionState());
    onShowFeedback(
      granted
        ? 'Desktop alert permissions granted.'
        : 'Notifications blocked by browser/OS settings.',
    );
  };

  const handleTestAlert = async () => {
    setSendingTest(true);
    try {
      await onSendTestAlert();
      onShowFeedback('Dispatched test alert through Firestore & desktop notifications.');
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <div className="space-y-5 @xl:space-y-6">
      <div className="flex flex-col @3xl:flex-row @3xl:items-start @3xl:justify-between gap-3 @xl:gap-4">
        <div className="min-w-0">
          <h1 className="text-xl @xl:text-2xl font-bold text-slate-900">Notifications</h1>
          <p className="text-xs @xl:text-sm text-slate-500 mt-1">
            Schedule decisions, fairness assignments, report verifications, and native Windows alerts
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={sendingTest}
            onClick={handleTestAlert}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-60 text-xs font-semibold text-slate-800 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5 text-blue-600" />
            <span>{sendingTest ? 'Sending...' : 'Test Alert'}</span>
          </button>

          {unreadCount > 0 && (
            <button
              type="button"
              onClick={async () => {
                await onMarkAllRead();
                onShowFeedback('Marked all notifications as read.');
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Mark All Read ({unreadCount})</span>
            </button>
          )}
        </div>
      </div>

      {/* Desktop Notification Permission Banner */}
      <SurfaceCard className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center shrink-0">
            <BellRing className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-900">
              Desktop Toast Notifications
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Status:{' '}
              <span className="font-semibold text-slate-800">
                {permState === 'tauri'
                  ? 'Native Windows Desktop Enabled'
                  : permState === 'granted'
                    ? 'Enabled'
                    : permState === 'denied'
                      ? 'Blocked in OS/Browser'
                      : 'Permission Required'}
              </span>
            </div>
          </div>
        </div>

        {permState !== 'tauri' && permState !== 'granted' && (
          <button
            type="button"
            onClick={handleEnableAlerts}
            className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            Enable Alerts
          </button>
        )}
      </SurfaceCard>

      {data.notifications.length === 0 ? (
        <EmptyStatePanel
          icon={<Bell className="w-5 h-5" />}
          title="You're all caught up"
          subtitle="Notifications for shift assignments, approvals, reports, and time off will appear here."
        />
      ) : (
        <div className="grid grid-cols-1 @5xl:grid-cols-2 gap-3.5">
          {data.notifications.map((notif: PushNotificationRecord) => (
            <SurfaceCard
              key={notif.id}
              className={`space-y-2 ${
                notif.isRead ? 'opacity-80' : 'border-blue-300 bg-blue-50/20'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900">
                      {notif.title}
                    </h3>
                    <NotificationCategoryChip category={notif.category} />
                    {!notif.isRead && <StatusChip label="Unread" tone="info" />}
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    {notif.message}
                  </p>
                  <div className="text-[11px] font-mono-tabular text-slate-400">
                    {formatFirebaseTimestamp(notif.createdAt)}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onMarkRead(notif.id, !notif.isRead)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer shrink-0"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{notif.isRead ? 'Mark Unread' : 'Mark Read'}</span>
                </button>
              </div>
            </SurfaceCard>
          ))}
        </div>
      )}
    </div>
  );
}
