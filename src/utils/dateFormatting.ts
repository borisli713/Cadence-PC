import type { Timestamp } from 'firebase/firestore';
import { getCurrentBcp47Tag, translateStatic } from '../i18n/I18nContext';

export function formatFirebaseTimestamp(ts: Timestamp | null): string {
  if (!ts) return translateStatic('win_just_now');
  try {
    const date = ts.toDate();
    return new Intl.DateTimeFormat(getCurrentBcp47Tag(), {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return translateStatic('win_recent');
  }
}

export function dayDiffFromToday(isoDate: string): number {
  const parts = isoDate.split('-').map((n) => Number.parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return 0;
  const target = new Date(parts[0], parts[1] - 1, parts[2]);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function formatRelativeDayBadge(isoDate: string): string {
  const diff = dayDiffFromToday(isoDate);
  if (diff === 0) return translateStatic('rel_today');
  if (diff === 1) return translateStatic('rel_tomorrow');
  if (diff > 1) return translateStatic('rel_in_days_format', diff);
  if (diff === -1) return translateStatic('win_rel_yesterday');
  return translateStatic('win_rel_days_ago_format', Math.abs(diff));
}
