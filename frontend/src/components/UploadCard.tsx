import { useRef, useState } from 'react';
import { uploadRegistrations, downloadMsFormsExport } from '../api';
import type { UploadResult } from '../types';

interface Props {
  onUploaded: () => void;
}

export function UploadCard({ onUploaded }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
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

  const handleDownload = async () => {
    setDownloadBusy(true);
    setError(null);
    try {
      await downloadMsFormsExport();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setDownloadBusy(false);
    }
  };

  return (
    <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 sm:gap-4 flex-wrap">
        <div className="min-w-0">
          <h3 className="font-bold">Upload registrations</h3>
          <p className="text-sm text-slate-400">MS Forms Excel export (.xlsx)</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            disabled={downloadBusy}
            onClick={handleDownload}
            className="bg-ink-900 hover:bg-ink-900/70 border border-slate-700/40 hover:border-emerald-500/40 disabled:opacity-40 text-emerald-300 font-semibold px-3 py-2 rounded-lg text-sm transition flex items-center gap-1.5 whitespace-nowrap"
            title="Download the current roster as an MS-Forms-compatible Excel. Edit it locally, then re-upload — no data is lost (manual additions are preserved)."
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4" />
            </svg>
            {downloadBusy ? 'Preparing…' : 'Download current Excel'}
          </button>
          <button
            disabled={busy}
            onClick={() => ref.current?.click()}
            className="bg-lime-400 hover:bg-lime-300 disabled:opacity-40 text-ink-950 font-bold px-4 sm:px-5 py-2 rounded-lg transition whitespace-nowrap"
          >
            {busy ? 'Importing…' : 'Choose file'}
          </button>
        </div>
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
      <p className="text-xs text-slate-500 mt-2.5 italic">
        Tip: before uploading a fresh Excel, click <b className="text-emerald-400">Download current Excel</b> to grab a copy that already includes manually-added teams — edit and re-upload to merge cleanly.
      </p>
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
