import type { RemoteReleaseInfo, UpdateCheckResult } from '../types/cadence';
import {
  getDesktopAppVersion,
  invokeCheckGitHubUpdate,
  isTauriDesktop,
} from './tauriBridge';

export const GITHUB_RELEASES_API_URL =
  'https://api.github.com/repos/borisli713/Cadence-Mobile/releases/latest';
export const GITHUB_RELEASES_PAGE_URL =
  'https://github.com/borisli713/Cadence-Mobile/releases';

function parseSemver(raw: string): [number, number, number] {
  const cleaned = raw.trim().replace(/^v/i, '');
  const parts = cleaned.split(/[.-]/);
  const major = Number.parseInt(parts[0] ?? '0', 10) || 0;
  const minor = Number.parseInt(parts[1] ?? '0', 10) || 0;
  const patch = Number.parseInt(parts[2] ?? '0', 10) || 0;
  return [major, minor, patch];
}

export function isNewerVersion(remote: string, current: string): boolean {
  const [rMaj, rMin, rPat] = parseSemver(remote);
  const [cMaj, cMin, cPat] = parseSemver(current);
  if (rMaj !== cMaj) return rMaj > cMaj;
  if (rMin !== cMin) return rMin > cMin;
  return rPat > cPat;
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
    const json = (await response.json()) as {
      tag_name?: string;
      name?: string;
      body?: string;
      html_url?: string;
      assets?: Array<{ name?: string; browser_download_url?: string }>;
    };

    const rawTag = (json.tag_name ?? json.name ?? '').trim();
    const versionName = rawTag.replace(/^v/i, '') || currentVersion;
    const assets = Array.isArray(json.assets) ? json.assets : [];
    const winAsset = assets.find((a) => {
      const n = (a.name ?? '').toLowerCase();
      return n.endsWith('.exe') || n.endsWith('.msi');
    });

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
