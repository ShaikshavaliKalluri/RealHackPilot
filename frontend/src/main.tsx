import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MsalProvider } from '@azure/msal-react';
import App from './App';
import { msalInstance } from './auth';
import './index.css';

// Initialise MSAL before rendering. handleRedirectPromise() is required
// to complete the auth code flow after Azure AD redirects back.
msalInstance.initialize().then(() => msalInstance.handleRedirectPromise()).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MsalProvider instance={msalInstance}>
        <App />
      </MsalProvider>
    </StrictMode>,
  );
});
