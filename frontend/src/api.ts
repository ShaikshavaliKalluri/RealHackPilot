import type { Team, DashboardStats, UploadResult, Member } from './types';
import { getAccessToken } from './auth';

const BASE = '/api';

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
  role: 'organizer' | 'judge' | 'none';
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

export async function createTeamsChannels(teamIds: number[] | null, sentByEmail: string | null): Promise<{ created: number[]; already_existing: number[]; mode: string }> {
  const r = await authFetch(`${BASE}/comms/channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ team_ids: teamIds, sent_by_email: sentByEmail }),
  });
  if (!r.ok) throw new Error(`Channel create failed: ${r.status}`);
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
