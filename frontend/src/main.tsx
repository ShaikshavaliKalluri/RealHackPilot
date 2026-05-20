import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MsalProvider } from '@azure/msal-react';
import App from './App';
import { msalInstance } from './auth';
import './index.css';

/**
 * Initialise MSAL, process any pending redirect, then render the app.
 *
 * The promise chain is wrapped in try/catch so that an MSAL failure
 * (network blip, malformed redirect, etc.) never leaves the page blank —
 * the app still renders, the LoginPage shows, and the user can retry.
 * We also surface the error to the console so DevTools can show it.
 */
async function bootstrap() {
  try {
    await msalInstance.initialize();
    const result = await msalInstance.handleRedirectPromise();
    if (result?.account) {
      msalInstance.setActiveAccount(result.account);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('MSAL bootstrap failed:', e);
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MsalProvider instance={msalInstance}>
        <App />
      </MsalProvider>
    </StrictMode>,
  );
}

bootstrap();
