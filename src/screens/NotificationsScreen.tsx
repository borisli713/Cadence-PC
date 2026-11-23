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
import { useI18n } from '../i18n/I18nContext';

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
  const { t } = useI18n();
  const [permState, setPermState] = useState(getNotificationPermissionState);
  const [sendingTest, setSendingTest] = useState(false);

  const unreadCount = data.notifications.filter((n) => !n.isRead).length;

  const handleEnableAlerts = async () => {
    const granted = await requestOsNotificationPermission();
    setPermState(getNotificationPermissionState());
    onShowFeedback(
      granted
        ? t('device_notifications_enabled_banner')
        : t('win_perm_blocked_notice'),
    );
  };

  const handleTestAlert = async () => {
    setSendingTest(true);
    try {
      await onSendTestAlert();
      onShowFeedback(t('vm_banner_test_alert_sent'));
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <div className="space-y-5 @xl:space-y-6">
      <div className="flex flex-col @3xl:flex-row @3xl:items-start @3xl:justify-between gap-3 @xl:gap-4">
        <div className="min-w-0">
          <h1 className="text-xl @xl:text-2xl font-bold text-slate-900">
            {t('notifications_title')}
          </h1>
          <p className="text-xs @xl:text-sm text-slate-500 mt-1">
            {t('notifications_subtitle')}
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
            <span>{sendingTest ? t('win_sending') : t('btn_test_alert')}</span>
          </button>

          {unreadCount > 0 && (
            <button
              type="button"
              onClick={async () => {
                await onMarkAllRead();
                onShowFeedback(t('vm_banner_all_read'));
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>{t('btn_mark_all_read_count', unreadCount)}</span>
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
              {t('win_desktop_toast_title')}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {t('win_status_label')}:{' '}
              <span className="font-semibold text-slate-800">
                {permState === 'tauri'
                  ? t('win_status_native_windows')
                  : permState === 'granted'
                    ? t('win_status_enabled')
                    : permState === 'denied'
                      ? t('win_status_blocked')
                      : t('win_status_perm_required')}
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
            {t('btn_enable_device_alerts')}
          </button>
        )}
      </SurfaceCard>

      {data.notifications.length === 0 ? (
        <EmptyStatePanel
          icon={<Bell className="w-5 h-5" />}
          title={t('empty_notifications_title')}
          subtitle={t('empty_notifications_subtitle')}
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
                    {!notif.isRead && (
                      <StatusChip label={t('badge_unread')} tone="info" />
                    )}
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
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>
                    {notif.isRead ? t('btn_mark_unread') : t('btn_mark_read')}
                  </span>
                </button>
              </div>
            </SurfaceCard>
          ))}
        </div>
      )}
    </div>
  );
}
