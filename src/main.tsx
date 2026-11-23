import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary';
import { I18nProvider } from './i18n/I18nContext';
import { signOutUser } from './services/authService';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ErrorBoundary onSignOut={() => void signOutUser()}>
        <App />
      </ErrorBoundary>
    </I18nProvider>
  </StrictMode>,
);
