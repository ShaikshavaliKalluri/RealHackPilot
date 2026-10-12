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
import { CacheLookupPolicy, InteractionRequiredAuthError, PublicClientApplication, type AccountInfo, type Configuration } from '@azure/msal-browser';

const msalConfig: Configuration = {
  auth: {
    clientId: '4c55dc04-7f4b-4765-8ae5-bc69f52ab98e',
    authority: 'https://login.microsoftonline.com/2c94bed6-d675-4d3d-a53b-7b461fd6acc2',
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'localStorage',
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
  'ChannelMessage.Send',
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

// ===== Backend bearer token =====
//
// The API accepts the ID token (audience = our client id). Users kept getting
// stuck on "Loading..." with 401s that only went away in incognito:
//   1. acquireTokenSilent returns the CACHED id token even after it has
//      expired (it only checks the access token), so the API said 401;
//   2. the refresh used ssoSilent, a hidden iframe to login.microsoftonline.com
//      that Chrome blocks along with third-party cookies;
//   3. nothing fell back to signing in again, so the page hung.
// Now we check the id token's own exp, refresh with the refresh token (plain
// HTTPS, no iframe), and if that fails App.tsx re-runs sign-in.

const REFRESH_MARGIN_S = 5 * 60;

function tokenSecondsLeft(idToken: string | undefined): number {
  if (!idToken) return -1;
  try {
    const payload = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return (payload.exp ?? 0) - Date.now() / 1000;
  } catch {
    return -1;
  }
}

function currentAccount(): AccountInfo | null {
  return msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0] ?? null;
}

let inflightRefresh: Promise<string | null> | null = null;

async function refreshIdToken(account: AccountInfo): Promise<string | null> {
  try {
    const r = await msalInstance.acquireTokenSilent({
      scopes: loginRequest.scopes,
      account,
      forceRefresh: true,
      cacheLookupPolicy: CacheLookupPolicy.RefreshToken,
    });
    return tokenSecondsLeft(r.idToken) > 60 ? r.idToken : null;
  } catch {
    return null;
  }
}

/** ID token for our backend, refreshed before it expires. Returns null when
 * the session can't be renewed silently (App.tsx then signs in again). */
export async function getAccessToken(opts: { forceRefresh?: boolean } = {}): Promise<string | null> {
  const account = currentAccount();
  if (!account) return null;
  if (!opts.forceRefresh) {
    try {
      const r = await msalInstance.acquireTokenSilent({ scopes: loginRequest.scopes, account });
      if (tokenSecondsLeft(r.idToken) > REFRESH_MARGIN_S) return r.idToken;
    } catch { /* fall through to refresh */ }
  }
  // Many calls start together on page load; share one refresh between them.
  inflightRefresh ??= refreshIdToken(account).finally(() => { inflightRefresh = null; });
  return inflightRefresh;
}

const REAUTH_KEY = 'realhack:reauth-at';

/** Silent renewal failed: sign in again with a full-page redirect (first-party
 * cookies, so usually no password prompt). Loop-guarded: returns false if we
 * already tried in the last 2 minutes, so the login page shows instead. */
export function reauthenticate(): boolean {
  try {
    const last = Number(sessionStorage.getItem(REAUTH_KEY) || 0);
    if (Date.now() - last < 2 * 60_000) return false;
    sessionStorage.setItem(REAUTH_KEY, String(Date.now()));
  } catch { /* ignore */ }
  const account = currentAccount();
  clearStuckInteraction();
  void msalInstance.loginRedirect({ ...loginRequest, loginHint: account?.username, account: account ?? undefined })
    .catch(() => { /* LoginPage takes over */ });
  return true;
}

/** An interrupted redirect can leave MSAL's "interaction in progress" flag
 * behind, blocking every later sign-in with interaction_in_progress. */
export function clearStuckInteraction(): void {
  for (const store of [sessionStorage, localStorage]) {
    try {
      for (const k of Object.keys(store)) {
        if (k.includes('interaction.status') || k.endsWith('.interaction_status')) store.removeItem(k);
      }
    } catch { /* ignore */ }
  }
}

/** Last resort: forget this site's cached sign-in (what incognito does). */
export function resetSignIn(): void {
  for (const store of [localStorage, sessionStorage]) {
    try {
      Object.keys(store)
        .filter((k) => k.startsWith('msal.') || k.includes('login.windows.net') || k.includes('login.microsoftonline.com') || k.startsWith('realhack:reauth'))
        .forEach((k) => store.removeItem(k));
    } catch { /* ignore */ }
  }
  window.location.replace(window.location.origin + window.location.pathname + window.location.search);
}
