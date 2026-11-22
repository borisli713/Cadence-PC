import React, { useMemo, useState } from 'react';
import {
  Database,
  Download,
  FileText,
  Shield,
  ShieldOff,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  computeScheduledHoursByUid,
  formatHours,
} from '../domain/fairnessEngine';
import {
  StaffDirectoryEntry,
  UserRole,
  WorkspaceUiData,
} from '../types/cadence';
import {
  invokeSavePayrollSummary,
  invokeSaveTeamHoursCsv,
  isTauriDesktop,
} from '../utils/tauriBridge';
import { StaffHoursBalanceChart } from '../components/StaffHoursBalanceChart';
import {
  EmptyStatePanel,
  ModalShell,
  StatusChip,
  SurfaceCard,
} from '../components/UiPrimitives';

interface TeamHoursScreenProps {
  data: WorkspaceUiData;
  onAddRosterStaff: (
    displayName: string,
    department: string,
    weeklyHoursTarget: number,
    role: UserRole,
  ) => Promise<void>;
  onToggleManagerRole: (
    member: StaffDirectoryEntry,
    grantManager: boolean,
  ) => Promise<void>;
  onSeedSampleData: () => Promise<void>;
  onShowFeedback: (msg: string) => void;
}

export function TeamHoursScreen({
  data,
  onAddRosterStaff,
  onToggleManagerRole,
  onSeedSampleData,
  onShowFeedback,
}: TeamHoursScreenProps) {
  const isManager = data.profile.role === UserRole.MANAGER;
  const scheduledByUid = useMemo(
    () => computeScheduledHoursByUid(data.shifts),
    [data.shifts],
  );

  const sortedStaff = useMemo(() => {
    return [...data.staffDirectory]
      .map((member) => {
        const scheduled =
          scheduledByUid[member.uid] ?? member.scheduledHoursThisWeek;
        const target = Math.max(1, member.weeklyHoursTarget);
        const ratio = (member.totalHoursWorked + scheduled) / target;
        return { member, scheduled, target, ratio };
      })
      .sort((a, b) => a.ratio - b.ratio);
  }, [data.staffDirectory, scheduledByUid]);

  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('Operations');
  const [targetHours, setTargetHours] = useState('40');
  const [role, setRole] = useState<UserRole>(UserRole.STAFF);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [togglingUid, setTogglingUid] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleCreateMember = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedTarget = Number.parseInt(targetHours, 10);
    if (!name.trim()) {
      setErrorMsg('Enter staff member display name.');
      return;
    }
    if (Number.isNaN(parsedTarget) || parsedTarget < 1 || parsedTarget > 80) {
      setErrorMsg('Weekly target must be between 1 and 80.');
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      await onAddRosterStaff(
        name.trim(),
        department.trim() || 'Operations',
        parsedTarget,
        role,
      );
      setAddOpen(false);
      setName('');
      setDepartment('Operations');
      setTargetHours('40');
      setRole(UserRole.STAFF);
      onShowFeedback('Added staff member to team roster.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 @xl:space-y-6">
      <div className="flex flex-col @3xl:flex-row @3xl:items-start @3xl:justify-between gap-3 @xl:gap-4">
        <div className="min-w-0">
          <h1 className="text-xl @xl:text-2xl font-bold text-slate-900">Team Hours</h1>
          <p className="text-xs @xl:text-sm text-slate-500 mt-1">
            Fairness utilization ledger sorted lowest-ratio first, roster roles, and sample scenario seeding
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {data.staffDirectory.length > 0 && (
            <button
              type="button"
              onClick={async () => {
                const savedPath = await invokeSaveTeamHoursCsv(
                  data.staffDirectory,
                  data.shifts,
                );
                if (typeof savedPath === 'string') {
                  onShowFeedback(`Exported team hours CSV to ${savedPath}`);
                } else if (savedPath === undefined) {
                  const csv = [
                    'Name,Department,Role,LoggedHours,ScheduledHours,TargetHours,Utilization%',
                    ...sortedStaff.map(({ member, scheduled, target, ratio }) =>
                      [
                        `"${member.displayName.replace(/"/g, '""')}"`,
                        `"${member.department.replace(/"/g, '""')}"`,
                        member.role,
                        member.totalHoursWorked.toFixed(2),
                        scheduled.toFixed(2),
                        target.toFixed(1),
                        `${Math.round(ratio * 100)}%`,
                      ].join(','),
                    ),
                  ].join('\n');
                  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'cadence-team-hours.csv';
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                  onShowFeedback('Exported team hours CSV.');
                }
              }}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download className="w-4 h-4 text-slate-600" />
              <span>Export CSV</span>
            </button>
          )}
          {data.staffDirectory.length > 0 && isTauriDesktop() && (
            <button
              type="button"
              onClick={async () => {
                const savedPath = await invokeSavePayrollSummary('Active Workspace');
                if (typeof savedPath === 'string') {
                  onShowFeedback(`Saved payroll HTML summary to ${savedPath}`);
                }
              }}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer whitespace-nowrap shrink-0"
            >
              <FileText className="w-4 h-4 text-slate-600" />
              <span>Export HTML</span>
            </button>
          )}
          {isManager && (
            <>
              <button
                type="button"
                disabled={seeding}
                onClick={async () => {
                  setSeeding(true);
                  try {
                    await onSeedSampleData();
                    onShowFeedback(
                      'Loaded sample overlaps, pending requests, shift report, and time off.',
                    );
                  } finally {
                    setSeeding(false);
                  }
                }}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-60 text-xs font-semibold text-slate-800 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Database className="w-4 h-4 text-slate-600" />
                <span>
                  {seeding ? 'Seeding...' : 'Load Sample Overlaps & Requests'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setAddOpen(true);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
              >
                <UserPlus className="w-4 h-4" />
                <span>Add Roster Staff</span>
              </button>
            </>
          )}
        </div>
      </div>

      <StaffHoursBalanceChart
        staffDirectory={data.staffDirectory}
        shifts={data.shifts}
        rustRows={data.rustInsights?.staffChart}
      />

      {sortedStaff.length === 0 ? (
        <EmptyStatePanel
          icon={<Users className="w-5 h-5" />}
          title="No team members in directory yet"
          subtitle="Managers can add roster staff or load sample overlaps to test fairness scheduling."
        />
      ) : (
        <div className="grid grid-cols-1 @2xl:grid-cols-2 @6xl:grid-cols-3 gap-4">
          {sortedStaff.map(({ member, scheduled, target, ratio }) => {
            const pct = Math.round(ratio * 100);
            const canToggleRole =
              isManager &&
              !member.isSampleRoster &&
              !member.uid.startsWith('roster_') &&
              member.uid !== data.profile.uid;

            return (
              <SurfaceCard key={member.uid} className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-900 truncate">
                        {member.displayName}
                      </h3>
                      {member.uid === data.profile.uid && (
                        <StatusChip label="You" tone="info" />
                      )}
                      {member.isSampleRoster && (
                        <StatusChip label="Sample" tone="neutral" />
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {member.department} · Target {target}h/wk
                    </p>
                  </div>

                  <StatusChip
                    label={
                      member.role === UserRole.MANAGER ? 'Manager' : 'Staff'
                    }
                    tone={
                      member.role === UserRole.MANAGER ? 'violet' : 'neutral'
                    }
                  />
                </div>

                <div className="grid grid-cols-3 gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                  <div>
                    <div className="text-[11px] text-slate-500">Logged</div>
                    <div className="font-mono-tabular font-semibold text-emerald-700">
                      {formatHours(member.totalHoursWorked)}h
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Scheduled</div>
                    <div className="font-mono-tabular font-semibold text-blue-700">
                      {formatHours(scheduled)}h
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Utilization</div>
                    <div className="font-mono-tabular font-semibold text-slate-900">
                      {pct}%
                    </div>
                  </div>
                </div>

                {canToggleRole && (
                  <div className="pt-1 flex justify-end">
                    <button
                      type="button"
                      disabled={togglingUid === member.uid}
                      onClick={async () => {
                        setTogglingUid(member.uid);
                        try {
                          const grant = member.role !== UserRole.MANAGER;
                          await onToggleManagerRole(member, grant);
                          onShowFeedback(
                            `${
                              grant ? 'Promoted' : 'Changed'
                            } ${member.displayName} to ${
                              grant ? 'Manager' : 'Staff'
                            }.`,
                          );
                        } finally {
                          setTogglingUid(null);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-60 text-xs font-semibold text-slate-800 cursor-pointer"
                    >
                      {member.role === UserRole.MANAGER ? (
                        <>
                          <ShieldOff className="w-3.5 h-3.5 text-slate-600" />
                          <span>Set Role to Staff</span>
                        </>
                      ) : (
                        <>
                          <Shield className="w-3.5 h-3.5 text-violet-600" />
                          <span>Promote to Manager</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </SurfaceCard>
            );
          })}
        </div>
      )}

      {/* Add Roster Staff Modal */}
      <ModalShell
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add Roster Staff Member"
        subtitle="Create a team roster entry for shift planning and fairness tracking"
        footer={
          <>
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="add-roster-form"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
            >
              {saving ? 'Adding...' : 'Add Member'}
            </button>
          </>
        }
      >
        <form
          id="add-roster-form"
          onSubmit={handleCreateMember}
          className="space-y-3.5"
        >
          {errorMsg && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
              {errorMsg}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Full Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex Rivera"
              maxLength={80}
              required
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Target Hours/Wk
              </label>
              <input
                type="number"
                min={1}
                max={80}
                value={targetHours}
                onChange={(e) => setTargetHours(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-tabular text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Role
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
              >
                <option value={UserRole.STAFF}>Staff</option>
                <option value={UserRole.MANAGER}>Manager</option>
              </select>
            </div>
          </div>
        </form>
      </ModalShell>
    </div>
  );
}
