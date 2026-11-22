import { useState } from 'react';
import { Calendar, Check } from 'lucide-react';
import { isTauriDesktop } from '../utils/tauriBridge';

export type LoadingStage = 'initializing' | 'syncing';

interface LoadingScreenProps {
  stage: LoadingStage;
  appVersion: string;
  userEmail?: string | null;
}

interface StepItem {
  label: string;
  state: 'done' | 'active' | 'pending';
}

export function LoadingScreen({
  stage,
  appVersion,
  userEmail,
}: LoadingScreenProps) {
  const [iconError, setIconError] = useState(false);
  const desktop = isTauriDesktop();

  const heading =
    stage === 'initializing'
      ? 'Preparing Cadence workspace'
      : 'Syncing verified workspace';

  const description =
    stage === 'initializing'
      ? 'Checking your verified session and local workspace preferences.'
      : 'Connecting your team roster, active shifts, and live updates.';

  const steps: StepItem[] = [
    {
      label: 'Session & account verification',
      state: stage === 'syncing' ? 'done' : 'active',
    },
    {
      label: 'Workspace profile & team roster',
      state: stage === 'syncing' ? 'active' : 'pending',
    },
    {
      label: 'Schedule streams & notifications',
      state: 'pending',
    },
  ];

  return (
    <div
      className="min-h-dvh w-full cadence-launch-surface flex flex-col items-center px-4 py-6 sm:px-6 sm:py-10 overflow-y-auto cadence-scroll"
      role="status"
      aria-live="polite"
      aria-label={heading}
    >
      <div className="w-full max-w-md space-y-6 my-auto">
        <div className="flex items-center gap-3.5">
          {iconError ? (
            <div className="w-11 h-11 rounded-xl border border-slate-200 bg-white shadow-xs flex items-center justify-center text-blue-600 shrink-0">
              <Calendar className="w-5 h-5" />
            </div>
          ) : (
            <img
              src="/cadence-icon.png"
              alt="Cadence logo"
              onError={() => setIconError(true)}
              className="w-11 h-11 rounded-xl border border-slate-200 bg-white shadow-xs object-cover shrink-0"
            />
          )}
          <div className="min-w-0">
            <div className="text-xl font-bold text-slate-900 leading-tight tracking-tight">
              Cadence
            </div>
            <div className="text-xs text-slate-500 truncate">
              Verified shift reporting &amp; fair scheduling
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-7 space-y-6">
          <div className="space-y-1.5">
            <h1 className="text-lg font-bold text-slate-900 leading-snug">
              {heading}
            </h1>
            <p className="text-xs text-slate-600 leading-relaxed">
              {description}
            </p>
            {userEmail && (
              <p className="text-xs font-medium text-slate-700 pt-1 truncate">
                {userEmail}
              </p>
            )}
          </div>

          <div
            className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden"
            aria-hidden="true"
          >
            <div className="h-full w-2/5 rounded-full bg-blue-600 cadence-progress-bar" />
          </div>

          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {steps.map((step) => (
              <div
                key={step.label}
                className="py-3 first:pt-3.5 last:pb-0 flex items-center gap-3"
              >
                {step.state === 'done' && (
                  <span className="w-5 h-5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center shrink-0">
                    <Check className="w-3 h-3 stroke-[2.5]" />
                  </span>
                )}
                {step.state === 'active' && (
                  <span
                    className="w-5 h-5 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin shrink-0"
                    aria-hidden="true"
                  />
                )}
                {step.state === 'pending' && (
                  <span
                    className="w-5 h-5 rounded-full border border-slate-200 bg-slate-50 shrink-0"
                    aria-hidden="true"
                  />
                )}

                <span
                  className={`text-xs ${
                    step.state === 'active'
                      ? 'font-semibold text-slate-900'
                      : step.state === 'done'
                        ? 'font-medium text-slate-700'
                        : 'font-normal text-slate-400'
                  }`}
                >
                  {step.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
          <span>
            {desktop ? 'Cadence Desktop · Windows' : 'Cadence Workspace'}
          </span>
          <span className="font-mono-tabular">v{appVersion}</span>
        </div>
      </div>
    </div>
  );
}
