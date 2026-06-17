import type { Team, DashboardStats, UploadResult, Member } from './types';
import { getAccessToken, getGraphTeamsToken } from './auth';

const BASE = '/api';

// ---- Test Mode (sandbox database) ----
// Persisted in localStorage so reloading keeps Test Mode on. authFetch checks
// this flag on every request and sets `x-sandbox: true` when on. The backend
// routes requests with that header to the sandbox DB instead of prod.
const SANDBOX_FLAG_KEY = 'realhack_pilot_sandbox';

export function isSandboxMode(): boolean {
  try {
    return localStorage.getItem(SANDBOX_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSandboxMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(SANDBOX_FLAG_KEY, '1');
    else localStorage.removeItem(SANDBOX_FLAG_KEY);
  } catch {
    // localStorage unavailable — just ignore; Test Mode won't persist across reloads
  }
  // Hard reload so every cached page state reflects the new DB.
  window.location.reload();
}

/**
 * Wrapper around `fetch` that auto-injects the MSAL ID token as
 * `Authorization: Bearer ...` on every API call.
 *
 * If the first attempt returns 401 (almost always because the ID token
 * has expired — they have a ~1 hour lifetime), we force a silent
 * re-auth via MSAL's ssoSilent and retry once with the new token. If
 * the retry also 401s, the caller surfaces the error and the user
 * needs to sign in again.
 */
async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const attempt = async (forceRefresh: boolean): Promise<Response> => {
    const token = await getAccessToken({ forceRefresh });
    const headers = new Headers(init.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (isSandboxMode()) headers.set('x-sandbox', 'true');
    return fetch(input, { ...init, headers });
  };

  let r = await attempt(false);
  if (r.status === 401) {
    // Likely an expired ID token — force a silent refresh and retry once.
    r = await attempt(true);
  }
  return r;
}

export async function fetchTeams(): Promise<Team[]> {
  const r = await authFetch(`${BASE}/teams`);
  if (!r.ok) throw new Error(`Failed to fetch teams: ${r.status}`);
  return r.json();
}

export async function fetchStats(): Promise<DashboardStats> {
  const r = await authFetch(`${BASE}/stats`);
  if (!r.ok) throw new Error(`Failed to fetch stats: ${r.status}`);
  return r.json();
}

export async function uploadRegistrations(file: File): Promise<UploadResult> {
  const fd = new FormData();
  fd.append('file', file);
  const r = await authFetch(`${BASE}/upload`, { method: 'POST', body: fd });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Upload failed: ${r.status} — ${text}`);
  }
  return r.json();
}

export async function rescreen(): Promise<{ teams_scanned: number; duplicate_participants: number; multi_team_mentors: number }> {
  const r = await authFetch(`${BASE}/rescreen`, { method: 'POST' });
  if (!r.ok) throw new Error(`Rescreen failed: ${r.status}`);
  return r.json();
}

// AI screening is async: POST kicks off a background job and returns
// immediately with the current job status. Callers should poll
// aiScreenStatus() to watch progress and decide when to refresh the UI.
export interface AIScreenStatus {
  job_id: string | null;
  status: 'idle' | 'running' | 'done' | 'error';
  total: number;
  scored: number;
  failed: number;
  providers: Record<string, number>;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
}

export async function runAIScreen(force = false): Promise<AIScreenStatus> {
  const r = await authFetch(`${BASE}/ai-screen?force=${force}`, { method: 'POST' });
  if (r.status === 409) {
    // A job is already running — return its current status instead of erroring
    const body = await r.json().catch(() => null);
    if (body?.detail?.status) return body.detail.status as AIScreenStatus;
  }
  if (!r.ok) throw new Error(`AI screen failed: ${r.status}`);
  return r.json();
}

export async function aiScreenStatus(): Promise<AIScreenStatus> {
  const r = await authFetch(`${BASE}/ai-screen/status`);
  if (!r.ok) throw new Error(`AI screen status failed: ${r.status}`);
  return r.json();
}

export async function aiScreenOne(teamId: number): Promise<any> {
  const r = await authFetch(`${BASE}/ai-screen/${teamId}`, { method: 'POST' });
  if (!r.ok) throw new Error(`AI screen for team ${teamId} failed: ${r.status}`);
  return r.json();
}

// Organizer chatbot
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  reply: string;
  team_refs: number[];
  provider: string | null;
  model: string | null;
  error: string | null;
}

export async function chatSend(messages: ChatMessage[]): Promise<ChatResponse> {
  const r = await authFetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Chat failed (${r.status}): ${txt.slice(0, 200)}`);
  }
  return r.json();
}

export interface LLMHealth {
  configured_primary: string;
  openai: { key_set: boolean; working: boolean; model: string | null; error: string | null };
  anthropic: { key_set: boolean; working: boolean; model: string | null; error: string | null };
  active_provider: string;
}

export async function llmHealth(): Promise<LLMHealth> {
  const r = await authFetch(`${BASE}/llm/health`);
  if (!r.ok) throw new Error(`LLM health failed: ${r.status}`);
  return r.json();
}

export interface EmailTemplate {
  id: string;
  label: string;
  description: string;
  audience: string;
  subject: string;
}

export interface RenderedEmail {
  team_id: number;
  team_name: string;
  audience: string;
  to: string[];
  subject: string;
  body: string;
  // The branded HTML version of the body. Null when the template has no
  // HTML variant or when the composer edited the plain-text body (in which
  // case we drop the HTML override so the new text is what gets sent).
  body_html: string | null;
  missing_fields: string[];
}

export async function fetchEmailTemplates(): Promise<EmailTemplate[]> {
  const r = await authFetch(`${BASE}/email/templates`);
  if (!r.ok) throw new Error(`Templates fetch failed: ${r.status}`);
  return r.json();
}

export interface BlankTemplate {
  template_id: string;
  subject: string;
  body: string;
  body_html: string | null;
}

export async function fetchBlankTemplate(templateId: string): Promise<BlankTemplate> {
  const r = await authFetch(`${BASE}/email/templates/${templateId}/blank`);
  if (!r.ok) throw new Error(`Blank template fetch failed: ${r.status}`);
  return r.json();
}

export async function renderEmails(templateId: string, teamIds: number[] | null): Promise<RenderedEmail[]> {
  const r = await authFetch(`${BASE}/email/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template_id: templateId, team_ids: teamIds }),
  });
  if (!r.ok) throw new Error(`Render failed: ${r.status}`);
  return r.json();
}

export async function judgeAI(teamId: number, repoUrl: string | null): Promise<any> {
  const r = await authFetch(`${BASE}/judge/${teamId}/ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_url: repoUrl }),
  });
  if (!r.ok) throw new Error(`Judge AI failed: ${r.status}`);
  return r.json();
}

export async function judgeHuman(
  teamId: number,
  scores: Record<string, { score: number | null; comment: string }>,
  panelist: string | null,
  repoUrl: string | null,
): Promise<any> {
  const r = await authFetch(`${BASE}/judge/${teamId}/human`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scores, panelist, repo_url: repoUrl }),
  });
  if (!r.ok) throw new Error(`Judge save failed: ${r.status}`);
  return r.json();
}

// ===== New M4: panel judging =====

import type { Judge, RubricAxis, JudgeScoreRecord, LeaderboardData } from './types';

export async function fetchRubric(): Promise<{ axes: RubricAxis[]; max_per_axis: number }> {
  const r = await authFetch(`${BASE}/judging/rubric`);
  if (!r.ok) throw new Error(`Rubric fetch failed: ${r.status}`);
  return r.json();
}

export async function judgeLogin(name: string, email: string): Promise<Judge> {
  const r = await authFetch(`${BASE}/judges/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email }),
  });
  if (!r.ok) throw new Error(`Sign-in failed: ${r.status}`);
  return r.json();
}

export async function fetchJudges(): Promise<Judge[]> {
  const r = await authFetch(`${BASE}/judges`);
  if (!r.ok) throw new Error(`Judges fetch failed: ${r.status}`);
  return r.json();
}

export async function createJudge(name: string, email: string | null, role = 'judge'): Promise<Judge> {
  const r = await authFetch(`${BASE}/judges`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, role }),
  });
  if (!r.ok) throw new Error(`Create judge failed: ${r.status}`);
  return r.json();
}

export interface JudgeBulkResult {
  created_count: number;
  updated_count: number;
  skipped_count: number;
  failed: { name: string; email: string; error: string }[];
}

export async function bulkAddJudges(
  rows: { name: string; email: string; role?: string }[],
): Promise<JudgeBulkResult> {
  const r = await authFetch(`${BASE}/judges/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Bulk add failed (${r.status}): ${txt.slice(0, 300)}`);
  }
  return r.json();
}

export interface JudgeDedupeResult {
  merged_count: number;
  deleted_ids: number[];
  remaining_judges: number;
}

export async function dedupeJudgeEmails(): Promise<JudgeDedupeResult> {
  const r = await authFetch(`${BASE}/judges/dedupe-emails`, { method: 'POST' });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Dedupe failed (${r.status}): ${txt.slice(0, 300)}`);
  }
  return r.json();
}

export interface SeatCoverage {
  total: number;
  submitted_count: number;
  pending_count: number;
  by_floor: Record<string, number>;
  submitted: {
    id: number;
    name: string;
    floor: string;
    desk: string;
    landmark: string | null;
    updated_at: string | null;
    updated_by: string | null;
  }[];
  pending: {
    id: number;
    name: string;
    mentor_name: string | null;
    has_channel: boolean;
  }[];
}

export async function fetchSeatCoverage(): Promise<SeatCoverage> {
  const r = await authFetch(`${BASE}/seat-coverage`);
  if (!r.ok) throw new Error(`Seat coverage fetch failed: ${r.status}`);
  return r.json();
}

export async function postChannelQrAllForce(): Promise<PostQrBulkResult> {
  const graphToken = await getGraphTeamsToken();
  const r = await authFetch(`${BASE}/comms/teams/post-channel-qr-all?force=true`, {
    method: 'POST',
    headers: { 'X-Graph-Token': graphToken },
  });
  if (!r.ok) {
    let msg = `Bulk QR re-post failed: ${r.status}`;
    const bodyText = await r.text();
    try {
      const j = JSON.parse(bodyText);
      if (j?.detail) msg = j.detail;
    } catch {
      if (bodyText) msg = bodyText;
    }
    throw new Error(msg);
  }
  return r.json();
}

export async function updateJudge(
  judgeId: number,
  patch: { name?: string; email?: string | null; role?: string },
): Promise<Judge> {
  const r = await authFetch(`${BASE}/judges/${judgeId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Update judge failed: ${r.status} — ${t}`);
  }
  return r.json();
}

export async function deleteJudge(judgeId: number): Promise<{ deleted: boolean }> {
  const r = await authFetch(`${BASE}/judges/${judgeId}`, { method: 'DELETE' });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Delete judge failed: ${r.status} — ${t}`);
  }
  return r.json();
}

// ===== Swag (t-shirt) pickup =====

export interface SwagPerson {
  email: string;
  name: string;
  tshirt_size: string | null;
  country: string | null;
  roles: string[];
  teams: string[];
  /** Badge shown next to the person's name. 'Member' / 'Mentor' / 'Judge' /
   *  'Organiser' / 'Support' / 'Leadership' / 'HR' / etc. -- whatever the
   *  swag-extras upload set the category to, or computed from the member/
   *  mentor source for team participants. */
  category: string;
  collected: boolean;
  collected_at: string | null;
  collected_by_email: string | null;
  picked_up_by_name: string | null;
  picked_up_by_email: string | null;
  notes: string | null;
}

export interface SwagExtra {
  id: number;
  email: string;
  name: string;
  tshirt_size: string | null;
  country: string | null;
  category: string;
  created_at: string | null;
}

export interface SwagExtraImportResult {
  created_count: number;
  updated_count: number;
  skipped_existing_roster_count: number;
  failed: { name: string; email: string; error: string }[];
  by_category: Record<string, number>;
}

export interface SwagStats {
  total: number;
  collected: number;
  pending: number;
}

export async function fetchSwagPeople(): Promise<SwagPerson[]> {
  const r = await authFetch(`${BASE}/swag/people`);
  if (!r.ok) throw new Error(`Swag people fetch failed: ${r.status}`);
  return r.json();
}

export async function fetchSwagStats(): Promise<SwagStats> {
  const r = await authFetch(`${BASE}/swag/stats`);
  if (!r.ok) throw new Error(`Swag stats fetch failed: ${r.status}`);
  return r.json();
}

export async function markSwagCollected(
  email: string,
  opts: { notes?: string | null; pickedUpByName?: string | null; pickedUpByEmail?: string | null } = {},
): Promise<SwagPerson> {
  const r = await authFetch(`${BASE}/swag/mark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      notes: opts.notes ?? null,
      picked_up_by_name: opts.pickedUpByName ?? null,
      picked_up_by_email: opts.pickedUpByEmail ?? null,
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Mark collected failed: ${r.status} — ${t}`);
  }
  return r.json();
}

export async function unmarkSwagCollected(email: string): Promise<SwagPerson> {
  const r = await authFetch(`${BASE}/swag/unmark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Unmark failed: ${r.status} — ${t}`);
  }
  return r.json();
}

// === Swag extras: non-team people who still need a t-shirt ===

export async function fetchSwagExtras(): Promise<SwagExtra[]> {
  const r = await authFetch(`${BASE}/swag/extras`);
  if (!r.ok) throw new Error(`Swag extras fetch failed: ${r.status}`);
  return r.json();
}

export async function importSwagExtrasFromXlsx(file: File): Promise<SwagExtraImportResult> {
  const fd = new FormData();
  fd.append('file', file);
  const r = await authFetch(`${BASE}/swag/extras/import`, {
    method: 'POST',
    body: fd,
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    let msg = `Import failed (${r.status})`;
    try { const j = JSON.parse(txt); if (j?.detail) msg = j.detail; } catch { msg += ': ' + txt.slice(0, 200); }
    throw new Error(msg);
  }
  return r.json();
}

export async function deleteSwagExtra(id: number): Promise<void> {
  const r = await authFetch(`${BASE}/swag/extras/${id}`, { method: 'DELETE' });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Delete swag extra failed: ${r.status} — ${t}`);
  }
}

// === Floor-walk judge visits ===

export interface JudgeVisit {
  id: number;
  team_id: number;
  judge_id: number;
  judge_name: string | null;
  visited_at: string;
  marked_by_email: string | null;
  notes: string | null;
}

export interface JudgeVisitsByTeam {
  by_team: Record<number, JudgeVisit[]>;
}

export interface JudgeVisitsStats {
  total_teams: number;
  teams_with_any_visit: number;
  teams_with_zero_visits: number;
  total_visits: number;
  per_team_counts: Record<number, number>;
  per_judge_counts: Record<number, number>;
}

export async function fetchVisitsByTeam(): Promise<JudgeVisitsByTeam> {
  const r = await authFetch(`${BASE}/visits/by-team`);
  if (!r.ok) throw new Error(`Visits-by-team fetch failed: ${r.status}`);
  return r.json();
}

export async function fetchVisitsStats(): Promise<JudgeVisitsStats> {
  const r = await authFetch(`${BASE}/visits/stats`);
  if (!r.ok) throw new Error(`Visits-stats fetch failed: ${r.status}`);
  return r.json();
}

export async function markVisit(
  teamId: number,
  judgeId: number,
  notes: string | null = null,
): Promise<JudgeVisit> {
  const r = await authFetch(`${BASE}/visits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ team_id: teamId, judge_id: judgeId, notes }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Mark visit failed: ${r.status} — ${t}`);
  }
  return r.json();
}

export async function unmarkVisit(visitId: number): Promise<void> {
  const r = await authFetch(`${BASE}/visits/${visitId}`, { method: 'DELETE' });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Unmark visit failed: ${r.status} — ${t}`);
  }
}

export async function updateVisitNotes(visitId: number, notes: string | null): Promise<JudgeVisit> {
  const r = await authFetch(`${BASE}/visits/${visitId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Update visit notes failed: ${r.status} — ${t}`);
  }
  return r.json();
}


// ===== Teams channel — per-team button =====

export interface CreateChannelResult {
  channel_id: string;
  status: 'sent' | 'mocked' | 'already_exists';
  display_name?: string;
  members_added?: number;
  owners?: number;
  unresolved_emails?: string[];
}

/**
 * Acquire a Graph access token via MSAL (popup the first time to consent
 * the new scopes), then POST it to the backend which uses it to call
 * Graph and create the channel. In sandbox/Test Mode the backend skips
 * the Graph call and just writes a mock entry, so the token can be empty.
 */
export async function createTeamsChannelForTeam(teamId: number): Promise<CreateChannelResult> {
  let graphToken = '';
  try {
    graphToken = await getGraphTeamsToken();
  } catch (e) {
    if (!isSandboxMode()) throw e;
  }
  const r = await authFetch(`${BASE}/comms/teams/${teamId}/create-channel`, {
    method: 'POST',
    headers: graphToken ? { 'X-Graph-Token': graphToken } : undefined,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Create channel failed: ${r.status} — ${t}`);
  }
  return r.json();
}

export interface PostChannelWelcomeResult {
  message_id: string;
  mentions_count: number;
  status: string;
}

export interface PostChannelWelcomeBulkResult {
  total_teams_with_channels: number;
  posted_count: number;
  skipped_already_posted_count: number;
  skipped_no_real_channel_count: number;
  failed_count: number;
  posted: { team_id: number; team_name: string; mentions: number }[];
  skipped_already_posted: { team_id: number; team_name: string }[];
  skipped_no_real_channel: { team_id: number; team_name: string }[];
  failed: { team_id: number; team_name: string; error: string }[];
}

export interface PostQrBulkResult {
  total_teams_with_channels: number;
  posted_count: number;
  skipped_already_posted_count: number;
  skipped_no_real_channel_count: number;
  failed_count: number;
  posted: { team_id: number; team_name: string }[];
  skipped_already_posted: { team_id: number; team_name: string }[];
  skipped_no_real_channel: { team_id: number; team_name: string }[];
  failed: { team_id: number; team_name: string; error: string }[];
}

export async function postChannelQrAll(): Promise<PostQrBulkResult> {
  const graphToken = await getGraphTeamsToken();
  const r = await authFetch(`${BASE}/comms/teams/post-channel-qr-all`, {
    method: 'POST',
    headers: { 'X-Graph-Token': graphToken },
  });
  if (!r.ok) {
    let msg = `Bulk QR post failed: ${r.status}`;
    const bodyText = await r.text();
    try {
      const j = JSON.parse(bodyText);
      if (j?.detail) msg = j.detail;
    } catch {
      if (bodyText) msg = bodyText;
    }
    throw new Error(msg);
  }
  return r.json();
}

export async function postChannelQrForTeam(teamId: number): Promise<{ message_id: string; qr_target_url: string; status: string }> {
  const graphToken = await getGraphTeamsToken();
  const r = await authFetch(`${BASE}/comms/teams/${teamId}/post-channel-qr`, {
    method: 'POST',
    headers: { 'X-Graph-Token': graphToken },
  });
  if (!r.ok) {
    let msg = `QR post failed: ${r.status}`;
    const bodyText = await r.text();
    try {
      const j = JSON.parse(bodyText);
      if (j?.detail) msg = j.detail;
    } catch {
      if (bodyText) msg = bodyText;
    }
    throw new Error(msg);
  }
  return r.json();
}

// === Repo-ready announcement bulk flow ===

export interface RepoUrlImportResult {
  updated_count: number;
  unchanged_count: number;
  not_found_count: number;
  no_repo_url_count: number;
  updated: { team_id: number; team_name: string; repo_url: string }[];
  not_found: string[];
  no_repo_url: string[];
}

export async function importRepoUrlsFromXlsx(file: File): Promise<RepoUrlImportResult> {
  const fd = new FormData();
  fd.append('file', file);
  const r = await authFetch(`${BASE}/import/repo-urls`, {
    method: 'POST',
    body: fd,
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    let msg = `Import failed (${r.status})`;
    try { const j = JSON.parse(txt); if (j?.detail) msg = j.detail; } catch { msg += ': ' + txt.slice(0, 200); }
    throw new Error(msg);
  }
  return r.json();
}

export interface PostRepoReadyBulkResult {
  total_teams_with_channels: number;
  posted_count: number;
  skipped_already_posted_count: number;
  skipped_no_real_channel_count: number;
  skipped_no_repo_url_count: number;
  failed_count: number;
  posted: { team_id: number; team_name: string }[];
  skipped_no_repo_url: { team_id: number; team_name: string }[];
  failed: { team_id: number; team_name: string; error: string }[];
}

export async function postChannelRepoReadyAll(force = false): Promise<PostRepoReadyBulkResult> {
  const graphToken = await getGraphTeamsToken();
  const qs = force ? '?force=true' : '';
  const r = await authFetch(`${BASE}/comms/teams/post-channel-repo-ready-all${qs}`, {
    method: 'POST',
    headers: { 'X-Graph-Token': graphToken },
  });
  if (!r.ok) {
    let msg = `Bulk repo-ready post failed: ${r.status}`;
    const bodyText = await r.text();
    try { const j = JSON.parse(bodyText); if (j?.detail) msg = j.detail; } catch { if (bodyText) msg = bodyText; }
    throw new Error(msg);
  }
  return r.json();
}

export async function fetchRepoReadyPostedTeamIds(): Promise<number[]> {
  const r = await authFetch(`${BASE}/comms/repo-ready-posted-team-ids`);
  if (!r.ok) throw new Error(`Repo-ready posted-ids fetch failed: ${r.status}`);
  const j = await r.json();
  return j.team_ids ?? [];
}

export async function postChannelRepoReadyForTeam(
  teamId: number,
): Promise<{ message_id: string; repo_url: string; status: string }> {
  const graphToken = await getGraphTeamsToken();
  const r = await authFetch(`${BASE}/comms/teams/${teamId}/post-channel-repo-ready`, {
    method: 'POST',
    headers: { 'X-Graph-Token': graphToken },
  });
  if (!r.ok) {
    let msg = `Repo-ready post failed: ${r.status}`;
    const bodyText = await r.text();
    try { const j = JSON.parse(bodyText); if (j?.detail) msg = j.detail; } catch { if (bodyText) msg = bodyText; }
    throw new Error(msg);
  }
  return r.json();
}

export async function postChannelWelcomeAll(): Promise<PostChannelWelcomeBulkResult> {
  const graphToken = await getGraphTeamsToken();
  // Backend loops through every team with a channel; ~2-3 min for 95 teams.
  // Bump the fetch's implicit timeout via no explicit AbortController; this
  // resolves only when the loop finishes.
  const r = await authFetch(`${BASE}/comms/teams/post-channel-welcome-all`, {
    method: 'POST',
    headers: { 'X-Graph-Token': graphToken },
  });
  if (!r.ok) {
    let msg = `Bulk post welcome failed: ${r.status}`;
    const bodyText = await r.text();
    try {
      const j = JSON.parse(bodyText);
      if (j?.detail) msg = j.detail;
    } catch {
      if (bodyText) msg = bodyText;
    }
    throw new Error(msg);
  }
  return r.json();
}

export async function postChannelWelcome(teamId: number): Promise<PostChannelWelcomeResult> {
  const graphToken = await getGraphTeamsToken();
  const r = await authFetch(`${BASE}/comms/teams/${teamId}/post-channel-welcome`, {
    method: 'POST',
    headers: { 'X-Graph-Token': graphToken },
  });
  if (!r.ok) {
    let msg = `Post welcome failed: ${r.status}`;
    const bodyText = await r.text();
    try {
      const j = JSON.parse(bodyText);
      if (j?.detail) msg = j.detail;
    } catch {
      if (bodyText) msg = bodyText;
    }
    throw new Error(msg);
  }
  return r.json();
}


// ---- Sandbox admin (super-admin only) ----

export interface SandboxStatus {
  configured: boolean;
  message?: string;
  counts?: Record<string, number>;
}

export async function fetchSandboxStatus(): Promise<SandboxStatus> {
  const r = await authFetch(`${BASE}/admin/sandbox/status`);
  if (!r.ok) throw new Error(`Sandbox status failed: ${r.status}`);
  return r.json();
}

export async function refreshSandbox(): Promise<{ refreshed: boolean; rows_copied: Record<string, number> }> {
  const r = await authFetch(`${BASE}/admin/sandbox/refresh`, { method: 'POST' });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Sandbox refresh failed: ${r.status} — ${t}`);
  }
  return r.json();
}

// Lowercase the protected emails so the frontend can hide destructive controls.
export const PROTECTED_JUDGE_EMAILS: ReadonlySet<string> = new Set([
  'shaikshavali.kalluri@realpage.com',
  'suneel.nallu@realpage.com',
  'bhaskar.jaddu@realpage.com',
]);

export async function submitJudgeScore(payload: {
  judge_id: number;
  team_id: number;
  round: number;
  scores: Record<string, number>;
  comment?: string | null;
  entered_by_email?: string | null;
}): Promise<JudgeScoreRecord> {
  const r = await authFetch(`${BASE}/judging/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Score submit failed: ${r.status} — ${t}`);
  }
  return r.json();
}

export async function deleteJudgeScore(judgeId: number, teamId: number, round: number): Promise<{ deleted: boolean }> {
  const qs = new URLSearchParams({ judge_id: String(judgeId), team_id: String(teamId), round: String(round) });
  const r = await authFetch(`${BASE}/judging/scores?${qs}`, { method: 'DELETE' });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Delete score failed: ${r.status} — ${t}`);
  }
  return r.json();
}

export async function fetchJudgeScores(opts: { round?: number; judge_id?: number; team_id?: number } = {}): Promise<JudgeScoreRecord[]> {
  const qs = new URLSearchParams();
  if (opts.round !== undefined) qs.set('round', String(opts.round));
  if (opts.judge_id !== undefined) qs.set('judge_id', String(opts.judge_id));
  if (opts.team_id !== undefined) qs.set('team_id', String(opts.team_id));
  const url = `${BASE}/judging/scores${qs.toString() ? '?' + qs : ''}`;
  const r = await authFetch(url);
  if (!r.ok) throw new Error(`Scores fetch failed: ${r.status}`);
  return r.json();
}

// ===== Role + judge assignments =====

export interface UserRole {
  // 'rews' = swag-distribution volunteer. Routes to a stripped-down pickup-
  // desk UI (search + mark only, no undo, no nav, no Excel export). Added
  // by an organizer via the Judges & Organizers admin panel with role='rews'.
  // 'none' = signed in via AAD but not on any roster -> 'Not registered' card.
  role: 'organizer' | 'judge' | 'rews' | 'none';
  judge_id: number | null;
  name: string | null;
  email: string | null;
}

export async function fetchMyRole(): Promise<UserRole> {
  const r = await authFetch(`${BASE}/me/role`);
  if (!r.ok) throw new Error(`Role fetch failed: ${r.status}`);
  return r.json();
}

export async function fetchMyAssignedTeams(round?: number): Promise<Team[]> {
  const qs = round !== undefined ? `?round=${round}` : '';
  const r = await authFetch(`${BASE}/judge/me/teams${qs}`);
  if (!r.ok) throw new Error(`Assigned teams fetch failed: ${r.status}`);
  return r.json();
}

export async function fetchTeamsForJudge(judgeId: number, round?: number): Promise<Team[]> {
  const qs = round !== undefined ? `?round=${round}` : '';
  const r = await authFetch(`${BASE}/judges/${judgeId}/teams${qs}`);
  if (!r.ok) throw new Error(`Teams-for-judge fetch failed: ${r.status}`);
  return r.json();
}

export async function fetchMyAvailableRounds(): Promise<number[]> {
  const r = await authFetch(`${BASE}/judge/me/rounds`);
  if (!r.ok) throw new Error(`My rounds fetch failed: ${r.status}`);
  return r.json();
}

export async function fetchRoundsForJudge(judgeId: number): Promise<number[]> {
  const r = await authFetch(`${BASE}/judges/${judgeId}/rounds`);
  if (!r.ok) throw new Error(`Judge rounds fetch failed: ${r.status}`);
  return r.json();
}

export interface JudgeAssignment {
  id: number;
  judge_id: number;
  team_id: number;
  round: number;
}

export async function fetchJudgeAssignments(judgeId: number, round?: number): Promise<JudgeAssignment[]> {
  const qs = round !== undefined ? `?round=${round}` : '';
  const r = await authFetch(`${BASE}/judges/${judgeId}/assignments${qs}`);
  if (!r.ok) throw new Error(`Assignments fetch failed: ${r.status}`);
  return r.json();
}

export async function setJudgeAssignments(judgeId: number, round: number, teamIds: number[]): Promise<JudgeAssignment[]> {
  const r = await authFetch(`${BASE}/judges/${judgeId}/assignments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ round, team_ids: teamIds }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Set assignments failed: ${r.status} — ${t}`);
  }
  return r.json();
}

// ===== Panels =====

export interface Panel {
  id: number;
  name: string;
  round: number;
  team_ids: number[];
  judge_ids: number[];
}

export async function fetchPanels(round?: number): Promise<Panel[]> {
  const qs = round !== undefined ? `?round=${round}` : '';
  const r = await authFetch(`${BASE}/panels${qs}`);
  if (!r.ok) throw new Error(`Panels fetch failed: ${r.status}`);
  return r.json();
}

export async function createPanel(name: string, round: number): Promise<Panel> {
  const r = await authFetch(`${BASE}/panels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, round }),
  });
  if (!r.ok) throw new Error(`Create panel failed: ${r.status}`);
  return r.json();
}

export async function renamePanel(panelId: number, name: string): Promise<Panel> {
  const r = await authFetch(`${BASE}/panels/${panelId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) throw new Error(`Rename panel failed: ${r.status}`);
  return r.json();
}

export async function deletePanel(panelId: number): Promise<{ deleted: boolean }> {
  const r = await authFetch(`${BASE}/panels/${panelId}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`Delete panel failed: ${r.status}`);
  return r.json();
}

export async function setPanelTeams(panelId: number, teamIds: number[]): Promise<Panel> {
  const r = await authFetch(`${BASE}/panels/${panelId}/teams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ team_ids: teamIds }),
  });
  if (!r.ok) throw new Error(`Set panel teams failed: ${r.status}`);
  return r.json();
}

export async function setPanelJudges(panelId: number, judgeIds: number[]): Promise<Panel> {
  const r = await authFetch(`${BASE}/panels/${panelId}/judges`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ judge_ids: judgeIds }),
  });
  if (!r.ok) throw new Error(`Set panel judges failed: ${r.status}`);
  return r.json();
}

export async function downloadPanelInvite(panelId: number, day: 1 | 2): Promise<void> {
  const r = await authFetch(`${BASE}/panels/${panelId}/invite.ics?day=${day}`);
  if (!r.ok) {
    let msg = `Invite download failed: ${r.status}`;
    try {
      const j = await r.json();
      if (j?.detail) msg = j.detail;
    } catch {
      // not JSON; keep the status-only message
    }
    throw new Error(msg);
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const cd = r.headers.get('Content-Disposition') || '';
  const m = /filename="?([^";]+)"?/.exec(cd);
  const filename = m?.[1] || `realhack-panel-${panelId}-day${day}.ics`;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface ScheduleRow {
  team_id: number;
  team: string;
  panel: string;
  slot: string;  // date label, e.g. '18th June'
  time: string; // start time HH:MM
  mentor: string;
  is_us: boolean;
  us_reason: string; // why this team is US-affiliated; empty for non-US teams
}

export interface PanelInviteMeta {
  subject: string;
  body: string;
  body_html: string;
  start_iso: string;
  end_iso: string;
  location: string;
  required_emails: string[];
  optional_emails: string[];
  team_count: number;
  schedule: ScheduleRow[];
  day_label: string;
}

export async function swapPanelTeamDays(panelId: number, teamAId: number, teamBId: number): Promise<void> {
  const r = await authFetch(`${BASE}/panels/${panelId}/swap-team-days`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ team_a_id: teamAId, team_b_id: teamBId }),
  });
  if (!r.ok) {
    let msg = `Swap failed: ${r.status}`;
    try { const j = await r.json(); if (j?.detail) msg = j.detail; } catch { /* keep status msg */ }
    throw new Error(msg);
  }
}

export async function fetchPanelInviteMeta(panelId: number, day: 1 | 2): Promise<PanelInviteMeta> {
  const r = await authFetch(`${BASE}/panels/${panelId}/invite-meta?day=${day}`);
  if (!r.ok) {
    let msg = `Invite meta failed: ${r.status}`;
    try {
      const j = await r.json();
      if (j?.detail) msg = j.detail;
    } catch {
      // keep status-only msg
    }
    throw new Error(msg);
  }
  return r.json();
}

/**
 * Build the Outlook Web "compose new event" deeplink.
 *
 * Outlook Web's compose endpoint accepts subject, startdt, enddt, body, and
 * location — these reliably pre-fill. Attendees in the URL are unreliable
 * across Outlook builds, so we don't include them here; the frontend copies
 * the attendee list to the clipboard separately for the user to paste.
 *
 * Body is rendered as HTML by Outlook Web's compose dialog, so plain '\n'
 * collapses to whitespace. We HTML-escape the backend's plain-text body
 * and convert newlines to <br> so the schedule grid renders line-by-line.
 */
export function buildOutlookComposeUrl(meta: PanelInviteMeta): string {
  const bodyHtml = meta.body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '<br>');
  const params = new URLSearchParams({
    subject: meta.subject,
    startdt: meta.start_iso,
    enddt: meta.end_iso,
    body: bodyHtml,
    location: meta.location,
    online: 'true', // hint to Outlook to add a Teams link
  });
  return `https://outlook.office.com/calendar/deeplink/compose?${params.toString()}`;
}

export async function fetchLeaderboard(round: number): Promise<LeaderboardData> {
  const r = await authFetch(`${BASE}/judging/leaderboard?round=${round}`);
  if (!r.ok) throw new Error(`Leaderboard fetch failed: ${r.status}`);
  return r.json();
}

// ===== Comms + audit =====

import type { CommLogEntry } from './types';

export async function commsMode(): Promise<{ mode: string }> {
  const r = await authFetch(`${BASE}/comms/mode`);
  if (!r.ok) throw new Error(`Comms mode failed: ${r.status}`);
  return r.json();
}

export interface BulkCreateChannelsResult {
  created_count: number;
  already_existing_count: number;
  failed_count: number;
  created: { team_id: number; team_name: string; channel_id: string }[];
  already_existing: { team_id: number; team_name: string }[];
  failed: { team_id: number; team_name: string; error: string }[];
  mode: string;
}

export async function createTeamsChannels(
  teamIds: number[] | null,
  sentByEmail: string | null,
): Promise<BulkCreateChannelsResult> {
  // Real-Graph bulk create — needs the delegated Graph token same as the
  // per-team button. Skip the token acquire in sandbox.
  let graphToken = '';
  try {
    graphToken = await getGraphTeamsToken();
  } catch (e) {
    if (!isSandboxMode()) throw e;
  }
  const r = await authFetch(`${BASE}/comms/channels`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(graphToken ? { 'X-Graph-Token': graphToken } : {}),
    },
    body: JSON.stringify({ team_ids: teamIds, sent_by_email: sentByEmail }),
  });
  if (!r.ok) {
    let msg = `Channel bulk-create failed: ${r.status}`;
    const bodyText = await r.text();
    try {
      const j = JSON.parse(bodyText);
      if (j?.detail) msg = j.detail;
    } catch {
      if (bodyText) msg = bodyText;
    }
    throw new Error(msg);
  }
  return r.json();
}

export interface AdoptOrphanChannelsResult {
  parent_team_channel_count: number;
  teams_without_channel_in_db: number;
  adopted_count: number;
  not_found_count: number;
  adopted: { team_id: number; team_name: string; channel_id: string; display_name: string }[];
  not_found: { team_id: number; team_name: string; expected_name: string }[];
}

export async function adoptOrphanChannels(): Promise<AdoptOrphanChannelsResult> {
  const graphToken = await getGraphTeamsToken();
  const r = await authFetch(`${BASE}/comms/adopt-orphan-channels`, {
    method: 'POST',
    headers: { 'X-Graph-Token': graphToken },
  });
  if (!r.ok) {
    let msg = `Adopt orphans failed: ${r.status}`;
    const bodyText = await r.text();
    try {
      const j = JSON.parse(bodyText);
      if (j?.detail) msg = j.detail;
    } catch {
      if (bodyText) msg = bodyText;
    }
    throw new Error(msg);
  }
  return r.json();
}

export interface MentionsCheckResult {
  total_teams: number;
  total_unique_emails: number;
  resolved_count: number;
  unresolved_email_count: number;
  teams_with_issues_count: number;
  teams_with_issues: {
    team_id: number;
    team_name: string;
    unresolved: { role: 'mentor' | 'member'; name: string; email: string }[];
  }[];
}

export async function checkWelcomeMentions(): Promise<MentionsCheckResult> {
  const graphToken = await getGraphTeamsToken();
  const r = await authFetch(`${BASE}/comms/check-welcome-mentions`, {
    method: 'POST',
    headers: { 'X-Graph-Token': graphToken },
  });
  if (!r.ok) {
    let msg = `Check mentions failed: ${r.status}`;
    const bodyText = await r.text();
    try {
      const j = JSON.parse(bodyText);
      if (j?.detail) msg = j.detail;
    } catch {
      if (bodyText) msg = bodyText;
    }
    throw new Error(msg);
  }
  return r.json();
}

export async function fetchWelcomedTeamIds(): Promise<number[]> {
  const r = await authFetch(`${BASE}/comms/welcomed-team-ids`);
  if (!r.ok) throw new Error(`Welcomed-team-ids fetch failed: ${r.status}`);
  const j = await r.json();
  return j.team_ids ?? [];
}

export async function fetchQrPostedTeamIds(): Promise<number[]> {
  const r = await authFetch(`${BASE}/comms/qr-posted-team-ids`);
  if (!r.ok) throw new Error(`QR-posted-team-ids fetch failed: ${r.status}`);
  const j = await r.json();
  return j.team_ids ?? [];
}

export async function adoptChannelByLink(
  teamId: number,
  linkOrId: string,
): Promise<{ team_id: number; team_name: string; channel_id: string; status: string }> {
  const r = await authFetch(`${BASE}/comms/teams/${teamId}/adopt-channel-by-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teams_channel_link: linkOrId }),
  });
  if (!r.ok) {
    let msg = `Adopt by link failed: ${r.status}`;
    const bodyText = await r.text();
    try {
      const j = JSON.parse(bodyText);
      if (j?.detail) msg = j.detail;
    } catch {
      if (bodyText) msg = bodyText;
    }
    throw new Error(msg);
  }
  return r.json();
}

export async function resetTeamChannelState(teamId: number): Promise<{ team_id: number; team_name: string; status: string }> {
  const r = await authFetch(`${BASE}/comms/teams/${teamId}/reset-channel`, {
    method: 'POST',
  });
  if (!r.ok) {
    let msg = `Reset failed: ${r.status}`;
    const bodyText = await r.text();
    try {
      const j = JSON.parse(bodyText);
      if (j?.detail) msg = j.detail;
    } catch {
      if (bodyText) msg = bodyText;
    }
    throw new Error(msg);
  }
  return r.json();
}

export async function postTeamMessage(teamId: number, message: string, sentByEmail: string | null): Promise<any> {
  const r = await authFetch(`${BASE}/comms/teams/${teamId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sent_by_email: sentByEmail }),
  });
  if (!r.ok) throw new Error(`Message failed: ${r.status}`);
  return r.json();
}

export async function broadcastMessage(message: string, teamIds: number[] | null, sentByEmail: string | null): Promise<any> {
  const r = await authFetch(`${BASE}/comms/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, team_ids: teamIds, sent_by_email: sentByEmail }),
  });
  if (!r.ok) throw new Error(`Broadcast failed: ${r.status}`);
  return r.json();
}

export async function fetchCommLog(opts: { team_id?: number; kind?: string; limit?: number } = {}): Promise<CommLogEntry[]> {
  const qs = new URLSearchParams();
  if (opts.team_id !== undefined) qs.set('team_id', String(opts.team_id));
  if (opts.kind) qs.set('kind', opts.kind);
  if (opts.limit) qs.set('limit', String(opts.limit));
  const url = `${BASE}/comms/log${qs.toString() ? '?' + qs : ''}`;
  const r = await authFetch(url);
  if (!r.ok) throw new Error(`Comm log fetch failed: ${r.status}`);
  return r.json();
}

export async function appendCommLog(payload: {
  team_id?: number | null;
  kind: string;
  template_id?: string | null;
  subject?: string | null;
  body?: string | null;
  recipients?: string[];
  sent_by_email?: string | null;
  status?: string;
}): Promise<CommLogEntry> {
  const r = await authFetch(`${BASE}/comms/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Log append failed: ${r.status}`);
  return r.json();
}

export async function checkDuplicate(teamId: number, kind = 'email', templateId: string | null = null, hours = 24): Promise<{ duplicate: boolean; last_sent_at?: string; last_sent_by_email?: string }> {
  const qs = new URLSearchParams({ team_id: String(teamId), kind, hours: String(hours) });
  if (templateId) qs.set('template_id', templateId);
  const r = await authFetch(`${BASE}/comms/duplicate-check?${qs}`);
  if (!r.ok) throw new Error(`Duplicate check failed: ${r.status}`);
  return r.json();
}

export async function checkRepo(teamId: number): Promise<{ ready: boolean; notes: string; github?: any }> {
  const r = await authFetch(`${BASE}/teams/${teamId}/check-repo`, { method: 'POST' });
  if (!r.ok) throw new Error(`Repo check failed: ${r.status}`);
  return r.json();
}

export async function updateReadiness(teamId: number, patch: { presentation_uploaded?: boolean; repo_url?: string | null; has_teams_channel?: boolean }): Promise<any> {
  const r = await authFetch(`${BASE}/teams/${teamId}/readiness`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`Readiness update failed: ${r.status}`);
  return r.json();
}

// ===== Team / member edit (post-registration change requests) =====

export interface TeamEditPatch {
  name?: string;
  mentor_name?: string | null;
  mentor_email?: string | null;
  mentor_location?: string | null;
  mentor_tshirt_size?: string | null;
  mentor_address?: string | null;
  idea?: string | null;
  tools?: string | null;
  approach?: string | null;
  viability?: string | null;
  business_value?: string | null;
  repo_url?: string | null;
  edit_reason?: string | null;
}

export interface MemberEditPayload {
  name?: string;
  email?: string | null;
  location?: string | null;
  tshirt_size?: string | null;
  address?: string | null;
  edit_reason?: string | null;
}

async function readErr(r: Response, fallback: string): Promise<string> {
  try {
    const body = await r.json();
    if (body && typeof body.detail === 'string') return body.detail;
  } catch {
    /* not JSON — fall through */
  }
  return `${fallback} (${r.status})`;
}

export interface NewMemberPayload {
  name: string;
  email?: string | null;
  location?: string | null;
  tshirt_size?: string | null;
  address?: string | null;
}

export interface NewTeamPayload {
  name: string;
  mentor_name?: string | null;
  mentor_email?: string | null;
  mentor_location?: string | null;
  mentor_tshirt_size?: string | null;
  mentor_address?: string | null;
  idea?: string | null;
  tools?: string | null;
  approach?: string | null;
  viability?: string | null;
  business_value?: string | null;
  repo_url?: string | null;
  members?: NewMemberPayload[];
  edit_reason?: string | null;
}

/**
 * Download current team roster as a MS-Forms-compatible .xlsx so organizers
 * can edit it locally and re-upload without losing manual additions.
 */
export async function downloadMsFormsExport(): Promise<void> {
  const r = await authFetch(`${BASE}/export-msforms.xlsx`);
  if (!r.ok) throw new Error(`Export failed: ${r.status}`);
  const blob = await r.blob();
  const cd = r.headers.get('Content-Disposition') || '';
  const match = cd.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : 'realhack_registrations.xlsx';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function createTeam(payload: NewTeamPayload): Promise<Team> {
  const r = await authFetch(`${BASE}/teams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(await readErr(r, 'Team create failed'));
  return r.json();
}

export async function updateTeam(teamId: number, patch: TeamEditPatch): Promise<Team> {
  const r = await authFetch(`${BASE}/teams/${teamId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(await readErr(r, 'Team update failed'));
  return r.json();
}

export async function addTeamMember(teamId: number, payload: MemberEditPayload & { name: string }): Promise<Member> {
  const r = await authFetch(`${BASE}/teams/${teamId}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(await readErr(r, 'Add member failed'));
  return r.json();
}

export async function updateMember(memberId: number, patch: MemberEditPayload): Promise<Member> {
  const r = await authFetch(`${BASE}/members/${memberId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(await readErr(r, 'Member update failed'));
  return r.json();
}

export async function deleteMember(memberId: number): Promise<void> {
  const r = await authFetch(`${BASE}/members/${memberId}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(await readErr(r, 'Member delete failed'));
}

export interface BackfillMentorResult {
  teams_total: number;
  teams_with_raw: number;
  mentor_locations_set: number;
  mentor_tshirt_sizes_set: number;
  mentor_addresses_set: number;
  member_locations_set: number;
  member_addresses_set: number;
  performed_by: string | null;
}

export async function backfillMentorLocations(): Promise<BackfillMentorResult> {
  const r = await authFetch(`${BASE}/admin/backfill-mentor-locations`, { method: 'POST' });
  if (!r.ok) throw new Error(await readErr(r, 'Backfill failed'));
  return r.json();
}

// ===== Auth (current user profile) =====

export interface UserProfile {
  name: string;
  email: string;
  job_title: string | null;
  department: string | null;
  initials: string;
}

export async function fetchMe(): Promise<UserProfile> {
  const r = await authFetch(`${BASE}/me`);
  if (!r.ok) throw new Error(`Profile fetch failed: ${r.status}`);
  return r.json();
}

/**
 * Download the CSV export of all teams. Browser <a href> can't carry the
 * MSAL Bearer token, so we authFetch as a blob and trigger a client-side
 * download via a synthetic <a> click.
 */
export async function exportCsv(): Promise<void> {
  const r = await authFetch(`${BASE}/export.csv`);
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Export failed (${r.status}): ${t.slice(0, 200)}`);
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `realhack-teams-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * DevOps hand-off sheet: one xlsx with merged team rows, columns are
 * S.No / Team Name / Member names / Email Ids / Gitrepo url. Used to give
 * DevOps a single file to provision GitHub repos from.
 */
export async function exportDevOpsRepos(): Promise<void> {
  const r = await authFetch(`${BASE}/export/devops-repos.xlsx`);
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Export failed (${r.status}): ${t.slice(0, 200)}`);
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `realhack-2026-devops-repos-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ===== Tournament progression =====

export interface RoundSummary {
  round: number;
  eligible_team_count: number;
  scored_team_count: number;
}

export async function advanceTeams(fromRound: number, teamIds: number[]): Promise<{ from_round: number; to_round: number; advanced_team_ids: number[]; advanced_count: number }> {
  const r = await authFetch(`${BASE}/rounds/advance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from_round: fromRound, team_ids: teamIds }),
  });
  if (!r.ok) throw new Error(`Advance failed: ${r.status}`);
  return r.json();
}

export async function resetRoundAdvancements(round: number): Promise<{ reset_to_round: number; teams_reset: number }> {
  const r = await authFetch(`${BASE}/rounds/reset/${round}`, { method: 'POST' });
  if (!r.ok) throw new Error(`Reset failed: ${r.status}`);
  return r.json();
}

export async function setWinners(positions: Record<string, number>): Promise<{ positions: Record<string, number> }> {
  const r = await authFetch(`${BASE}/rounds/winners`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positions }),
  });
  if (!r.ok) throw new Error(`Set winners failed: ${r.status}`);
  return r.json();
}

export async function fetchRoundSummary(): Promise<RoundSummary[]> {
  const r = await authFetch(`${BASE}/rounds/summary`);
  if (!r.ok) throw new Error(`Round summary failed: ${r.status}`);
  return r.json();
}
