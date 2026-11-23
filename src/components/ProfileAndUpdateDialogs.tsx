import React, { useEffect, useState } from 'react';
import {
  Bell,
  Download,
  ExternalLink,
  Globe,
  LogOut,
  RefreshCw,
  Save,
  User as UserIcon,
} from 'lucide-react';
import type { UpdateCheckResult, UserProfile } from '../types/cadence';
import { isTauriDesktop, openExternalUrl } from '../utils/tauriBridge';
import { GITHUB_RELEASES_PAGE_URL } from '../utils/updateChecker';
import { LanguagePreference, useI18n } from '../i18n/I18nContext';
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
  const { preference, languages, setLanguagePreference, t } = useI18n();
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
      setErrorMsg(t('win_err_empty_display_name'));
      return;
    }
    if (Number.isNaN(targetNum) || targetNum < 1 || targetNum > 80) {
      setErrorMsg(t('win_err_weekly_target_range'));
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      await onSavePreferences(
        displayName.trim(),
        department.trim() || t('default_dept_operations'),
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

  const roleLabel =
    profile.role === 'manager' ? t('role_manager') : t('role_staff');

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={t('profile_settings')}
      subtitle={t('email_role_format', profile.email, roleLabel)}
      footer={
        <div className="w-full flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onSignOut()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-rose-700 hover:bg-rose-50 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span>{t('sign_out')}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer whitespace-nowrap shrink-0"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              form="profile-settings-form"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              <Save className="w-3.5 h-3.5 shrink-0" />
              <span>{saving ? t('win_saving') : t('save')}</span>
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
              {t('display_name_label')}
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
              {t('department_label')}
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
              {t('weekly_hours_target_label')}
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
              <Bell className="w-4 h-4 text-blue-600 shrink-0" />
              <span>{t('enable_push_alerts')}</span>
            </span>
            <input
              type="checkbox"
              checked={pushEnabled}
              onChange={(e) => setPushEnabled(e.target.checked)}
              className="w-4 h-4 rounded accent-blue-600 cursor-pointer"
            />
          </label>
        </div>

        <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <label
                htmlFor="cadence-lang-select"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900"
              >
                <Globe className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span>{t('language_label')}</span>
              </label>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                {t('language_picker_subtitle')}
              </p>
            </div>
          </div>

          <select
            id="cadence-lang-select"
            value={preference}
            onChange={(e) =>
              void setLanguagePreference(e.target.value as LanguagePreference)
            }
            className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-600 cursor-pointer"
          >
            {languages.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.code === 'system'
                  ? t(opt.labelKey)
                  : opt.nativeLabel === t(opt.labelKey)
                    ? opt.nativeLabel
                    : `${opt.nativeLabel} — ${t(opt.labelKey)}`}
              </option>
            ))}
          </select>
        </div>

        <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-slate-900">
                {t('win_current_win_ver')}
              </div>
              <div className="text-xs text-slate-500 mt-0.5 font-mono-tabular">
                v{appVersion} ·{' '}
                {isTauriDesktop()
                  ? t('win_windows_rust_desktop')
                  : t('win_web_workspace_preview')}
              </div>
            </div>
            {updateResult?.updateAvailable ? (
              <StatusChip
                label={t('win_version_avail_chip', updateResult.latest.versionName)}
                tone="success"
              />
            ) : (
              <StatusChip label={t('win_up_to_date')} tone="neutral" />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={checkingUpdate}
              onClick={() => onCheckForUpdates()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-800 cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 shrink-0 ${checkingUpdate ? 'animate-spin' : ''}`}
              />
              <span>
                {checkingUpdate
                  ? t('checking_for_updates')
                  : t('check_for_updates')}
              </span>
            </button>
            {updateResult?.updateAvailable && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenUpdateDialog();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {t('win_view_release_format', updateResult.latest.versionName)}
                </span>
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
  const { t } = useI18n();
  if (!updateResult) return null;
  const { currentVersion, latest, updateAvailable } = updateResult;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={
        updateAvailable
          ? t('win_update_avail_title_format', latest.versionName)
          : t('win_update_uptodate_title')
      }
      subtitle={t('win_update_subtitle_format', currentVersion, latest.versionName)}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer whitespace-nowrap shrink-0"
          >
            {t('update_later')}
          </button>
          <button
            type="button"
            onClick={() =>
              openExternalUrl(
                latest.downloadPageUrl || GITHUB_RELEASES_PAGE_URL,
              )
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer whitespace-nowrap shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            <span>{t('update_open_github')}</span>
          </button>
          {latest.windowsAssetUrl && (
            <button
              type="button"
              onClick={() => {
                if (latest.windowsAssetUrl) {
                  openExternalUrl(latest.windowsAssetUrl);
                }
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span>
                {t(
                  'win_download_installer_format',
                  latest.windowsAssetName ?? t('win_win_installer'),
                )}
              </span>
            </button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs">
          <span className="text-slate-600">{t('win_current_win_ver')}</span>
          <span className="font-mono-tabular font-semibold text-slate-900">
            v{currentVersion}
          </span>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs">
          <span className="text-slate-600">{t('win_latest_win_rel')}</span>
          <span className="font-mono-tabular font-semibold text-blue-700">
            v{latest.versionName}
          </span>
        </div>

        <div>
          <div className="text-xs font-semibold text-slate-700 mb-1.5">
            {t('win_release_notes')}
          </div>
          <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-700 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
            {latest.releaseNotes || t('win_release_notes_fallback')}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
