// DEV-ONLY visual harness for Settings → Intelligence (IntelligenceSettings +
// ProviderPerformanceSettings). Not shipped — same precedent as
// retrievalSettingsHarness.tsx.
//
// WHY: most of this pane's states cannot be reached from a fresh userData — a
// memory server that is unreachable or whose Cloud key was rejected, a provider
// with learned measurements, a debug level forced by the environment. The stub
// below lets each one be rendered on demand, against the real components.
//
// Query parameters (all optional):
//   theme=light|dark                 data-theme on <html>, as the app sets it
//   hs=none|fresh|disabled|checking|connected|unreachable|auth|cloud
//                                    fresh = a new install: the synthesized localhost default,
//                                    nothing listening (what most users actually see)
//   perf=empty|populated
//   env=1                            NATIVELY_CONTEXT_DEBUG forces the level
//   restart=1                        fires the "restart the memory server" nudge
//   off=1                            every flag off
//   open=setup,dev                   opens those disclosures after mount
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { IntelligenceSettings } from '../components/settings/IntelligenceSettings';

const q = new URLSearchParams(location.search);
const theme = q.get('theme') === 'light' ? 'light' : 'dark';
const hs = q.get('hs') ?? 'connected';
const allOff = q.get('off') === '1';
document.documentElement.setAttribute('data-theme', theme);

const FLAG_KEYS = [
  'meetingModeAutoDetect', 'speakerLabelsV1', 'calibration', 'capabilityProbe', 'adaptiveImageQuality',
  'meetingMemoryV2', 'chatHistoryMultiTurn', 'conversationMemoryV2', 'profileTreeV2', 'answerDiversityGuard',
  'globalSearchV2', 'trace', 'hindsightMemory',
];
const ON_BY_DEFAULT = new Set(['meetingModeAutoDetect', 'speakerLabelsV1', 'chatHistoryMultiTurn']);
const flags = FLAG_KEYS.map((key) => ({ key, enabled: !allOff && ON_BY_DEFAULT.has(key), setting: key, env: '', default: false }));

const baseUrl = hs === 'none' ? '' : hs === 'cloud' || hs === 'auth' ? 'https://api.hindsight.vectorize.io' : 'http://localhost:8888';
let healthCalls = 0;
(window as any).__healthCalls = () => healthCalls;
const hindsight = {
  baseUrl,
  hasApiKey: hs === 'cloud' || hs === 'auth',
  autoStart: true,
  serverCommand: '',
  llmProvider: 'gemini',
  // `checking` has to outlive the pane's 25s grace window to stay on screen, so it
  // simply never answers; `unreachable` answers false and is shown as checking until
  // the grace window runs out (the real behaviour).
  available: hs === 'connected' || hs === 'cloud',
  mode: hs === 'cloud' || hs === 'auth' ? 'cloud' : 'local',
  synthetic: hs === 'fresh',
  explicitlyDisabled: hs === 'disabled',
  authFailed: hs === 'auth',
};

const now = Date.now();
const profile = (over: Record<string, unknown>) => ({
  providerId: 'gemini',
  modelId: 'gemini-3.5-flash',
  networkProfileId: 'n1',
  route: 'text_stream',
  grade: 'fast',
  confidence: 'high',
  sampleCount: 42,
  lastUpdated: now,
  stale: false,
  capability: { visionVerdict: 'SUPPORTED', contextWindowTokens: 1_000_000, source: 'catalog' },
  streamIdle: { valueMs: 8000, source: 'shipped_prior', sampleCount: 42 },
  projected100k: null,
  largeContextWarning: null,
  isCurrentNetwork: true,
  ...over,
});
const diagnostics = q.get('perf') === 'populated'
  ? {
      ok: true,
      network: { id: 'n1', interfaceClass: 'wifi', offline: false },
      profiles: [
        profile({ streamIdle: { valueMs: 2500, source: 'profile', sampleCount: 42 }, projected100k: { predictedTtftMs: 14000, actionable: true } }),
        profile({ providerId: 'groq', modelId: 'qwen/qwen3.6-27b', grade: 'slow', confidence: 'medium', sampleCount: 9, largeContextWarning: 'Large requests to this model have failed repeatedly on this network. Natively will shrink them first.' }),
        profile({ providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-5', grade: 'unreliable', confidence: 'low', sampleCount: 3, capability: { visionVerdict: 'UNSUPPORTED', contextWindowTokens: 200_000, source: 'probe' } }),
        profile({ providerId: 'openai', modelId: 'gpt-5.5-mini', grade: 'good', isCurrentNetwork: false, networkProfileId: 'n2', stale: true }),
      ],
      secondaryStreams: [{ kind: 'Answer repair', attempts: 12, completed: 9, firstTokenTimeouts: 3, maxObservedTtftMs: 6400 }],
    }
  : { ok: true, network: { id: 'n1', interfaceClass: 'wifi', offline: false }, profiles: [], secondaryStreams: [] };

let restartHandler: ((d: { provider: string }) => void) | null = null;
// Writes persist for the page's lifetime, so a level change or a Forget reads back
// the way the main process would answer it.
let ctxLevel = q.get('env') === '1' ? 'verbose' : 'standard';
const never = () => new Promise(() => {});
const later = <T,>(v: T, ms = 400) => new Promise<T>((r) => setTimeout(() => r(v), ms));

(window as any).electronAPI = {
  getIntelligenceFlags: async () => flags.map((f) => ({ ...f })),
  setIntelligenceFlag: async (key: string, enabled: boolean) => {
    const f = flags.find((x) => x.key === key);
    if (f) f.enabled = enabled;
    return { enabled };
  },
  getHindsightConfig: async () => { healthCalls += 1; return hs === 'checking' ? never() : { ...hindsight }; },
  // Every save payload, in order, for checks that read what the pane sends.
  setHindsightConfig: async (cfg: unknown) => {
    ((window as any).__hsSaves ??= []).push(cfg);
    // Persist like hindsight-config:set does, so the pane's re-read shows the save.
    const c = cfg as { baseUrl?: string; autoStart?: boolean };
    if (typeof c.autoStart === 'boolean') (hindsight as any).autoStart = c.autoStart;
    if (typeof c.baseUrl === 'string' && c.baseUrl.trim()) { (hindsight as any).baseUrl = c.baseUrl.trim(); (hindsight as any).synthetic = false; }
    return later({ healthy: hindsight.available });
  },
  testHindsightConnection: async () => later({ healthy: hindsight.available }, 900),
  disableHindsight: async () => undefined,
  getStoredCredentials: async () => ({ hasGeminiKey: true }),
  onHindsightRestartNeeded: (h: (d: { provider: string }) => void) => {
    restartHandler = h;
    return () => { restartHandler = null; };
  },
  openExternal: () => undefined,
  getContextDebugConfig: async () => ({
    level: ctxLevel,
    levelSource: q.get('env') === '1' ? 'environment' : 'setting',
    contentInclusion: q.get('env') === '1',
    logDirectory: '/Users/you/Library/Logs/Natively/context-debug',
    currentFile: '/Users/you/Library/Logs/Natively/context-debug/session-2026-09-25T04-12-09.jsonl',
  }),
  setContextDebugLevel: async (level: string) => { ctxLevel = level; },
  openContextDebugFolder: async () => undefined,
  exportContextDebugSession: async () => ({ ok: true }),
  clearContextDebugLogs: async () => later(undefined),
  providerPerformanceGetDiagnostics: async () => later(diagnostics, 300),
  providerPerformanceReset: async () => {
    diagnostics.profiles = [];
    diagnostics.secondaryStreams = [];
  },
  providerPerformanceCalibrate: async () => later({ ok: true, result: { skippedReason: 'flag_off' } }, 600),
};

// Click a disclosure open after the pane has loaded, by its visible label.
function openAfterMount() {
  const want = (q.get('open') ?? '').split(',').filter(Boolean);
  const labels: Record<string, RegExp> = {
    setup: /^(Edit setup|Set up)$/,
    dev: /^Developer options/i,
  };
  setTimeout(() => {
    for (const k of want) {
      const re = labels[k];
      const btn = [...document.querySelectorAll('button')].find((b) => re?.test(b.textContent?.trim() ?? ''));
      btn?.click();
    }
    if (q.get('restart') === '1') restartHandler?.({ provider: 'Gemini' });
  }, 600);
}

function Harness() {
  React.useEffect(openAfterMount, []);
  // Mirrors the real Settings content column: the periwinkle accent scope the
  // modal root carries, bg-bg-main, p-8, and the ~574px the column measures live.
  return (
    <div data-settings-theme="periwinkle" className="bg-bg-main" style={{ minHeight: '100vh' }}>
      <div className="p-8" style={{ width: 574 + 64, margin: '0 auto' }}>
        <IntelligenceSettings />
      </div>
    </div>
  );
}

createRoot(document.getElementById('harness-root')!).render(<Harness />);
