import { useState } from 'react';
import type { Team } from '../types';
import { FlagBadge } from './FlagBadge';
import { AIScoreBlock } from './AIScoreBlock';
import { TeamReadiness } from './TeamReadiness';
import { TeamEditModal } from './TeamEditModal';
import { createTeamsChannelForTeam, postChannelWelcome, postChannelQrForTeam, adoptChannelByLink, isSandboxMode } from '../api';

interface Props {
  team: Team;
  expanded: boolean;
  onToggle: () => void;
  onRescore?: () => void;
  onReload?: () => void;
}

export function TeamCard({ team, expanded, onToggle, onRescore, onReload }: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [channelBusy, setChannelBusy] = useState(false);
  const [channelMsg, setChannelMsg] = useState<string | null>(null);
  const [welcomeBusy, setWelcomeBusy] = useState(false);
  const [welcomeMsg, setWelcomeMsg] = useState<string | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const [qrMsg, setQrMsg] = useState<string | null>(null);
  const pct = Math.round(team.completeness_score * 100);

  const handleCreateChannel = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const inSandbox = isSandboxMode();
    const confirmText = inSandbox
      ? `Create a MOCK Teams channel for "${team.name}"? (Test Mode — no real channel will be created.)`
      : `Create a real Microsoft Teams channel "2026 ${team.name}" with all members + mentor? This action is logged and cannot be undone from the app.`;
    if (!confirm(confirmText)) return;
    setChannelBusy(true);
    setChannelMsg(null);
    try {
      const r = await createTeamsChannelForTeam(team.id);
      const verb = r.status === 'mocked' ? 'Mock channel created' : 'Channel created';
      const detail = r.members_added != null ? ` · ${r.members_added} members added` : '';
      const unresolved = (r.unresolved_emails && r.unresolved_emails.length)
        ? ` · unresolved: ${r.unresolved_emails.join(', ')}`
        : '';
      setChannelMsg(`✓ ${verb}${detail}${unresolved}`);
      if (onReload) onReload();
    } catch (err: any) {
      setChannelMsg(`✗ ${err.message ?? String(err)}`);
    } finally {
      setChannelBusy(false);
    }
  };

  const handleAdoptByLink = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const link = prompt(
      `Paste the Teams channel link or channel id for "${team.name}".\n\n` +
      `From Teams: right-click the channel → "Get link to channel" → Copy.\n` +
      `Paste the URL here (or the raw id starting with "19:" if you have it).`
    );
    if (!link) return;
    setChannelBusy(true);
    setChannelMsg(null);
    try {
      const r = await adoptChannelByLink(team.id, link);
      setChannelMsg(`✓ Adopted channel · id ${r.channel_id.slice(0, 24)}…`);
      if (onReload) onReload();
    } catch (err: any) {
      setChannelMsg(`✗ ${err.message ?? String(err)}`);
    } finally {
      setChannelBusy(false);
    }
  };

  const handlePostWelcome = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmText = `Post the RealHack 2026 welcome message to the "2026 ${team.name}" channel? All members + mentor will be @mentioned.`;
    if (!confirm(confirmText)) return;
    setWelcomeBusy(true);
    setWelcomeMsg(null);
    try {
      const r = await postChannelWelcome(team.id);
      setWelcomeMsg(`✓ Welcome posted · ${r.mentions_count} @mention${r.mentions_count === 1 ? '' : 's'}`);
    } catch (err: any) {
      setWelcomeMsg(`✗ ${err.message ?? String(err)}`);
    } finally {
      setWelcomeBusy(false);
    }
  };

  const handlePostQr = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmText = `Post the floor-walk QR-code message to the "2026 ${team.name}" channel? The team will see a personalized message with their QR code inline.`;
    if (!confirm(confirmText)) return;
    setQrBusy(true);
    setQrMsg(null);
    try {
      const r = await postChannelQrForTeam(team.id);
      setQrMsg(`✓ QR posted · scans to ${r.qr_target_url}`);
    } catch (err: any) {
      setQrMsg(`✗ ${err.message ?? String(err)}`);
    } finally {
      setQrBusy(false);
    }
  };

  const completenessTone =
    pct >= 80 ? 'text-lime-300' : pct >= 50 ? 'text-amber-400' : 'text-rose-400';

  return (
    <>
    <div
      onClick={onToggle}
      className={`bg-ink-800/60 border rounded-xl p-5 cursor-pointer transition select-none ${
        expanded ? 'border-lime-500/60 ring-1 ring-lime-500/20' : 'border-slate-700/40 hover:border-lime-500/40'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-bold truncate">{team.name}</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Mentor: <span className="text-slate-200">{team.mentor_name || '—'}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {team.ai_scores && team.ai_scores.overall && (
            <AIScoreBlock scores={team.ai_scores} inline />
          )}
          <div className={`text-2xl font-extrabold ${completenessTone}`}>{pct}%</div>
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {!expanded && (
        team.ai_scores?.summary ? (
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wider text-lime-400 font-bold mb-0.5">AI Summary</div>
            <p className="text-sm text-slate-200 line-clamp-3 italic">{team.ai_scores.summary}</p>
          </div>
        ) : team.idea && (
          <p className="text-sm text-slate-300 mt-3 line-clamp-3">{team.idea}</p>
        )
      )}

      {!expanded && (
        <>
          <div className="mt-3 flex flex-wrap">
            {(team.flags || []).slice(0, 6).map((f, i) => (
              <FlagBadge key={i} flag={f} />
            ))}
            {team.flags && team.flags.length > 6 && (
              <span className="text-xs text-slate-400 ml-1">+{team.flags.length - 6} more</span>
            )}
          </div>
          <div className="mt-4 pt-3 border-t border-slate-700/40 text-xs text-slate-400">
            <div className="flex justify-between gap-3">
              <span className="shrink-0">{team.members.length} member{team.members.length === 1 ? '' : 's'}</span>
              <span className="text-right">
                {(() => {
                  const us = team.members.filter((m) => m.location === 'US').length;
                  const india = team.members.filter((m) => m.location === 'India').length;
                  const ph = team.members.filter((m) => m.location === 'Philippines').length;
                  // Anything that isn't a standard country goes into "Others"
                  // with the actual country names listed comma-separated so
                  // organizers can see at a glance who's in scope.
                  const others = team.members
                    .map((m) => (m.location || '').trim())
                    .filter((loc) => loc && !['US', 'India', 'Philippines'].includes(loc));
                  const othersDedup = Array.from(new Set(others));
                  return (
                    <>
                      {us} US · {india} IN · {ph} PH
                      {others.length > 0 && (
                        <>
                          {' '}· {others.length} Others
                          <span className="text-slate-500"> ({othersDedup.join(', ')})</span>
                        </>
                      )}
                    </>
                  );
                })()}
              </span>
            </div>
            {/* Floor-walk seat row — green if set, amber if pending. */}
            <div className="mt-1.5">
              {team.seat_floor && team.seat_desk ? (
                <>
                  <span className="text-emerald-300/90">
                    📍 {team.seat_floor} floor · Desk {team.seat_desk}
                    {team.seat_landmark && <span className="text-slate-500"> · {team.seat_landmark}</span>}
                  </span>
                  {team.seat_updated_by && (
                    <div className="text-slate-500 text-[11px] mt-0.5">
                      by {team.seat_updated_by}
                    </div>
                  )}
                </>
              ) : (
                <span className="text-amber-300/80">
                  📍 Seat location not set yet
                </span>
              )}
            </div>
          </div>
        </>
      )}

      {expanded && (
        <div className="mt-4 pt-4 border-t border-slate-700/40 space-y-4" onClick={(e) => e.stopPropagation()}>

          <div className="flex justify-end items-center gap-2 flex-wrap">
            {team.has_teams_channel ? (
              <span
                className="text-xs px-3 py-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 flex items-center gap-1.5"
                title={team.teams_channel_id || ''}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Teams channel created
              </span>
            ) : (
              <>
                <button
                  onClick={handleCreateChannel}
                  disabled={channelBusy}
                  className="text-xs px-3 py-1 rounded-md border border-violet-500/40 hover:bg-violet-500/10 text-violet-200 disabled:opacity-40 transition flex items-center gap-1.5"
                  title="Create a private Teams channel for this team and add all members + mentor"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  {channelBusy ? 'Creating…' : 'Create Teams channel'}
                </button>
                <button
                  onClick={handleAdoptByLink}
                  disabled={channelBusy}
                  className="text-xs px-2 py-1 rounded-md border border-slate-600 hover:border-amber-400 hover:text-amber-300 text-slate-400 disabled:opacity-40 transition"
                  title="If a channel for this team already exists in Microsoft Teams, paste its link here to link it (no recreate)."
                >
                  🔗 Link existing
                </button>
              </>
            )}
            {team.has_teams_channel && team.teams_channel_id && !team.teams_channel_id.startsWith('sandbox-') && !team.teams_channel_id.startsWith('mock-') && (
              <>
                <button
                  onClick={handlePostWelcome}
                  disabled={welcomeBusy}
                  className="text-xs px-3 py-1 rounded-md border border-sky-500/40 hover:bg-sky-500/10 text-sky-200 disabled:opacity-40 transition flex items-center gap-1.5"
                  title="Post the RealHack 2026 welcome message in the team's channel, @mentioning the mentor and all members"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  {welcomeBusy ? 'Posting…' : 'Post welcome to channel'}
                </button>
                <button
                  onClick={handlePostQr}
                  disabled={qrBusy}
                  className="text-xs px-3 py-1 rounded-md border border-cyan-500/40 hover:bg-cyan-500/10 text-cyan-200 disabled:opacity-40 transition flex items-center gap-1.5"
                  title="Post the floor-walk QR-code message in the team's channel — they get their team's QR inlined as an image"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 4h2v2h-2v-2zm4 0h2v2h-2v-2zm-4-4h6v2h-6v-2z" />
                  </svg>
                  {qrBusy ? 'Posting…' : 'Post QR to channel'}
                </button>
              </>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                // Build a mailto: link with members in To, mentor + default
                // org CCs in Cc, an empty subject + body so the organizer
                // types the message in Outlook itself. window.open in a new
                // tab so the dashboard stays put.
                const memberEmails = team.members.map((m) => m.email).filter((x): x is string => !!x);
                const ccList: string[] = [];
                if (team.mentor_email) ccList.push(team.mentor_email);
                ccList.push('RealHack@realpage.com', 'bhaskar.jaddu@RealPage.com', 'Suneel.Nallu@RealPage.com');
                const params = new URLSearchParams();
                params.set('cc', ccList.join(','));
                params.set('subject', `RealHack 2026 — Team ${team.name}`);
                const url = `mailto:${memberEmails.join(',')}?${params.toString().replace(/\+/g, '%20')}`;
                window.open(url, '_blank');
              }}
              disabled={team.members.every((m) => !m.email)}
              className="text-xs px-3 py-1 rounded-md border border-amber-500/40 hover:bg-amber-500/10 text-amber-200 disabled:opacity-40 transition flex items-center gap-1.5"
              title="Open Outlook with this team's members in To and the mentor + organizers in Cc"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Send mail
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditOpen(true);
              }}
              className="text-xs px-3 py-1 rounded-md border border-sky-500/40 hover:bg-sky-500/10 text-sky-200 transition flex items-center gap-1.5"
              title="Update idea, mentor, or members (audit-logged)"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit team
            </button>
          </div>
          {channelMsg && (
            <div className={`text-xs ${channelMsg.startsWith('✓') ? 'text-emerald-300' : 'text-rose-300'}`}>
              {channelMsg}
            </div>
          )}
          {welcomeMsg && (
            <div className={`text-xs ${welcomeMsg.startsWith('✓') ? 'text-emerald-300' : 'text-rose-300'}`}>
              {welcomeMsg}
            </div>
          )}
          {qrMsg && (
            <div className={`text-xs ${qrMsg.startsWith('✓') ? 'text-emerald-300' : 'text-rose-300'}`}>
              {qrMsg}
            </div>
          )}

          {team.ai_scores?.summary && (
            <div className="bg-lime-500/5 border border-lime-500/20 rounded-lg p-3">
              <h4 className="text-xs uppercase tracking-wider text-lime-400 mb-1 font-bold">AI Summary</h4>
              <p className="text-sm text-slate-100 italic">{team.ai_scores.summary}</p>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs uppercase tracking-wider text-slate-400">AI Screen</h4>
              {onRescore && (
                <button
                  onClick={onRescore}
                  className="text-xs px-2 py-0.5 rounded border border-slate-700/40 hover:border-lime-500/50 hover:bg-lime-500/10 text-slate-300 transition"
                >
                  {team.ai_scores?.overall ? 'Rescore' : 'Run AI Screen'}
                </button>
              )}
            </div>
            <AIScoreBlock scores={team.ai_scores} />
          </div>

          {onReload && (
            <div className="pt-3 border-t border-slate-700/40">
              <TeamReadiness team={team} onReload={onReload} />
            </div>
          )}

          <div>
            <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-1">Team Members ({team.members.length})</h4>
            <div className="space-y-1.5">
              {team.members.length === 0 && (
                <p className="text-sm text-slate-500 italic">No members listed.</p>
              )}
              {team.members.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 bg-ink-900/50 rounded px-3 py-1.5 text-sm">
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-slate-100">{m.name}</span>
                    {m.email && <span className="text-slate-400 ml-2 text-xs">{m.email}</span>}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="px-1.5 py-0.5 rounded bg-ink-800 border border-slate-700/40">{m.location || '—'}</span>
                    <span className="px-1.5 py-0.5 rounded bg-ink-800 border border-slate-700/40">{m.tshirt_size || '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {team.mentor_name && (
            <div>
              <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-1">Mentor</h4>
              <div className="text-sm">
                <span className="font-semibold text-slate-100">{team.mentor_name}</span>
                {team.mentor_email && <span className="text-slate-400 ml-2 text-xs">{team.mentor_email}</span>}
              </div>
            </div>
          )}

          {team.idea && (
            <div>
              <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-1">Idea / Problem Statement</h4>
              <p className="text-sm text-slate-200 whitespace-pre-wrap">{team.idea}</p>
            </div>
          )}

          {team.tools && (
            <div>
              <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-1">Tech Stack / Tools</h4>
              <p className="text-sm text-slate-200 whitespace-pre-wrap">{team.tools}</p>
            </div>
          )}

          {team.approach && (
            <div>
              <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-1">Approach</h4>
              <p className="text-sm text-slate-200 whitespace-pre-wrap">{team.approach}</p>
            </div>
          )}

          {team.viability && (
            <div>
              <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-1">Viability</h4>
              <p className="text-sm text-slate-200 whitespace-pre-wrap">{team.viability}</p>
            </div>
          )}

          {team.business_value && (
            <div>
              <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-1">Business Value</h4>
              <p className="text-sm text-slate-200 whitespace-pre-wrap">{team.business_value}</p>
            </div>
          )}

          {team.flags && team.flags.length > 0 && (
            <div>
              <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-1">All Flags ({team.flags.length})</h4>
              <div className="flex flex-wrap">
                {team.flags.map((f, i) => (
                  <FlagBadge key={i} flag={f} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
    {editOpen && (
      <TeamEditModal
        team={team}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          if (onReload) onReload();
        }}
      />
    )}
    </>
  );
}
