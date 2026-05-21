/**
 * MSAL.js configuration for RealHack Pilot.
 *
 * The Entra app reg (4c55dc04-7f4b-4765-8ae5-bc69f52ab98e) has
 * Assignment Required = Yes and only the AGAa-RealHack-Pilot-Users
 * security group assigned, so Entra refuses to issue tokens to anyone
 * outside that group at sign-in time. We just have to verify the token
 * is valid for our app on the backend; the group gate is handled by Entra.
 *
 * Production redirect URI: https://realhack.realpage.com (must be added as a
 * SPA platform redirect URI on the app reg before sign-in works).
 */
import { PublicClientApplication, type Configuration } from '@azure/msal-browser';

const msalConfig: Configuration = {
  auth: {
    clientId: '4c55dc04-7f4b-4765-8ae5-bc69f52ab98e',
    authority: 'https://login.microsoftonline.com/2c94bed6-d675-4d3d-a53b-7b461fd6acc2',
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
};

export const msalInstance = new PublicClientApplication(msalConfig);

// Scopes we need at sign-in time. User.Read lets us call Graph /me to fetch
// jobTitle/department for the header badge. The Mail.Send / Channel.Create
// etc. scopes used by the CLIs are NOT requested here — those are CLI-only.
export const loginRequest = {
  scopes: ['User.Read'],
};

/**
 * Get a bearer token for the signed-in user — used in the Authorization
 * header on every call to our backend API.
 *
 * Returns the ID TOKEN (not the access token) because our backend validates
 * audience = our client_id, and only the ID token has our client_id as its
 * audience. The access token returned for the User.Read scope has
 * Microsoft Graph as its audience and would fail backend validation.
 *
 * ID tokens have a ~1 hour lifetime. When `forceRefresh` is true we use
 * ssoSilent to round-trip Microsoft via a hidden iframe and get a fresh
 * ID token — important after a 401-expired response from the backend.
 *
 * (If/when we expose a custom API scope like `api://<clientId>/access`,
 * we can switch to a properly-scoped access token. Until then ID-token-as-
 * auth is fine for an internal app and is the simplest path.)
 */
export async function getAccessToken(opts: { forceRefresh?: boolean } = {}): Promise<string | null> {
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) return null;
  const account = accounts[0];
  // First try acquireTokenSilent with forceRefresh if requested. This
  // sometimes — but not always — yields a fresh ID token.
  try {
    const result = await msalInstance.acquireTokenSilent({
      scopes: loginRequest.scopes,
      account,
      forceRefresh: opts.forceRefresh ?? false,
    });
    if (opts.forceRefresh) {
      // forceRefresh requested but acquireTokenSilent might still hand
      // back the cached ID token. Fall through to ssoSilent which always
      // round-trips Microsoft and returns a fresh idToken.
      try {
        const sso = await msalInstance.ssoSilent({
          scopes: loginRequest.scopes,
          account,
          loginHint: account.username,
        });
        return sso.idToken || result.idToken;
      } catch {
        return result.idToken;
      }
    }
    return result.idToken;
  } catch {
    // Silent acquire failed entirely — caller will handle via redirect.
    return null;
  }
}
