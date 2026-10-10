// src/lib/funnel/funnelCatalog.mjs
//
// The funnel event catalogue: every event this app may report, and every
// property each one may carry.
//
// THIS FILE HAS A TWIN: natively-api/lib/funnelCatalog.js. Everything below
// this header is the same text in both, and funnelCatalogParity.test.mjs
// compares them. They are two files because the app and the API are separate
// repositories that ship on separate schedules.
//
// ORDER OF CHANGE: add an event or a value to the SERVER file first, deploy it,
// and only then ship the app that sends it. The server refuses what it does
// not know and this app then drops that event for good.
//
// THE CONTROL: no free strings. A property is an enum (a list of the only
// values it may take), 'int' or 'bool'. There is nowhere in a funnel event for
// a name, an email, a key, a prompt or a line of transcript to go.

/** What the install can do right now, as the client sees it. */
export const ENTITLEMENTS = Object.freeze([
  'none',           // no AI configured at all
  'byok',           // the user's own provider key, local model or sign-in
  'trial',          // free trial running
  'trial_expired',  // trial over, no choice made yet
  'api',            // Natively API plan
  'pro',            // Natively Pro licence
  'api_pro',        // both
])

/** Everything the app can send a buyer to. */
export const CHECKOUT_PRODUCTS = Object.freeze([
  'api_standard', 'api_pro', 'api_max', 'api_ultra', 'pro_lifetime', 'pro_yearly',
])

/** Every place in the app that can open a checkout page or offer a trial. */
export const SURFACES = Object.freeze([
  'trial_card',            // the end-of-trial / see-your-options card
  'trial_promo',           // the "try Natively" card
  'api_promo',             // the Natively API cards
  'api_settings',          // Settings › Plans, Natively API
  'pro_settings',          // Settings › Plans, Natively Pro
  'quota_banner',          // "you have run out" banner
  'profile_intelligence',  // locked Profile Intelligence
  'modes_settings',        // locked Modes
  'max_ultra_toaster',
  'jd_toaster',
  'profile_toaster',
  'meeting_start',         // the trial that starts by itself with a meeting
  'overlay',               // the meeting overlay's trial notice
  'trial_meter',           // the launcher's small card: trial clock, voice and AI used
  'other',
])

/**
 * The cards the app can raise by itself. Mirrors CARDS in the app's
 * src/lib/cards/cardPolicy.mjs; a test there fails when a card is added without
 * being added here.
 */
export const CARD_IDS = Object.freeze([
  'browser_extension', 'trial_promo', 'natively_api_new', 'max_ultra',
  'natively_api_existing', 'profile_ad', 'jd_ad', 'review_prompt', 'support',
])

/**
 * Why an answer that was asked for did not come, as one word. The same causes
 * the overlay words its notice from (src/lib/funnel/answerFailure.mjs maps
 * them; a test there fails when the overlay learns a cause this list lacks).
 * Never the provider's message, a status number or a model name.
 */
export const ANSWER_FAILURE_CAUSES = Object.freeze([
  'setup',         // no AI provider is set up
  'auth',          // the provider refused the key or sign-in
  'credits',       // the provider is out of credits
  'rate',          // the provider is rate limiting
  'model',         // the provider does not have the model
  'timeout',       // no reply in time
  'idle',          // the reply stopped arriving
  'empty',         // an empty reply
  'broke_off',     // the reply stopped part-way
  'unreachable',   // offline, or a local server that is not running
  'too_large',     // the request was refused as too large
  'rejected',      // the provider refused the request
  'overloaded',
  'server',        // the provider had a server error
  'failed',        // the provider failed and said nothing more
  'trial_ended',
  'plan_limit',    // the Natively plan's limit
  'plan_expired',
  'not_sent',      // the app did not send it (privacy setting, attachment, images the model cannot read)
  'app',           // a fault of the app's own
])

/** What the user did with a card. Mirrors OUTCOMES in the same file. */
export const CARD_OUTCOMES = Object.freeze(['shown', 'acted', 'later', 'never', 'interrupted'])

const INT = 'int'
const BOOL = 'bool'

export const FUNNEL_CATALOG = Object.freeze({
  // ── The install ──────────────────────────────────────────────────────────
  app_first_run: {},
  // At most once per local calendar day per install. A snapshot, so "what did
  // the people who left the trial through their own keys do next" has an answer.
  app_active_day: {
    days_since_install: INT,
    has_own_ai: BOOL,
    has_api_key: BOOL,
    has_pro: BOOL,
    meetings_total: INT,
  },
  meeting_started: {
    first: BOOL,
    // Whose AI answers: ours (a plan or the trial), the user's own, or nobody's.
    ai: ['natively', 'own', 'none'],
  },
  meeting_ended: {
    minutes: INT,
    first: BOOL,
    // How many answers the assistant gave in it. A count, never the answers: a
    // meeting with none is someone who started the app and got nothing from it.
    answers: INT,
  },

  // A meeting the app never saw end: it was closed or it crashed while one was
  // running, and the next launch found the note the meeting left on disk.
  // `minutes` runs to the last time the app was known to be up. A meeting ended
  // by quitting the app normally is a meeting_ended like any other.
  meeting_cut_off: {
    minutes: INT,
    first: BOOL,
  },
  // An answer was asked for and did not come. At most once per cause per local
  // day per install: which kinds of failure someone met that day, not how often.
  answer_failed: {
    cause: ANSWER_FAILURE_CAUSES,
    ai: ['natively', 'own', 'none'],
    in_meeting: BOOL,
  },

  // ── Getting started ──────────────────────────────────────────────────────
  // The steps before the first meeting: where a new user stops is the first
  // thing a funnel has to say.
  onboarding_stage: {
    stage: ['welcome', 'tour', 'permissions'],
    action: ['shown', 'completed', 'skipped'],
  },

  // ── What people use ──────────────────────────────────────────────────────
  // At most once per feature per local day per install: which features someone
  // used that day, not how often or on what.
  feature_used: {
    feature: [
      'answer', 'follow_up', 'recap', 'suggest_questions', 'clarify', 'brainstorm',
      'chat', 'search', 'copy_answer', 'pdf_export', 'calendar_connect',
    ],
  },

  // ── Cards ────────────────────────────────────────────────────────────────
  // One event for every card the app raises (trial promo, plan and upgrade
  // cards, support, review), taken from the card ledger: shown, acted on, put
  // off, refused for good.
  card: {
    id: CARD_IDS,
    outcome: CARD_OUTCOMES,
  },

  // ── The trial ────────────────────────────────────────────────────────────
  trial_start_result: {
    surface: SURFACES,
    result: [
      'ok', 'already_used', 'already_used_expired', 'ip_limit', 'daily_limit', 'rate_limited',
      'hwid_unavailable', 'network', 'server_error',
    ],
  },
  trial_expired: {},
  // The meeting overlay's trial notice: it started by itself, it is about to
  // end, it has ended, or the automatic start failed and a manual one is offered.
  trial_notice: {
    state: ['started', 'ending', 'ended', 'failed'],
    action: ['shown', 'own_keys', 'plans', 'start', 'dismissed'],
  },
  trial_card: {
    mode: ['active', 'expired'],
    action: [
      'shown', 'plan_standard', 'plan_pro', 'plan_max', 'plan_ultra',
      'byok', 'dismissed', 'wipe_failed', 'end_anyway',
    ],
  },

  // ── Paying ───────────────────────────────────────────────────────────────
  checkout_opened: {
    product: CHECKOUT_PRODUCTS,
    surface: SURFACES,
    opened: BOOL,
  },
  key_entered: {
    kind: ['api_key', 'pro_licence'],
    result: ['ok', 'invalid', 'network', 'error'],
    // Minutes since this install started its trial / left it through its own
    // keys. Absent when it never did. This is what makes "chose own keys, then
    // pasted a paid key" countable.
    mins_since_trial_start: INT,
    mins_since_byok_exit: INT,
  },
  upgrade_prompt: {
    surface: SURFACES,
    action: ['shown', 'clicked', 'dismissed'],
  },
  paywall_hit: {
    feature: ['modes', 'profile_intelligence'],
  },
})

export const FUNNEL_EVENT_NAMES = Object.freeze(Object.keys(FUNNEL_CATALOG))

/** Largest integer any 'int' property may carry. Minutes in ~19 years. */
export const FUNNEL_INT_MAX = 10_000_000

/**
 * Check one event's properties against the catalogue.
 *
 * Returns { ok: true, props } with exactly the allowed keys, or
 * { ok: false, error }. An unknown key is a rejection, never a strip: silently
 * dropping a field hides the bug that sent it.
 */
export function checkFunnelProps(eventType, props) {
  const spec = FUNNEL_CATALOG[eventType]
  if (!spec || !Object.prototype.hasOwnProperty.call(FUNNEL_CATALOG, eventType)) {
    return { ok: false, error: 'event_type' }
  }
  if (props === undefined || props === null) return { ok: true, props: {} }
  if (typeof props !== 'object' || Array.isArray(props)) return { ok: false, error: 'props_not_object' }
  const out = {}
  for (const key of Object.keys(props)) {
    if (!Object.prototype.hasOwnProperty.call(spec, key)) return { ok: false, error: `unknown_prop:${key.slice(0, 32)}` }
    const rule = spec[key]
    const v = props[key]
    if (rule === INT) {
      if (!Number.isInteger(v) || v < 0 || v > FUNNEL_INT_MAX) return { ok: false, error: `bad_prop:${key}` }
    } else if (rule === BOOL) {
      if (typeof v !== 'boolean') return { ok: false, error: `bad_prop:${key}` }
    } else if (!(typeof v === 'string' && rule.includes(v))) {
      return { ok: false, error: `bad_prop:${key}` }
    }
    out[key] = v
  }
  return { ok: true, props: out }
}
