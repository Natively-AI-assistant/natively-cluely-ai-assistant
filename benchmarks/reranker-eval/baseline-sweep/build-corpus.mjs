/**
 * A corpus with real distractors.
 *
 * The earlier 12-passage set left almost no headroom: text-embedding-3-small
 * put the right passage first on 7 of 10 queries, so a reranker could win at
 * most 3 points and the differences between models vanished into noise.
 *
 * Here every topic contributes ONE passage that answers its question and FOUR
 * that discuss the same subject without answering it, using the same
 * vocabulary. A bi-encoder scores all five alike; separating them is precisely
 * what a cross-encoder is for. That is the measurement.
 */
import fs from 'node:fs';

const TOPICS = [
  {
    key: 'bundling',
    gold: 'Because esbuild emits one bundle per entry point, a module imported by two entries is INLINED into both. A singleton held in a module-level variable therefore exists twice at runtime. Anchoring it on globalThis is the fix.',
    distractors: [
      'esbuild is used for the main process because it is fast enough to run on every save. Its output goes to dist-electron and is not minified in development.',
      'Vite builds the renderer into a single index.html plus hashed asset chunks. Chunks over 1500 kB raise a build warning, which is advisory and does not fail the build.',
      'Bundle sizes are tracked per release. The renderer bundle grew after the settings redesign, which is expected because the panel ships its own icon set.',
      'Entry points are declared in the build script. Adding one means adding it there and to the packaging file list, or the new bundle ships without being loaded.',
    ],
    query: 'Why does one singleton end up existing twice while the app is running?',
  },
  {
    key: 'native-modules',
    gold: 'A native module built for plain Node fails to load under Electron with ERR_DLOPEN_FAILED and a NODE_MODULE_VERSION mismatch. They must be rebuilt against the Electron ABI during postinstall.',
    distractors: [
      'better-sqlite3 stores the meeting database. Queries are synchronous, which is why long scans are moved off the main thread.',
      'keytar provides secure storage on macOS through the Keychain. On Windows the same capability is Credential Manager, reached through a different native binding.',
      'The verify-native-arch step checks the compiled architecture of the native binaries before a commit lands, so an x64 build never ships inside an arm64 package.',
      'Native modules are unpacked from the asar archive at package time, because a .node file cannot be dlopened from inside an archive.',
    ],
    query: 'What is the error when a native binding was compiled for the wrong runtime?',
  },
  {
    key: 'audio-macos',
    gold: 'System audio capture on macOS uses a PRIVATE CoreAudio aggregate device. It remains enumerable in-process, so it poisons the microphone picker unless it is filtered out by uid.',
    distractors: [
      'Microphone permission on macOS is requested the first time capture starts. Denying it leaves the app running with transcription disabled rather than crashing.',
      'On Windows the equivalent of system audio capture is WASAPI loopback, which needs its own device enumeration path and shares none of the aggregate-device behaviour.',
      'Audio devices are re-enumerated when the system reports a configuration change, because a headset connecting mid-meeting must appear without a restart.',
      'The audio pipeline resamples to 16 kHz mono before transcription, since every speech provider in use expects that format.',
    ],
    query: 'Why does the microphone list show a device the user never added?',
  },
  {
    key: 'signing',
    gold: 'Without a provisioning profile, AMFI kills a signed and notarized macOS application at launch with POSIX error 163, and produces no crash report at all.',
    distractors: [
      'Code signing a macOS build needs a Developer ID certificate and the hardened runtime, then notarization before the app can be distributed outside the store.',
      'Notarization is asynchronous. The build waits for the ticket and staples it, so the first launch does not need a network round trip.',
      'Entitlements are declared in a plist alongside the build configuration. Adding one that the certificate does not authorise makes signing fail loudly.',
      'Windows signing uses a different certificate and does not involve notarization at all; SmartScreen reputation builds up separately over time.',
    ],
    query: 'A signed and notarized Mac build dies instantly with no crash report — what is happening?',
  },
  {
    key: 'reranking',
    gold: 'Reranking decides the ORDER of candidates that embedding retrieval already found. The single seam is ModeHybridRetriever, and a partial ranking is rejected wholesale because an unscored candidate would sink below every candidate the reranker never saw.',
    distractors: [
      'Embedding retrieval finds the candidate set by cosine similarity in vector space. Recall at k saturates quickly and is the wrong metric for judging a reranker.',
      'Rerankers can be run locally or through a hosted provider. The hosted path sends the query and the candidate text, and nothing else leaves the machine.',
      'The reranker catalogue lists ten models with pinned revisions and per-file digests, so a download that resumes cannot mix bytes from two revisions.',
      'A cross-encoder scores one query-passage pair at a time, which is why its cost is linear in the number of candidates rather than constant.',
    ],
    query: 'After cosine similarity has already produced the candidate set, what determines their final order?',
  },
  {
    key: 'shortcuts',
    gold: 'Global shortcuts on Windows go through RegisterHotKey, which can SILENTLY drop a registration. The application then appears to leak the chord to whatever window has focus.',
    distractors: [
      'Shortcuts are configurable per action. A chord already claimed by the system is rejected at registration time with a message naming the conflict.',
      'On macOS global shortcuts require Accessibility permission, and the app prompts for it the first time a chord is registered.',
      'CommandOrControl is used wherever an action means the same thing on both platforms; explicit Command or Control appears only when the behaviour differs on purpose.',
      'Transparent always-on-top windows behave differently across macOS Spaces and Windows virtual desktops, so neither window level nor click-through maps across the two.',
    ],
    query: 'Why does a keyboard chord sometimes reach the wrong application on Windows?',
  },
  {
    key: 'overlay',
    gold: 'The overlay is THREE windows: a fixed-height shell plus a pill and a toggle as auxiliaries, welded together with setParentWindow so they follow moves atomically.',
    distractors: [
      'The overlay stays on top of other windows and is excluded from screen capture, so a shared screen does not show it.',
      'Overlay content is rendered by the same Vite bundle as the settings window, with routing deciding which surface mounts.',
      'Window opacity is animated on hover, and the timeout that drives it is shared, so it must be flushed rather than cleared when the window hides.',
      'The overlay is positioned relative to the active display, and it is repositioned when the display arrangement changes.',
    ],
    query: 'How many windows make up the overlay and what holds them together when it moves?',
  },
  {
    key: 'embedding-width',
    gold: 'An embedding width is MEASURED by probing the provider, never assumed: a guessed width stamps a wrong space key over real vectors, and every later search silently misses.',
    distractors: [
      'Embedding providers are tried in order and the first available one wins, unless the user pinned a provider in manual mode.',
      'Voyage embeds queries and documents differently, so it is never something a user ends up on by accident.',
      'The embedding catalogue records dimensions per model, and models that support several widths list all of them.',
      'Re-embedding runs when the space key changes, and it is bounded so a large knowledge base cannot spend the whole session re-indexing.',
    ],
    query: 'Why is an embedding vector width probed rather than read from a table?',
  },
];

/**
 * Two further phrasings per topic, on top of the plain question above.
 *
 * (b) shifts the keywords so lexical overlap points at a DISTRACTOR, and
 * (c) is vague enough that no passage wins on similarity alone. Both exist
 * because the plain questions alone left the embedder at 18/24 before any
 * reranker ran, and models cannot be told apart in three points of headroom.
 */
const EXTRA_PHRASINGS = {
  "bundling": [
    "duplicate instance of a shared module across build outputs",
    "module-level state and entry points, what goes wrong"
  ],
  "native-modules": [
    "dlopen failure after installing dependencies",
    "binding compiled somewhere else, what does it say on load"
  ],
  "audio-macos": [
    "aggregate device showing up where it should not",
    "unexpected entry in the capture device list on a Mac"
  ],
  "signing": [
    "hardened runtime and entitlements but it will not start",
    "process killed by the OS immediately, nothing logged"
  ],
  "reranking": [
    "what changes the sequence of results after retrieval",
    "ordering stage that runs once, and what happens if it half-answers"
  ],
  "shortcuts": [
    "hotkey registration that quietly does not take",
    "chord going to the wrong window"
  ],
  "overlay": [
    "how the floating pieces stay together when dragged",
    "parenting of the auxiliary windows"
  ],
  "embedding-width": [
    "vector size discovered instead of declared, and why",
    "wrong dimensions written into the index"
  ]
};

const passages = [];
const queries = [];
for (const t of TOPICS) {
  const goldIndex = passages.length;
  passages.push(t.gold);
  for (const d of t.distractors) passages.push(d);
  queries.push({ q: t.query, gold: goldIndex, topic: t.key });
  for (const alt of EXTRA_PHRASINGS[t.key] ?? []) queries.push({ q: alt, gold: goldIndex, topic: t.key });
}
// Interleave so a gold passage is never at a predictable offset — a reranker
// must not be able to look good by accident of ordering.
const order = passages.map((_, i) => i);
let seed = 12345;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
const shuffled = order.map(i => passages[i]);
const newIndexOf = new Map(order.map((old, now) => [old, now]));

fs.writeFileSync(process.argv[2], JSON.stringify({
  passages: shuffled,
  queries: queries.map(q => ({ ...q, gold: newIndexOf.get(q.gold) })),
}, null, 1));
console.log(`${shuffled.length} passages (${TOPICS.length} topics x 5), ${queries.length} queries ` +
  `(${TOPICS.length} topics x ${1 + (EXTRA_PHRASINGS[TOPICS[0].key]?.length ?? 0)})`);
