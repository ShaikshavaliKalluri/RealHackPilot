import type { Team } from '../types';
import { FlagBadge } from './FlagBadge';
import { AIScoreBlock } from './AIScoreBlock';
import { TeamReadiness } from './TeamReadiness';

interface Props {
  team: Team;
  expanded: boolean;
  onToggle: () => void;
  onRescore?: () => void;
  onReload?: () => void;
}

export function TeamCard({ team, expanded, onToggle, onRescore, onReload }: Props) {
  const pct = Math.round(team.completeness_score * 100);
  const completenessTone =
    pct >= 80 ? 'text-lime-300' : pct >= 50 ? 'text-amber-400' : 'text-rose-400';

  return (
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
            <div className="flex justify-between">
              <span>{team.members.length} member{team.members.length === 1 ? '' : 's'}</span>
              <span>
                {team.members.filter((m) => m.location === 'US').length} US ·{' '}
                {team.members.filter((m) => m.location === 'India').length} IN ·{' '}
                {team.members.filter((m) => m.location === 'Philippines').length} PH
              </span>
            </div>
          </div>
        </>
      )}

      {expanded && (
        <div className="mt-4 pt-4 border-t border-slate-700/40 space-y-4" onClick={(e) => e.stopPropagation()}>

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
  );
}
