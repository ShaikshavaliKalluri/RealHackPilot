import { useEffect, useMemo, useState } from 'react';
import { fetchEmailTemplates, renderEmails, appendCommLog, checkDuplicate, type EmailTemplate, type RenderedEmail } from '../api';
import type { Team } from '../types';

interface Props {
  open: boolean;
  teams: Team[];
  onClose: () => void;
}

type TeamFilter = 'all' | 'flagged' | 'incomplete' | 'complete';

const FILTER_LABEL: Record<TeamFilter, string> = {
  all: 'All teams',
  flagged: 'Flagged teams',
  incomplete: 'Incomplete teams',
  complete: 'Complete teams',
};

function selectTeams(teams: Team[], f: TeamFilter): Team[] {
  if (f === 'flagged') return teams.filter((t) => t.flags && t.flags.length > 0);
  if (f === 'incomplete') return teams.filter((t) => t.completeness_score < 0.8);
  if (f === 'complete') return teams.filter((t) => t.completeness_score >= 0.8 && (!t.flags || t.flags.length === 0));
  return teams;
}

function defaultFilterFor(templateId: string): TeamFilter {
  if (templateId === 'fix_it') return 'incomplete';
  if (templateId === 'final_call') return 'flagged';
  return 'all';
}

function mailtoLink(email: RenderedEmail): string {
  const to = email.to.join(',');
  const subj = encodeURIComponent(email.subject);
  const body = encodeURIComponent(email.body);
  return `mailto:${to}?subject=${subj}&body=${body}`;
}

export function EmailComposer({ open, teams, onClose }: Props) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TeamFilter>('all');
  const [overrideSelection, setOverrideSelection] = useState<Set<number> | null>(null);
  const [rendered, setRendered] = useState<RenderedEmail[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [duplicates, setDuplicates] = useState<Record<number, { duplicate: boolean; last_sent_at?: string }>>({});
  const [sentTeams, setSentTeams] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open) return;
    fetchEmailTemplates().then(setTemplates).catch((e) => setError(e.message));
  }, [open]);

  // Recompute candidate teams based on filter or override
  const candidateTeams = useMemo(() => {
    if (overrideSelection) {
      return teams.filter((t) => overrideSelection.has(t.id));
    }
    return selectTeams(teams, filter);
  }, [teams, filter, overrideSelection]);

  const selectedTemplate = templates.find((t) => t.id === templateId) || null;

  const doRender = async () => {
    if (!templateId) return;
    setLoading(true);
    setError(null);
    setPreviewIdx(null);
    setSentTeams(new Set());
    setDuplicates({});
    try {
      const ids = candidateTeams.map((t) => t.id);
      const r = await renderEmails(templateId, ids);
      setRendered(r);
      // Probe for recent duplicates of this template per team
      const dupMap: Record<number, { duplicate: boolean; last_sent_at?: string }> = {};
      await Promise.all(
        r.map(async (em) => {
          try {
            const d = await checkDuplicate(em.team_id, 'email', templateId, 24);
            dupMap[em.team_id] = d;
          } catch { /* ignore */ }
        }),
      );
      setDuplicates(dupMap);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const logSend = async (em: RenderedEmail) => {
    try {
      await appendCommLog({
        team_id: em.team_id,
        kind: 'email',
        template_id: templateId,
        subject: em.subject,
        body: em.body,
        recipients: em.to,
        sent_by_email: 'organizer@realpage.com',
        status: 'sent',
      });
      setSentTeams((prev) => new Set(prev).add(em.team_id));
    } catch (e) {
      console.warn('Audit log append failed', e);
    }
  };

  const reset = () => {
    setTemplateId(null);
    setRendered(null);
    setOverrideSelection(null);
    setFilter('all');
    setPreviewIdx(null);
  };

  if (!open) return null;

  const stage =
    !templateId ? 'pickTemplate'
    : !rendered ? 'pickTeams'
    : 'preview';

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-stretch justify-end">
      <div className="bg-ink-950 border-l border-slate-700/40 w-full max-w-2xl h-full overflow-y-auto">
        <div className="sticky top-0 bg-ink-950/95 backdrop-blur border-b border-slate-700/40 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-extrabold">Compose email</h2>
            <p className="text-xs text-slate-400">
              {stage === 'pickTemplate' && 'Step 1 of 3 · Choose a template'}
              {stage === 'pickTeams' && `Step 2 of 3 · Choose recipients (${candidateTeams.length} teams)`}
              {stage === 'preview' && `Step 3 of 3 · Preview & send (${rendered?.length ?? 0} emails)`}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>

        <div className="p-6 space-y-4">
          {error && <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded p-3 text-sm">{error}</div>}

          {/* STEP 1: pick template */}
          {stage === 'pickTemplate' && (
            <div className="space-y-3">
              {templates.length === 0 && <p className="text-slate-400 text-sm">Loading templates…</p>}
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setTemplateId(t.id);
                    setFilter(defaultFilterFor(t.id));
                  }}
                  className="w-full text-left bg-ink-800/60 hover:bg-lime-500/10 border border-slate-700/40 hover:border-lime-500/50 rounded-xl p-4 transition"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-bold">{t.label}</h3>
                      <p className="text-sm text-slate-400 mt-0.5">{t.description}</p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-ink-900 border border-slate-700/40 text-slate-300 capitalize">
                      {t.audience}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* STEP 2: pick teams */}
          {stage === 'pickTeams' && selectedTemplate && (
            <div className="space-y-4">
              <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-4">
                <div className="text-xs uppercase text-slate-400 tracking-wider">Template</div>
                <div className="font-bold mt-0.5">{selectedTemplate.label}</div>
                <div className="text-xs text-slate-500 mt-1">To: <span className="capitalize">{selectedTemplate.audience}</span></div>
              </div>

              <div>
                <h4 className="text-xs uppercase text-slate-400 tracking-wider mb-2">Quick filter</h4>
                <div className="flex flex-wrap gap-2">
                  {(['all', 'flagged', 'incomplete', 'complete'] as TeamFilter[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => {
                        setFilter(f);
                        setOverrideSelection(null);
                      }}
                      className={`px-3 py-1.5 rounded text-sm font-semibold transition ${
                        !overrideSelection && filter === f
                          ? 'bg-lime-400 text-ink-950'
                          : 'bg-ink-800 border border-slate-700/40 text-slate-200 hover:border-lime-500/40'
                      }`}
                    >
                      {FILTER_LABEL[f]} ({selectTeams(teams, f).length})
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-xs uppercase text-slate-400 tracking-wider mb-2">
                  Recipients ({candidateTeams.length})
                </h4>
                <div className="bg-ink-800/40 border border-slate-700/40 rounded-xl max-h-64 overflow-y-auto p-2 space-y-1">
                  {candidateTeams.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 px-2 py-1 hover:bg-ink-800/60 rounded text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={overrideSelection ? overrideSelection.has(t.id) : true}
                        onChange={(e) => {
                          const next = new Set(overrideSelection ?? new Set(candidateTeams.map((tt) => tt.id)));
                          if (e.target.checked) next.add(t.id);
                          else next.delete(t.id);
                          setOverrideSelection(next);
                        }}
                        className="accent-lime-400"
                      />
                      <span className="font-semibold text-slate-100 flex-1 truncate">{t.name}</span>
                      <span className="text-xs text-slate-500">
                        {selectedTemplate.audience === 'mentor'
                          ? (t.mentor_email ? '✓ has email' : '✗ no mentor email')
                          : `${t.members.filter((m) => m.email).length}/${t.members.length} emails`}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-slate-700/40">
                <button
                  onClick={reset}
                  className="text-sm text-slate-400 hover:text-white"
                >
                  ← Back
                </button>
                <button
                  onClick={doRender}
                  disabled={loading || candidateTeams.length === 0}
                  className="bg-lime-400 hover:bg-lime-300 disabled:opacity-40 text-ink-950 font-bold px-5 py-2 rounded-lg text-sm transition"
                >
                  {loading ? 'Rendering…' : `Render ${candidateTeams.length} email${candidateTeams.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: preview */}
          {stage === 'preview' && rendered && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 items-center">
                <button
                  onClick={reset}
                  className="text-sm text-slate-400 hover:text-white"
                >
                  ← Start over
                </button>
                <span className="text-sm text-slate-500">·</span>
                <button
                  onClick={() => {
                    rendered.forEach((e) => {
                      if (e.to.length > 0) {
                        window.open(mailtoLink(e), '_blank');
                        logSend(e);
                      }
                    });
                  }}
                  className="text-xs px-3 py-1.5 rounded bg-lime-400 hover:bg-lime-300 text-ink-950 font-bold transition"
                >
                  Open all in Outlook
                </button>
                <button
                  onClick={() => {
                    const text = rendered.map((e) =>
                      `To: ${e.to.join(', ') || '(no email)'}\nSubject: ${e.subject}\n\n${e.body}\n\n---\n\n`
                    ).join('');
                    navigator.clipboard.writeText(text);
                    rendered.forEach((e) => logSend(e));
                  }}
                  className="text-xs px-3 py-1.5 rounded bg-ink-800 hover:bg-ink-800/70 border border-slate-700/40 text-slate-200 font-semibold transition"
                >
                  Copy all
                </button>
                {Object.values(duplicates).filter((d) => d.duplicate).length > 0 && (
                  <span className="text-xs text-amber-300">
                    ⚠ {Object.values(duplicates).filter((d) => d.duplicate).length} team(s) already received this template in last 24h
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {rendered.map((e, i) => {
                  const expanded = previewIdx === i;
                  const hasRecipients = e.to.length > 0;
                  const dup = duplicates[e.team_id];
                  const alreadySent = sentTeams.has(e.team_id);
                  return (
                    <div key={i} className="bg-ink-800/60 border border-slate-700/40 rounded-xl overflow-hidden">
                      <button
                        onClick={() => setPreviewIdx(expanded ? null : i)}
                        className="w-full text-left px-4 py-3 hover:bg-ink-800/80"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-slate-100 truncate flex items-center gap-2">
                              {e.team_name}
                              {alreadySent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-lime-500/15 text-lime-300 border border-lime-500/40">✓ logged</span>}
                              {dup?.duplicate && !alreadySent && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/40" title={dup.last_sent_at ? `Last sent ${dup.last_sent_at}` : undefined}>
                                  ⚠ already sent in last 24h
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-400 truncate">{e.subject}</div>
                          </div>
                          <div className="text-xs flex flex-col items-end">
                            <span className={hasRecipients ? 'text-lime-300' : 'text-amber-400'}>
                              {hasRecipients ? `${e.to.length} recipient${e.to.length === 1 ? '' : 's'}` : 'no email on file'}
                            </span>
                            {e.missing_fields.length > 0 && (
                              <span className="text-rose-300">{e.missing_fields.length} missing</span>
                            )}
                          </div>
                        </div>
                      </button>
                      {expanded && (
                        <div className="border-t border-slate-700/40 px-4 py-3 space-y-3">
                          <div>
                            <div className="text-xs uppercase tracking-wider text-slate-400">To</div>
                            <div className="text-sm text-slate-200">{e.to.join(', ') || <span className="italic text-amber-400">No email addresses on file</span>}</div>
                          </div>
                          <div>
                            <div className="text-xs uppercase tracking-wider text-slate-400">Subject</div>
                            <div className="text-sm text-slate-100 font-semibold">{e.subject}</div>
                          </div>
                          <div>
                            <div className="text-xs uppercase tracking-wider text-slate-400">Body</div>
                            <pre className="text-sm text-slate-200 whitespace-pre-wrap font-sans bg-ink-900/50 rounded p-3 mt-1">{e.body}</pre>
                          </div>
                          <div className="flex gap-2">
                            <a
                              href={mailtoLink(e)}
                              target="_blank"
                              rel="noreferrer"
                              onClick={() => { if (hasRecipients) logSend(e); }}
                              className={`text-xs px-3 py-1.5 rounded font-bold transition ${hasRecipients ? 'bg-lime-400 hover:bg-lime-300 text-ink-950' : 'bg-ink-700 text-slate-500 cursor-not-allowed pointer-events-none'}`}
                            >
                              Open in Outlook
                            </a>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(`To: ${e.to.join(', ')}\nSubject: ${e.subject}\n\n${e.body}`);
                                logSend(e);
                              }}
                              className="text-xs px-3 py-1.5 rounded bg-ink-800 hover:bg-ink-800/70 border border-slate-700/40 text-slate-200 font-semibold transition"
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
