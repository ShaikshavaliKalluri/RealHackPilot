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
import { InteractionRequiredAuthError, PublicClientApplication, type Configuration } from '@azure/msal-browser';

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
// jobTitle/department for the header badge. Mail.Send lets the dashboard
// call Graph /me/sendMail directly for branded HTML emails (with the
// CID-inlined RealHack wordmark). NOTE: Mail.Send only authorises sending
// as the signed-in user — sending AS a shared mailbox would require
// Mail.Send.Shared, which our tenant won't grant for this app, so the
// dashboard sends from the organizer personally instead.
export const loginRequest = {
  scopes: ['User.Read', 'Mail.Send'],
};

// Scope set we ask for when sending an email from the dashboard. Same as
// login, but kept as a named constant so callers can reason about it.
const GRAPH_SEND_SCOPES = ['Mail.Send'];

// Scope needed to create a draft message (no send). Used by the
// 'Open in Outlook' branded flow — we POST a draft to Graph then open
// the deeplink so Outlook web shows the full HTML/logo design.
const GRAPH_DRAFT_SCOPES = ['Mail.ReadWrite'];

export async function getGraphDraftToken(): Promise<string> {
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) throw new Error('Not signed in.');
  const account = accounts[0];
  try {
    const result = await msalInstance.acquireTokenSilent({ scopes: GRAPH_DRAFT_SCOPES, account });
    return result.accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      const result = await msalInstance.acquireTokenPopup({ scopes: GRAPH_DRAFT_SCOPES, account });
      return result.accessToken;
    }
    throw e;
  }
}

// Scopes needed to create a private Teams channel + add members.
//
// TeamMember.ReadWrite.All would let the app auto-add channel members to
// the parent Team first (Teams requires private-channel members to also
// be in the parent Team). But that scope needs tenant-admin consent which
// isn't granted in our tenant. Workaround: organizers pre-add everyone
// to the parent Team manually via the Teams UI, and the backend silently
// tolerates the missing permission when it tries to auto-add.
const GRAPH_TEAMS_CHANNEL_SCOPES = [
  'Channel.Create',
  'ChannelMember.ReadWrite.All',
  'User.ReadBasic.All',
  'Team.ReadBasic.All',
];

/**
 * Acquire a Graph access token with the scopes needed to create a private
 * Teams channel + add members. Used by the per-team 'Create Teams channel'
 * button. Same pattern as getGraphSendToken — silent first, fall back to
 * interactive consent.
 */
export async function getGraphTeamsToken(): Promise<string> {
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) {
    throw new Error('Not signed in — cannot create Teams channel.');
  }
  const account = accounts[0];
  try {
    const result = await msalInstance.acquireTokenSilent({
      scopes: GRAPH_TEAMS_CHANNEL_SCOPES,
      account,
    });
    return result.accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      // First-time consent — opens a popup for the user to grant the new scopes.
      const result = await msalInstance.acquireTokenPopup({
        scopes: GRAPH_TEAMS_CHANNEL_SCOPES,
        account,
      });
      return result.accessToken;
    }
    throw e;
  }
}

/**
 * Acquire a Graph-scoped ACCESS TOKEN (audience = graph.microsoft.com)
 * for the signed-in user. Different from getAccessToken() above — that
 * one returns our app's ID token for backend auth. This one is the token
 * the browser uses to POST to graph.microsoft.com/.../sendMail.
 *
 * If the silent acquire fails because Mail.Send hasn't been consented
 * yet (e.g. an existing session that pre-dates this feature), we throw
 * InteractionRequiredAuthError back up so the caller can decide whether
 * to redirect the user through a consent flow.
 */
export async function getGraphSendToken(): Promise<string> {
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) {
    throw new Error('Not signed in — cannot send via Graph.');
  }
  const account = accounts[0];
  try {
    const result = await msalInstance.acquireTokenSilent({
      scopes: GRAPH_SEND_SCOPES,
      account,
    });
    return result.accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      // Consent for Mail.Send hasn't been granted yet in this session.
      // Redirect through MS to consent, then come back — the post-redirect
      // promise handler in main.tsx will resolve the result, but the
      // current send will be lost. Caller should surface a clear message.
      await msalInstance.acquireTokenRedirect({ scopes: GRAPH_SEND_SCOPES, account });
      // acquireTokenRedirect navigates away; this line is unreachable.
      throw new Error('Microsoft consent required — redirecting…');
    }
    throw e;
  }
}

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
