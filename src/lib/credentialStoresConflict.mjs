/**
 * What the credential-stores card in Settings → AI Providers says (unit-tested).
 *
 * Main reports two saved credential sets it cannot order, as field NAMES and
 * last-4 only (CredentialsManager.getAmbiguousStoreSummary), and answers a
 * choice with `{ ok }` or a reason code (resolveAmbiguousStores). This turns
 * both into what is shown: provider names instead of field names, one row per
 * key so the two sets can be compared, the OS store named for the platform the
 * app is running on, and a sentence for every reason a choice can be refused.
 * Reason codes choose the words and are never printed.
 *
 * Wording is whole sentences with `{store}` slots, passed through `t` BEFORE
 * the name goes in, so a language can put the name where it belongs. Every
 * sentence this module can show is in PHRASE and published as
 * CREDENTIAL_STORES_PHRASES; src/i18n.credentialStores.ts holds a row for each
 * and a test fails when one is missing.
 */

const identity = (text) => text;
const fill = (text, slots) => text.replace(/\{(\w+)\}/g, (m, k) => (k in slots ? String(slots[k]) : m));

const PHRASE = {
  appBackup: 'App backup',
  keychain: 'macOS Keychain',
  windowsAccount: 'Windows account',
  keyring: 'System keyring',
  customEmbeddings: 'Custom embeddings',
  customReranker: 'Custom reranker',
  speech: '{provider} speech',
  again: 'Choose again. If it keeps failing, restart Natively.',
  copyFailed: 'The two files could not be copied aside first, so nothing was changed.',
  freeSpace: 'Free up some disk space, then choose again.',
  saveFailed: 'Your choice could not be saved, so nothing was changed.',
  setUnreadable: 'The {store} set could not be read, so nothing was changed.',
  unlockKeychain: 'Unlock your keychain and choose again, or keep the app backup.',
  signInWindows: 'Sign in to the Windows account that saved these keys and choose again, or keep the app backup.',
  unlockKeyring: 'Unlock your system keyring and choose again, or keep the app backup.',
  backupUnreadable: 'The app backup could not be read, so nothing was changed.',
  keepOther: 'Keep the {store} set instead.',
  storeUnavailable: 'Your key store is unavailable this session, so nothing was changed.',
  restart: 'Restart Natively and try again.',
  notApplied: 'That choice could not be applied, so nothing was changed.',
};

/** Every sentence this module passes through `t`. */
export const CREDENTIAL_STORES_PHRASES = Object.values(PHRASE);

// A stored field that holds a secret the user typed in. Everything else in a
// set (model choices, languages, endpoints, trial state) is counted, not listed.
const KEY_FIELD = /ApiKey$/;

// The names the rest of Settings uses for the same providers. Brand names are
// never translated; the four that describe rather than name are worded in
// credentialKeyLabel so a language can say them its own way.
export const CREDENTIAL_KEY_LABELS = {
  geminiApiKey: 'Gemini',
  groqApiKey: 'Groq',
  openaiApiKey: 'OpenAI',
  claudeApiKey: 'Claude',
  deepseekApiKey: 'DeepSeek',
  nvidiaNimApiKey: 'Nvidia Nim',
  openrouterApiKey: 'OpenRouter',
  fluxionApiKey: 'Fluxion AI',
  agentrouterApiKey: 'AgentRouter',
  litellmApiKey: 'LiteLLM',
  ninerouterApiKey: '9Router',
  nativelyApiKey: 'Natively',
  customEmbeddingApiKey: PHRASE.customEmbeddings,
  customRerankerApiKey: PHRASE.customReranker,
  jinaApiKey: 'Jina',
  voyageApiKey: 'Voyage',
  tavilyApiKey: 'Tavily',
  groqSttApiKey: 'Groq speech',
  openAiSttApiKey: 'OpenAI speech',
  deepgramApiKey: 'Deepgram',
  elevenLabsApiKey: 'ElevenLabs',
  azureApiKey: 'Azure Speech',
  ibmWatsonApiKey: 'IBM Watson',
  sonioxApiKey: 'Soniox',
};
const SPEECH_KEY_OF = { groqSttApiKey: 'Groq', openAiSttApiKey: 'OpenAI' };
const DESCRIBED_KEY = { customEmbeddingApiKey: PHRASE.customEmbeddings, customRerankerApiKey: PHRASE.customReranker };

/** `geminiApiKey` → "Gemini". A field this table has not met is spelled out
    from its own name rather than shown raw. */
export function credentialKeyLabel(name, t = identity) {
  if (Object.hasOwn(SPEECH_KEY_OF, name)) return fill(t(PHRASE.speech), { provider: SPEECH_KEY_OF[name] });
  if (Object.hasOwn(DESCRIBED_KEY, name)) return t(DESCRIBED_KEY[name]);
  if (Object.hasOwn(CREDENTIAL_KEY_LABELS, name)) return CREDENTIAL_KEY_LABELS[name];
  const words = String(name).replace(/ApiKey$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : String(name);
}

/** What the OS-protected set is called on this machine. safeStorage is the
    Keychain on macOS, the signed-in account (DPAPI) on Windows and the desktop
    keyring on Linux; "keychain" is a Mac word and is not shown anywhere else. */
export function credentialStoreName(which, platform, t = identity) {
  if (which === 'fallback') return t(PHRASE.appBackup);
  if (platform === 'darwin') return t(PHRASE.keychain);
  if (platform === 'win32') return t(PHRASE.windowsAccount);
  return t(PHRASE.keyring);
}

const splitSet = (set) => {
  const keys = new Map();
  let others = 0;
  for (const entry of Array.isArray(set?.keys) ? set.keys : []) {
    if (!entry || typeof entry.name !== 'string') continue;
    if (KEY_FIELD.test(entry.name)) keys.set(entry.name, String(entry.last4 ?? ''));
    else others += 1;
  }
  return { keys, others };
};

const time = (iso) => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : null;
};

/**
 * The two sets side by side: one row per key either set holds, sorted by the
 * name shown. `differs` is true when a key is missing from one set or ends in
 * different characters; rows that match are the ones that do not depend on the
 * choice. `newer` is the set saved last, or null when either time is unknown
 * or they are equal.
 */
export function compareCredentialStores(stores, t = identity) {
  const keyring = splitSet(stores?.keyring);
  const fallback = splitSet(stores?.fallback);
  const names = [...new Set([...keyring.keys.keys(), ...fallback.keys.keys()])];
  const rows = names
    .map((name) => {
      const k = keyring.keys.has(name) ? keyring.keys.get(name) : null;
      const f = fallback.keys.has(name) ? fallback.keys.get(name) : null;
      return { name, label: credentialKeyLabel(name, t), keyring: k, fallback: f, differs: k !== f };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  const kt = time(stores?.keyring?.mtimeIso);
  const ft = time(stores?.fallback?.mtimeIso);
  return {
    rows,
    keyring: { count: keyring.keys.size, others: keyring.others, savedAt: kt },
    fallback: { count: fallback.keys.size, others: fallback.others, savedAt: ft },
    newer: kt === null || ft === null || kt === ft ? null : (kt > ft ? 'keyring' : 'fallback'),
  };
}

/** "28 Sep, 14:44"; the year only when it is not this one. `locale` is the
    app's language when it is not English, so the month is written in the
    language of the sentence around it; left out, the system's region decides. */
export function formatSavedAt(ms, { locale, timeZone, now = Date.now() } = {}) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return null;
  const sameYear = new Date(ms).getUTCFullYear() === new Date(now).getUTCFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    ...(sameYear ? {} : { year: 'numeric' }),
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(ms));
}

/**
 * A refused choice, in words. `gone` means there is no longer anything to
 * choose (another window answered first): the card should re-read the state
 * and leave, not report a failure.
 */
export function describeResolveFailure(code, choice, platform, t = identity) {
  if (code === 'not_ambiguous') return { gone: true };
  const store = credentialStoreName('keyring', platform, t);
  switch (code) {
    case 'snapshot_failed':
      return { headline: t(PHRASE.copyFailed), detail: t(PHRASE.freeSpace) };
    case 'persist_failed':
      return { headline: t(PHRASE.saveFailed), detail: t(PHRASE.again) };
    case 'keyring_unreadable':
      return {
        headline: fill(t(PHRASE.setUnreadable), { store }),
        detail: platform === 'darwin'
          ? t(PHRASE.unlockKeychain)
          : platform === 'win32' ? t(PHRASE.signInWindows) : t(PHRASE.unlockKeyring),
      };
    case 'fallback_unreadable':
      return { headline: t(PHRASE.backupUnreadable), detail: fill(t(PHRASE.keepOther), { store }) };
    case 'store_degraded':
      return { headline: t(PHRASE.storeUnavailable), detail: t(PHRASE.restart) };
    default:
      return { headline: t(PHRASE.notApplied), detail: t(PHRASE.again) };
  }
}
