import { useRef, useState } from 'react';
import { uploadRegistrations } from '../api';
import type { UploadResult } from '../types';

interface Props {
  onUploaded: () => void;
}

export function UploadCard({ onUploaded }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handle = async (file: File) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await uploadRegistrations(file);
      setResult(r);
      onUploaded();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 sm:gap-4 flex-wrap">
        <div className="min-w-0">
          <h3 className="font-bold">Upload registrations</h3>
          <p className="text-sm text-slate-400">MS Forms Excel export (.xlsx)</p>
        </div>
        <button
          disabled={busy}
          onClick={() => ref.current?.click()}
          className="bg-lime-400 hover:bg-lime-300 disabled:opacity-40 text-ink-950 font-bold px-4 sm:px-5 py-2 rounded-lg transition whitespace-nowrap"
        >
          {busy ? 'Importing…' : 'Choose file'}
        </button>
        <input
          ref={ref}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handle(f);
            e.target.value = '';
          }}
        />
      </div>
      {result && (
        <div className="mt-3 text-sm text-lime-300">
          ✓ Imported <b>{result.teams_imported}</b> teams · {result.duplicate_participants} duplicate participants · {result.multi_team_mentors} overloaded mentors
        </div>
      )}
      {error && (
        <div className="mt-3 text-sm text-rose-300">⚠ {error}</div>
      )}
    </div>
  );
}
