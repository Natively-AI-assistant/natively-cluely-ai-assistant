import {
  AlertCircle, BookmarkCheck, Brain, Check, Copy, Download, FolderOpen, Gauge, History, Image as ImageIcon,
  ImageDown, Loader2, MessagesSquare, RefreshCw, Repeat2, Route, Save, ScrollText, ShieldAlert,
  SlidersHorizontal, Tags, Trash2, Wand2, Wifi, WifiOff,
  // Reply, UserCheck — icons of the two commented-out switches below (conversationMemoryV2, profileTreeV2)
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../i18n';
import { Disclosure } from '../ui/AccordionSection';
import { ProviderPerformanceSettings } from './ProviderPerformanceSettings';
import { LiquidGlassBadge } from '../../ui-components/LiquidGlassBadge';
import { LiquidGlassButton } from '../../ui-components/LiquidGlassButton';
import {
  Collapse, Presence, SETTINGS_BTN, SETTINGS_BTN_BASE, SETTINGS_BTN_NEUTRAL, SETTINGS_CARD, SETTINGS_FIELD_LABEL,
  SETTINGS_INPUT, SettingsDisclosureButton, SettingsMotionReady, SettingsNotice, SettingsRow, SettingsSectionHeading,
  SettingsSwitch, useMotionReadyAfter, useSettingsTones, useSettledFlag,
} from './SettingsRow';

// Label + one-line description + CATEGORY for each USER-FACING Intelligence OS flag.
// Keyed by flag key.
//
// THIS MAP IS AN ALLOWLIST, not a decoration (changed 2026-08-05). A registry flag with no
// entry here is NOT rendered at all. It previously fell back to the raw key + the 'dev'
// tier, which surfaced every internal rollout/shadow/kernel flag as an unexplained
// camelCase switch. Only add an entry when the flag (a) has a real production call site,
// and (b) is something a user can meaningfully decide.
//
// `group` is the Settings category the switch is listed under (2026-09-25 redesign — the
// pane used to be one heading per setting, with a "Smart features" master switch over the
// two meeting-notes flags and every other switch hidden in a "Customize" disclosure). Now
// every switch is visible under one of four categories, each rendered explicitly below:
//   • 'memory'   → what Natively remembers across chats and meetings (with Hindsight)
//   • 'notes'    → how meeting notes are written and live answers are checked
//   • 'provider' → handed to <ProviderPerformanceSettings> and listed above its read-out
//   • 'dev'      → user-meaningful diagnostics only, inside the Developer options
//                  disclosure. Shadow/observe-only experiments do NOT belong here — a
//                  switch whose best outcome is "no effect" is noise; leave those to their
//                  NATIVELY_* env vars.
// The Hindsight long-term-memory flags are NOT in this map — they live in the Hindsight
// row's own setup (privacy + external server), not the flag list.
//
// Rows render in THIS map's key order within a category, not the registry's.
//
// Descriptions corrected 2026-08-05 (settings-surface audit): each states what the toggle
// ADDS on top of what already ships unconditionally, rather than describing the whole
// subsystem. Since 2026-09-25 every Settings description line is at most 75 characters
// (spaces included), at the owner's request — say what the switch adds, in one short line.
type FlagGroup = 'memory' | 'notes' | 'provider' | 'dev';
const FLAG_META: Record<string, { label: string; desc: string; group: FlagGroup }> = {
  // ── Memory ───────────────────────────────────────────────────────────────────────────
  meetingMemoryV2: { label: 'Capture key points', desc: 'Saves each meeting’s decisions and open items for the next meeting.', group: 'memory' },
  globalSearchV2: { label: 'Search past meetings', desc: 'Search all your saved meetings by keyword and jump to the moment.', group: 'memory' },
  chatHistoryMultiTurn: { label: 'Chat history', desc: 'Chat remembers earlier turns and screenshots. Off keeps the last one.', group: 'memory' },
  // conversationMemoryV2 ("Conversation follow-ups") and profileTreeV2 ("Extra
  // candidate-voice check", under Notes & answers) are COMMENTED OUT, not deleted
  // (2026-09-25, owner's request): every read of both sits after Context Intelligence
  // V3's early return in the answer path, so on the default path neither switch did
  // anything. The registry entries and their reads on the V3-off fallback path are
  // untouched (changing them would change the answer engine); they stay settable via
  // NATIVELY_* env vars. To restore a switch, uncomment its line here, its FLAG_ICON
  // line, and its icon in the lucide-react import — ideally alongside a V3-path read.
  // conversationMemoryV2: { label: 'Conversation follow-ups', desc: 'Typed chat also understands follow-ups like “make that shorter”.', group: 'memory' },
  // ── Notes & answers ──────────────────────────────────────────────────────────────────
  // meetingSummaryV3 removed (2026-08-25): V3 notes are now the unconditional default with
  // no user-facing toggle — see electron/intelligence/intelligenceFlags.ts's
  // `settingIgnored` on that flag's spec. Do not re-add an entry here without also
  // removing `settingIgnored` from the registry (otherwise the toggle would render but
  // silently do nothing).
  meetingModeAutoDetect: { label: 'Auto-detect meeting type', desc: 'Detects the meeting type and picks the best notes template for it.', group: 'notes' },
  // followUpDraftV2 removed (2026-08-25): the LLM-written follow-up draft is now the
  // unconditional default with no user-facing toggle — see
  // electron/intelligence/intelligenceFlags.ts's `settingIgnored` on that flag's spec. Do
  // not re-add an entry here without also removing `settingIgnored` from the registry
  // (otherwise the toggle would render but silently do nothing).
  speakerLabelsV1: { label: 'Speaker labels', desc: 'Uses the names you give speakers in your notes and action items.', group: 'notes' },
  // profileTreeV2: { label: 'Extra candidate-voice check', desc: 'One more pass to catch answers that slip out of your first-person voice.', group: 'notes' }, // commented out — see conversationMemoryV2 above
  answerDiversityGuard: { label: 'Repetition guard', desc: 'Rewords a live answer’s opening when it repeats an earlier one.', group: 'notes' },
  // inMeetingSearchV2 / lectureIntelligenceV2 / diagramIntelligence removed (2026-09-25),
  // together with the "Try it" section that was their ONLY caller in the app: those three
  // flags gate nothing but the search-in-meeting / generate-lecture-notes /
  // generate-diagram IPCs, which no other surface invokes. With the section gone their
  // switches would do nothing — the "no effect" case this map's header rules out. The IPC
  // handlers and the registry entries are untouched; re-add these entries only alongside
  // a real surface that calls them.
  // ── Provider performance (2026-09-08) ────────────────────────────────────────────────
  // Only the three a user can meaningfully DECIDE appear here. The rest of the set
  // (providerPerformanceProfile, adaptiveStreamIdle, adaptiveTtft,
  // adaptiveConnectTimeout) are deliberately absent: they are bounded so that ON is
  // safer than or equal to today's behaviour, so a switch whose best outcome is
  // "no visible change" would be noise — exactly what this map's header rules out.
  adaptiveImageQuality: { label: 'Shrink screenshots when the provider is slow', desc: 'Sends smaller screenshots to slow providers. Coding stays sharp.', group: 'provider' },
  calibration: { label: 'Measure provider speed directly', desc: 'Lets “Run calibration” send small test requests. Uses your API key.', group: 'provider' },
  capabilityProbe: { label: 'Check image support directly', desc: 'Calibration sends one tiny image to check support. Uses your key.', group: 'provider' },
  // ── Developer options: the ONE diagnostic a user or support agent may legitimately flip ─
  // Everything else that used to live here (contextRouterV2 / liveTranscriptBrain /
  // promptAssemblerV2 / intelligenceOsEnabled / durableMemoryWindow) was removed
  // 2026-08-05: they are shadow-only, reserved, or no longer gate anything, so their best
  // case for a user was "no effect" and their worst case was a misleading promise. They
  // remain flippable via their NATIVELY_* env vars for internal testing.
  trace: { label: 'Diagnostics trace', desc: 'Logs how each answer was routed, without transcript text. For support.', group: 'dev' },
};

// The Hindsight long-term-memory flags are rendered by the Hindsight row's setup (not the
// generic flag list), so they're intentionally absent from FLAG_META. List them here so
// the grouping logic can skip them rather than treat them as unknown flags.
const HINDSIGHT_FLAG_KEYS = new Set(['hindsightMemory', 'hindsightPostMeetingRetain', 'hindsightLiveRecall']);

// The tile glyph for each FLAG_META row. Every Settings row carries a 40px tile,
// so a flag without an entry here falls back to the generic sliders glyph
// rather than rendering an empty tile.
const FLAG_ICON: Record<string, LucideIcon> = {
  meetingModeAutoDetect: Wand2,
  speakerLabelsV1: Tags,
  calibration: Gauge,
  capabilityProbe: ImageIcon,
  adaptiveImageQuality: ImageDown,
  meetingMemoryV2: BookmarkCheck,
  chatHistoryMultiTurn: MessagesSquare,
  // conversationMemoryV2: Reply,   // switch commented out (see FLAG_META)
  // profileTreeV2: UserCheck,      // switch commented out (see FLAG_META)
  answerDiversityGuard: Repeat2,
  globalSearchV2: History,
  trace: Route,
};

// AI provider detected from the encrypted CredentialsManager — drives the Hindsight setup
// card's manual-launch env-export snippet. Priority order MUST match
// `scripts/hindsight-llm-config.mjs` providerTable() so the snippet shown matches the entry
// the litellm router picks first. `'litellm'` covers users routing through their own
// gateway (`hasLitellmBaseURL === true` with no direct provider key); `'other'` is the
// catch-all (no provider saved yet, or unrecognized).
type DetectedProvider = 'gemini' | 'openai' | 'claude' | 'deepseek' | 'groq' | 'litellm' | 'other';

// Per-provider env-var name + friendly label for the setup card snippet. Env var names
// must match `providerTable.key` byte-for-byte — a typo here is a silent failure mode.
type ProviderEnvHint = { env: string; label: string; snippetLabel: string };
const PROVIDER_ENV_HINTS: Record<Exclude<DetectedProvider, 'litellm' | 'other'>, ProviderEnvHint> = {
  gemini:   { env: 'GEMINI_API_KEY',    label: 'Gemini',            snippetLabel: 'Gemini:' },
  openai:   { env: 'OPENAI_API_KEY',    label: 'OpenAI',            snippetLabel: 'OpenAI:' },
  claude:   { env: 'ANTHROPIC_API_KEY', label: 'Claude (Anthropic)', snippetLabel: 'Claude:' },
  deepseek: { env: 'DEEPSEEK_API_KEY',  label: 'DeepSeek',          snippetLabel: 'DeepSeek:' },
  groq:     { env: 'GROQ_API_KEY',      label: 'Groq',              snippetLabel: 'Groq:' },
};

interface FlagRow { key: string; enabled: boolean; setting: string; env: string; default: boolean }

// One feature row, in General's row shape. Shared by the core, advanced and
// developer groups.
const FlagRowView: React.FC<{ row: FlagRow; onToggle: (row: FlagRow) => void }> = ({ row, onToggle }) => {
  const t = useT();
  const meta = FLAG_META[row.key];
  const Icon = FLAG_ICON[row.key] ?? SlidersHorizontal;
  const label = t(meta?.label || row.key);
  return (
    <SettingsRow
      icon={<Icon size={20} />}
      title={label}
      description={meta?.desc ? t(meta.desc) : undefined}
      control={<SettingsSwitch checked={row.enabled} onChange={() => onToggle(row)} label={label} />}
    />
  );
};
interface HindsightCfg { baseUrl: string; hasApiKey: boolean; autoStart: boolean; serverCommand: string; llmProvider: string; available: boolean; mode: 'local' | 'cloud'; synthetic: boolean; explicitlyDisabled: boolean; authFailed: boolean }

// Inline copyable command/snippet — Sync's pairing-link field and its Copy button. Used in
// the Hindsight setup card so a non-technical user can grab the install / launch /
// env-export commands with one click instead of typing them by hand. Copy → Copied is
// Sync's move too: the glyph cross-fades, the label swaps, the tone eases to green.
const CopyBlock: React.FC<{ text: string; label?: string }> = ({ text, label }) => {
  const t = useT();
  const tones = useSettingsTones();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // Awaited: writeText REJECTS rather than throws when the write is refused, so the
  // old sync try/catch let the rejection escape unhandled and still said "Copied"
  // (caught 2026-09-25 in the Intelligence harness, where clipboard access is denied).
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable — the text is selectable anyway */ }
  }, [text]);
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <code
        className="flex-1 min-w-0 truncate rounded-lg border border-border-subtle bg-bg-input px-3 py-2 font-mono text-xs text-text-primary"
        title={text}
      >
        {label ? <span className="mr-1.5 text-text-secondary">{label}</span> : null}
        {text}
      </code>
      <button
        type="button"
        onClick={() => void handleCopy()}
        aria-label={`${t('Copy')} ${text}`}
        className={`${SETTINGS_BTN_BASE} min-w-[92px] ${copied ? tones.ok : SETTINGS_BTN_NEUTRAL}`}
      >
        <Presence kind="icon" id={copied ? 'check' : 'copy'}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </Presence>
        <Presence kind="text" id={copied ? 'copied' : 'copy'}>
          {copied ? t('Copied') : t('Copy')}
        </Presence>
      </button>
    </div>
  );
};

// ── Context Intelligence debug logging (Developer options) ──────────────────
// Records AI routing/retrieval/evidence/answers to a local JSONL file for
// debugging. Level precedence is env var > this setting (owned by
// debug-config.ts in the main process); when the env var is set, the selector
// shows the effective value and disables itself.
type CtxDebugLevel = 'off' | 'standard' | 'verbose';
const CTX_LEVELS: readonly CtxDebugLevel[] = ['off', 'standard', 'verbose'];

const ContextDebugSection: React.FC = () => {
  const t = useT();
  const tones = useSettingsTones();
  const [cfg, setCfg] = useState<{
    level: CtxDebugLevel; levelSource: 'environment' | 'setting' | 'default';
    contentInclusion: boolean; storedLevel?: CtxDebugLevel;
    logDirectory?: string | null; currentFile?: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyShown = useSettledFlag(busy);
  // Clearing is confirmed inline, not with <ConfirmDialog>: that portals to <body>
  // at z-50, and Settings sits inside GenieModal at z-index 300, so the dialog
  // opened BEHIND Settings (verified live 2026-09-25: open, but elementFromPoint at
  // its centre hit Settings) while its overlay still took the input. Same fix as Sync.
  const [confirmClear, setConfirmClear] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  const refresh = useCallback(async () => {
    try { setCfg(await window.electronAPI.getContextDebugConfig() as never); } catch { /* panel is best-effort */ }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  // Optimistic: the pill starts moving on the click, not after the IPC round
  // trip; the refresh reconciles. Re-entry is guarded here rather than by
  // disabling the buttons, which would flash all three at 50% for one frame.
  const setLevel = useCallback(async (level: CtxDebugLevel) => {
    if (busy) return;
    setBusy(true);
    setCfg((prev) => (prev ? { ...prev, level } : prev));
    try { await window.electronAPI.setContextDebugLevel(level); await refresh(); }
    finally { setBusy(false); }
  }, [busy, refresh]);

  const clearLogs = useCallback(async () => {
    setBusy(true);
    try { await window.electronAPI.clearContextDebugLogs(); await refresh(); }
    finally { setBusy(false); setConfirmClear(false); }
  }, [refresh]);

  if (!cfg) return null;
  const envForced = cfg.levelSource === 'environment';
  const levelIndex = Math.max(0, CTX_LEVELS.indexOf(cfg.level));

  // A segmented control in the row's control slot, where General puts its pickers.
  // transitions.dev "tabs sliding": one pill under equal-width cells, moved by a
  // transform (250ms smooth-out, symmetric), while only the label colours cross-fade.
  const levelPicker = (
    <div
      role="group"
      aria-label={t('Context Debug Logging')}
      className={`relative grid grid-cols-3 rounded-lg border border-border-subtle bg-bg-input p-0.5 ${envForced ? 'opacity-50' : ''}`}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0.5 left-0.5 rounded-md border border-border-subtle bg-bg-component shadow-sm transition-transform duration-[250ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        style={{ width: 'calc((100% - 4px) / 3)', transform: `translateX(${levelIndex * 100}%)` }}
      />
      {CTX_LEVELS.map((lvl) => (
        <button
          key={lvl}
          type="button"
          disabled={envForced}
          onClick={() => void setLevel(lvl)}
          aria-pressed={cfg.level === lvl}
          className={`relative z-10 rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors duration-150 ease-out ${
            cfg.level === lvl ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          {t(lvl)}
        </button>
      ))}
    </div>
  );

  const logPath = cfg.currentFile ?? cfg.logDirectory ?? '';

  return (
    <SettingsRow
      icon={<ScrollText size={20} />}
      title={t('Context Debug Logging')}
      description={t('Local logs. Verbose adds document text.')}
      control={levelPicker}
    >
      {envForced ? (
        <SettingsNotice tone={tones.warn} icon={<ShieldAlert size={14} />}>
          {t('Set by NATIVELY_CONTEXT_DEBUG — the environment variable overrides this setting.')}
        </SettingsNotice>
      ) : null}

      {cfg.contentInclusion ? (
        <SettingsNotice tone={tones.warn} icon={<ShieldAlert size={14} />}>
          {t('Full local evidence logging is enabled (development build). Logs may contain sensitive personal data.')}
        </SettingsNotice>
      ) : null}

      {/* The log path grows in when logging is switched on and folds away with Off. */}
      <Collapse open={cfg.level !== 'off' && !!logPath}>
        <div className="pb-3 -mt-1.5">
          <CopyBlock text={logPath} label={t('Log:')} />
        </div>
      </Collapse>

      {/* The action buttons and the confirm step are one slot that changes identity. */}
      <div className="pb-3">
        <Presence kind="control" id={confirmClear ? 'confirm' : 'actions'} block>
          {confirmClear ? (
            <div
              className="flex flex-wrap items-center gap-2"
              role="group"
              aria-label={t('Clear context debug logs?')}
              onKeyDown={(e) => {
                // Stop here so Settings' window-level Escape does not close the panel too.
                if (e.key === 'Escape' && !busy) {
                  e.stopPropagation();
                  setConfirmClear(false);
                }
              }}
            >
              <p className="w-full text-xs text-text-secondary">
                {t('Deletes every context-debug JSONL file on this device. This cannot be undone.')}
              </p>
              {/* autoFocus, not a ref + effect: the confirm mounts only after the
                  outgoing buttons' exit, so an effect keyed on the state would run
                  before this button exists. Cancel is the safe default. */}
              <button autoFocus type="button" className={SETTINGS_BTN} onClick={() => setConfirmClear(false)} disabled={busy}>
                {t('Cancel')}
              </button>
              <button
                type="button"
                className={`${SETTINGS_BTN_BASE} hover:bg-red-500/15 ${tones.danger}`}
                onClick={() => void clearLogs()}
                disabled={busy}
              >
                <Presence kind="icon" id={busyShown ? 'busy' : 'idle'}>
                  {busyShown ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                </Presence>
                {t('Clear logs')}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={SETTINGS_BTN}
                aria-label={t('Open Debug Log Folder')}
                onClick={() => { void window.electronAPI.openContextDebugFolder(); }}
              >
                <FolderOpen size={14} />
                {t('Open folder')}
              </button>
              <button
                type="button"
                className={SETTINGS_BTN}
                aria-label={t('Export Context Debug Session')}
                onClick={async () => {
                  const r = await window.electronAPI.exportContextDebugSession();
                  setNotice(r.ok ? t('Revealed current session log.') : (r.error ?? t('Export failed.')));
                  clearTimeout(noticeTimer.current);
                  noticeTimer.current = setTimeout(() => setNotice(null), 3000);
                }}
              >
                <Download size={14} />
                {t('Export session')}
              </button>
              <button
                type="button"
                className={SETTINGS_BTN}
                aria-label={t('Clear Context Debug Logs')}
                onClick={() => setConfirmClear(true)}
              >
                <Trash2 size={14} />
                {t('Clear logs')}
              </button>
              <span className="text-xs text-text-secondary" role="status">
                <Presence kind="text" id={notice}>{notice}</Presence>
              </span>
            </div>
          )}
        </Presence>
      </div>
    </SettingsRow>
  );
};

// Memory-server connection state as a discrete value, so "I haven't set this up" reads
// differently from "I set it up but it's offline".
type ConnStatus = 'not-configured' | 'checking' | 'connected' | 'unreachable' | 'auth-failed';

// The badge beside the Hindsight row's title. Only the two healthy/neutral states get
// one: the Liquid Glass tag has no amber or red tint, and the failure states need a
// Retry and a sentence, so they grow in as a notice under the row instead.
//   Connected — Sync's badge pop (500ms bounce in): a connection just made earns it.
//   Checking  — quiet (control move, no overshoot), and only once a check has run
//               ~250ms: a health check that answers in 80ms must not flash a tag.
const StatusBadge: React.FC<{ status: ConnStatus; testing: boolean }> = ({ status, testing }) => {
  const t = useT();
  const checkingShown = useSettledFlag(status === 'checking' || testing);
  const visual: 'connected' | 'checking' | null =
    status === 'connected' ? 'connected' : checkingShown ? 'checking' : null;
  return (
    <Presence kind={visual === 'checking' ? 'control' : 'badge'} id={visual} className="inline-flex">
      {visual === 'connected' ? (
        <LiquidGlassBadge variant="green" icon={<Wifi size={10} strokeWidth={2.5} />}>{t('Connected')}</LiquidGlassBadge>
      ) : visual === 'checking' ? (
        <LiquidGlassBadge variant="sky" icon={<Loader2 size={10} strokeWidth={2.5} className="animate-spin" />}>{t('Checking…')}</LiquidGlassBadge>
      ) : null}
    </Presence>
  );
};

export const IntelligenceSettings: React.FC = () => {
  const t = useT();
  const tones = useSettingsTones();
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [cfg, setCfg] = useState<HindsightCfg | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  // Default OFF, like the backend (hindsight-config:get now reports an unsaved
  // setting as off). `autoStartTouched` keeps a save from persisting the switch's
  // value unless the user actually flipped it — every other field auto-saves on a
  // keystroke, and that used to write auto-start ON as a side effect.
  const [autoStart, setAutoStart] = useState(false);
  const autoStartTouched = React.useRef(false);
  // Saving Hindsight turns Long-term memory on (enableMemory) only when the user is
  // actually setting it up: they typed an address, or switched Auto-start ON. The
  // address field holds the synthetic localhost default for someone who never set it
  // up, so "any save" would opt them in on a key keystroke or an Auto-start OFF.
  const baseUrlTouched = React.useRef(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [savedAt, setSavedAt] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showDev, setShowDev] = useState(false);
  // Motion stays off until the first flags + Hindsight read has rendered, so opening
  // the pane never "swaps in" the values that arrive from IPC (SettingsMotionReady).
  // A 1.5s fallback keeps a hung read from leaving the pane motionless for good.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setLoaded(true), 1500);
    return () => clearTimeout(id);
  }, []);
  const motionReady = useMotionReadyAfter(loaded);
  // Spinners only for work long enough to notice (a local health check or save can
  // answer in milliseconds); see useSettledFlag.
  const testingShown = useSettledFlag(testing);
  const savingShown = useSettledFlag(saving);
  // While the panel first opens, the auto-started local server may still be loading its
  // embedding models (~15-20s on a warm cache, 2-3min cold). Treat a not-yet-healthy
  // server as "starting up" (→ Checking…) during this grace window instead of alarming
  // the user with "Can't connect". After it elapses, a still-down server correctly reads
  // as unreachable. CRITICAL: re-derive on every mount via useMemo keyed to a per-mount
  // timestamp — otherwise a user who opens the panel 60s after restart (when the server
  // is still booting) sees graceUntil already in the past and the chip flips to
  // "Can't connect" immediately. `tick` forces a re-render when the window expires so
  // the chip updates even if no poll lands exactly then.
  const [mountAt] = useState(() => Date.now());
  const graceUntil = useMemo(() => mountAt + 25_000, [mountAt]);
  const [graceTick, setTick] = useState(0);
  // When the user saves a NEW AI provider key while an app-managed Hindsight server is
  // already running, the server inherited the OLD key at spawn and won't see the new one
  // until restart. HindsightManager.notifyHindsightOfKeyChange broadcasts this event from the
  // main process; surface it as a small inline nudge so the user knows what to do.
  const [restartHint, setRestartHint] = useState<{ provider: string; at: number } | null>(null);
  // The setup card's manual-launch hint shows a per-provider env-export snippet. We pick
  // the snippet based on which provider the user has actually configured in AI Providers —
  // copy-pasting the wrong env var name is the #1 cause of "manual launch silently fails".
  // The type + hint map are hoisted to module scope (see PROVIDER_ENV_HINTS above) — env
  // var names must match `scripts/hindsight-llm-config.mjs` providerTable so the litellm
  // router picks the right chain entry.
  const [detectedProvider, setDetectedProvider] = useState<DetectedProvider | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [f, c] = await Promise.all([
        window.electronAPI.getIntelligenceFlags?.(),
        window.electronAPI.getHindsightConfig?.(),
      ]);
      if (Array.isArray(f)) setFlags(f);
      if (c) {
        // The IPC payload now carries mode/synthetic/explicitlyDisabled/authFailed. The
        // type in electron.d.ts is the new shape, but a small cast covers the case where
        // an older renderer (pre-this-change) somehow passes the old shape.
        setCfg(c as HindsightCfg);
        setBaseUrl(c.baseUrl || '');
        setAutoStart(c.autoStart !== false);
        setHealthy(c.available);
        setCfg((prev) => prev ? { ...prev, authFailed: Boolean((c as HindsightCfg).authFailed) } : prev);
      }
    } catch { /* settings panel never throws */ } finally { setLoaded(true); }
  }, []);

  // Detect which AI provider the user has configured (from the encrypted CredentialsManager)
  // so the setup card's manual-launch hint can show the matching env-var snippet. Order
  // matches `scripts/hindsight-llm-config.mjs` providerTable (Gemini first = highest priority
  // chain entry). Users with multiple providers see the first configured one — they can
  // always swap the env var name manually. `null` = not yet loaded; `'litellm'` = the
  // user routes through their own gateway (no direct provider key, but `litellmBaseURL`
  // is set in AI Providers); `'other'` = nothing configured or unrecognized.
  const detectProvider = useCallback(async () => {
    try {
      const c = await window.electronAPI.getStoredCredentials?.();
      if (!c) return;
      if (c.hasGeminiKey)   return setDetectedProvider('gemini');
      if (c.hasOpenaiKey)   return setDetectedProvider('openai');
      if (c.hasClaudeKey)   return setDetectedProvider('claude');
      if (c.hasDeepseekKey) return setDetectedProvider('deepseek');
      if (c.hasGroqKey)     return setDetectedProvider('groq');
      // No direct provider key, but the user has configured a LiteLLM gateway. Render the
      // LiteLLM-specific branch instead of dumping the 5-block fallback — the gateway is
      // already wired and the launcher reads LITELLM_BASE_URL.
      if (c.hasLitellmBaseURL) return setDetectedProvider('litellm');
      setDetectedProvider('other');
    } catch {
      setDetectedProvider('other');
    }
  }, []);
  useEffect(() => { detectProvider(); }, [detectProvider]);

  useEffect(() => { refresh(); }, [refresh]);

  // Hindsight restart hint — listen for the IPC event the main process broadcasts when an AI
  // provider key changes while an app-managed server is up. Surface a small inline nudge so
  // the user knows what to do. Auto-clears after 30s so it doesn't linger past action.
  // IMPORTANT: kick `detectProvider()` SYNCHRONOUSLY before `setRestartHint` — otherwise the
  // banner shows the NEW provider name while the snippet below still renders the OLD one for
  // ~50-200ms until the re-detect IPC completes. Re-detect is fire-and-forget; React batches
  // the setState calls.
  useEffect(() => {
    const handler = (data: { provider: string }) => {
      void detectProvider(); // re-detect first so snippet is current by the time the banner mounts
      setRestartHint({ provider: String(data?.provider || 'AI'), at: Date.now() });
    };
    const off = window.electronAPI?.onHindsightRestartNeeded?.(handler);
    return () => { try { off?.(); } catch { /* unmount */ } };
  }, [detectProvider]);

  // Auto-clear the restart hint after 30s so it doesn't linger after the user restarts.
  useEffect(() => {
    if (!restartHint) return;
    const id = setTimeout(() => setRestartHint(null), 30_000);
    return () => clearTimeout(id);
  }, [restartHint]);

  // "Nothing to connect to". The settings read ALWAYS returns an address — it fills in
  // http://localhost:8888 (`synthetic: true`) when the user never saved one — so the old
  // `!baseUrl` test never fired, and every user without Hindsight got "Checking…" forever
  // (and, once the grace window worked, "Can't reach the memory server") plus a health
  // poll every 4s. Not set up = no address, the untouched synthesized default, or
  // "Don't use Hindsight at all" (explicitlyDisabled). Typing a different address counts
  // as set up even before the auto-save lands.
  const notSetUp = !baseUrl.trim()
    || Boolean(cfg?.explicitlyDisabled)
    || (Boolean(cfg?.synthetic) && baseUrl === cfg?.baseUrl);

  // The local memory server can take ~15-20s to load its embedding models before /health
  // answers, and the app auto-starts it at launch. So when the panel opens with a baseUrl
  // configured but not yet healthy, poll every 4s until it connects — the chip flips to
  // "Connected" on its own without the user hitting Retry. Stops once healthy or unmounted.
  useEffect(() => {
    if (healthy === true) return;            // already connected — nothing to poll
    if (notSetUp) return;                    // not configured — nothing to wait for
    const id = setInterval(() => { void refresh(); }, 4000);
    return () => clearInterval(id);
  }, [healthy, notSetUp, refresh]);

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

  // Declared before onSaveHindsight so the save can cancel a pending auto-save timer.
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // One payload for every save path. Kept in a ref too, so the unmount flush sends
  // what is on screen now rather than what its first-render closure captured.
  const hindsightPayload = () => ({
    baseUrl,
    apiKey,
    ...(autoStartTouched.current ? { autoStart } : {}),
    enableMemory: (baseUrlTouched.current && baseUrl.trim() !== '') || (autoStartTouched.current && autoStart),
  });
  const payloadRef = React.useRef(hindsightPayload);
  payloadRef.current = hindsightPayload;

  const onSaveHindsight = useCallback(async () => {
    // Cancel any pending debounced auto-save — otherwise an explicit Apply click followed
    // by the timer firing would send TWO setHindsightConfig IPCs (double-save race: the
    // "Applied" indicator double-flashes and the second save's result can clobber the
    // first's error). The explicit save is authoritative; drop the pending one.
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    setSaving(true); setSavedAt(false);
    try {
      const res = await window.electronAPI.setHindsightConfig?.(payloadRef.current());
      setApiKey(''); // never keep the raw key in component state after save
      if (res && typeof res.healthy === 'boolean') setHealthy(res.healthy);
      setSavedAt(true);
      setTimeout(() => setSavedAt(false), 2000);
      await refresh();
    } catch { /* noop */ } finally { setSaving(false); }
  }, [refresh]);

  // Debounced auto-save — fires 400ms after the last edit to any Hindsight field. The
  // explicit Apply button (force) bypasses + cancels the debounce. Auto-save means the
  // "no save needed at all" UX works: the user just types their Cloud URL or flips a
  // toggle and walks away; the value persists without an Apply click.
  const scheduleAutoSave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void onSaveHindsight();
    }, 400);
  }, [onSaveHindsight]);
  // Flush any pending auto-save on unmount — a user who types a Cloud URL and closes
  // the panel inside the 400ms window must NOT lose the edit. The IPC is
  // fire-and-forget (we don't await); the renderer is unmounting anyway so any
  // post-await setState calls would warn but not break anything.
  useEffect(() => () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
      // Fire synchronously — best effort. Uses window.electronAPI directly because
      // onSaveHindsight closes over state setters (and may run after unmount).
      try {
        void window.electronAPI.setHindsightConfig?.(payloadRef.current());
        // Don't reset apiKey to '' here — that's a UI-only concern handled in onSaveHindsight.
      } catch { /* swallow — renderer is unmounting */ }
    }
  }, []);

  const onTest = useCallback(async () => {
    setTesting(true);
    try {
      const res = await window.electronAPI.testHindsightConnection?.();
      setHealthy(Boolean(res?.healthy));
    } catch { setHealthy(false); } finally { setTesting(false); }
  }, []);

  // Bucket the flag rows by category, in FLAG_META's key order (not the registry's).
  // Hindsight flags are skipped — they're owned by the Hindsight row's setup.
  const byGroup = useMemo(() => {
    const groups: Record<FlagGroup, FlagRow[]> = { memory: [], notes: [], provider: [], dev: [] };
    const byKey = new Map(flags.map((r) => [r.key, r]));
    for (const [key, meta] of Object.entries(FLAG_META)) {
      if (HINDSIGHT_FLAG_KEYS.has(key)) continue;
      // NOT RENDERED unless explicitly classified in FLAG_META (2026-08-05 audit). A
      // registry flag missing from the map used to fall back to `'dev'`, which dumped
      // every unclassified flag into "Developer options" as a bare camelCase key — 41 of
      // them, including load-bearing default-ON safety gates (docGroundedStrictIsolation,
      // contextOsEnabled, promptSystemV2). Iterating FLAG_META rather than the registry
      // payload keeps that true by construction; internal flags stay settable via their
      // NATIVELY_* env vars. A FLAG_META key the registry doesn't report is skipped.
      const row = byKey.get(key);
      if (row) groups[meta.group].push(row);
    }
    return groups;
  }, [flags]);

  // Connection status as a discrete state, so "never set up" reads differently from
  // "set up but unreachable" (the old single chip showed "Not running" for both).
  //   not-configured → no server URL saved yet (the common first-run case)
  //   checking       → a URL exists but health hasn't resolved (incl. the startup grace window
  //                    while the auto-started server loads its embedding models)
  //   connected      → last health check passed
  //   unreachable    → a URL exists, the grace window elapsed, and the server still didn't answer
  const status: 'not-configured' | 'checking' | 'connected' | 'unreachable' | 'auth-failed' = useMemo(() => {
    if (cfg?.authFailed) return 'auth-failed';
    if (healthy === true) return 'connected';
    if (notSetUp) return 'not-configured';
    if (healthy === null) return 'checking';
    // Down, but still within the startup grace window → show "Checking…" (it's likely booting),
    // not the alarming "Can't connect". After the window, report the real unreachable state.
    return Date.now() < graceUntil ? 'checking' : 'unreachable';
    // `graceTick` is read by nothing above, but it MUST be a dependency: the grace
    // comparison reads Date.now(), which no other dependency tracks, so without it the
    // memo kept its "checking" value forever and a down server never reached
    // "unreachable" (found 2026-09-25 in the Intelligence harness).
  }, [healthy, notSetUp, graceUntil, cfg?.authFailed, graceTick]);

  // When the grace window expires, force one re-render so a still-down server flips from
  // "Checking…" to "Can't connect" promptly (otherwise it'd wait for the next 4s poll).
  useEffect(() => {
    if (healthy === true || notSetUp) return;
    const ms = graceUntil - Date.now();
    if (ms <= 0) return;
    const id = setTimeout(() => setTick((n) => n + 1), ms + 50);
    return () => clearTimeout(id);
  }, [healthy, baseUrl, graceUntil]);

  const openExternal = useCallback((url: string) => {
    try { window.electronAPI.openExternal?.(url); } catch { /* noop */ }
  }, []);

  // A flag is forced by env when a NATIVELY_* env var is set — we can't tell the raw env
  // value from the renderer, but the get payload's `setting` is the SettingsManager key;
  // when present we allow toggling. (Env-forced detection is best-effort: if a future
  // payload exposes an `envForced` field, honor it; for now toggles are always enabled.)

  // Cloud is chosen explicitly or implied by a non-local address. Drives which setup
  // steps show and whether the Cloud account-key field appears.
  const cloudSetup = Boolean(cfg?.mode === 'cloud' || (baseUrl && !baseUrl.includes('localhost') && !baseUrl.startsWith('http://127.')));

  // What the Hindsight row says under its title. The address is the useful fact
  // once one is saved; before that, what setting up involves.
  const hindsightDescription = status === 'not-configured' ? (
    t('Keeps each meeting summary in Hindsight for later.')
  ) : (
    <>
      {cloudSetup ? 'Hindsight Cloud' : 'Hindsight'}
      {' · '}
      <span className="font-mono">{baseUrl.replace(/^https?:\/\//, '')}</span>
    </>
  );

  const flagRows = (group: FlagGroup) =>
    byGroup[group].map((row) => <FlagRowView key={row.key} row={row} onToggle={onToggleFlag} />);

  const setupToggleLabel = showSetup ? t('Hide setup') : (status === 'not-configured' ? t('Set up') : t('Edit setup'));
  // The setup control changes identity once: the Liquid Glass "Set up" call to action
  // while nothing is configured and the setup is shut, the plain toggle otherwise.
  const setupControlId = status === 'not-configured' && !showSetup ? 'cta' : 'toggle';

  return (
    // data-settings-stagger: the sections below settle in sequence on tab entrance
    // (rules in src/index.css). Safe here — every direct child is a plain <section>,
    // and the file's own motion (Presence / Collapse from SettingsRow, silent until
    // SettingsMotionReady) is interaction-only and lives deeper in the tree.
    //
    // Four categories, each a heading over several rows — never a heading per setting.
    // Every switch is visible under its category; only diagnostics sit behind a
    // disclosure, at the foot, as General's ADVANCED does.
    //
    // Built from General's parts, as Sync is: Audio's section heading, General's row
    // (40px tile, 14px bold title, 12px description, control), General's secondary
    // button and ADVANCED disclosure, Audio's card for anything that opens under a
    // row, and the Liquid Glass badge/button General and Billing use. There is no
    // pane title, matching Audio and Sync — the first section heading leads.
    <SettingsMotionReady.Provider value={motionReady}>
    <div className="space-y-8 animated fadeIn" data-settings-stagger>
      {/* ── Memory: Hindsight long-term memory, then the memory switches ── */}
      <section>
        <SettingsSectionHeading
          title={t('Memory')}
          subtitle={t('What Natively remembers across your chats and meetings.')}
        />

        <SettingsRow
          icon={<Brain size={20} />}
          title={t('Long-term memory')}
          badge={
            <>
              <LiquidGlassBadge variant="sky">{t('Beta')}</LiquidGlassBadge>
              <StatusBadge status={status} testing={testing} />
            </>
          }
          description={hindsightDescription}
          // Keyed on set-up vs not, never on the address: typing a URL must update the
          // line in place, not replay a swap on every keystroke.
          descriptionKey={status === 'not-configured' ? 'none' : 'configured'}
          control={
            <>
              {/* Retry arrives with the unreachable state and leaves with it. */}
              <Presence kind="control" id={status === 'unreachable' ? 'retry' : null}>
                <button type="button" className={SETTINGS_BTN} onClick={onTest} disabled={testing}>
                  <Presence kind="icon" id={testingShown ? 'busy' : 'idle'}>
                    {testingShown ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  </Presence>
                  {t('Retry')}
                </button>
              </Presence>
              <Presence kind="control" id={setupControlId}>
                {setupControlId === 'cta' ? (
                  // The one primary action on the pane, in the Liquid Glass action
                  // colour Sync's Connect uses.
                  <LiquidGlassButton variant="action" className="lg-sm" aria-expanded={showSetup} onClick={() => setShowSetup(true)}>
                    {setupToggleLabel}
                  </LiquidGlassButton>
                ) : (
                  // min-width holds the button still while "Edit setup" ⇄ "Hide setup"
                  // swaps, so the row's control column never jitters.
                  <button type="button" className={`${SETTINGS_BTN} min-w-[108px]`} aria-expanded={showSetup} onClick={() => setShowSetup((v) => !v)}>
                    <SlidersHorizontal size={14} />
                    <Presence kind="text" id={setupToggleLabel}>{setupToggleLabel}</Presence>
                  </button>
                )}
              </Presence>
            </>
          }
        >
          {/* Each notice grows in under the row and folds away when it no longer applies.
              The key-rejected one is an alert, so it also shakes once as it lands. */}
          <Collapse open={status === 'unreachable'}>
            <div className="pb-3">
              <SettingsNotice tone={tones.warn} icon={<WifiOff size={14} />} className="">
                {t('Can’t reach the memory server. Make sure it’s running, then retry.')}
              </SettingsNotice>
            </div>
          </Collapse>
          <Collapse open={status === 'auth-failed'}>
            <div className="pb-3">
              <SettingsNotice tone={tones.danger} icon={<AlertCircle size={14} />} alert shakeKey="auth-failed" className="">
                {t('Hindsight Cloud rejected the account key. Paste a new one in the setup.')}
              </SettingsNotice>
            </div>
          </Collapse>

          {/* Surfaced when the user just saved a new AI provider key while an app-managed
              server is already up. The server inherited the OLD env at spawn and won't see
              the new key until restart. Lives under the row, not inside the setup card, so
              it is seen whether or not the setup is open. */}
          <Collapse open={!!restartHint}>
            <div className="pb-3">
              <SettingsNotice tone={tones.warn} icon={<AlertCircle size={14} />} className="">
                {t('You just saved a new')} <span className="font-medium">{restartHint?.provider}</span> {t('key, but the running Hindsight server still has the old one. Quit and relaunch Natively, or toggle autoStart off and on to restart the server.')}
              </SettingsNotice>
            </div>
          </Collapse>

          <Collapse open={showSetup}>
            <div className="pb-3">
              <div className={`${SETTINGS_CARD} p-4 space-y-4`}>
                {/* Mode-aware setup. Local: 3-step pip-install + start + paste (the user does
                    nothing because we auto-spawn). Cloud: 2-step paste URL + paste key. No
                    `pip install` for Cloud (the server is user-managed). */}
                <ol className="space-y-3 text-xs leading-relaxed text-text-secondary">
                  {cloudSetup ? (
                    // CLOUD FLOW — no install, just paste URL + key
                    <>
                      <li>
                        <span className="font-semibold text-text-primary">{t('1. Paste your Hindsight Cloud address below.')}</span> {t("If you don’t have one, sign up at")}{' '}
                        <button type="button" onClick={() => openExternal('https://hindsight.vectorize.io')} className="text-accent-primary hover:underline">hindsight.vectorize.io</button>.
                      </li>
                      <li>
                        <span className="font-semibold text-text-primary">{t('2. Paste your Cloud account key.')}</span> {t('Found in your Hindsight Cloud dashboard. The app saves it automatically — no Apply needed.')}
                      </li>
                    </>
                  ) : (
                    // LOCAL FLOW — 3 steps. Step 3 is fully automatic when the companion is installed.
                    <>
                      <li>
                        <span className="font-semibold text-text-primary">{t('1. Install the companion app.')}</span> {t('In your Terminal, run:')}
                        <CopyBlock text="pip install hindsight-all" />
                        <span className="mt-1.5 block">{t('Requires Python 3.11 or later.')}</span>
                      </li>
                      <li>
                        <span className="font-semibold text-text-primary">{t('2. Start it.')}</span>{' '}
                        {t('From the Natively project folder, run the bundled launcher and keep it running while you use the app:')}
                        <CopyBlock text="bash scripts/hindsight-start.sh" />
                        <span className="mt-1.5 block">
                          {t('Starts the embedded memory server on port 8888.')}
                        </span>
                        <span className="mt-1 block">
                          <span className="font-medium text-text-primary">{t('If you start it from inside Natively')}</span> {t('(autoStart toggle ON below), your AI provider key from the AI Providers screen is forwarded to the server automatically — nothing else to do.')}
                        </span>
                        <span className="mt-1 block">
                          <span className="font-medium text-text-primary">{t('If you run the script yourself')}</span> {t('in a Terminal, also export your AI provider key so the server can use it (the script reads your shell environment, not the app’s stored credentials):')}
                        </span>
                        {detectedProvider && detectedProvider !== 'other' && detectedProvider !== 'litellm' ? (
                          // Auto-detected: show the env-var snippet that matches the user's
                          // configured AI provider. Prevents the "wrong env var name → silent
                          // failure" footgun. The label tells them which provider this is for.
                          <>
                            <CopyBlock
                              text={`export ${PROVIDER_ENV_HINTS[detectedProvider].env}=your-key-here`}
                              label={PROVIDER_ENV_HINTS[detectedProvider].snippetLabel}
                            />
                            <span className="mt-1.5 block">
                              {t('We detected your AI Providers key for')} <span className="font-medium text-text-primary">{PROVIDER_ENV_HINTS[detectedProvider].label}</span> {t('— the env var name above is the one the launcher reads.')}
                            </span>
                          </>
                        ) : detectedProvider === 'litellm' ? (
                          // User is routing through their own LiteLLM gateway (a base URL is set in
                          // AI Providers, no direct provider key). Render a single LiteLLM-specific
                          // snippet instead of the 5-block fallback — the gateway is already
                          // configured and the launcher reads LITELLM_BASE_URL.
                          <>
                            <CopyBlock
                              text="export LITELLM_BASE_URL=your-gateway-url"
                              label="LiteLLM gateway:"
                            />
                            <span className="mt-1.5 block">
                              {t('We detected a LiteLLM gateway URL in AI Providers. The launcher forwards it automatically when started from inside Natively; if you run the script yourself, also export the URL above.')}
                            </span>
                          </>
                        ) : detectedProvider === 'other' ? (
                          // No provider configured yet (or unrecognized) — render every supported
                          // env var name as its own copyable line so the user can pick the right
                          // one for whatever key they save. Each is a one-click copy.
                          <>
                            <span className="mt-1.5 block">
                              {t('No AI provider key is configured yet. Save one in the AI Providers screen, then copy the matching line below:')}
                            </span>
                            <div className="mt-2">
                              <span className={SETTINGS_FIELD_LABEL}>{t('Pick the one that matches your key')}</span>
                              {(Object.keys(PROVIDER_ENV_HINTS) as Array<keyof typeof PROVIDER_ENV_HINTS>).map((k) => (
                                <CopyBlock
                                  key={k}
                                  text={`export ${PROVIDER_ENV_HINTS[k].env}=your-key-here`}
                                  label={PROVIDER_ENV_HINTS[k].snippetLabel}
                                />
                              ))}
                            </div>
                          </>
                        ) : (
                          // Still loading (detectedProvider === null). Show a neutral placeholder so
                          // the panel doesn't pop in empty; replaced on the next render once the
                          // credentials IPC resolves.
                          <CopyBlock text="export GEMINI_API_KEY=your-key-here" label={t("Loading provider…")} />
                        )}
                      </li>
                      <li>
                        <span className="font-semibold text-text-primary">{t('3. Paste the address below')}</span> {t('(the local default is already filled in). The app connects automatically — no Apply needed.')}
                      </li>
                    </>
                  )}
                </ol>
                <button type="button" onClick={() => openExternal('https://hindsight.vectorize.io/developer/installation')} className="text-xs font-medium text-accent-primary hover:underline">
                  {t('Full setup guide & troubleshooting →')}
                </button>

                <div className="space-y-4 border-t border-border-subtle pt-4">
                  {/* One stack child, so the hint and the Cloud key field can grow and fold
                      inside it: a Collapse that is itself a spaced-stack child keeps its
                      16px margin while its height animates, then drops it in one jump. */}
                  <div>
                    <label className="block">
                      <span className={`${SETTINGS_FIELD_LABEL} mb-2`}>{t('Server address')}</span>
                      <input
                        type="text"
                        value={baseUrl}
                        onChange={(e) => { baseUrlTouched.current = true; setBaseUrl(e.target.value); scheduleAutoSave(); }}
                        placeholder="http://localhost:8888"
                        className={SETTINGS_INPUT}
                      />
                    </label>
                    <Collapse open={!!cfg?.synthetic && baseUrl === 'http://localhost:8888'}>
                      <p className="pt-2 text-xs text-text-secondary">
                        {t('Local default. Enter a Hindsight Cloud address to switch to Cloud.')}
                      </p>
                    </Collapse>

                    {/* Cloud is the alternative to running local software. The API key here is
                        the Hindsight Cloud ACCOUNT key — explicitly NOT the user's AI provider
                        key, which already lives in the AI Providers screen and is forwarded
                        automatically. Hidden for local mode to reduce noise — it grows in once
                        the address is a non-localhost URL. */}
                    <Collapse open={cloudSetup}>
                      <label className="block pt-4">
                        <span className={`${SETTINGS_FIELD_LABEL} mb-2`}>
                          {t('Hindsight Cloud account key')}{' '}
                          <span className="normal-case tracking-normal">
                            {t('(not your AI key)')}
                            {cfg?.hasApiKey ? t(' — saved, leave blank to keep') : ''}
                          </span>
                        </span>
                        <input
                          type="password"
                          value={apiKey}
                          onChange={(e) => { setApiKey(e.target.value); scheduleAutoSave(); }}
                          placeholder={cfg?.hasApiKey ? t('••••••••  saved') : t('Required for Hindsight Cloud')}
                          className={SETTINGS_INPUT}
                        />
                        <span className="block pt-2 text-xs text-text-secondary">
                          {t('Your AI provider key stays on this device and is used separately.')}
                        </span>
                      </label>
                    </Collapse>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-text-primary">{t('Start memory server automatically at launch')}</p>
                      <p className="text-xs text-text-secondary mt-0.5">
                        {t('Starts the companion with Natively and passes it your AI provider key.')}
                      </p>
                    </div>
                    <SettingsSwitch
                      checked={autoStart}
                      onChange={() => { autoStartTouched.current = true; setAutoStart((v) => !v); scheduleAutoSave(); }}
                      label={t('Start memory server automatically at launch')}
                    />
                  </div>

                  {/* Privacy disclosure ABOVE the Save action so it's seen before any data is sent. */}
                  <SettingsNotice tone={tones.warn} icon={<ShieldAlert size={14} />} className="">
                    {t('Local keeps memory on this device. Choosing Cloud sends meeting summaries, and what you type in search, to Hindsight’s servers — a privacy trade-off for an otherwise local-first app.')}
                  </SettingsNotice>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Save → spinner → check, as an icon swap in one fixed slot, with the
                        label swapping beside it; min-width keeps the pill from resizing
                        between "Apply now" and "Applied". */}
                    <LiquidGlassButton
                      variant="action"
                      className="lg-sm min-w-[118px]"
                      onClick={onSaveHindsight}
                      disabled={saving}
                      icon={
                        <Presence kind="icon" id={savingShown ? 'busy' : savedAt ? 'done' : 'idle'}>
                          {savingShown ? <Loader2 size={14} className="animate-spin" /> : savedAt ? <Check size={14} /> : <Save size={14} />}
                        </Presence>
                      }
                    >
                      <Presence kind="text" id={savedAt ? 'applied' : 'apply'}>
                        {savedAt ? t('Applied') : t('Apply now')}
                      </Presence>
                    </LiquidGlassButton>
                    <button type="button" onClick={onTest} disabled={testing || !baseUrl.trim()} className={SETTINGS_BTN}>
                      <Presence kind="icon" id={testingShown ? 'busy' : 'idle'}>
                        {testingShown ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
                      </Presence>
                      {t('Test connection')}
                    </button>
                    {/* "Don't use Hindsight" opt-out — sets the explicit-disable sentinel so the
                        synthetic default can't silently re-enable Hindsight on next launch. */}
                    <button
                      type="button"
                      onClick={async () => {
                        if (window.electronAPI?.disableHindsight) {
                          await window.electronAPI.disableHindsight();
                          await refresh();
                        }
                      }}
                      className="ml-auto text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
                    >
                      {t("Don't use Hindsight at all")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </Collapse>
        </SettingsRow>

        {flagRows('memory')}
      </section>

      {/* ── Notes & answers ── */}
      {byGroup.notes.length ? (
        <section>
          <SettingsSectionHeading
            title={t('Notes & answers')}
            subtitle={t('How meeting notes are written and live answers are checked.')}
          />
          {flagRows('notes')}
        </section>
      ) : null}

      {/* What Natively has learned about each provider's speed, and what it does
          with it. Lives here rather than in AI Providers because it is mostly a
          DIAGNOSTIC read-out; its three switches are listed above the read-out. */}
      <section>
        <ProviderPerformanceSettings settings={flagRows('provider')} />
      </section>

      {/* Developer options — diagnostics only, General's ADVANCED disclosure at the foot. */}
      {byGroup.dev.length ? (
        <section>
          <SettingsDisclosureButton
            open={showDev}
            onToggle={() => setShowDev((v) => !v)}
            label={t('Developer options')}
          />
          <Disclosure open={showDev}>
            <div className="mt-1">
              {flagRows('dev')}
              <ContextDebugSection />
            </div>
          </Disclosure>
        </section>
      ) : null}
    </div>
    </SettingsMotionReady.Provider>
  );
};

export default IntelligenceSettings;
