import { Brain, Check, Loader2, Wifi, WifiOff } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

// Label + one-line description + group for each Intelligence OS flag. Keyed by flag key;
// an unknown key falls back to the raw key so a newly-added flag still renders.
const FLAG_META: Record<string, { label: string; desc: string; group: string }> = {
  // Memory
  hindsightMemory: { label: 'Long-term memory', desc: 'Master switch for cross-meeting memory (Hindsight). Needs a server configured above.', group: 'Memory' },
  hindsightPostMeetingRetain: { label: 'Remember meetings', desc: 'Store a summary of each meeting after it ends, for later recall.', group: 'Memory' },
  hindsightLiveRecall: { label: 'Recall in answers', desc: 'For backward-looking questions ("what did we discuss last time?"), surface prior-meeting memory into the answer.', group: 'Memory' },
  durableMemoryWindow: { label: 'Durable session memory', desc: 'Keep long-range follow-up context for the whole session instead of a short rolling window.', group: 'Memory' },
  conversationMemoryV2: { label: 'Conversation follow-ups', desc: 'Resolve bare follow-ups ("make that shorter") against earlier turns in this session.', group: 'Memory' },
  // Search
  globalSearchV2: { label: 'Search past meetings', desc: 'Real local search across your saved meetings (ranked), instead of re-running the AI.', group: 'Search' },
  inMeetingSearchV2: { label: 'Search current meeting', desc: 'Search the live meeting transcript for a phrase, with timestamps.', group: 'Search' },
  meetingMemoryV2: { label: 'Structured meeting memory', desc: 'Extract topics / decisions / action items into each saved meeting (powers better search).', group: 'Search' },
  // Answer quality
  profileTreeV2: { label: 'Stronger candidate voice', desc: 'Keep first-person ("I built…") and prevent assistant-identity leaks on profile questions.', group: 'Answer quality' },
  answerDiversityGuard: { label: 'Answer shape polish', desc: 'Normalize the final answer shape and reduce repeated/templated phrasing.', group: 'Answer quality' },
  // Lecture & diagrams
  lectureIntelligenceV2: { label: 'Lecture notes', desc: 'Generate structured notes, flashcards and exam questions in lecture mode.', group: 'Lecture & diagrams' },
  diagramIntelligence: { label: 'Diagrams', desc: 'Generate diagrams (Mermaid) from a question in lecture mode.', group: 'Lecture & diagrams' },
  // Advanced / shadow (observe-only — included for transparency)
  trace: { label: 'Diagnostics trace', desc: 'Record a per-answer routing trace (no content). Developer diagnostics only.', group: 'Advanced' },
  contextRouterV2: { label: 'Context router (shadow)', desc: 'Compute the next-gen routing decision for telemetry only — does not change answers yet.', group: 'Advanced' },
  liveTranscriptBrain: { label: 'Live-transcript brain (shadow)', desc: 'Evaluate the live-transcript engine for telemetry only — does not change answers yet.', group: 'Advanced' },
  promptAssemblerV2: { label: 'Prompt assembler v2 (shadow)', desc: 'Evaluate the next-gen prompt builder for telemetry only — does not change answers yet.', group: 'Advanced' },
  intelligenceOsEnabled: { label: 'Intelligence OS (umbrella)', desc: 'Reserved umbrella flag. No effect on its own — toggle the specific features above.', group: 'Advanced' },
};

const GROUP_ORDER = ['Memory', 'Search', 'Answer quality', 'Lecture & diagrams', 'Advanced'];

interface FlagRow { key: string; enabled: boolean; setting: string; env: string; default: boolean }
interface HindsightCfg { baseUrl: string; hasApiKey: boolean; autoStart: boolean; serverCommand: string; llmProvider: string; available: boolean }

const Toggle: React.FC<{ on: boolean; disabled?: boolean; onClick: () => void }> = ({ on, disabled, onClick }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    aria-pressed={on}
    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${on ? 'bg-accent-primary' : 'bg-bg-item-active'} ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
  >
    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
  </button>
);

export const IntelligenceSettings: React.FC = () => {
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [cfg, setCfg] = useState<HindsightCfg | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [autoStart, setAutoStart] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [savedAt, setSavedAt] = useState(false);
  // "Try it" feature runners (lecture notes / diagram / in-meeting search). These call the
  // real IPCs against the CURRENT meeting transcript, so they need an active meeting + the
  // matching flag; the handlers return { enabled:false } when the flag is off.
  const [tryBusy, setTryBusy] = useState<null | 'lecture' | 'diagram' | 'search'>(null);
  const [tryOut, setTryOut] = useState<{ kind: string; text: string } | null>(null);
  const [searchQ, setSearchQ] = useState('');

  const flagOn = useCallback((key: string) => flags.find((f) => f.key === key)?.enabled ?? false, [flags]);

  const runTry = useCallback(async (kind: 'lecture' | 'diagram' | 'search', fn: () => Promise<any>) => {
    setTryBusy(kind); setTryOut(null);
    try {
      const res = await fn();
      if (res && res.enabled === false) {
        setTryOut({ kind, text: 'This feature is off — enable its toggle above first.' });
        return;
      }
      const payload = res?.notes ?? res?.diagram ?? res?.results ?? res;
      const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
      setTryOut({ kind, text: text && text !== 'null' ? text : 'No result — is a meeting active with a transcript?' });
    } catch (e: any) {
      setTryOut({ kind, text: `Failed: ${e?.message || 'error'}` });
    } finally { setTryBusy(null); }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [f, c] = await Promise.all([
        window.electronAPI.getIntelligenceFlags?.(),
        window.electronAPI.getHindsightConfig?.(),
      ]);
      if (Array.isArray(f)) setFlags(f);
      if (c) {
        setCfg(c);
        setBaseUrl(c.baseUrl || '');
        setAutoStart(c.autoStart !== false);
        setHealthy(c.available);
      }
    } catch { /* settings panel never throws */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const onToggleFlag = useCallback(async (row: FlagRow) => {
    // Optimistic flip; reconcile from the round-trip.
    setFlags((prev) => prev.map((r) => (r.key === row.key ? { ...r, enabled: !r.enabled } : r)));
    try {
      const res = await window.electronAPI.setIntelligenceFlag?.(row.key, !row.enabled);
      if (res && typeof res.enabled === 'boolean') {
        setFlags((prev) => prev.map((r) => (r.key === row.key ? { ...r, enabled: res.enabled! } : r)));
      }
    } catch { await refresh(); }
  }, [refresh]);

  const onSaveHindsight = useCallback(async () => {
    setSaving(true); setSavedAt(false);
    try {
      const res = await window.electronAPI.setHindsightConfig?.({ baseUrl, apiKey, autoStart });
      setApiKey(''); // never keep the raw key in component state after save
      if (res && typeof res.healthy === 'boolean') setHealthy(res.healthy);
      setSavedAt(true);
      setTimeout(() => setSavedAt(false), 2000);
      await refresh();
    } catch { /* noop */ } finally { setSaving(false); }
  }, [baseUrl, apiKey, autoStart, refresh]);

  const onTest = useCallback(async () => {
    setTesting(true);
    try {
      const res = await window.electronAPI.testHindsightConnection?.();
      setHealthy(Boolean(res?.healthy));
    } catch { setHealthy(false); } finally { setTesting(false); }
  }, []);

  const grouped = useMemo(() => {
    const byGroup: Record<string, FlagRow[]> = {};
    for (const row of flags) {
      const g = FLAG_META[row.key]?.group || 'Advanced';
      (byGroup[g] ||= []).push(row);
    }
    return byGroup;
  }, [flags]);

  // A flag is forced by env when a NATIVELY_* env var is set — we can't tell the raw env
  // value from the renderer, but the get payload's `setting` is the SettingsManager key;
  // when present we allow toggling. (Env-forced detection is best-effort: if a future
  // payload exposes an `envForced` field, honor it; for now toggles are always enabled.)

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-2">
        <Brain size={18} className="text-accent-primary" />
        <h2 className="text-base font-semibold text-text-primary">Intelligence</h2>
      </div>

      {/* ── Long-term memory (Hindsight) ─────────────────────────── */}
      <section className="rounded-xl border border-border-subtle bg-bg-item-active/30 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-text-primary">Long-term memory server</div>
            <div className="text-xs text-text-secondary">Cross-meeting memory needs a Hindsight server — local or Cloud.</div>
          </div>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${healthy ? 'bg-green-500/15 text-green-400' : 'bg-bg-item-active text-text-secondary'}`}>
            {healthy ? <Wifi size={12} /> : <WifiOff size={12} />}{healthy ? 'Connected' : 'Not running'}
          </span>
        </div>

        <label className="block">
          <span className="text-xs text-text-secondary">Server URL</span>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://localhost:8888  (local)  or  your Hindsight Cloud URL"
            className="mt-1 w-full rounded-lg bg-bg-input px-3 py-2 text-sm text-text-primary outline-none ring-1 ring-border-subtle focus:ring-accent-primary"
          />
        </label>

        <label className="block">
          <span className="text-xs text-text-secondary">API key {cfg?.hasApiKey ? '(saved — leave blank to keep)' : '(Cloud only)'}</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={cfg?.hasApiKey ? '••••••••  saved' : 'optional — for Hindsight Cloud'}
            className="mt-1 w-full rounded-lg bg-bg-input px-3 py-2 text-sm text-text-primary outline-none ring-1 ring-border-subtle focus:ring-accent-primary"
          />
        </label>

        <label className="flex items-center justify-between">
          <span className="text-sm text-text-primary">Auto-start a local server when installed</span>
          <Toggle on={autoStart} onClick={() => setAutoStart((v) => !v)} />
        </label>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={onSaveHindsight}
            disabled={saving}
            className="rounded-lg bg-accent-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : savedAt ? <Check size={14} /> : null}
            {savedAt ? 'Saved' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onTest}
            disabled={testing || !baseUrl.trim()}
            className="rounded-lg bg-bg-item-active px-3 py-1.5 text-sm text-text-primary hover:bg-bg-item-active/70 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : null}
            Test connection
          </button>
        </div>
        <p className="text-[11px] text-text-secondary">
          Local keeps memory on this device. Cloud sends meeting summaries to Hindsight's servers — a privacy trade-off for a local-first app.
        </p>
      </section>

      {/* ── Intelligence features ────────────────────────────────── */}
      <section className="space-y-4">
        <div className="text-sm font-medium text-text-primary">Intelligence features</div>
        {GROUP_ORDER.filter((g) => grouped[g]?.length).map((group) => (
          <div key={group} className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{group}</div>
            {grouped[group].map((row) => {
              const meta = FLAG_META[row.key];
              return (
                <div key={row.key} className="flex items-start justify-between gap-4 rounded-lg px-3 py-2 hover:bg-bg-item-active/40">
                  <div className="min-w-0">
                    <div className="text-sm text-text-primary">{meta?.label || row.key}</div>
                    {meta?.desc ? <div className="text-xs text-text-secondary">{meta.desc}</div> : null}
                  </div>
                  <Toggle on={row.enabled} onClick={() => onToggleFlag(row)} />
                </div>
              );
            })}
          </div>
        ))}
      </section>

      {/* ── Try it (runs against the current meeting) ────────────── */}
      <section className="rounded-xl border border-border-subtle bg-bg-item-active/30 p-4 space-y-3">
        <div>
          <div className="text-sm font-medium text-text-primary">Try it</div>
          <div className="text-xs text-text-secondary">Runs against the current meeting's transcript. Enable the matching toggle above and start a meeting first.</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={tryBusy !== null || !flagOn('lectureIntelligenceV2')}
            onClick={() => runTry('lecture', () => window.electronAPI.generateLectureNotes?.())}
            className="rounded-lg bg-bg-item-active px-3 py-1.5 text-sm text-text-primary hover:bg-bg-item-active/70 disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            {tryBusy === 'lecture' ? <Loader2 size={14} className="animate-spin" /> : null} Lecture notes
          </button>
          <button
            type="button"
            disabled={tryBusy !== null || !flagOn('diagramIntelligence')}
            onClick={() => runTry('diagram', () => window.electronAPI.generateDiagram?.())}
            className="rounded-lg bg-bg-item-active px-3 py-1.5 text-sm text-text-primary hover:bg-bg-item-active/70 disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            {tryBusy === 'diagram' ? <Loader2 size={14} className="animate-spin" /> : null} Diagram
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search the current meeting…"
            disabled={!flagOn('inMeetingSearchV2')}
            className="flex-1 rounded-lg bg-bg-input px-3 py-2 text-sm text-text-primary outline-none ring-1 ring-border-subtle focus:ring-accent-primary disabled:opacity-40"
          />
          <button
            type="button"
            disabled={tryBusy !== null || !flagOn('inMeetingSearchV2') || !searchQ.trim()}
            onClick={() => runTry('search', () => window.electronAPI.searchInMeeting?.(searchQ.trim()))}
            className="rounded-lg bg-bg-item-active px-3 py-1.5 text-sm text-text-primary hover:bg-bg-item-active/70 disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            {tryBusy === 'search' ? <Loader2 size={14} className="animate-spin" /> : null} Search
          </button>
        </div>
        {tryOut ? (
          <pre className="max-h-48 overflow-auto rounded-lg bg-bg-input p-3 text-[11px] text-text-secondary whitespace-pre-wrap">{tryOut.text}</pre>
        ) : null}
      </section>
    </div>
  );
};

export default IntelligenceSettings;
