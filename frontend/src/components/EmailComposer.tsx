import { useEffect, useMemo, useState } from 'react';
import { fetchEmailTemplates, renderEmails, appendCommLog, checkDuplicate, type EmailTemplate, type RenderedEmail } from '../api';
import type { Team } from '../types';

interface Props {
  open: boolean;
  teams: Team[];
  userEmail?: string;  // signed-in organizer's email — used as test-mode default
  onClose: () => void;
}

/**
 * Split a comma- / semicolon- / whitespace-separated address list into an
 * array, dropping anything that doesn't look like an email address.
 */
function parseAddressList(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'));
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

interface MailtoOverrides {
  toOverride?: string[];   // if set, replaces email.to
  cc?: string[];
  bcc?: string[];
}

function mailtoLink(email: RenderedEmail, overrides: MailtoOverrides = {}): string {
  const to = (overrides.toOverride && overrides.toOverride.length > 0 ? overrides.toOverride : email.to).join(',');
  const params = new URLSearchParams();
  params.set('subject', email.subject);
  params.set('body', email.body);
  if (overrides.cc && overrides.cc.length > 0) params.set('cc', overrides.cc.join(','));
  if (overrides.bcc && overrides.bcc.length > 0) params.set('bcc', overrides.bcc.join(','));
  // URLSearchParams encodes spaces as '+' but mailto: wants %20 — swap.
  return `mailto:${to}?${params.toString().replace(/\+/g, '%20')}`;
}

export function EmailComposer({ open, teams, userEmail, onClose }: Props) {
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

  // ---- CC / BCC / To-override controls (applied to every email in the batch) ----
  const [ccRaw, setCcRaw] = useState('');
  const [bccRaw, setBccRaw] = useState('');
  const [toOverrideRaw, setToOverrideRaw] = useState('');
  const [testMode, setTestMode] = useState(false);

  // Step 2 team-list controls
  const [teamSearch, setTeamSearch] = useState('');

  // Patch a single rendered email in place — used by the Step 3 editable
  // subject/body inputs. Editing the body drops body_html for that email so
  // the edited plain-text version is what actually gets sent (we don't have
  // a frontend equivalent of _html_wrap so we can't safely regenerate HTML).
  const patchRendered = (idx: number, patch: Partial<RenderedEmail>) => {
    setRendered((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const merged = { ...next[idx], ...patch };
      if ('body' in patch) {
        // Body was edited — drop HTML override so the new plain text is sent.
        (merged as any).body_html = null;
      }
      next[idx] = merged;
      return next;
    });
  };

  // Test mode auto-fills To with the signed-in user's address so nothing
  // accidentally goes to a real team during testing.
  const effectiveToOverride = useMemo(() => {
    if (testMode && userEmail) return [userEmail];
    const list = parseAddressList(toOverrideRaw);
    return list.length > 0 ? list : undefined;
  }, [testMode, userEmail, toOverrideRaw]);

  const ccList = useMemo(() => parseAddressList(ccRaw), [ccRaw]);
  const bccList = useMemo(() => parseAddressList(bccRaw), [bccRaw]);
  const overrides: MailtoOverrides = {
    toOverride: effectiveToOverride,
    cc: ccList,
    bcc: bccList,
  };

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
      <div className="bg-ink-950 border-l border-slate-700/40 w-full max-w-4xl h-full overflow-y-auto">
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
          {stage === 'pickTeams' && selectedTemplate && (() => {
            const searchedTeams = teamSearch.trim()
              ? candidateTeams.filter((t) =>
                  t.name.toLowerCase().includes(teamSearch.trim().toLowerCase()) ||
                  (t.mentor_name && t.mentor_name.toLowerCase().includes(teamSearch.trim().toLowerCase())),
                )
              : candidateTeams;
            const isChecked = (id: number) => overrideSelection ? overrideSelection.has(id) : true;
            const selectedCount = overrideSelection ? overrideSelection.size : candidateTeams.length;
            return (
            <div className="space-y-4">
              <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-4">
                <div className="text-xs uppercase text-slate-400 tracking-wider">Template</div>
                <div className="font-bold mt-0.5">{selectedTemplate.label}</div>
                <div className="text-xs text-slate-500 mt-1">Default audience: <span className="capitalize">{selectedTemplate.audience}</span></div>
              </div>

              {/* Recipients control panel — applied to every email in the batch */}
              <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Recipients (applied to every email)</h4>
                  {userEmail && (
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={testMode}
                        onChange={(e) => {
                          const turningOn = e.target.checked;
                          setTestMode(turningOn);
                          // When user enables test mode AND nothing is selected
                          // right now, default-pick just 1 team so they can render
                          // a single test email immediately. Otherwise leave
                          // their current selection alone.
                          if (turningOn && candidateTeams.length === 0 && teams.length > 0) {
                            const first = teams[0];
                            setFilter('all');
                            setOverrideSelection(new Set([first.id]));
                          }
                        }}
                        className="accent-amber-400"
                      />
                      <span>Send to me only (test mode)</span>
                    </label>
                  )}
                </div>

                <div>
                  <label className="text-[10px] uppercase tracking-wider text-slate-500">
                    To override (optional)
                  </label>
                  <input
                    type="text"
                    value={testMode && userEmail ? userEmail : toOverrideRaw}
                    onChange={(e) => setToOverrideRaw(e.target.value)}
                    disabled={testMode}
                    placeholder="Leave blank to send to each team's members. Comma-separated to redirect."
                    className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-1.5 text-sm mt-1 focus:outline-none focus:border-lime-500/60 disabled:opacity-60"
                  />
                  {testMode && (
                    <p className="text-[10px] text-amber-300 mt-1">
                      Test mode is on — every email goes to you only. Uncheck to send to real recipients.
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-slate-500">CC</label>
                    <input
                      type="text"
                      value={ccRaw}
                      onChange={(e) => setCcRaw(e.target.value)}
                      placeholder="organizer1@realpage.com, ..."
                      className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-1.5 text-sm mt-1 focus:outline-none focus:border-lime-500/60"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-slate-500">BCC</label>
                    <input
                      type="text"
                      value={bccRaw}
                      onChange={(e) => setBccRaw(e.target.value)}
                      placeholder="audit@realpage.com, ..."
                      className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-1.5 text-sm mt-1 focus:outline-none focus:border-lime-500/60"
                    />
                  </div>
                </div>

                {(ccList.length > 0 || bccList.length > 0) && (
                  <div className="text-[11px] text-slate-400">
                    {ccList.length > 0 && <span className="mr-3">CC: <span className="text-slate-200">{ccList.length} address{ccList.length === 1 ? '' : 'es'}</span></span>}
                    {bccList.length > 0 && <span>BCC: <span className="text-slate-200">{bccList.length} address{bccList.length === 1 ? '' : 'es'}</span></span>}
                  </div>
                )}
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
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <h4 className="text-xs uppercase text-slate-400 tracking-wider">
                    Recipients · {selectedCount} of {candidateTeams.length} selected
                  </h4>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      onClick={() => setOverrideSelection(new Set(candidateTeams.map((t) => t.id)))}
                      className="px-2 py-1 rounded bg-ink-900 border border-slate-700/40 text-slate-300 hover:border-lime-500/40 hover:text-white transition"
                    >
                      Select all
                    </button>
                    <button
                      onClick={() => setOverrideSelection(new Set())}
                      className="px-2 py-1 rounded bg-ink-900 border border-slate-700/40 text-slate-300 hover:border-rose-500/40 hover:text-rose-200 transition"
                    >
                      Select none
                    </button>
                  </div>
                </div>
                <input
                  type="text"
                  value={teamSearch}
                  onChange={(e) => setTeamSearch(e.target.value)}
                  placeholder="Search team name or mentor..."
                  className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-1.5 text-sm mb-2 focus:outline-none focus:border-lime-500/60"
                />
                <div className="bg-ink-800/40 border border-slate-700/40 rounded-xl max-h-64 overflow-y-auto p-2 space-y-1">
                  {searchedTeams.length === 0 && (
                    <div className="text-xs text-slate-500 italic px-2 py-3 text-center">
                      No teams match "{teamSearch}".
                    </div>
                  )}
                  {searchedTeams.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 px-2 py-1 hover:bg-ink-800/60 rounded text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isChecked(t.id)}
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
            );
          })()}

          {/* STEP 3: preview */}
          {stage === 'preview' && rendered && (
            <div className="space-y-3">
              {/* Read-only recipients summary — edited back in Step 2 */}
              <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-3 text-xs flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-400">
                <span className="text-slate-500 uppercase tracking-wider text-[10px] font-semibold">Recipients</span>
                {testMode ? (
                  <span className="text-amber-300">Test mode · all emails go to {userEmail}</span>
                ) : effectiveToOverride && effectiveToOverride.length > 0 ? (
                  <span>To override: <span className="text-slate-200">{effectiveToOverride.join(', ')}</span></span>
                ) : (
                  <span>To: <span className="text-slate-200">each team's members</span></span>
                )}
                {ccList.length > 0 && <span>CC: <span className="text-slate-200">{ccList.join(', ')}</span></span>}
                {bccList.length > 0 && <span>BCC: <span className="text-slate-200">{bccList.join(', ')}</span></span>}
                <button
                  onClick={() => { setRendered(null); }}
                  className="ml-auto text-lime-300 hover:text-lime-200 underline-offset-2 hover:underline"
                >
                  ← Edit recipients
                </button>
              </div>

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
                      const hasRecipients = (effectiveToOverride && effectiveToOverride.length > 0) || e.to.length > 0;
                      if (hasRecipients) {
                        window.open(mailtoLink(e, overrides), '_blank');
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
                    const text = rendered.map((e) => {
                      const to = (effectiveToOverride && effectiveToOverride.length > 0 ? effectiveToOverride : e.to).join(', ') || '(no email)';
                      const ccLine = ccList.length > 0 ? `Cc: ${ccList.join(', ')}\n` : '';
                      const bccLine = bccList.length > 0 ? `Bcc: ${bccList.join(', ')}\n` : '';
                      return `To: ${to}\n${ccLine}${bccLine}Subject: ${e.subject}\n\n${e.body}\n\n---\n\n`;
                    }).join('');
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
                  const effectiveTo = effectiveToOverride && effectiveToOverride.length > 0 ? effectiveToOverride : e.to;
                  const hasRecipients = effectiveTo.length > 0;
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
                              {hasRecipients ? `${effectiveTo.length} recipient${effectiveTo.length === 1 ? '' : 's'}` : 'no email on file'}
                            </span>
                            {effectiveToOverride && effectiveToOverride.length > 0 && (
                              <span className="text-[10px] text-amber-300">overridden</span>
                            )}
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
                            <div className="text-sm text-slate-200">
                              {effectiveTo.join(', ') || <span className="italic text-amber-400">No email addresses on file</span>}
                              {effectiveToOverride && effectiveToOverride.length > 0 && (
                                <span className="ml-2 text-xs text-amber-300">(override — team's emails {e.to.length > 0 ? `[${e.to.join(', ')}]` : '(none)'} ignored)</span>
                              )}
                            </div>
                          </div>
                          {ccList.length > 0 && (
                            <div>
                              <div className="text-xs uppercase tracking-wider text-slate-400">CC</div>
                              <div className="text-sm text-slate-200">{ccList.join(', ')}</div>
                            </div>
                          )}
                          {bccList.length > 0 && (
                            <div>
                              <div className="text-xs uppercase tracking-wider text-slate-400">BCC</div>
                              <div className="text-sm text-slate-200">{bccList.join(', ')}</div>
                            </div>
                          )}
                          <div>
                            <div className="text-xs uppercase tracking-wider text-slate-400 flex items-center justify-between">
                              <span>Subject</span>
                              <span className="text-[10px] text-slate-500 normal-case">editable — overrides template for this team only</span>
                            </div>
                            <input
                              type="text"
                              value={e.subject}
                              onChange={(ev) => patchRendered(i, { subject: ev.target.value })}
                              className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 text-sm text-slate-100 font-semibold mt-1 focus:outline-none focus:border-lime-500/60"
                            />
                          </div>
                          <div>
                            <div className="text-xs uppercase tracking-wider text-slate-400 flex items-center justify-between">
                              <span>Body</span>
                              <span className="text-[10px] text-slate-500 normal-case">
                                editable — note: editing here sends plain text (drops HTML formatting)
                              </span>
                            </div>
                            <textarea
                              value={e.body}
                              onChange={(ev) => patchRendered(i, { body: ev.target.value })}
                              rows={Math.min(20, Math.max(8, e.body.split('\n').length + 1))}
                              className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 mt-1 text-sm text-slate-200 font-sans whitespace-pre-wrap focus:outline-none focus:border-lime-500/60 resize-y"
                            />
                          </div>
                          <div className="flex gap-2">
                            <a
                              href={mailtoLink(e, overrides)}
                              target="_blank"
                              rel="noreferrer"
                              onClick={() => { if (hasRecipients) logSend(e); }}
                              className={`text-xs px-3 py-1.5 rounded font-bold transition ${hasRecipients ? 'bg-lime-400 hover:bg-lime-300 text-ink-950' : 'bg-ink-700 text-slate-500 cursor-not-allowed pointer-events-none'}`}
                            >
                              Open in Outlook
                            </a>
                            <button
                              onClick={() => {
                                const toLine = (effectiveToOverride && effectiveToOverride.length > 0 ? effectiveToOverride : e.to).join(', ');
                                const ccLine = ccList.length > 0 ? `\nCc: ${ccList.join(', ')}` : '';
                                const bccLine = bccList.length > 0 ? `\nBcc: ${bccList.join(', ')}` : '';
                                navigator.clipboard.writeText(`To: ${toLine}${ccLine}${bccLine}\nSubject: ${e.subject}\n\n${e.body}`);
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
