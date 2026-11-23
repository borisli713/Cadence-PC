import type { RemoteReleaseInfo, UpdateCheckResult } from '../types/cadence';
import {
  getDesktopAppVersion,
  invokeCheckGitHubUpdate,
  isTauriDesktop,
} from './tauriBridge';
import { translateStatic } from '../i18n/I18nContext';

const ENV_GITHUB_REPO = (
  import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  }
).env?.VITE_GITHUB_REPO;

const GITHUB_REPO = ENV_GITHUB_REPO?.trim() || 'borisli713/Cadence-PC';

export const GITHUB_RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`;
export const GITHUB_RELEASES_PAGE_URL = `https://github.com/${GITHUB_REPO}/releases`;

interface RawGitHubRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: Array<{ name?: string; browser_download_url?: string }>;
}

function normalizeTagVersion(raw: string): string {
  return raw
    .trim()
    .replace(/^(windows-v?|win-v?|v)/i, '')
    .trim();
}

function parseSemver(raw: string): [number, number, number] {
  const cleaned = normalizeTagVersion(raw);
  const parts = cleaned.split(/[.-]/);
  return [
    Number.parseInt(parts[0] ?? '0', 10) || 0,
    Number.parseInt(parts[1] ?? '0', 10) || 0,
    Number.parseInt(parts[2] ?? '0', 10) || 0,
  ];
}

export function isNewerVersion(remote: string, current: string): boolean {
  const [rMaj, rMin, rPat] = parseSemver(remote);
  const [cMaj, cMin, cPat] = parseSemver(current);
  if (rMaj !== cMaj) return rMaj > cMaj;
  if (rMin !== cMin) return rMin > cMin;
  return rPat > cPat;
}

function isWindowsRelease(rel: RawGitHubRelease): boolean {
  if (rel.draft || rel.prerelease) return false;
  const tag = (rel.tag_name ?? rel.name ?? '').trim().toLowerCase();
  const assets = Array.isArray(rel.assets) ? rel.assets : [];
  const hasWinAsset = assets.some((a) => {
    const n = (a.name ?? '').toLowerCase();
    return n.endsWith('.exe') || n.endsWith('.msi');
  });
  const hasApkOnly =
    !hasWinAsset &&
    assets.some((a) => (a.name ?? '').toLowerCase().endsWith('.apk'));
  if (hasApkOnly) return false;
  return tag.startsWith('windows-') || tag.startsWith('win-') || hasWinAsset;
}

export async function checkForGitHubUpdate(): Promise<UpdateCheckResult | null> {
  if (isTauriDesktop()) {
    const desktopResult = await invokeCheckGitHubUpdate();
    if (desktopResult) return desktopResult;
  }

  const currentVersion = await getDesktopAppVersion();
  try {
    const response = await fetch(GITHUB_RELEASES_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return null;
    const allReleases = (await response.json()) as RawGitHubRelease[];
    const winReleases = (Array.isArray(allReleases) ? allReleases : []).filter(
      isWindowsRelease,
    );

    if (winReleases.length === 0) {
      return {
        currentVersion,
        latest: {
          versionName: currentVersion,
          releaseNotes: translateStatic('win_release_notes_fallback'),
          downloadPageUrl: GITHUB_RELEASES_PAGE_URL,
          windowsAssetUrl: null,
          windowsAssetName: null,
        },
        updateAvailable: false,
      };
    }

    winReleases.sort((a, b) => {
      const va = normalizeTagVersion(a.tag_name ?? a.name ?? '');
      const vb = normalizeTagVersion(b.tag_name ?? b.name ?? '');
      if (isNewerVersion(va, vb)) return -1;
      if (isNewerVersion(vb, va)) return 1;
      return 0;
    });

    const json = winReleases[0];
    const versionName =
      normalizeTagVersion(json.tag_name ?? json.name ?? '') || currentVersion;
    const assets = Array.isArray(json.assets) ? json.assets : [];
    const winAsset =
      assets.find((a) => (a.name ?? '').toLowerCase().endsWith('-setup.exe')) ??
      assets.find((a) => (a.name ?? '').toLowerCase().endsWith('.msi')) ??
      assets.find((a) => (a.name ?? '').toLowerCase().endsWith('.exe'));

    const latest: RemoteReleaseInfo = {
      versionName,
      releaseNotes: (json.body ?? '').trim(),
      downloadPageUrl: json.html_url ?? GITHUB_RELEASES_PAGE_URL,
      windowsAssetUrl: winAsset?.browser_download_url ?? null,
      windowsAssetName: winAsset?.name ?? null,
    };

    return {
      currentVersion,
      latest,
      updateAvailable: isNewerVersion(versionName, currentVersion),
    };
  } catch {
    return null;
  }
}
