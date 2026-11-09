// plans_viewed: once each time Settings › Plans & Billing comes into view.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPlansTab, plansViewTransition } from '../plansViewed.mjs'
import { FUNNEL_CATALOG, checkFunnelProps } from '../funnelCatalog.mjs'

test('all three Plans & Billing ids are the plans tab, nothing else is', () => {
  for (const tab of ['plans', 'natively-api', 'natively-pro']) assert.equal(isPlansTab(tab), true, tab)
  for (const tab of ['general', 'ai-providers', '', undefined, null, 42]) assert.equal(isPlansTab(tab), false, String(tab))
})

test('coming into view from the sidebar or a link is one view, labelled by how', () => {
  assert.deepEqual(plansViewTransition(false, { open: true, tab: 'plans', fromSidebar: true }), { from: 'sidebar' })
  assert.deepEqual(plansViewTransition(false, { open: true, tab: 'plans', fromSidebar: false }), { from: 'link' })
  assert.deepEqual(plansViewTransition(false, { open: true, tab: 'natively-pro', fromSidebar: false }), { from: 'link' })
})

test('staying in view, moving between its own ids, or another tab is not a view', () => {
  assert.equal(plansViewTransition(true, { open: true, tab: 'plans', fromSidebar: true }), null)
  assert.equal(plansViewTransition(true, { open: true, tab: 'natively-api', fromSidebar: false }), null)
  assert.equal(plansViewTransition(false, { open: true, tab: 'general', fromSidebar: false }), null)
})

test('a closed Settings never counts, even when it last showed Plans & Billing', () => {
  assert.equal(plansViewTransition(false, { open: false, tab: 'plans', fromSidebar: false }), null)
})

test('a walk through Settings counts each return to Plans & Billing once', () => {
  const steps = [
    { open: true, tab: 'general', fromSidebar: false },
    { open: true, tab: 'plans', fromSidebar: true },
    { open: true, tab: 'natively-api', fromSidebar: false },
    { open: true, tab: 'audio', fromSidebar: false },
    { open: true, tab: 'plans', fromSidebar: true },
    { open: false, tab: 'plans', fromSidebar: false },
    { open: true, tab: 'plans', fromSidebar: false },
  ]
  let inView = false
  const sent = []
  for (const now of steps) {
    const view = plansViewTransition(inView, now)
    if (view) sent.push(view.from)
    inView = now.open && isPlansTab(now.tab)
  }
  assert.deepEqual(sent, ['sidebar', 'sidebar', 'link'])
})

test('every value it sends is one the funnel catalogue accepts', () => {
  assert.deepEqual([...FUNNEL_CATALOG.plans_viewed.from].sort(), ['link', 'sidebar'])
  for (const from of ['sidebar', 'link']) assert.equal(checkFunnelProps('plans_viewed', { from }).ok, true, from)
  assert.equal(checkFunnelProps('plans_viewed', { from: 'elsewhere' }).ok, false)
})
