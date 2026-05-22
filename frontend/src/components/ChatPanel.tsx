import { useEffect, useRef, useState } from 'react';
import { chatSend, type ChatMessage } from '../api';
import type { Team } from '../types';

interface Props {
  teams: Team[];
  onJumpToTeam: (teamId: number) => void;
}

interface BubbleProps {
  role: 'user' | 'assistant';
  content: string;
  teamRefs?: number[];
  teamLookup: Map<number, string>;
  onJumpToTeam: (teamId: number) => void;
}

function Bubble({ role, content, teamRefs, teamLookup, onJumpToTeam }: BubbleProps) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[88%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
          isUser
            ? 'bg-lime-400 text-ink-950'
            : 'bg-ink-900 border border-slate-700/40 text-slate-100'
        }`}
      >
        <div>{content}</div>
        {!isUser && teamRefs && teamRefs.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {teamRefs.map((id) => {
              const name = teamLookup.get(id);
              if (!name) return null;
              return (
                <button
                  key={id}
                  onClick={() => onJumpToTeam(id)}
                  className="text-xs bg-ink-800 hover:bg-lime-500/20 border border-slate-700/40 hover:border-lime-500/50 px-2 py-0.5 rounded transition text-slate-200"
                >
                  {name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const SAMPLE_QUESTIONS = [
  'Which 5 teams have the weakest ideas?',
  'List teams whose mentor hasn\'t confirmed yet.',
  'Summarize common themes across business-value answers.',
  'Draft a fix-it email for the 3 most incomplete teams.',
  'Which teams should I prioritize for an AI re-screen?',
];

export function ChatPanel({ teams, onJumpToTeam }: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Array<ChatMessage & { team_refs?: number[] }>>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to the latest message when history grows
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, busy, open]);

  const teamLookup = new Map<number, string>(teams.map((t) => [t.id, t.name]));

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setInput('');
    const userMsg: ChatMessage = { role: 'user', content: trimmed };
    const nextHistory = [...history, userMsg];
    setHistory(nextHistory);
    try {
      // Send only role+content to the backend (strip team_refs from prior assistant turns)
      const payload: ChatMessage[] = nextHistory.map((m) => ({ role: m.role, content: m.content }));
      const r = await chatSend(payload);
      setHistory((h) => [...h, { role: 'assistant', content: r.reply, team_refs: r.team_refs }]);
    } catch (e: any) {
      setHistory((h) => [
        ...h,
        { role: 'assistant', content: `Error: ${e.message ?? String(e)}` },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setHistory([]);
    setInput('');
  };

  return (
    <>
      {/* Floating launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open RealHack assistant"
          className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 bg-lime-400 hover:bg-lime-300 text-ink-950 font-bold rounded-full shadow-xl shadow-lime-500/30 px-4 py-2.5 sm:px-5 sm:py-3 text-sm flex items-center gap-2 transition"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          Ask the bot
        </button>
      )}

      {/* Side panel */}
      {open && (
        <div className="fixed inset-x-3 bottom-3 top-3 sm:inset-auto sm:bottom-6 sm:right-6 sm:top-auto sm:w-[400px] sm:max-w-[92vw] sm:h-[600px] sm:max-h-[80vh] z-40 bg-ink-800 border border-slate-700/60 rounded-2xl shadow-2xl shadow-black/50 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/40">
            <div>
              <div className="font-bold text-lime-300">RealHack assistant</div>
              <div className="text-xs text-slate-400">Ask anything about the 91 teams</div>
            </div>
            <div className="flex items-center gap-2">
              {history.length > 0 && (
                <button
                  onClick={reset}
                  className="text-xs text-slate-400 hover:text-white"
                  title="Start a new conversation"
                >
                  Reset
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                aria-label="Close chat"
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
            {history.length === 0 && (
              <div className="text-sm text-slate-400">
                <p className="mb-3">Try asking:</p>
                <div className="space-y-1.5">
                  {SAMPLE_QUESTIONS.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => send(q)}
                      className="block w-full text-left text-xs bg-ink-900/60 hover:bg-lime-500/10 border border-slate-700/40 hover:border-lime-500/40 rounded px-2.5 py-1.5 transition"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {history.map((m, i) => (
              <Bubble
                key={i}
                role={m.role}
                content={m.content}
                teamRefs={m.team_refs}
                teamLookup={teamLookup}
                onJumpToTeam={(id) => {
                  onJumpToTeam(id);
                  // Optionally close the panel so the user can see the team — leave open for now
                }}
              />
            ))}
            {busy && (
              <div className="flex justify-start mb-3">
                <div className="bg-ink-900 border border-slate-700/40 rounded-xl px-3 py-2 text-sm text-slate-400 italic">
                  Thinking…
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-slate-700/40 p-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about the teams…"
                disabled={busy}
                className="flex-1 bg-ink-900 border border-slate-700/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-lime-500/60 disabled:opacity-50"
                autoFocus
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="bg-lime-400 hover:bg-lime-300 disabled:opacity-40 text-ink-950 font-bold rounded-lg px-3 text-sm transition"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
