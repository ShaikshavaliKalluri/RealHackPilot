import type { AIScores } from '../types';

interface Props {
  scores: AIScores | null | undefined;
  inline?: boolean;
}

const AXES: { key: keyof AIScores; label: string }[] = [
  { key: 'genuineness', label: 'Genuineness' },
  { key: 'solution_clarity', label: 'Solution clarity' },
  { key: 'business_value', label: 'Business value' },
  { key: 'novelty', label: 'Novelty' },
];

function toneFor(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'text-slate-400';
  if (score >= 4) return 'text-lime-300';
  if (score >= 3) return 'text-amber-300';
  return 'text-rose-300';
}

function bgFor(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'bg-slate-700/40';
  if (score >= 4) return 'bg-lime-500/15 border-lime-500/40';
  if (score >= 3) return 'bg-amber-500/15 border-amber-500/40';
  return 'bg-rose-500/15 border-rose-500/40';
}

export function AIScoreBlock({ scores, inline = false }: Props) {
  if (!scores || scores.error) {
    return (
      <div className="text-xs text-slate-500 italic">
        {scores?.error ? `AI screen error: ${scores.error}` : 'Not yet AI-screened.'}
      </div>
    );
  }

  if (inline) {
    // Compact inline view for the team card collapsed state
    const overall = scores.overall?.score;
    return (
      <div className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded border ${bgFor(overall)}`}>
        <span className="opacity-70">AI</span>
        <span className={toneFor(overall)}>{overall ?? '—'}</span>
        <span className="opacity-50">/5</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className={`px-3 py-1 rounded-full border font-bold text-sm ${bgFor(scores.overall?.score)}`}>
          AI overall: <span className={toneFor(scores.overall?.score)}>{scores.overall?.score ?? '—'}/5</span>
        </div>
        {scores.overall?.headline && (
          <span className="text-sm text-slate-300 italic">"{scores.overall.headline}"</span>
        )}
        {scores.provider && (
          <span className="text-xs text-slate-500">
            via {scores.provider}{scores.model ? ` · ${scores.model}` : ''}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {AXES.map(({ key, label }) => {
          const axis = scores[key] as { score: number | null; reason: string } | undefined;
          const score = axis?.score;
          return (
            <div key={key} className={`rounded border px-3 py-2 ${bgFor(score)}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider">{label}</span>
                <span className={`text-lg font-extrabold ${toneFor(score)}`}>{score ?? '—'}</span>
              </div>
              {axis?.reason && (
                <p className="text-xs text-slate-300 mt-1 leading-snug">{axis.reason}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
