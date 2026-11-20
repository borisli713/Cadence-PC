import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary';
import { signOutUser } from './services/authService';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary onSignOut={() => void signOutUser()}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
