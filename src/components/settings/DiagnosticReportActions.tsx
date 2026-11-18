/**
 * "Send diagnostic report" (2026-11-18, #759), shown beside a connection finding
 * the app could not fix by itself. The log is free text, so nothing leaves
 * without the click on Send; "What's sent" shows exactly the text the send
 * carries, and Copy hands the same text over for an e-mail when the connection is
 * the very thing that is broken. See PRIVACY.md "Diagnostic report".
 */
import React, { useState } from 'react';

type State = 'idle' | 'sending' | 'sent' | 'failed';

const FAILURE_TEXT: Record<string, string> = {
  network: 'Could not reach Natively to send it. Copy the report and e-mail it to us instead.',
  unavailable: 'Natively could not take the report just now. Try again later, or copy it and e-mail it to us.',
  rate_limited: 'You have already sent several reports today. Copy this one and e-mail it to us instead.',
  rejected: 'Natively did not accept the report. Copy it and e-mail it to us instead.',
};

const linkButton = 'underline underline-offset-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:no-underline';

export const DiagnosticReportActions: React.FC = () => {
  const [state, setState] = useState<State>('idle');
  const [ref, setRef] = useState('');
  const [failure, setFailure] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadPreview = async (): Promise<string> => {
    const r = await window.electronAPI?.getDiagnosticReportPreview?.().catch(() => null);
    return r?.preview ?? '';
  };

  const togglePreview = async () => {
    if (preview !== null) { setPreview(null); return; }
    setPreview(await loadPreview());
  };

  const copy = async () => {
    const text = preview ?? (await loadPreview());
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the preview is on screen to select */ }
  };

  const send = async () => {
    if (state === 'sending') return;
    setState('sending');
    const r = await window.electronAPI?.sendDiagnosticReport?.().catch(() => null);
    if (r?.ok) { setRef(r.ref); setState('sent'); return; }
    setFailure(FAILURE_TEXT[r && !r.ok ? r.error : 'network'] ?? FAILURE_TEXT.network);
    setState('failed');
  };

  if (state === 'sent') {
    return (
      <div className="text-[12px] text-[var(--text-secondary)]" role="status">
        Sent. If you contact support, quote this reference{ref ? `: ${ref}` : ''}.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 text-[12px] text-[var(--text-secondary)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" onClick={send} disabled={state === 'sending'} className={linkButton}>
          {state === 'sending' ? 'Sending…' : 'Send diagnostic report to Natively'}
        </button>
        <button type="button" onClick={togglePreview} className={linkButton}>
          {preview === null ? 'What’s sent' : 'Hide'}
        </button>
        <button type="button" onClick={copy} className={linkButton}>
          {copied ? 'Copied' : 'Copy report'}
        </button>
      </div>
      {state === 'failed' && <div role="status">{failure}</div>}
      {preview !== null && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--bg-secondary,transparent)] p-2 text-[11px] leading-snug select-text">
          {preview}
        </pre>
      )}
    </div>
  );
};

export default DiagnosticReportActions;
