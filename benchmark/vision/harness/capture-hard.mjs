// Harder scenes, added after both models cleared the first ladder at 100%.
// These target the classic vision-model failure modes: row/column alignment in a
// long table, exact counting of small status glyphs, transcribing 11px text, and
// reasoning across two screenshots.
import fs from 'node:fs'
import path from 'node:path'
import sharp from '../../../natively-api/node_modules/sharp/dist/index.cjs'

const OUT = path.resolve(process.argv[2])
fs.mkdirSync(OUT, { recursive: true })
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const txt = (x, y, s, size, fill, family = 'Helvetica', extra = '') =>
  `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" fill="${fill}" ${extra}>${esc(s)}</text>`

// ── 1. Row alignment: 26 rows, no zebra striping, thin rules ────────────────
const REGIONS = ['NA', 'EMEA', 'APAC', 'LATAM']
const rows = Array.from({ length: 26 }, (_, i) => ({
  sku: `SKU-${1000 + i * 10}`,
  region: REGIONS[(i * 3) % 4],
  units: 900 + ((i * 419) % 900),
  margin: (8 + ((i * 7) % 90) / 10).toFixed(1),
}))
const tableSvg = () => {
  const cols = [60, 330, 620, 900, 1180]
  const head = ['SKU', 'Region', 'Units', 'Margin %', 'Status']
  const body = rows.map((r, i) => {
    const y = 150 + i * 28
    const cells = [r.sku, r.region, r.units.toLocaleString('en-US'), `${r.margin}%`, i % 5 === 0 ? 'review' : 'ok']
    return `<line x1="40" y1="${y + 8}" x2="1400" y2="${y + 8}" stroke="#eceff3"/>` +
      txt(20, y, String(i + 1), 13, '#9aa0a6') +
      cells.map((c, j) => txt(cols[j], y, c, 14, '#202124', j === 0 ? 'Menlo' : 'Helvetica')).join('')
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><rect width="1440" height="900" fill="#fff"/>
    ${txt(40, 60, 'Inventory margin report — FY26 Q3 (page 2 of 7)', 22, '#202124')}
    ${head.map((h, j) => txt(cols[j], 120, h, 14, '#5f6368')).join('')}
    <line x1="40" y1="128" x2="1400" y2="128" stroke="#9aa0a6"/>${body}</svg>`
}

// ── 2. Exact counting of small status glyphs ────────────────────────────────
const JOBS = [
  'build (ubuntu, node 20)', 'build (ubuntu, node 22)', 'build (macos, node 20)', 'build (macos, node 22)',
  'build (windows, node 20)', 'build (windows, node 22)', 'lint', 'typecheck',
  'unit (shard 1/4)', 'unit (shard 2/4)', 'unit (shard 3/4)', 'unit (shard 4/4)',
  'integration (postgres)', 'integration (sqlite)', 'e2e (chromium)', 'e2e (firefox)',
  'e2e (webkit)', 'bundle-size', 'licence-scan', 'codeql', 'docker (arm64)', 'docker (amd64)',
  'publish-dry-run', 'notify',
]
const FAILED = new Set([4, 10, 16, 20, 22])
const SKIPPED = new Set([17, 21, 23])
const ciSvg = () => {
  const glyph = (i) => FAILED.has(i) ? ['✕', '#d93025'] : SKIPPED.has(i) ? ['◦', '#9aa0a6'] : ['✓', '#188038']
  const body = JOBS.map((j, i) => {
    const col = i < 12 ? 0 : 1, row = i % 12
    const x = 60 + col * 680, y = 200 + row * 52
    const [g, c] = glyph(i)
    return txt(x, y, g, 20, c) + txt(x + 34, y, j, 15, '#202124') +
      txt(x + 470, y, `${1 + (i * 7) % 9}m ${10 + (i * 13) % 50}s`, 13, '#5f6368')
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><rect width="1440" height="900" fill="#fff"/>
    ${txt(60, 70, 'CI · pull request #4821 — merge queue checks', 22, '#202124')}
    ${txt(60, 104, 'Some checks were not successful', 16, '#d93025')}
    ${txt(60, 140, 'All jobs', 15, '#5f6368')}${body}</svg>`
}

// ── 3. 11px log transcription + a needle ────────────────────────────────────
const LOG = Array.from({ length: 34 }, (_, i) => {
  const t = `2026-09-17T${String(9 + Math.floor(i / 12)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}:${String((i * 13) % 60).padStart(2, '0')}.${String((i * 37) % 1000).padStart(3, '0')}Z`
  if (i === 22) return [t, 'ERROR', 'billing.worker', 'order 8f3c21ab rejected: idempotency key replay detected (attempt 3)']
  const lv = i % 9 === 0 ? 'WARN' : 'INFO'
  const msgs = ['lease renewed for shard 4', 'flushed 128 events to ledger', 'cache warm: 2,048 keys', 'poll returned 0 rows', 'reconciler tick complete', 'webhook accepted id=wh_' + (1000 + i)]
  return [t, lv, ['billing.worker', 'stt.relay', 'api.http', 'reconciler'][i % 4], msgs[i % msgs.length]]
})
const logSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><rect width="1440" height="900" fill="#0d1117"/>
  ${txt(14, 22, 'production logs — natively-api — tail -f', 12, '#8b949e')}
  ${LOG.map((l, i) => {
    const y = 48 + i * 24
    const colour = l[1] === 'ERROR' ? '#ff7b72' : l[1] === 'WARN' ? '#d29922' : '#8b949e'
    return txt(14, y, String(i + 1).padStart(2, ' '), 11, '#484f58', 'Menlo', 'xml:space="preserve"') +
      txt(48, y, l[0], 11, '#6e7681', 'Menlo') + txt(232, y, l[1].padEnd(5), 11, colour, 'Menlo', 'xml:space="preserve"') +
      txt(290, y, l[2].padEnd(16), 11, '#58a6ff', 'Menlo', 'xml:space="preserve"') + txt(430, y, l[3], 11, l[1] === 'ERROR' ? '#ff7b72' : '#c9d1d9', 'Menlo')
  }).join('')}</svg>`

// ── 4. Two-screenshot pair: a diff, and the failing test it caused ──────────
const diffSvg = () => {
  const lines = [
    ['ctx', ' export function retryAfterMs(header) {'],
    ['ctx', '   if (!header) return null'],
    ['del', '-  const secs = Number(header)'],
    ['add', '+  const secs = parseInt(header, 10)'],
    ['ctx', '   if (Number.isFinite(secs)) return secs * 1000'],
    ['ctx', '   const at = Date.parse(header)'],
    ['del', '-  return at ? Math.max(0, at - Date.now()) : null'],
    ['add', '+  return at ? Math.max(0, Date.now() - at) : null'],
    ['ctx', ' }'],
  ]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><rect width="1440" height="900" fill="#fff"/>
    ${txt(40, 54, 'Files changed · lib/retryAfter.js · +2 −2', 20, '#202124')}
    ${lines.map(([k, s], i) => {
      const y = 120 + i * 30
      const bg = k === 'add' ? '#e6ffec' : k === 'del' ? '#ffebe9' : '#fff'
      return `<rect x="40" y="${y - 20}" width="1360" height="28" fill="${bg}"/>` +
        txt(50, y, String(31 + i), 12, '#8c959f', 'Menlo') + txt(100, y, s, 15, '#1f2328', 'Menlo', 'xml:space="preserve"')
    }).join('')}
    ${txt(40, 420, 'Reviewers: 1 approval · CI: 1 failing check', 15, '#5f6368')}</svg>`
}
const failSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><rect width="1440" height="900" fill="#0d1117"/>
  ${txt(30, 46, 'CI · unit tests · retryAfter.test.mjs', 16, '#c9d1d9')}
  ${txt(30, 96, '✕ retryAfterMs: an HTTP-date header returns the delay', 15, '#ff7b72', 'Menlo')}
  ${txt(30, 136, '  input:    "Wed, 17 Sep 2026 12:00:05 GMT"', 14, '#c9d1d9', 'Menlo', 'xml:space="preserve"')}
  ${txt(30, 166, '  expected: 5000', 14, '#7ee787', 'Menlo', 'xml:space="preserve"')}
  ${txt(30, 196, '  actual:   0', 14, '#ff7b72', 'Menlo', 'xml:space="preserve"')}
  ${txt(30, 246, '✓ retryAfterMs: a numeric header returns seconds as ms', 15, '#7ee787', 'Menlo')}
  ${txt(30, 286, '✓ retryAfterMs: a missing header returns null', 15, '#7ee787', 'Menlo')}
  ${txt(30, 346, '1 failing, 2 passing', 14, '#8b949e', 'Menlo')}</svg>`

for (const [id, svg] of [['dense_table', tableSvg()], ['ci_matrix', ciSvg()], ['log_tiny', logSvg()], ['pr_diff', diffSvg()], ['pr_failure', failSvg()]]) {
  await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, `${id}.png`))
  console.log('rendered', id)
}
fs.writeFileSync(path.join(OUT, 'hard-truth.json'), JSON.stringify({
  dense_table: { row19: rows[18], row7: rows[6], total_rows: rows.length },
  ci_matrix: { failed: [...FAILED].map((i) => JOBS[i]), skipped: [...SKIPPED].map((i) => JOBS[i]), counts: { failed: FAILED.size, skipped: SKIPPED.size, passed: JOBS.length - FAILED.size - SKIPPED.size } },
  log_tiny: { error_line_number: 23, order: '8f3c21ab', keyword: 'idempotency', attempt: 3 },
  pr_pair: { cause: 'operands swapped: Date.now() - at should be at - Date.now()', added_line: 37, expected: 5000, actual: 0 },
}, null, 1))
