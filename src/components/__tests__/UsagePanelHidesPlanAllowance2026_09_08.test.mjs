/**
 * The monthly usage panel reports a PROPORTION, not the plan's allowance.
 *
 * "Usage this month" used to read "4.1M / 6.5M · 63%", which prints the exact
 * entitlement on screen. It now reads "63%" — the same "am I running low?"
 * signal without spelling out what the plan grants.
 *
 * The trial panel deliberately KEEPS the pair: a trial's allowance is public,
 * and a trial user is exactly the person deciding whether a task will fit. So
 * this is not "percentages everywhere" and a blanket change to ResourceMeter
 * would be wrong — which is what these assertions pin.
 *
 * Source assertions, because the panel is a large motion-heavy component with
 * no render harness in this repo. They check the CALL SITES rather than any
 * rendered string, so a copy tweak cannot fail them falsely.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(__dirname, '../settings/NativelyApiSettings.tsx'), 'utf8')

/**
 * The JSX of one usage card, located by its RENDERED section heading.
 *
 * Anchored on `<text></SectionLabel>`, not on the bare words: both phrases also
 * appear in this file's prose comments, and a plain indexOf found one of those
 * first and sliced a region containing no meters at all — a test that fails for
 * a reason unrelated to the behaviour it guards.
 */
function cardAfter(heading) {
  const m = new RegExp(`${heading}\\s*</SectionLabel>`).exec(SRC)
  assert.ok(m, `heading "${heading}" not rendered by a SectionLabel — the panel was restructured`)
  const body = SRC.slice(m.index)
  const end = body.indexOf('</Card>')
  assert.notEqual(end, -1, `no </Card> after "${heading}"`)
  return body.slice(0, end)
}

test('every meter in "Usage this month" shows the percentage only', () => {
  const card = cardAfter('Usage this month')
  const rows = card.match(/<(?:ResourceMeter|KnowledgeUsage)\b[^>]*\/>/g) ?? []
  assert.ok(rows.length >= 4, `expected the four product rows, found ${rows.length}`)
  for (const row of rows) {
    assert.match(row, /\bpercentOnly\b/,
      `this row still prints the plan's allowance: ${row.trim()}`)
  }
})

test('the trial panel still shows used/limit', () => {
  // Not an oversight and not consistency debt — see ResourceMeter's comment.
  const card = cardAfter('Usage this trial')
  const rows = card.match(/<ResourceMeter\b[^>]*\/>/g) ?? []
  assert.ok(rows.length >= 3, `expected the trial rows, found ${rows.length}`)
  for (const row of rows) {
    assert.doesNotMatch(row, /\bpercentOnly\b/,
      `the trial panel should keep its figures: ${row.trim()}`)
  }
})

test('an unmetered resource reads "Unlimited" rather than a percentage', () => {
  // percent is meaningless without a limit; 0% would read as "none used".
  assert.match(SRC, /meter\.limit == null \? 'Unlimited' : `\$\{Math\.round\(real\)\}%`/,
    'the percentOnly branch must still handle an absent limit')
})

test('the Knowledge breakdown inherits the parent panel\'s reading', () => {
  // The disclosure rows sit INSIDE the monthly card; leaving them on the
  // default would print the allowance one click away from a panel that hides it.
  assert.match(SRC, /label="Embeddings"[^>]*percentOnly=\{percentOnly\}/)
  assert.match(SRC, /label="Reranking"[^>]*percentOnly=\{percentOnly\}/)
})
