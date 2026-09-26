// src/lib/helpSetupStatus.mjs
//
// What Setup & Help's "Get started" rows say about THIS install: which
// permissions are allowed, which speech provider and AI model are chosen, and
// whether a Natively API key is saved. Pure and platform-injectable, so the
// macOS and Windows branches are both tested on either OS (CLAUDE.md).
//
// Facts, never verdicts. A row says "Deepgram · key saved", not
// "working": a saved key can still be wrong, and only Test Connection in Audio
// or a real answer can prove it. `done` means only that the step has been
// taken, so the pane can tick it.
//
// Sources, so the next edit can re-check them rather than trust this file:
//   permissions  `permissions:check` (ipcHandlers.ts) + permissionAttentionPolicy.mjs,
//                the same rule that brings the launcher's permissions card back
//   speech       CredentialsManager.getSttProvider ('none' until one is chosen)
//                and the has*Key flags of `get-stored-credentials`; provider
//                labels are the Speech Provider list's in SettingsOverlay.tsx
//   model        `get-current-llm-config` provider/modelId + the same credentials
//   context      Modes and Profile Intelligence open for Natively Pro or a live
//                trial — App.tsx's rule (isPremium || activeTrial), read here
//                from `license:get-details` and the local trial token;
//                `modes:get-active` and `profile:get-status` for what is set

import { permissionsNeedAttention } from './permissionAttentionPolicy.mjs';

/** @param {unknown} platform */
function assertPlatform(platform) {
  if (platform !== 'darwin' && platform !== 'win32') {
    throw new Error(`Unsupported platform: ${String(platform)}`);
  }
  return platform;
}

/**
 * The Speech Provider list's own labels, and what each one needs.
 *   key       the credentials flag that says its key (or file) is saved
 *   onDevice  runs on this computer; nothing to paste
 *   platforms where it is offered at all (Apple Speech is macOS-only)
 */
const SPEECH_PROVIDERS = {
  natively: { label: 'Natively API', key: 'hasNativelyKey' },
  'apple-speech': { label: 'Apple Speech', onDevice: true, platforms: ['darwin'] },
  google: { label: 'Google Cloud', key: 'googleServiceAccountPath' },
  groq: { label: 'Groq Whisper', key: 'hasSttGroqKey' },
  nvidia_nim: { label: 'Nvidia Nim', key: 'hasNvidiaNimKey' },
  openai: { label: 'OpenAI Whisper', key: 'hasSttOpenaiKey' },
  deepgram: { label: 'Deepgram', key: 'hasDeepgramKey' },
  elevenlabs: { label: 'ElevenLabs Scribe', key: 'hasElevenLabsKey' },
  azure: { label: 'Azure Speech', key: 'hasAzureKey' },
  ibmwatson: { label: 'IBM Watson', key: 'hasIbmWatsonKey' },
  soniox: { label: 'Soniox', key: 'hasSonioxKey' },
  'local-whisper': { label: 'Local Models', onDevice: true },
};

/** Every credential that lets Active Model answer without anything else. */
const AI_KEY_FLAGS = [
  'hasNativelyKey', 'hasGeminiKey', 'hasGroqKey', 'hasOpenaiKey', 'hasClaudeKey', 'hasDeepseekKey',
  'hasNvidiaNimKey', 'hasOpenrouterKey', 'hasFluxionKey',
];

/**
 * @typedef {{ state: 'done'|'todo'|'checking'|'locked', detail: string }} SetupStep
 * `locked` is a step the user's plan doesn't include yet.
 */

/**
 * @param {'darwin'|'win32'} platform
 * @param {{ platform?: string, microphone?: string, screen?: string } | null | undefined} check
 *   the `permissions:check` result; null while it is still running
 * @returns {SetupStep}
 */
export function permissionsStep(platform, check) {
  assertPlatform(platform);
  if (!check) return { state: 'checking', detail: 'Checking…' };
  // The check reports the platform it ran on; a result from elsewhere (the
  // harness, a test) is not evidence about this one.
  if (check.platform !== platform) return { state: 'checking', detail: 'Checking…' };
  if (permissionsNeedAttention(check)) {
    const missing = [];
    if (platform === 'darwin' && check.screen !== 'granted' && check.screen !== 'restricted') missing.push('Screen Recording');
    if (check.microphone !== 'granted') missing.push('Microphone');
    return { state: 'todo', detail: missing.length ? `${missing.join(' and ')} not allowed yet` : 'Not allowed yet' };
  }
  return {
    state: 'done',
    detail: platform === 'darwin' ? 'Microphone and Screen Recording allowed' : 'Microphone allowed',
  };
}

/**
 * @param {'darwin'|'win32'} platform
 * @param {Record<string, unknown> | null | undefined} credentials `get-stored-credentials`
 * @returns {SetupStep}
 */
export function speechStep(platform, credentials) {
  assertPlatform(platform);
  if (!credentials) return { state: 'checking', detail: 'Checking…' };
  const id = typeof credentials.sttProvider === 'string' ? credentials.sttProvider : 'none';
  const provider = SPEECH_PROVIDERS[/** @type {keyof typeof SPEECH_PROVIDERS} */ (id)];
  if (!provider || (provider.platforms && !provider.platforms.includes(platform))) {
    return { state: 'todo', detail: 'No speech provider chosen yet' };
  }
  if (provider.onDevice) return { state: 'done', detail: `${provider.label} · runs on this computer` };
  return credentials[provider.key]
    ? { state: 'done', detail: `${provider.label} · key saved` }
    : { state: 'todo', detail: `${provider.label} · needs a key` };
}

/** How a keyless provider was set up, in the words AI Providers uses. */
const KEYLESS_AI_DETAIL = {
  ollama: 'Running a model on this computer',
  custom: 'Using your own endpoint',
  'codex-cli': 'Signed in with OpenAI Codex',
  antigravity: 'Signed in with Google Antigravity',
};

/**
 * Names HOW the AI model is reached, never the model: `get-current-llm-config`'s
 * displayName is the raw model id for cloud models ("gemini-3.7-flash"), and
 * Help names UI labels, not ids.
 *
 * @param {Record<string, unknown> | null | undefined} credentials `get-stored-credentials`
 * @param {{ provider?: string, modelId?: string } | null | undefined} llm `get-current-llm-config`
 * @returns {SetupStep}
 */
export function modelStep(credentials, llm) {
  if (!credentials || !llm) return { state: 'checking', detail: 'Checking…' };
  if (llm.modelId === 'natively' && credentials.hasNativelyKey) return { state: 'done', detail: 'Using Natively API' };
  const keyless = KEYLESS_AI_DETAIL[/** @type {keyof typeof KEYLESS_AI_DETAIL} */ (String(llm.provider))];
  if (keyless) return { state: 'done', detail: keyless };
  if (AI_KEY_FLAGS.some((flag) => !!credentials[flag])) return { state: 'done', detail: 'A provider key is saved' };
  return { state: 'todo', detail: 'No key or sign-in yet' };
}

/**
 * @param {Record<string, unknown> | null | undefined} credentials
 * @returns {SetupStep}
 */
export function nativelyStep(credentials) {
  if (!credentials) return { state: 'checking', detail: 'Checking…' };
  return credentials.hasNativelyKey
    ? { state: 'done', detail: 'Key saved · AI and speech are set up' }
    : { state: 'todo', detail: 'One key sets up the AI model and speech for you' };
}

/**
 * Whether Modes and Profile Intelligence are open: Natively Pro, or a trial
 * whose local token hasn't expired (App.tsx seeds its trial from the same
 * token). null while either read is still out.
 *
 * @param {{ isPremium?: boolean } | null | undefined} license `license:get-details`
 * @param {{ hasToken?: boolean, expired?: boolean } | null | undefined} trial `getLocalTrial`
 * @returns {boolean | null}
 */
export function contextUnlocked(license, trial) {
  if (!license || !trial) return null;
  return !!license.isPremium || (!!trial.hasToken && !trial.expired);
}

const PRO_DETAIL = 'Part of Natively Pro · a free trial opens it';

/**
 * The active mode. General is where everyone starts, so it isn't a choice
 * made: the step is done once a mode for a kind of meeting is active.
 *
 * @param {boolean | null} unlocked contextUnlocked()
 * @param {{ name?: string, templateType?: string } | null | undefined} active
 *   `modes:get-active`; undefined while it is still being read, null when none is active
 * @returns {SetupStep}
 */
export function modeStep(unlocked, active) {
  if (unlocked === null || active === undefined) return { state: 'checking', detail: 'Checking…' };
  if (!unlocked) return { state: 'locked', detail: PRO_DETAIL };
  if (!active || active.templateType === 'general' || !active.name) {
    return { state: 'todo', detail: 'Using General · pick one for your meeting type' };
  }
  return { state: 'done', detail: `Using ${active.name}` };
}

/**
 * @param {boolean | null} unlocked contextUnlocked()
 * @param {{ hasProfile?: boolean } | null | undefined} profile
 *   `profile:get-status`; undefined while it is still being read
 * @returns {SetupStep}
 */
export function profileStep(unlocked, profile) {
  if (unlocked === null || profile === undefined) return { state: 'checking', detail: 'Checking…' };
  if (!unlocked) return { state: 'locked', detail: PRO_DETAIL };
  return profile?.hasProfile
    ? { state: 'done', detail: 'Résumé added · answers can draw on it' }
    : { state: 'todo', detail: 'Answers can draw on your résumé and the job' };
}

/** The Speech Provider list's label for a provider id, or null. */
export function speechProviderLabel(id) {
  return SPEECH_PROVIDERS[/** @type {keyof typeof SPEECH_PROVIDERS} */ (id)]?.label ?? null;
}
