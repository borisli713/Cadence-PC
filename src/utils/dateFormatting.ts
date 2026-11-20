import type { Timestamp } from 'firebase/firestore';

export function formatFirebaseTimestamp(ts: Timestamp | null): string {
  if (!ts) return 'Just now';
  try {
    const date = ts.toDate();
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return 'Recent';
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
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff > 1) return `In ${diff}d`;
  if (diff === -1) return 'Yesterday';
  return `${Math.abs(diff)}d ago`;
}
