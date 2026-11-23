import React from 'react';
import { AlertTriangle, LogOut, RefreshCw } from 'lucide-react';
import { unwrapFirestoreErrorMessage } from '../firebase';
import { useI18n } from '../i18n/I18nContext';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  onSignOut?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

function ErrorFallbackView({
  message,
  onRetry,
  onSignOut,
}: {
  message: string;
  onRetry: () => void;
  onSignOut?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="min-h-dvh bg-slate-50 flex flex-col items-center px-4 py-6 sm:p-6 overflow-y-auto cadence-scroll">
      <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-sm space-y-4 my-auto">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900">
              {t('win_err_boundary_title')}
            </h2>
            <p className="text-sm text-slate-600 mt-1 break-words">
              {message || t('win_err_boundary_fallback')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-4 h-4" />
            <span>{t('win_retry_workspace')}</span>
          </button>
          {onSignOut && (
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <LogOut className="w-4 h-4" />
              <span>{t('sign_out')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: unwrapFirestoreErrorMessage(error),
    };
  }

  private handleRetry = () => {
    this.setState({ hasError: false, message: '' });
  };

  override render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <ErrorFallbackView
        message={this.state.message}
        onRetry={this.handleRetry}
        onSignOut={this.props.onSignOut}
      />
    );
  }
}
