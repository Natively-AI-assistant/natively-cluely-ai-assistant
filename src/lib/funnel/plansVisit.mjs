// One visit to Settings › Plans & Billing, summed up as the funnel event
// plans_visit when it ends (added 2026-11-09).
//
// plans_viewed counts that someone opened the tab. This says what they did
// there, so the pricing design can be judged on numbers: did they scroll past
// the API plans to the packs and the Pro licence, did they move the plan rail
// themselves, did they try Yearly, how long did they stay, did they open a
// checkout or the refund details. One row per visit, so a visit can be read
// whole without stitching events together.
//
// A visit starts when the tab comes into view (the same moment plans_viewed is
// sent) and ends when it leaves: another tab, Settings closing, the window
// going away. Time counts only while the window is visible AND in front
// (focused), so Settings left open behind other windows does not read as an
// hour of reading. Focus is needed as well because the launcher can run with
// background throttling off, and then a hidden window still says "visible".
//
// Pure apart from the clock and the sender it is given, so it is tested
// without a window. Every property is an enum, a whole number or a yes/no, as
// the catalogue requires; nothing a person typed can reach it.

import { parseCheckoutUrl } from './checkoutLinks.mjs'

/** The parts of the page a visit can reach, in page order for someone without a plan. */
export const PLANS_SECTIONS = Object.freeze(['api_plans', 'packs', 'pro', 'bottom'])

/** A visit longer than this is reported as this many seconds. */
export const PLANS_VISIT_SECONDS_MAX = 1800

/** The four API plan cards in the rail. */
export const PLAN_CARDS = Object.freeze(['standard', 'pro', 'max', 'ultra'])

/** A Dodo checkout link: the same test the main process tags checkouts by. */
export function isCheckoutUrl(url) {
  return typeof url === 'string' && parseCheckoutUrl(url) !== null
}

/**
 * @param {{ now?: () => number, send?: (props: Record<string, string | number | boolean>) => void }} [deps]
 */
export function createPlansVisitTracker(deps = {}) {
  const now = deps.now ?? (() => Date.now())
  const send = deps.send ?? (() => {})
  /** @type {null | {
   *   from: 'sidebar' | 'link', visibleMs: number, visibleSince: number | null,
   *   sections: Set<string>, cards: Set<string>, railScrolled: boolean,
   *   cycle: 'monthly' | 'yearly' | null, cycleSwitched: boolean,
   *   checkouts: number, refundOpened: boolean,
   * }} */
  let visit = null
  /** Called on every start, so parts already on screen can report again. */
  const startListeners = new Set()

  return {
    /** The tab came into view. Ends a visit left open, so two never overlap. */
    start(from, { visible = true } = {}) {
      if (visit) this.end()
      visit = {
        from: from === 'sidebar' ? 'sidebar' : 'link',
        visibleMs: 0,
        visibleSince: visible ? now() : null,
        sections: new Set(),
        cards: new Set(),
        railScrolled: false,
        cycle: null,
        cycleSwitched: false,
        checkouts: 0,
        refundOpened: false,
      }
      for (const fn of startListeners) { try { fn() } catch { /* a listener never stops a visit */ } }
    },
    /**
     * Run fn each time a visit starts. A part of the page that stays mounted
     * between visits (Settings hidden, not closed) uses it to report that it is
     * on screen again. Returns the unsubscribe.
     */
    onStart(fn) {
      startListeners.add(fn)
      return () => { startListeners.delete(fn) }
    },
    /** Whether a visit is running. */
    get active() { return visit !== null },
    /** A part of the page came into view. Unknown names are ignored. */
    seen(section) {
      if (visit && PLANS_SECTIONS.includes(section)) visit.sections.add(section)
    },
    /** An API plan card was on screen in the rail. */
    card(id) {
      if (visit && PLAN_CARDS.includes(id)) visit.cards.add(id)
    },
    /** The person moved the plan rail themselves (wheel, drag, keys), not its own rotation. */
    railScrolled() { if (visit) visit.railScrolled = true },
    /**
     * The Monthly / Yearly switch's current value, whoever set it (the page
     * itself moves a yearly subscriber to Yearly). Never counts as a switch.
     */
    cycle(value) {
      if (!visit || (value !== 'monthly' && value !== 'yearly')) return
      visit.cycle = value
    },
    /** The person pressed the switch to a different value. */
    cycleSwitched(value) {
      if (!visit || (value !== 'monthly' && value !== 'yearly')) return
      if (visit.cycle !== value) visit.cycleSwitched = true
      visit.cycle = value
    },
    /** A link was opened from the tab; counted only when it is a checkout. */
    opened(url) { if (visit && isCheckoutUrl(url)) visit.checkouts += 1 },
    /** "How it works & refund policy" was opened. */
    refundOpened() { if (visit) visit.refundOpened = true },
    /** The window was hidden or shown: time stops and starts with it. */
    visibility(visible) {
      if (!visit) return
      if (visible && visit.visibleSince === null) visit.visibleSince = now()
      if (!visible && visit.visibleSince !== null) {
        visit.visibleMs += Math.max(0, now() - visit.visibleSince)
        visit.visibleSince = null
      }
    },
    /**
     * The tab left view. Sends plans_visit once and returns its props, or null
     * when no visit was running.
     */
    end() {
      if (!visit) return null
      const v = visit
      visit = null
      if (v.visibleSince !== null) v.visibleMs += Math.max(0, now() - v.visibleSince)
      const props = {
        from: v.from,
        seconds: Math.min(PLANS_VISIT_SECONDS_MAX, Math.round(v.visibleMs / 1000)),
        saw_api_plans: v.sections.has('api_plans'),
        saw_packs: v.sections.has('packs'),
        saw_pro: v.sections.has('pro'),
        saw_bottom: v.sections.has('bottom'),
        plan_cards: v.cards.size,
        saw_max_ultra: v.cards.has('max') || v.cards.has('ultra'),
        rail_scrolled: v.railScrolled,
        cycle_switched: v.cycleSwitched,
        checkouts: v.checkouts,
        refund_opened: v.refundOpened,
      }
      if (v.cycle) props.cycle = v.cycle
      try { send(props) } catch { /* telemetry never breaks the page */ }
      return props
    },
  }
}

/**
 * The app's one tracker. SettingsOverlay starts and ends visits; the Plans
 * page's parts report into it. Sends through the preload bridge, which checks
 * the event against the catalogue and drops it when Usage statistics is off.
 */
export const plansVisit = createPlansVisitTracker({
  send: (props) => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined
    api?.funnelTrack?.('plans_visit', props)?.catch?.(() => {})
  },
})
