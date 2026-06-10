import { useEffect, useState } from 'react';
import { fetchSeatCoverage, postChannelQrAllForce, type SeatCoverage, type PostQrBulkResult } from '../api';

/**
 * Floor-walk coverage dashboard panel. Shows how many teams have filled in
 * their seat info via the public /team/<id> page and surfaces the laggards
 * alphabetically so organizers can chase them. Also exposes a 'Re-post QR
 * (force)' button -- used after the QR-channel template changes (e.g. when
 * we added the seat call-to-action) and we need every team to see the new
 * message even though they already received the old one.
 */
export function SeatCoveragePanel() {
  const [data, setData] = useState<SeatCoverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [repostBusy, setRepostBusy] = useState(false);
  const [repostResult, setRepostResult] = useState<PostQrBulkResult | null>(null);
  const [repostError, setRepostError] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    fetchSeatCoverage()
      .then(setData)
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { reload(); }, []);

  const handleForceRepost = async () => {
    if (!data) return;
    const confirmText =
      `Re-post the QR-code message (with the updated 'enter your seat' call to action) to all ${data.total} team channels?\n\n` +
      `This BYPASSES the 'already posted' check -- every team will get the new message, even if they already received the old QR post. Use this when the template itself has changed and you need everyone to see the updated text.\n\n` +
      `Takes ~3-4 min. Keep this tab open.`;
    if (!confirm(confirmText)) return;
    setRepostBusy(true);
    setRepostError(null);
    setRepostResult(null);
    try {
      const r = await postChannelQrAllForce();
      setRepostResult(r);
    } catch (e: any) {
      setRepostError(e.message ?? String(e));
    } finally {
      setRepostBusy(false);
    }
  };

  if (loading) {
    return <div className="text-slate-400 text-sm">Loading floor-walk coverage…</div>;
  }
  if (error || !data) {
    return (
      <div className="bg-rose-500/10 border border-rose-500/40 rounded-xl p-4 text-sm text-rose-200">
        Failed to load coverage: {error}
      </div>
    );
  }

  const pct = data.total > 0 ? Math.round((data.submitted_count / data.total) * 100) : 0;
  const floors = Object.entries(data.by_floor).sort();

  return (
    <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-slate-100">Floor-walk coverage</h3>
          <p className="text-sm text-slate-400">
            Teams self-serve their seat info via the QR-linked page. This shows who has and who hasn't.
          </p>
        </div>
        <button
          onClick={reload}
          className="text-xs px-3 py-1 rounded border border-slate-600/40 hover:bg-slate-700/20 text-slate-300 transition"
        >
          Refresh
        </button>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex items-baseline justify-between text-sm mb-1">
          <span className="text-slate-300">
            <strong className="text-lime-300 text-lg">{data.submitted_count}</strong>
            <span className="text-slate-500"> of </span>
            <strong>{data.total}</strong> teams have shared their seat
          </span>
          <span className="text-slate-400 text-xs">{pct}%</span>
        </div>
        <div className="h-2 bg-ink-900 rounded-full overflow-hidden">
          <div
            className="h-full bg-lime-400 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Floor distribution */}
      {floors.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {floors.map(([floor, count]) => (
            <span
              key={floor}
              className="text-xs px-3 py-1 rounded-full border border-slate-600/40 bg-slate-800/40 text-slate-300"
            >
              <strong className="text-slate-100">{count}</strong> on {floor} floor
            </span>
          ))}
        </div>
      )}

      {/* Pending list */}
      {data.pending_count > 0 ? (
        <div>
          <div className="text-sm font-semibold text-amber-300 mb-2">
            ⚠ {data.pending_count} team{data.pending_count === 1 ? '' : 's'} pending
            <span className="text-slate-500 font-normal ml-2">(alphabetical · click to copy team name)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-64 overflow-y-auto">
            {data.pending.map((t) => (
              <button
                key={t.id}
                onClick={() => navigator.clipboard.writeText(t.name)}
                className="text-left text-xs px-2 py-1.5 rounded border border-slate-700/40 hover:bg-slate-700/20 text-slate-300 transition"
                title={`Mentor: ${t.mentor_name || '—'}${t.has_channel ? '' : ' · No Teams channel yet'}`}
              >
                <span className={t.has_channel ? '' : 'opacity-60'}>{t.name}</span>
                {!t.has_channel && <span className="text-slate-500 ml-1">(no channel)</span>}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-sm text-lime-300">
          ✓ Every team has shared their seat info.
        </div>
      )}

      {/* Re-post action */}
      <div className="pt-3 border-t border-slate-700/40 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <p className="text-sm text-slate-300 font-semibold">Re-post the QR message (force)</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Use this after changing the QR template text. Bypasses the 'already posted' check so every team sees the new message — even if they already received the old QR post.
          </p>
        </div>
        <button
          onClick={handleForceRepost}
          disabled={repostBusy}
          className="bg-cyan-400 hover:bg-cyan-300 disabled:opacity-40 text-ink-950 font-bold px-4 py-2 rounded text-sm transition"
        >
          {repostBusy ? 'Re-posting…' : `🔁 Re-post to ${data.total} channels`}
        </button>
      </div>
      {repostResult && (
        <div className="text-sm text-lime-300">
          ✓ Re-posted to {repostResult.posted_count} channel{repostResult.posted_count === 1 ? '' : 's'}.
          {repostResult.failed_count > 0 && (
            <span className="text-rose-300"> · {repostResult.failed_count} failed.</span>
          )}
        </div>
      )}
      {repostError && (
        <div className="text-sm text-rose-300">⚠ {repostError}</div>
      )}
    </div>
  );
}
