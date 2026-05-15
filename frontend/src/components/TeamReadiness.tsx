import { useEffect, useState } from 'react';
import type { Team, CommLogEntry } from '../types';
import { checkRepo, updateReadiness, postTeamMessage, fetchCommLog } from '../api';

interface Props {
  team: Team;
  onReload: () => void;
}

function ago(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function kindBadge(kind: string): { label: string; color: string } {
  switch (kind) {
    case 'email':                  return { label: 'Email',         color: 'bg-sky-500/15 text-sky-300 border-sky-500/40' };
    case 'teams_message':          return { label: 'Teams msg',     color: 'bg-violet-500/15 text-violet-300 border-violet-500/40' };
    case 'teams_broadcast':        return { label: 'Broadcast',     color: 'bg-violet-500/15 text-violet-300 border-violet-500/40' };
    case 'teams_channel_create':   return { label: 'Channel',       color: 'bg-lime-500/15 text-lime-300 border-lime-500/40' };
    default:                       return { label: kind,            color: 'bg-slate-500/15 text-slate-300 border-slate-500/40' };
  }
}

export function TeamReadiness({ team, onReload }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [log, setLog] = useState<CommLogEntry[]>([]);
  const [repoUrl, setRepoUrl] = useState(team.repo_url ?? '');

  const reloadLog = async () => {
    try {
      const entries = await fetchCommLog({ team_id: team.id, limit: 50 });
      setLog(entries);
    } catch {}
  };

  useEffect(() => { reloadLog(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [team.id]);

  const runCheck = async (label: string, fn: () => Promise<any>) => {
    setBusy(label);
    setError(null);
    setInfo(null);
    try {
      await fn();
      await reloadLog();
      onReload();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleCheckRepo = () => runCheck('repo', async () => {
    const r = await checkRepo(team.id);
    setInfo(`Repo check: ${r.ready ? '✓ ready' : '⚠ not ready'} — ${r.notes}`);
  });

  const handleSaveRepoUrl = () => runCheck('repo_url', async () => {
    await updateReadiness(team.id, { repo_url: repoUrl.trim() || null });
    setInfo('Repo URL saved');
  });

  const handleTogglePresentation = () => runCheck('presentation', async () => {
    await updateReadiness(team.id, { presentation_uploaded: !team.presentation_uploaded });
  });

  const handleSendMessage = () => runCheck('message', async () => {
    if (!msg.trim()) return;
    await postTeamMessage(team.id, msg.trim(), 'organizer@realpage.com');
    setMsg('');
    setInfo('Message posted to team channel');
  });

  const readinessRow = (
    label: string,
    ok: boolean,
    detail: string,
    action?: React.ReactNode,
  ) => (
    <div className="flex items-center justify-between gap-3 px-3 py-2 bg-ink-900/40 rounded">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className={`text-lg ${ok ? 'text-lime-300' : 'text-slate-500'}`}>{ok ? '✓' : '○'}</span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-100">{label}</div>
          <div className="text-xs text-slate-400 truncate">{detail}</div>
        </div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );

  return (
    <div className="space-y-3">
      <h4 className="text-xs uppercase tracking-wider text-slate-400">Readiness checks</h4>

      <div className="space-y-2">
        {/* Teams channel */}
        {readinessRow(
          'Teams channel',
          team.has_teams_channel,
          team.has_teams_channel
            ? `Created ${team.teams_channel_created_at ? ago(team.teams_channel_created_at) : ''} · id ${team.teams_channel_id?.slice(0, 18) || '—'}…`
            : 'Channel not created yet — use the Teams Comms panel to create.',
          team.has_teams_channel ? null : (
            <span className="text-xs text-slate-500 italic">create via panel</span>
          ),
        )}

        {/* Repo link */}
        <div className="bg-ink-900/40 rounded p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-lg ${team.repo_url ? 'text-lime-300' : 'text-slate-500'}`}>{team.repo_url ? '✓' : '○'}</span>
            <div className="text-sm font-semibold text-slate-100">Repo link</div>
          </div>
          <div className="flex gap-2">
            <input
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              className="flex-1 bg-ink-950 border border-slate-700/40 rounded px-2 py-1 text-xs focus:outline-none focus:border-lime-500/60"
            />
            <button
              disabled={busy === 'repo_url'}
              onClick={handleSaveRepoUrl}
              className="text-xs bg-ink-800 border border-slate-700/40 hover:border-lime-500/40 rounded px-2 py-1 transition"
            >
              {busy === 'repo_url' ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {/* Repo readiness */}
        {readinessRow(
          'Repo readiness',
          team.repo_ready,
          team.repo_check_notes || (team.repo_url ? 'Not checked yet' : 'No repo URL'),
          <button
            disabled={busy === 'repo' || !team.repo_url}
            onClick={handleCheckRepo}
            className="text-xs bg-ink-800 border border-slate-700/40 hover:border-lime-500/40 rounded px-2 py-1 transition disabled:opacity-40"
          >
            {busy === 'repo' ? 'Checking…' : 'Check now'}
          </button>,
        )}

        {/* Presentation */}
        {readinessRow(
          'Presentation uploaded',
          team.presentation_uploaded,
          team.presentation_uploaded ? 'Marked uploaded by organizer' : 'Not marked yet (manual flag)',
          <button
            disabled={busy === 'presentation'}
            onClick={handleTogglePresentation}
            className="text-xs bg-ink-800 border border-slate-700/40 hover:border-lime-500/40 rounded px-2 py-1 transition disabled:opacity-40"
          >
            {team.presentation_uploaded ? 'Mark as missing' : 'Mark as uploaded'}
          </button>,
        )}
      </div>

      {/* Custom message */}
      <div className="bg-ink-900/40 rounded p-3 space-y-2">
        <h5 className="text-xs uppercase tracking-wider text-slate-400">Send a custom message to this team</h5>
        <textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          rows={2}
          placeholder="E.g. 'Reminder: please post your GitHub link in this channel before tomorrow 9am.'"
          className="w-full bg-ink-950 border border-slate-700/40 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-violet-500/60"
        />
        <button
          disabled={busy === 'message' || !msg.trim()}
          onClick={handleSendMessage}
          className="bg-violet-400 hover:bg-violet-300 disabled:opacity-40 text-ink-950 font-bold px-3 py-1.5 rounded text-xs transition"
        >
          {busy === 'message' ? 'Posting…' : 'Post to team channel'}
        </button>
      </div>

      {info && <div className="text-xs text-lime-300">✓ {info}</div>}
      {error && <div className="text-xs text-rose-300">⚠ {error}</div>}

      {/* Audit log */}
      <div>
        <h5 className="text-xs uppercase tracking-wider text-slate-400 mb-2">Communication history <span className="text-slate-500 font-normal normal-case">· {log.length} entr{log.length === 1 ? 'y' : 'ies'}</span></h5>
        {log.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No communications logged for this team yet.</p>
        ) : (
          <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {log.map((e) => {
              const b = kindBadge(e.kind);
              return (
                <div key={e.id} className="bg-ink-900/40 rounded px-2 py-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-semibold ${b.color}`}>{b.label}</span>
                    <span className="text-slate-300 font-semibold flex-1 truncate">{e.subject || e.body?.slice(0, 60) || '—'}</span>
                    <span className="text-slate-500 shrink-0">{ago(e.sent_at)}</span>
                  </div>
                  {e.body && e.subject && (
                    <p className="text-slate-400 mt-0.5 line-clamp-2 pl-1">{e.body}</p>
                  )}
                  <div className="text-slate-600 mt-0.5 pl-1">
                    {e.sent_by_email && <>by {e.sent_by_email}</>}
                    {e.status === 'mocked' && <span className="ml-2 text-amber-400">(mocked · pending Graph)</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
