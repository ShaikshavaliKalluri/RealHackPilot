import { useEffect, useMemo, useState } from 'react';
import {
  fetchBUTaxonomy, fetchBUReportData, classifyBUTeams, summarizeBUTeams,
  overrideBUClassification, overrideLeadershipSummary, downloadBUReportPptx,
  type BUTaxonomyResponse, type BUReportData, type BUBlock, type BUTeamBlock,
  type BUClassifyResult, type BUSummarizeResult,
} from '../api';

type View = 'editor' | 'presentation';

interface Props {
  onReload?: () => void;
}

export function BUReport({ onReload: _onReload }: Props) {
  void _onReload;
  // Default landing view is Presentation -- this is a document, not a
  // spreadsheet. Editor is a power-user tab for overrides.
  const [view, setView] = useState<View>('presentation');
  const [round, setRound] = useState<number>(1);
  const [taxonomy, setTaxonomy] = useState<BUTaxonomyResponse | null>(null);
  const [data, setData] = useState<BUReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState<'classify' | 'summarize' | 'summarize_with_judges' | null>(null);
  const [bulkLog, setBulkLog] = useState<string[]>([]);
  const [editingTeamId, setEditingTeamId] = useState<number | null>(null);
  // Full-pipeline state: running the entire classify -> summarize -> judge
  // synthesis chain in one shot. When running, the presentation view shows
  // a progress overlay instead of the (partially populated) report.
  const [pipelineStep, setPipelineStep] = useState<string | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setErr(null);
    try {
      const [tax, d] = await Promise.all([fetchBUTaxonomy(), fetchBUReportData(round)]);
      setTaxonomy(tax);
      setData(d);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [round]); // eslint-disable-line react-hooks/exhaustive-deps

  const allTeamIds = useMemo(() => {
    if (!data) return [];
    const ids: number[] = [];
    for (const bu of data.bus) {
      ids.push(...bu.standouts.map((t) => t.team_id));
      ids.push(...bu.long_tail.map((t) => t.team_id));
    }
    ids.push(...data.unclassified.map((t) => t.team_id));
    return ids;
  }, [data]);

  const unclassifiedIds = useMemo(
    () => data?.unclassified.map((t) => t.team_id) ?? [],
    [data],
  );

  const unsummarizedIds = useMemo(() => {
    if (!data) return [];
    const ids: number[] = [];
    for (const bu of data.bus) {
      for (const t of [...bu.standouts, ...bu.long_tail]) {
        if (!t.summary) ids.push(t.team_id);
      }
    }
    return ids;
  }, [data]);

  const bulkClassify = async (ids: number[], force = false) => {
    if (ids.length === 0) {
      alert('Nothing to classify.');
      return;
    }
    const label = force ? `Re-classify all ${ids.length}?` : `Classify ${ids.length} unclassified team${ids.length === 1 ? '' : 's'}?`;
    if (!confirm(label)) return;
    setBulkBusy('classify');
    setBulkLog([]);
    try {
      const results = await classifyBUTeams(ids, force);
      const counts = summarizeCounts(results);
      setBulkLog([
        `Classified: ${counts.classified ?? 0}`,
        `Skipped (already had classification): ${counts.skipped_existing ?? 0}`,
        `No idea text: ${counts.no_idea ?? 0}`,
        `Failed: ${counts.failed ?? 0}`,
      ]);
      await reload();
    } catch (e: any) {
      alert(`Bulk classify failed: ${e?.message ?? e}`);
    } finally {
      setBulkBusy(null);
    }
  };

  const bulkSummarize = async (ids: number[], withJudges: boolean, force = false) => {
    if (ids.length === 0) {
      alert('Nothing to summarize.');
      return;
    }
    const cost = ids.length * (withJudges ? 2 : 1);
    if (!confirm(`Summarize ${ids.length} team${ids.length === 1 ? '' : 's'}${withJudges ? ' + judge synthesis' : ''}? (~${cost} LLM calls)`)) return;
    setBulkBusy(withJudges ? 'summarize_with_judges' : 'summarize');
    setBulkLog([]);
    try {
      const results = await summarizeBUTeams(ids, round, { force, withJudgeSynthesis: withJudges });
      const counts = summarizeCountsSum(results);
      setBulkLog([
        `Summarized: ${counts.summarized ?? 0}`,
        `Skipped (already had summary): ${counts.skipped_existing ?? 0}`,
        `No idea text: ${counts.no_idea ?? 0}`,
        `Failed: ${counts.failed ?? 0}`,
      ]);
      await reload();
    } catch (e: any) {
      alert(`Bulk summarize failed: ${e?.message ?? e}`);
    } finally {
      setBulkBusy(null);
    }
  };

  // ---------- Full pipeline (one-click auto-generate) ----------
  // Runs the entire generation flow: classify every team -> summarize every
  // team -> synthesize judge feedback for the top-3-per-BU standouts.
  // The organizer isn't expected to click through 3 different bulk buttons
  // just to get a leadership doc.
  const runFullPipeline = async (opts: { force?: boolean } = {}) => {
    const force = !!opts.force;
    if (!data) return;
    setPipelineError(null);
    try {
      // Load a fresh copy of the report to snapshot which teams exist.
      const dNow = await fetchBUReportData(round);
      const everyId: number[] = [];
      for (const bu of dNow.bus) {
        everyId.push(...bu.standouts.map((t) => t.team_id));
        everyId.push(...bu.long_tail.map((t) => t.team_id));
      }
      everyId.push(...dNow.unclassified.map((t) => t.team_id));

      if (everyId.length === 0) {
        setPipelineError('No teams with idea text to report on.');
        return;
      }

      // Step 1: classify (skips teams already classified unless force=true)
      setPipelineStep(`Classifying ${everyId.length} idea${everyId.length === 1 ? '' : 's'} into RealPage BUs…`);
      await classifyBUTeams(everyId, force);

      // Step 2: summarize + AI score
      setPipelineStep(`Writing leadership summaries for ${everyId.length} idea${everyId.length === 1 ? '' : 's'}…`);
      await summarizeBUTeams(everyId, round, { force, withJudgeSynthesis: false });

      // Step 3: re-fetch report to find the top-3-per-BU standouts, then
      // synthesize judge feedback for just those (cost + political control).
      setPipelineStep('Identifying standouts (top 3 per BU)…');
      const d2 = await fetchBUReportData(round);
      const standoutIdsList = d2.bus.flatMap((bu) => bu.standouts.map((t) => t.team_id));
      if (standoutIdsList.length > 0) {
        setPipelineStep(`Synthesizing judge feedback for ${standoutIdsList.length} standout${standoutIdsList.length === 1 ? '' : 's'}…`);
        await summarizeBUTeams(standoutIdsList, round, { force: true, withJudgeSynthesis: true });
      }

      setPipelineStep('Refreshing report…');
      await reload();
      setPipelineStep(null);
      setView('presentation');
    } catch (e: any) {
      setPipelineError(e?.message ?? String(e));
      setPipelineStep(null);
    }
  };

  // How complete is the current report? Used to decide between the big
  // Generate CTA (nothing built yet) vs the small Regenerate button.
  const reportProgress = useMemo(() => {
    if (!data) return { classified: 0, summarized: 0, total: 0 };
    let classified = 0;
    let summarized = 0;
    let total = 0;
    for (const bu of data.bus) {
      for (const t of [...bu.standouts, ...bu.long_tail]) {
        total++;
        if (t.bu) classified++;
        if (t.summary) summarized++;
      }
    }
    for (const t of data.unclassified) {
      total++;
      if (t.summary) summarized++;
    }
    return { classified, summarized, total };
  }, [data]);

  const isFirstRun = reportProgress.total > 0 && reportProgress.summarized === 0;
  const pipelineBusy = pipelineStep !== null;

  if (loading && !data) {
    return <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-6 text-sm text-slate-300">Loading BU report…</div>;
  }
  if (err) {
    return <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded p-3 text-sm">{err}</div>;
  }
  if (!data || !taxonomy) return null;

  return (
    <div className="space-y-5">
      <div className="bu-toolbar bg-ink-800/60 border border-slate-700/40 rounded-xl p-4 flex flex-wrap items-center gap-3 justify-between">
        <div className="flex gap-1 bg-ink-900 border border-slate-700/40 rounded-lg p-1">
          <button
            onClick={() => setView('presentation')}
            className={`px-3 py-1.5 rounded text-sm font-semibold transition ${view === 'presentation' ? 'bg-teal-400 text-ink-950' : 'text-slate-300 hover:text-white'}`}
          >
            Presentation
          </button>
          <button
            onClick={() => setView('editor')}
            className={`px-3 py-1.5 rounded text-sm font-semibold transition ${view === 'editor' ? 'bg-teal-400 text-ink-950' : 'text-slate-300 hover:text-white'}`}
            title="Fine-tune BU assignments, summaries, and scores after auto-generation"
          >
            Editor (overrides)
          </button>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-400">Round</div>
            <div className="flex gap-1 bg-ink-900 border border-slate-700/40 rounded-lg p-1 mt-1">
              {[1, 2].map((r) => (
                <button
                  key={r}
                  onClick={() => setRound(r)}
                  className={`px-3 py-1 rounded text-sm font-semibold transition ${round === r ? 'bg-sky-400 text-ink-950' : 'text-slate-300 hover:text-white'}`}
                >
                  R{r}
                </button>
              ))}
            </div>
          </div>
          <div className="text-xs text-slate-400 border-l border-slate-700/40 pl-3">
            <div>
              <strong className="text-slate-100">{data.total_teams}</strong> teams ·{' '}
              <strong className={reportProgress.summarized === reportProgress.total ? 'text-emerald-300' : 'text-amber-300'}>
                {reportProgress.summarized}/{reportProgress.total} written
              </strong>
            </div>
            <div className="mt-0.5">Generated {formatStamp(data.generated_at)}</div>
          </div>
          {!isFirstRun && (
            <button
              onClick={() => runFullPipeline({ force: false })}
              disabled={pipelineBusy}
              className="text-xs px-3 py-1.5 rounded border border-teal-500/40 bg-teal-500/15 hover:bg-teal-500/25 text-teal-200 transition disabled:opacity-50"
              title="Generate anything that hasn't been generated yet (fills in gaps without overwriting)"
            >
              {pipelineBusy ? 'Running…' : '↻ Fill gaps'}
            </button>
          )}
          {!isFirstRun && (
            <button
              onClick={() => {
                if (confirm('Rebuild the entire report from scratch? This overwrites all existing BU classifications, summaries, and judge syntheses.')) {
                  runFullPipeline({ force: true });
                }
              }}
              disabled={pipelineBusy}
              className="text-xs px-3 py-1.5 rounded border border-slate-600 hover:border-slate-400 text-slate-300 transition disabled:opacity-50"
              title="Blow everything away and regenerate. Use after judges submit more scores or teams update their ideas."
            >
              Regenerate all
            </button>
          )}
          <button
            onClick={reload}
            className="text-xs px-3 py-1.5 rounded bg-ink-900 border border-slate-700/40 text-slate-200 hover:border-teal-500/40 transition"
          >
            Refresh
          </button>
          {!isFirstRun && (
            <button
              onClick={async () => {
                try {
                  await downloadBUReportPptx(round);
                } catch (e: any) {
                  alert(`Download failed: ${e?.message ?? e}`);
                }
              }}
              disabled={pipelineBusy}
              className="text-sm px-4 py-2 rounded border-2 border-teal-400 bg-teal-500/25 hover:bg-teal-500/40 text-teal-100 font-semibold transition disabled:opacity-50"
              title="Download a PowerPoint (.pptx) of the leadership report, ready to send"
            >
              ⬇️ Download .pptx
            </button>
          )}
          {view === 'presentation' && !isFirstRun && (
            <button
              onClick={() => window.print()}
              className="text-xs px-3 py-1.5 rounded border border-slate-600 hover:border-slate-400 text-slate-300 transition"
              title="Alternative: browser Print → Save as PDF for a PDF instead of PPT"
            >
              🖨️ Print / PDF
            </button>
          )}
        </div>
      </div>

      {pipelineBusy && (
        <div className="bg-teal-500/10 border border-teal-500/40 rounded-xl p-6 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 rounded-full border-2 border-teal-400 border-t-transparent animate-spin" />
            <div>
              <div className="text-sm font-semibold text-teal-100">Generating leadership report…</div>
              <div className="text-xs text-teal-200/80 mt-0.5">{pipelineStep}</div>
            </div>
          </div>
          <div className="text-xs text-slate-400">
            This runs classify + summarize on every idea and layers judge synthesis on the standouts.
            Roughly a minute of LLM time -- safe to leave the tab open.
          </div>
        </div>
      )}

      {pipelineError && (
        <div className="bg-rose-500/10 border border-rose-500/40 rounded-lg p-3 text-sm text-rose-200">
          <strong>Generation failed:</strong> {pipelineError}
        </div>
      )}

      {isFirstRun && !pipelineBusy && (
        <div className="bg-gradient-to-br from-teal-500/15 to-sky-500/10 border border-teal-500/40 rounded-2xl p-8 text-center space-y-4">
          <div className="text-teal-200 text-sm font-semibold uppercase tracking-widest">RealHack 2026 · Leadership report</div>
          <h2 className="text-2xl font-bold text-slate-100">Generate the BU leadership report</h2>
          <p className="text-slate-300 max-w-2xl mx-auto text-sm leading-relaxed">
            One click classifies every RealHack idea into a RealPage BU (Property &amp; Renters Management,
            Resident Solutions, Business Services, Data Analytics, Mixed Use, Smart Building, or Cross-Cutting),
            writes a 2-3 sentence leadership summary + AI score, and synthesizes judge feedback on the top 3
            standouts per BU. Then hit Print / Save as PDF and send.
          </p>
          <p className="text-xs text-slate-400">
            Covers {data.total_teams} team{data.total_teams === 1 ? '' : 's'} · ~1 minute · &lt; $1 of Anthropic Haiku
          </p>
          <button
            onClick={() => runFullPipeline({ force: false })}
            disabled={pipelineBusy}
            className="text-base px-6 py-3 rounded-lg border-2 border-teal-400 bg-teal-500/25 hover:bg-teal-500/40 text-teal-100 font-semibold transition"
          >
            🚀 Generate report
          </button>
        </div>
      )}

      {view === 'editor' && (
        <>
          <div className="bu-toolbar bg-ink-800/60 border border-slate-700/40 rounded-xl p-4 flex flex-wrap items-center gap-3">
            <button
              onClick={() => bulkClassify(unclassifiedIds)}
              disabled={bulkBusy !== null || unclassifiedIds.length === 0}
              className="text-xs px-3 py-1.5 rounded border border-lime-500/40 hover:border-lime-500/70 hover:bg-lime-500/10 text-lime-200 transition disabled:opacity-50"
            >
              {bulkBusy === 'classify' ? 'Classifying…' : `🤖 Classify unclassified (${unclassifiedIds.length})`}
            </button>
            <button
              onClick={() => bulkClassify(allTeamIds, true)}
              disabled={bulkBusy !== null}
              className="text-xs px-3 py-1.5 rounded border border-slate-600 hover:border-slate-400 text-slate-300 transition disabled:opacity-50"
              title="Re-classify everyone from scratch (blows away existing classifications)"
            >
              ↻ Re-classify all
            </button>
            <button
              onClick={() => bulkSummarize(unsummarizedIds, false)}
              disabled={bulkBusy !== null || unsummarizedIds.length === 0}
              className="text-xs px-3 py-1.5 rounded border border-amber-500/40 hover:border-amber-500/70 hover:bg-amber-500/10 text-amber-200 transition disabled:opacity-50"
            >
              {bulkBusy === 'summarize' ? 'Summarizing…' : `🤖 Summarize un-summarized (${unsummarizedIds.length})`}
            </button>
            <button
              onClick={() => bulkSummarize(standoutIds(data), true, true)}
              disabled={bulkBusy !== null}
              className="text-xs px-3 py-1.5 rounded border border-violet-500/40 hover:border-violet-500/70 hover:bg-violet-500/10 text-violet-200 transition disabled:opacity-50"
              title="Regenerate summary + judge synthesis for the top-3-per-BU standouts (extra LLM cost)"
            >
              {bulkBusy === 'summarize_with_judges' ? 'Synthesizing…' : `🎯 Synthesize standouts + judges`}
            </button>
          </div>

          {bulkLog.length > 0 && (
            <div className="bg-ink-900/60 border border-slate-700/40 rounded-lg p-3 text-xs text-slate-300 space-y-1">
              {bulkLog.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          )}

          {data.unclassified.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-4 space-y-2">
              <h3 className="text-sm font-semibold text-amber-200">
                Unclassified ({data.unclassified.length})
              </h3>
              <p className="text-xs text-slate-300">
                These teams have no BU assigned yet. Classify all above, or override individually.
              </p>
              <div className="space-y-2 mt-2">
                {data.unclassified.map((t) => (
                  <TeamEditorRow
                    key={t.team_id}
                    team={t}
                    taxonomy={taxonomy}
                    editing={editingTeamId === t.team_id}
                    onStartEdit={() => setEditingTeamId(t.team_id)}
                    onEndEdit={() => setEditingTeamId(null)}
                    onSaved={reload}
                  />
                ))}
              </div>
            </div>
          )}

          {data.bus.map((bu) => bu.team_count === 0 ? null : (
            <div key={bu.key} className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-base font-bold text-slate-100">
                  {bu.display}{' '}
                  <span className="text-slate-400 font-normal">({bu.team_count} idea{bu.team_count === 1 ? '' : 's'})</span>
                </h3>
                {bu.avg_ai_score !== null && (
                  <div className="text-xs text-slate-400">avg AI score {bu.avg_ai_score}/10</div>
                )}
              </div>
              <div className="space-y-2">
                {[...bu.standouts, ...bu.long_tail].map((t) => (
                  <TeamEditorRow
                    key={t.team_id}
                    team={t}
                    taxonomy={taxonomy}
                    editing={editingTeamId === t.team_id}
                    onStartEdit={() => setEditingTeamId(t.team_id)}
                    onEndEdit={() => setEditingTeamId(null)}
                    onSaved={reload}
                  />
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {view === 'presentation' && <PresentationView data={data} />}
    </div>
  );
}

function standoutIds(data: BUReportData): number[] {
  return data.bus.flatMap((bu) => bu.standouts.map((t) => t.team_id));
}

function summarizeCounts(results: BUClassifyResult[]): Record<string, number> {
  return results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
}
function summarizeCountsSum(results: BUSummarizeResult[]): Record<string, number> {
  return results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
}

function formatStamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch { return iso; }
}


// ===== Editor row =====

interface TeamEditorRowProps {
  team: BUTeamBlock;
  taxonomy: BUTaxonomyResponse;
  editing: boolean;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onSaved: () => Promise<void>;
}

function TeamEditorRow({ team, taxonomy, editing, onStartEdit, onEndEdit, onSaved }: TeamEditorRowProps) {
  const [savingCls, setSavingCls] = useState(false);
  const [savingSum, setSavingSum] = useState(false);
  const [bu, setBu] = useState<string>(team.bu ?? taxonomy.bus[0]?.key ?? '');
  const [subTags, setSubTags] = useState<Set<string>>(new Set(team.sub_tags));
  const [fnTags, setFnTags] = useState<Set<string>>(new Set(team.function_tags));
  const [thTags, setThTags] = useState<Set<string>>(new Set(team.theme_tags));
  const [rationale, setRationale] = useState<string>(team.rationale);
  const [summary, setSummary] = useState<string>(team.summary);
  const [score, setScore] = useState<number>(team.ai_score_10 ?? 5);
  const [judgeSyn, setJudgeSyn] = useState<string>(team.judge_synthesis);

  // Sync local state if the team object is refreshed under us.
  useEffect(() => {
    setBu(team.bu ?? taxonomy.bus[0]?.key ?? '');
    setSubTags(new Set(team.sub_tags));
    setFnTags(new Set(team.function_tags));
    setThTags(new Set(team.theme_tags));
    setRationale(team.rationale);
    setSummary(team.summary);
    setScore(team.ai_score_10 ?? 5);
    setJudgeSyn(team.judge_synthesis);
  }, [team]);

  const buEntry = taxonomy.bus.find((b) => b.key === bu);
  const validSub = buEntry ? new Set(buEntry.sub_tags) : new Set<string>();

  const toggle = (set: Set<string>, setter: (v: Set<string>) => void, k: string) => {
    const next = new Set(set);
    if (next.has(k)) next.delete(k); else next.add(k);
    setter(next);
  };

  const saveClassification = async () => {
    if (!bu) { alert('Pick a BU.'); return; }
    setSavingCls(true);
    try {
      await overrideBUClassification(team.team_id, {
        bu,
        sub_tags: [...subTags].filter((t) => validSub.has(t)),
        function_tags: [...fnTags],
        theme_tags: [...thTags],
        rationale: rationale.trim() || null,
      });
      await onSaved();
    } catch (e: any) {
      alert(`Save failed: ${e?.message ?? e}`);
    } finally {
      setSavingCls(false);
    }
  };

  const saveSummary = async () => {
    if (!summary.trim()) { alert('Summary is empty.'); return; }
    setSavingSum(true);
    try {
      await overrideLeadershipSummary(team.team_id, {
        summary: summary.trim(),
        ai_score_10: Math.max(1, Math.min(10, score)),
        judge_synthesis: judgeSyn.trim() || null,
      });
      await onSaved();
    } catch (e: any) {
      alert(`Save failed: ${e?.message ?? e}`);
    } finally {
      setSavingSum(false);
    }
  };

  const buDisplay = taxonomy.bus.find((b) => b.key === team.bu)?.display ?? '—';

  return (
    <div className={`bg-ink-900/60 border rounded-lg p-3 ${editing ? 'border-teal-500/60' : 'border-slate-700/40'}`}>
      <div className="flex flex-wrap items-baseline gap-2 justify-between">
        <div>
          <div className="font-semibold text-slate-100">{team.team_name}</div>
          <div className="text-xs text-slate-400 mt-0.5">
            <span className="mr-2">{buDisplay}</span>
            {team.sub_tags.length > 0 && <span className="mr-2">· {team.sub_tags.join(', ')}</span>}
            {team.ai_score_10 !== null && <span className="text-teal-300 font-mono">· AI {team.ai_score_10}/10</span>}
            {team.advanced_to_round >= 2 && <span className="ml-2 text-emerald-300">✓ advanced</span>}
          </div>
        </div>
        <div className="flex gap-2">
          {!editing && (
            <button
              onClick={onStartEdit}
              className="text-xs px-2.5 py-1 rounded border border-slate-600 hover:border-slate-400 text-slate-300 transition"
            >
              ✏️ Edit
            </button>
          )}
          {editing && (
            <button
              onClick={onEndEdit}
              className="text-xs px-2.5 py-1 rounded border border-slate-600 hover:border-slate-400 text-slate-300 transition"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {team.idea && (
        <details className="mt-2">
          <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-200">Idea text</summary>
          <div className="mt-2 text-sm text-slate-300 whitespace-pre-wrap">{team.idea}</div>
        </details>
      )}

      {team.summary && (
        <div className="mt-2 text-sm text-slate-200 border-l-2 border-teal-500/40 pl-3">
          {team.summary}
        </div>
      )}

      {editing && (
        <div className="mt-3 pt-3 border-t border-slate-700/40 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-xs text-slate-300 space-y-1 md:col-span-1">
              <span className="block uppercase tracking-wide text-slate-400">Business Unit</span>
              <select
                value={bu}
                onChange={(e) => { setBu(e.target.value); setSubTags(new Set()); }}
                className="w-full bg-ink-900 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-100"
              >
                {taxonomy.bus.map((b) => (
                  <option key={b.key} value={b.key}>{b.display}</option>
                ))}
              </select>
              <span className="block text-slate-500 mt-1 text-[10px]">{buEntry?.description}</span>
            </label>
            <div className="md:col-span-2 space-y-2">
              <div className="text-xs uppercase tracking-wide text-slate-400">Sub-tags (product/division)</div>
              <div className="flex flex-wrap gap-1.5">
                {buEntry?.sub_tags.map((k) => {
                  const on = subTags.has(k);
                  return (
                    <button
                      key={k}
                      onClick={() => toggle(subTags, setSubTags, k)}
                      className={`text-[11px] px-2 py-1 rounded border transition ${on ? 'border-teal-500/60 bg-teal-500/15 text-teal-200' : 'border-slate-600 hover:border-slate-400 text-slate-300'}`}
                    >
                      {k}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-slate-400">Function tags</div>
              <div className="flex flex-wrap gap-1.5">
                {taxonomy.function_tags.map((k) => {
                  const on = fnTags.has(k);
                  return (
                    <button
                      key={k}
                      onClick={() => toggle(fnTags, setFnTags, k)}
                      className={`text-[11px] px-2 py-1 rounded border transition ${on ? 'border-sky-500/60 bg-sky-500/15 text-sky-200' : 'border-slate-600 hover:border-slate-400 text-slate-300'}`}
                    >
                      {k}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-slate-400">Theme tags</div>
              <div className="flex flex-wrap gap-1.5">
                {taxonomy.theme_tags.map((k) => {
                  const on = thTags.has(k);
                  return (
                    <button
                      key={k}
                      onClick={() => toggle(thTags, setThTags, k)}
                      className={`text-[11px] px-2 py-1 rounded border transition ${on ? 'border-violet-500/60 bg-violet-500/15 text-violet-200' : 'border-slate-600 hover:border-slate-400 text-slate-300'}`}
                    >
                      {k}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Rationale (LLM's or your own)</div>
            <input
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              className="w-full bg-ink-900 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-100"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={saveClassification}
              disabled={savingCls}
              className="text-xs px-3 py-1.5 rounded border border-emerald-500/60 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 transition disabled:opacity-50"
            >
              {savingCls ? 'Saving…' : 'Save classification'}
            </button>
          </div>

          <div className="pt-3 border-t border-slate-700/40 space-y-2">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">
                Leadership summary
              </div>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={3}
                className="w-full bg-ink-900 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-100"
              />
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-xs text-slate-300 flex items-center gap-2">
                <span className="uppercase tracking-wide text-slate-400">AI score /10</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={score}
                  onChange={(e) => setScore(parseInt(e.target.value, 10) || 5)}
                  className="w-16 bg-ink-900 border border-slate-600 rounded px-2 py-1 text-sm text-slate-100"
                />
              </label>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">
                Judge synthesis (standouts only — leave blank if no verbatim summary needed)
              </div>
              <textarea
                value={judgeSyn}
                onChange={(e) => setJudgeSyn(e.target.value)}
                rows={2}
                className="w-full bg-ink-900 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-100"
              />
            </div>
            <div>
              <button
                onClick={saveSummary}
                disabled={savingSum}
                className="text-xs px-3 py-1.5 rounded border border-emerald-500/60 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 transition disabled:opacity-50"
              >
                {savingSum ? 'Saving…' : 'Save summary + score'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ===== Presentation view (print-to-PDF friendly) =====

function PresentationView({ data }: { data: BUReportData }) {
  return (
    <div className="bu-presentation">
      <style>{PRESENTATION_STYLES}</style>
      <header className="pv-header">
        <div className="pv-brand">RealHack 2026</div>
        <h1>Leadership Report: Ideas by Business Unit</h1>
        <div className="pv-meta">
          Round {data.round} · {data.total_teams} ideas submitted · generated {formatStamp(data.generated_at)}
        </div>
        <p className="pv-lead">
          Every RealHack 2026 idea has been classified into one of six RealPage business units.
          For each BU, this report shows the top three standout ideas (with judge feedback synthesis)
          followed by the long tail. If an idea sparks interest for your area, reach out to the team
          and consider adopting or evolving it.
        </p>
      </header>

      {data.bus.map((bu) => bu.team_count === 0 ? null : (
        <BUPresentationSection key={bu.key} bu={bu} />
      ))}

      {data.unclassified_count > 0 && (
        <section className="pv-section">
          <h2>Cross-Cutting / Uncategorized ({data.unclassified_count})</h2>
          <p className="pv-desc">Ideas that span multiple BUs or don't cleanly map to one product area.</p>
          <ul className="pv-long-tail">
            {data.unclassified.map((t) => (
              <li key={t.team_id}>
                <strong>{t.team_name}</strong>
                {t.ai_score_10 !== null && <span className="pv-score-inline"> · AI {t.ai_score_10}/10</span>}
                {t.summary && <>: {t.summary}</>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="pv-footer">
        RealHack 2026 · RealPage Internal · Generated automatically from submissions and judge feedback.
      </footer>
    </div>
  );
}

function BUPresentationSection({ bu }: { bu: BUBlock }) {
  return (
    <section className="pv-section pv-bu">
      <div className="pv-bu-header">
        <h2>{bu.display}</h2>
        <div className="pv-bu-meta">
          {bu.team_count} idea{bu.team_count === 1 ? '' : 's'}
          {bu.avg_ai_score !== null && <> · avg AI score {bu.avg_ai_score}/10</>}
        </div>
      </div>
      <p className="pv-desc">{bu.description}</p>

      {(bu.top_sub_tags.length > 0 || bu.top_theme_tags.length > 0) && (
        <div className="pv-tag-rollup">
          {bu.top_sub_tags.length > 0 && (
            <div><strong>Divisions:</strong> {bu.top_sub_tags.map(([t, n]) => `${prettyTag(t)} (${n})`).join(', ')}</div>
          )}
          {bu.top_theme_tags.length > 0 && (
            <div><strong>Themes:</strong> {bu.top_theme_tags.map(([t, n]) => `${prettyTag(t)} (${n})`).join(', ')}</div>
          )}
          {bu.top_function_tags.length > 0 && (
            <div><strong>Functions:</strong> {bu.top_function_tags.map(([t, n]) => `${prettyTag(t)} (${n})`).join(', ')}</div>
          )}
        </div>
      )}

      {bu.standouts.length > 0 && (
        <div className="pv-standouts">
          <h3>Standouts (top {bu.standouts.length} by AI score)</h3>
          <div className="pv-cards">
            {bu.standouts.map((t) => <StandoutCard key={t.team_id} team={t} />)}
          </div>
        </div>
      )}

      {bu.long_tail.length > 0 && (
        <div className="pv-long-tail-wrap">
          <h3>Also submitted ({bu.long_tail.length})</h3>
          <ul className="pv-long-tail">
            {bu.long_tail.map((t) => (
              <li key={t.team_id}>
                <strong>{t.team_name}</strong>
                {t.ai_score_10 !== null && <span className="pv-score-inline"> · AI {t.ai_score_10}/10</span>}
                {t.sub_tags.length > 0 && <span className="pv-tags-inline"> · {t.sub_tags.map(prettyTag).join(', ')}</span>}
                {t.summary && <>: {t.summary}</>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function StandoutCard({ team }: { team: BUTeamBlock }) {
  return (
    <div className="pv-card">
      <div className="pv-card-head">
        <div className="pv-card-title">{team.team_name}</div>
        <div className="pv-card-score">{team.ai_score_10 ?? '—'}<span>/10</span></div>
      </div>
      {(team.sub_tags.length > 0 || team.theme_tags.length > 0) && (
        <div className="pv-card-tags">
          {team.sub_tags.map((t) => <span key={t} className="pv-chip pv-chip-sub">{prettyTag(t)}</span>)}
          {team.theme_tags.map((t) => <span key={t} className="pv-chip pv-chip-theme">{prettyTag(t)}</span>)}
        </div>
      )}
      {team.summary && <p className="pv-card-summary">{team.summary}</p>}
      {team.judge_synthesis && (
        <div className="pv-card-judges">
          <strong>Judges said:</strong> {team.judge_synthesis}
        </div>
      )}
      {team.mentor_name && <div className="pv-card-mentor">Mentor: {team.mentor_name}</div>}
    </div>
  );
}

function prettyTag(t: string): string {
  return t.replace(/_/g, ' ');
}


// Inline styles for the presentation + print CSS. Kept in the component so
// they only apply while this view is mounted (no polluting global scope).
const PRESENTATION_STYLES = `
.bu-presentation {
  background: #ffffff;
  color: #1a1f26;
  padding: 32px 40px;
  border-radius: 12px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  line-height: 1.5;
}
.bu-presentation h1, .bu-presentation h2, .bu-presentation h3 {
  margin: 0;
  color: #0a4f99;
}
.pv-header { border-bottom: 3px solid #0a4f99; padding-bottom: 20px; margin-bottom: 28px; }
.pv-brand { font-size: 12px; letter-spacing: 2px; font-weight: 700; color: #0a4f99; text-transform: uppercase; margin-bottom: 4px; }
.pv-header h1 { font-size: 28px; margin: 4px 0 6px 0; }
.pv-meta { font-size: 12px; color: #5a6a7a; }
.pv-lead { font-size: 14px; color: #333; max-width: 850px; margin-top: 12px; }
.pv-section { margin-bottom: 40px; page-break-inside: avoid; }
.pv-bu-header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.pv-bu-header h2 { font-size: 22px; }
.pv-bu-meta { font-size: 12px; color: #5a6a7a; }
.pv-desc { font-size: 13px; color: #444; margin: 8px 0 14px 0; }
.pv-tag-rollup { background: #f0f4f9; border-left: 4px solid #0a4f99; padding: 10px 14px; font-size: 12px; color: #333; margin-bottom: 16px; }
.pv-tag-rollup div + div { margin-top: 3px; }
.pv-standouts h3 { font-size: 14px; text-transform: uppercase; letter-spacing: 1px; color: #0a4f99; margin-bottom: 10px; }
.pv-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; margin-bottom: 20px; }
.pv-card { background: #f7fafd; border: 1px solid #cad9e8; border-left: 5px solid #0a4f99; border-radius: 6px; padding: 14px; page-break-inside: avoid; }
.pv-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.pv-card-title { font-size: 15px; font-weight: 700; color: #0a4f99; }
.pv-card-score { font-size: 22px; font-weight: 700; color: #2b7a2b; }
.pv-card-score span { font-size: 12px; font-weight: 400; color: #666; margin-left: 2px; }
.pv-card-tags { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0; }
.pv-chip { display: inline-block; padding: 2px 8px; font-size: 10px; border-radius: 999px; }
.pv-chip-sub { background: #dceafd; color: #0a4f99; }
.pv-chip-theme { background: #f3ddf9; color: #6a2b8a; }
.pv-card-summary { font-size: 13px; color: #222; margin: 8px 0; }
.pv-card-judges { font-size: 12px; color: #444; background: #fff8e0; border-left: 3px solid #d4a017; padding: 8px 10px; margin: 8px 0 4px 0; }
.pv-card-judges strong { color: #7a5c00; }
.pv-card-mentor { font-size: 11px; color: #666; margin-top: 6px; }
.pv-long-tail-wrap h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #5a6a7a; margin: 14px 0 8px 0; }
.pv-long-tail { padding-left: 20px; margin: 0; font-size: 13px; color: #222; }
.pv-long-tail li { margin-bottom: 6px; }
.pv-long-tail li strong { color: #0a4f99; }
.pv-score-inline, .pv-tags-inline { color: #5a6a7a; font-size: 12px; }
.pv-footer { border-top: 1px solid #cad9e8; margin-top: 30px; padding-top: 12px; font-size: 11px; color: #5a6a7a; text-align: center; }

@media print {
  @page { size: A4; margin: 15mm; }
  body { background: #ffffff !important; }
  /* Isolate the report on the page. Hide everything, then re-show only the
   * .bu-presentation subtree. */
  body * { visibility: hidden !important; }
  .bu-presentation, .bu-presentation * { visibility: visible !important; }
  .bu-presentation {
    position: absolute; left: 0; top: 0; width: 100%;
    padding: 0; border-radius: 0; box-shadow: none;
  }
  .pv-section.pv-bu { page-break-before: always; }
  .pv-section.pv-bu:first-of-type { page-break-before: auto; }
  .pv-card { page-break-inside: avoid; }
  /* Hide interactive toolbars inside the presentation too, just in case. */
  .bu-toolbar { display: none !important; }
}
`;
