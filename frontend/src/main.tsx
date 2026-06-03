import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MsalProvider } from '@azure/msal-react';
import App from './App';
import { msalInstance } from './auth';
import { PublicTeamPage } from './components/PublicTeamPage';
import { JudgingCardsPrint } from './components/JudgingCardsPrint';
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
  const pathname = window.location.pathname;
  // Public, no-auth route used by the QR-code judging-walk: render directly,
  // skip MSAL entirely so judges can scan a printed code without signing in.
  if (/^\/team\/\d+\/?$/.test(pathname)) {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <PublicTeamPage />
      </StrictMode>,
    );
    return;
  }

  try {
    await msalInstance.initialize();
    const result = await msalInstance.handleRedirectPromise();
    if (result?.account) {
      msalInstance.setActiveAccount(result.account);
    }
  } catch (e: unknown) {
    // eslint-disable-next-line no-console
    console.error('MSAL bootstrap failed:', e);
    // Stash the error message so LoginPage can show a friendly panel
    // (e.g. AADSTS50105 = user not assigned to app).
    const message = e instanceof Error ? e.message : String(e);
    try {
      sessionStorage.setItem('msal:bootstrap_error', message);
    } catch {
      // sessionStorage unavailable (private mode etc) — silently swallow
    }
  }

  // /judging-cards is auth-required (organizers print + distribute) but
  // it's a fully separate page, not part of the main App. Render inside
  // MsalProvider so the auth wrapper inside JudgingCardsPrint works.
  const isJudgingCardsPath = pathname === '/judging-cards' || pathname === '/judging-cards/';
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MsalProvider instance={msalInstance}>
        {isJudgingCardsPath ? <JudgingCardsPrint /> : <App />}
      </MsalProvider>
    </StrictMode>,
  );
}

bootstrap();
