// When Settings › Plans & Billing counts as viewed (funnel event plans_viewed).
//
// Once each time the tab comes into view: Settings opening on it, or moving to
// it from another tab. Moving between its own ids ('plans', 'natively-api',
// 'natively-pro' all show the same page) or re-rendering while it stays in
// view is not a new view. Pure, so it is tested without a window.

const PLANS_TABS = new Set(['plans', 'natively-api', 'natively-pro'])

/** Whether a Settings tab id shows Plans & Billing. */
export function isPlansTab(tab) {
  return typeof tab === 'string' && PLANS_TABS.has(tab)
}

/**
 * The plans_viewed props to send for this render, or null to send nothing.
 *
 * @param {boolean} wasInView Plans & Billing was in view on the last check.
 * @param {{ open: boolean, tab: unknown, fromSidebar: boolean }} now
 *   Settings is open, the tab it shows, and whether the last tab change was a
 *   click on the sidebar's Plans & Billing item.
 * @returns {{ from: 'sidebar' | 'link' } | null}
 */
export function plansViewTransition(wasInView, now) {
  const inView = Boolean(now && now.open) && isPlansTab(now.tab)
  if (!inView || wasInView) return null
  return { from: now.fromSidebar ? 'sidebar' : 'link' }
}
