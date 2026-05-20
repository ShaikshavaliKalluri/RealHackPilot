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
 * Get an access token for the signed-in user, requesting fresh if needed.
 * Returns null if not signed in.
 */
export async function getAccessToken(): Promise<string | null> {
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) return null;
  try {
    const result = await msalInstance.acquireTokenSilent({
      scopes: loginRequest.scopes,
      account: accounts[0],
    });
    return result.accessToken;
  } catch {
    // Silent acquire failed — the caller should redirect to login
    return null;
  }
}
