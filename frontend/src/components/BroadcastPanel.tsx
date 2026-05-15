import { useEffect, useState } from 'react';
import type { Team } from '../types';
import { commsMode, broadcastMessage } from '../api';

interface Props {
  teams: Team[];
  onReload: () => void;
}

export function BroadcastPanel({ teams, onReload }: Props) {
  const [mode, setMode] = useState<string>('mock');
  const [message, setMessage] = useState('');
  const [stage, setStage] = useState<'draft' | 'confirming' | 'sending'>('draft');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    commsMode().then((r) => setMode(r.mode)).catch(() => {});
  }, []);

  const isMock = mode === 'mock';
  const teamCount = teams.length;
  const messageOK = message.trim().length > 0;

  const handleSend = async () => {
    setStage('sending');
    setError(null);
    setResult(null);
    try {
      const r = await broadcastMessage(message.trim(), null, 'organizer@realpage.com');
      setResult(`Broadcast posted to ${r.posted_to} team channel${r.posted_to === 1 ? '' : 's'} · mode=${r.mode}`);
      setMessage('');
      setStage('draft');
      onReload();
    } catch (e: any) {
      setError(e.message ?? String(e));
      setStage('confirming'); // let them retry from confirmation
    }
  };

  return (
    <div className="bg-ink-800/60 border-2 border-amber-500/30 rounded-xl p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h3 className="font-bold flex items-center gap-2">
            <span className="text-amber-400">📢</span> Broadcast to ALL teams
          </h3>
          <p className="text-sm text-slate-400">
            One message posted to every team's channel. Use for global announcements (kickoff time, deadline reminders, results).
          </p>
        </div>
        {isMock && (
          <span className="text-xs px-3 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/40 font-semibold" title="Today, broadcasts are simulated. Real Teams messages will be posted once IT approves the Microsoft Teams integration.">
            ⚠ Simulation mode · nothing is actually sent to Teams yet
          </span>
        )}
      </div>

      <div className="bg-ink-900/50 rounded-lg p-4 space-y-3">
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-slate-400">Message</span>
          <textarea
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              if (stage === 'confirming') setStage('draft'); // editing resets confirmation
            }}
            rows={4}
            disabled={stage === 'sending'}
            placeholder="High-impact action — this goes to every team. Examples: 'Day 1 presentations start at 10am sharp in Hyperion Hall.' / 'Deadline reminder: code freeze tonight at midnight.'"
            className="w-full bg-ink-950 border border-slate-700/40 rounded px-3 py-2 mt-1 text-sm focus:outline-none focus:border-amber-500/60"
          />
        </label>

        {stage === 'draft' && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              {messageOK ? `${message.trim().length} characters · will post to ${teamCount} teams` : 'Enter a message to enable send'}
            </p>
            <button
              disabled={!messageOK}
              onClick={() => setStage('confirming')}
              className="bg-amber-400 hover:bg-amber-300 disabled:opacity-30 text-ink-950 font-bold px-4 py-2 rounded text-sm transition"
            >
              Review &amp; send →
            </button>
          </div>
        )}

        {stage === 'confirming' && (
          <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg p-4">
            <h4 className="font-bold text-amber-200 mb-2">⚠ Confirm broadcast</h4>
            <p className="text-sm text-slate-200 mb-2">
              This will post the message above to <span className="font-extrabold text-amber-300">{teamCount} team channel{teamCount === 1 ? '' : 's'}</span>
              {isMock ? ' (simulated today — once Graph API is live, this becomes a real send).' : '.'}
            </p>
            <div className="bg-ink-900/60 rounded p-2 mb-3 text-xs text-slate-300 italic max-h-32 overflow-y-auto whitespace-pre-wrap">
              "{message.trim()}"
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setStage('draft')}
                className="text-sm text-slate-400 hover:text-white px-3 py-2"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                className="bg-amber-400 hover:bg-amber-300 text-ink-950 font-bold px-5 py-2 rounded text-sm transition"
              >
                Yes — post to all {teamCount} teams
              </button>
            </div>
          </div>
        )}

        {stage === 'sending' && (
          <div className="text-sm text-slate-400 italic">Sending…</div>
        )}
      </div>

      {result && <div className="text-sm text-lime-300 mt-3">✓ {result}</div>}
      {error && <div className="text-sm text-rose-300 mt-3">⚠ {error}</div>}
    </div>
  );
}
