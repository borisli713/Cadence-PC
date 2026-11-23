import {
  ApprovalStatus,
  PushNotificationRecord,
  ScheduleChangeRequest,
  ShiftReport,
  ShiftReportStatus,
  TimeOffRequest,
} from '../types/cadence';
import { formatHours } from '../domain/fairnessEngine';
import {
  invokeFilterNewManagerWorkAlerts,
  invokeFilterUnnotifiedAlerts,
  invokeNativeNotification,
  isTauriDesktop,
} from './tauriBridge';
import { translateStatic } from '../i18n/I18nContext';

const STORAGE_KEY_NOTIFIED_IDS = 'cadence_notified_ids_v1';
const STORAGE_KEY_MGR_KEYS = 'cadence_notified_mgr_keys_v1';
const MAX_TRACKED_KEYS = 200;

export interface NotificationPayload {
  key: string;
  title: string;
  message: string;
}

function readSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((v): v is string => typeof v === 'string'))
      : new Set();
  } catch {
    return new Set();
  }
}

function writeSet(key: string, items: Set<string>): void {
  try {
    const trimmed = Array.from(items).slice(-MAX_TRACKED_KEYS);
    localStorage.setItem(key, JSON.stringify(trimmed));
  } catch {
    // Storage unavailable
  }
}

export function hasDesktopNotificationSupport(): boolean {
  if (isTauriDesktop()) return true;
  return typeof Notification !== 'undefined';
}

export function getNotificationPermissionState(): NotificationPermission | 'tauri' {
  if (isTauriDesktop()) return 'tauri';
  if (typeof Notification === 'undefined') return 'denied';
  return Notification.permission;
}

export async function requestOsNotificationPermission(): Promise<boolean> {
  if (isTauriDesktop()) {
    try {
      const notifPlugin = await import('@tauri-apps/plugin-notification');
      let granted = await notifPlugin.isPermissionGranted();
      if (!granted) {
        const perm = await notifPlugin.requestPermission();
        granted = perm === 'granted';
      }
      return granted;
    } catch {
      return true;
    }
  }
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export async function dispatchOsNotification(
  title: string,
  body: string,
): Promise<void> {
  if (isTauriDesktop()) {
    await invokeNativeNotification(title, body);
    return;
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/cadence-icon.png' });
  }
}

export function filterUnnotifiedAlerts(
  uid: string,
  notifications: PushNotificationRecord[],
  pushEnabled: boolean,
): PushNotificationRecord[] {
  if (!pushEnabled) return [];
  const storeKey = `${STORAGE_KEY_NOTIFIED_IDS}_${uid}`;
  const seen = readSet(storeKey);
  const fresh = notifications.filter((n) => !n.isRead && !seen.has(n.id));
  if (fresh.length > 0) {
    fresh.forEach((n) => seen.add(n.id));
    writeSet(storeKey, seen);
  }
  return fresh;
}

export async function filterUnnotifiedAlertsWithRust(
  uid: string,
  notifications: PushNotificationRecord[],
  pushEnabled: boolean,
): Promise<PushNotificationRecord[]> {
  if (!pushEnabled) return [];
  const rustFresh = await invokeFilterUnnotifiedAlerts(uid, notifications, pushEnabled);
  if (rustFresh !== null) return rustFresh;
  return filterUnnotifiedAlerts(uid, notifications, pushEnabled);
}

export function buildManagerWorkPayloads(
  managerUid: string,
  scheduleChanges: ScheduleChangeRequest[],
  timeOffRequests: TimeOffRequest[],
  shiftReports: ShiftReport[],
): NotificationPayload[] {
  const payloads: NotificationPayload[] = [];

  for (const req of scheduleChanges) {
    if (req.status === ApprovalStatus.PENDING && req.requesterUid !== managerUid) {
      const changeLabel = translateStatic(`change_type_${req.type}`);
      payloads.push({
        key: `chg_${req.id}`,
        title: translateStatic('notif_mgr_shift_req_title'),
        message: translateStatic(
          'notif_mgr_shift_req_body',
          req.requesterName,
          changeLabel,
          req.shiftTitle,
          req.proposedDate,
        ),
      });
    }
  }

  for (const to of timeOffRequests) {
    if (to.status === ApprovalStatus.PENDING && to.staffUid !== managerUid) {
      payloads.push({
        key: `to_${to.id}`,
        title: translateStatic('notif_mgr_time_off_title'),
        message: translateStatic(
          'notif_mgr_time_off_body',
          to.staffName,
          to.startDate,
          to.endDate,
        ),
      });
    }
  }

  for (const rep of shiftReports) {
    if (rep.status === ShiftReportStatus.SUBMITTED && rep.staffUid !== managerUid) {
      payloads.push({
        key: `rep_${rep.id}`,
        title: translateStatic('notif_mgr_report_title'),
        message: translateStatic(
          'notif_mgr_report_body',
          rep.staffName,
          formatHours(rep.workedHours),
          rep.shiftTitle,
          rep.date,
        ),
      });
    }
  }

  return payloads;
}

export function filterNewManagerWorkAlerts(
  uid: string,
  items: NotificationPayload[],
  pushEnabled: boolean,
): NotificationPayload[] {
  if (!pushEnabled) return [];
  const storeKey = `${STORAGE_KEY_MGR_KEYS}_${uid}`;
  const seen = readSet(storeKey);
  const fresh = items.filter((item) => !seen.has(item.key));
  if (fresh.length > 0) {
    fresh.forEach((item) => seen.add(item.key));
    writeSet(storeKey, seen);
  }
  return fresh;
}

export async function filterNewManagerWorkAlertsWithRust(
  uid: string,
  items: NotificationPayload[],
  pushEnabled: boolean,
): Promise<NotificationPayload[]> {
  if (!pushEnabled) return [];
  const rustFresh = await invokeFilterNewManagerWorkAlerts(uid, items, pushEnabled);
  if (rustFresh !== null) return rustFresh;
  return filterNewManagerWorkAlerts(uid, items, pushEnabled);
}
