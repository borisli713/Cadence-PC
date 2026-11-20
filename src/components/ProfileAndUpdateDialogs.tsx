import React, { useEffect, useState } from 'react';
import {
  Bell,
  Download,
  ExternalLink,
  LogOut,
  RefreshCw,
  Save,
  User as UserIcon,
} from 'lucide-react';
import type { UpdateCheckResult, UserProfile } from '../types/cadence';
import { isTauriDesktop, openExternalUrl } from '../utils/tauriBridge';
import { GITHUB_RELEASES_PAGE_URL } from '../utils/updateChecker';
import { ModalShell, StatusChip } from './UiPrimitives';

interface ProfileSettingsDialogProps {
  open: boolean;
  profile: UserProfile;
  appVersion: string;
  updateResult: UpdateCheckResult | null;
  checkingUpdate: boolean;
  onClose: () => void;
  onSavePreferences: (
    displayName: string,
    department: string,
    weeklyHoursTarget: number,
    pushNotificationsEnabled: boolean,
  ) => Promise<void>;
  onCheckForUpdates: () => Promise<void>;
  onOpenUpdateDialog: () => void;
  onSignOut: () => Promise<void>;
}

export function ProfileSettingsDialog({
  open,
  profile,
  appVersion,
  updateResult,
  checkingUpdate,
  onClose,
  onSavePreferences,
  onCheckForUpdates,
  onOpenUpdateDialog,
  onSignOut,
}: ProfileSettingsDialogProps) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [department, setDepartment] = useState(profile.department);
  const [weeklyTarget, setWeeklyTarget] = useState(
    String(profile.weeklyHoursTarget),
  );
  const [pushEnabled, setPushEnabled] = useState(
    profile.pushNotificationsEnabled,
  );
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDisplayName(profile.displayName);
      setDepartment(profile.department);
      setWeeklyTarget(String(profile.weeklyHoursTarget));
      setPushEnabled(profile.pushNotificationsEnabled);
      setErrorMsg(null);
    }
  }, [open, profile]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetNum = Number.parseInt(weeklyTarget, 10);
    if (!displayName.trim()) {
      setErrorMsg('Display name cannot be empty.');
      return;
    }
    if (Number.isNaN(targetNum) || targetNum < 1 || targetNum > 80) {
      setErrorMsg('Weekly hours target must be between 1 and 80.');
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      await onSavePreferences(
        displayName.trim(),
        department.trim() || 'Operations',
        targetNum,
        pushEnabled,
      );
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Profile & App Settings"
      subtitle={`${profile.email} · ${profile.role === 'manager' ? 'Manager' : 'Staff'}`}
      footer={
        <div className="w-full flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onSignOut()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-rose-700 hover:bg-rose-50 text-xs font-semibold transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="profile-settings-form"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : 'Save Changes'}</span>
            </button>
          </div>
        </div>
      }
    >
      <form
        id="profile-settings-form"
        onSubmit={handleSave}
        className="space-y-4"
      >
        {errorMsg && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Display Name
            </label>
            <div className="relative">
              <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={80}
                required
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Department
            </label>
            <input
              type="text"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              maxLength={60}
              required
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-600"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-end">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Weekly Hours Target
            </label>
            <input
              type="number"
              min={1}
              max={80}
              value={weeklyTarget}
              onChange={(e) => setWeeklyTarget(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-tabular text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-600"
            />
          </div>

          <label className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800">
              <Bell className="w-4 h-4 text-blue-600" />
              <span>Desktop Notifications</span>
            </span>
            <input
              type="checkbox"
              checked={pushEnabled}
              onChange={(e) => setPushEnabled(e.target.checked)}
              className="w-4 h-4 rounded accent-blue-600 cursor-pointer"
            />
          </label>
        </div>

        <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-slate-900">
                Application Version
              </div>
              <div className="text-xs text-slate-500 mt-0.5 font-mono-tabular">
                v{appVersion} ·{' '}
                {isTauriDesktop()
                  ? 'Windows Rust Desktop'
                  : 'Web Workspace Preview'}
              </div>
            </div>
            {updateResult?.updateAvailable ? (
              <StatusChip
                label={`v${updateResult.latest.versionName} Available`}
                tone="success"
              />
            ) : (
              <StatusChip label="Up to date" tone="neutral" />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={checkingUpdate}
              onClick={() => onCheckForUpdates()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-800 cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${checkingUpdate ? 'animate-spin' : ''}`}
              />
              <span>
                {checkingUpdate ? 'Checking GitHub...' : 'Check for Updates'}
              </span>
            </button>
            {updateResult?.updateAvailable && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenUpdateDialog();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>View Release v{updateResult.latest.versionName}</span>
              </button>
            )}
          </div>
        </div>
      </form>
    </ModalShell>
  );
}

interface AppUpdateDialogProps {
  open: boolean;
  updateResult: UpdateCheckResult | null;
  onClose: () => void;
}

export function AppUpdateDialog({
  open,
  updateResult,
  onClose,
}: AppUpdateDialogProps) {
  if (!updateResult) return null;
  const { currentVersion, latest, updateAvailable } = updateResult;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={
        updateAvailable
          ? `Windows Update Available: v${latest.versionName}`
          : 'Cadence Windows Is Up to Date'
      }
      subtitle={`Installed Windows v${currentVersion} · Latest Windows release v${latest.versionName}`}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
          >
            Later
          </button>
          <button
            type="button"
            onClick={() =>
              openExternalUrl(
                latest.downloadPageUrl || GITHUB_RELEASES_PAGE_URL,
              )
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>GitHub Releases</span>
          </button>
          {latest.windowsAssetUrl && (
            <button
              type="button"
              onClick={() => {
                if (latest.windowsAssetUrl) {
                  openExternalUrl(latest.windowsAssetUrl);
                }
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>
                Download {latest.windowsAssetName ?? 'Windows Installer'}
              </span>
            </button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs">
          <span className="text-slate-600">Current Windows Version</span>
          <span className="font-mono-tabular font-semibold text-slate-900">
            v{currentVersion}
          </span>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs">
          <span className="text-slate-600">Latest Windows Release</span>
          <span className="font-mono-tabular font-semibold text-blue-700">
            v{latest.versionName}
          </span>
        </div>

        <div>
          <div className="text-xs font-semibold text-slate-700 mb-1.5">
            Release Notes
          </div>
          <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-700 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
            {latest.releaseNotes || 'Maintenance update and reliability fixes.'}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
