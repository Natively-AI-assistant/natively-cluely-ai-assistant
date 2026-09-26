// Capture the benchmark's screenshots.
//
// Two kinds, deliberately:
//   - REAL pages rendered in the system Chrome at a laptop viewport (1440x900,
//     DPR 1) — what a Natively user actually screenshots. Ground truth is the
//     text that was visible in the viewport at capture time (<id>.txt).
//   - SYNTHETIC scenes rendered with sharp, used ONLY where the answer has to be
//     exactly knowable (a chart with no printed values, a planted code bug).
//
// Usage: node capture.mjs <out-dir>
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '../../../natively-control/node_modules/playwright/index.mjs'
import sharp from '../../../natively-api/node_modules/sharp/dist/index.cjs'

const OUT = path.resolve(process.argv[2])
fs.mkdirSync(OUT, { recursive: true })
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ── Real pages ───────────────────────────────────────────────────────────────
const PAGES = [
  { id: 'aoc_part2', url: 'https://adventofcode.com/2023/day/1', wait: 2500, scroll: 1500 },
  { id: 'stock_financials', url: 'https://stockanalysis.com/stocks/aapl/financials/', wait: 4000 },
  { id: 'github_code_small', url: 'https://github.com/expressjs/express/blob/master/lib/utils.js', wait: 4000, zoom: 0.6 },
  { id: 'wikipedia_table', url: 'https://en.wikipedia.org/wiki/List_of_countries_by_GDP_(nominal)', wait: 2500, scroll: 1800 },
  { id: 'github_repo', url: 'https://github.com/expressjs/express', wait: 4000 },
  { id: 'hn_frontpage', url: 'https://news.ycombinator.com', wait: 2000 },
  { id: 'grafana_home', url: 'https://play.grafana.org', wait: 12000 },
]

const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const captured = []
for (const p of PAGES) {
  const page = await ctx.newPage()
  try {
    await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForTimeout(p.wait)
    if (p.zoom) { await page.evaluate((z) => { document.body.style.zoom = String(z) }, p.zoom); await page.waitForTimeout(1500) }
    if (p.scroll) { await page.evaluate((y) => window.scrollTo(0, y), p.scroll); await page.waitForTimeout(1200) }
    fs.writeFileSync(path.join(OUT, `${p.id}.png`), await page.screenshot({ type: 'png' }))
    const visible = await page.evaluate(() => {
      const out = []; const vh = innerHeight, vw = innerWidth
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const t = n.textContent.trim(); if (!t) continue
        const r = n.parentElement?.getBoundingClientRect()
        if (!r || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw || !r.width) continue
        out.push(t)
      }
      return out.join('\n')
    })
    fs.writeFileSync(path.join(OUT, `${p.id}.txt`), visible)
    captured.push({ id: p.id, url: p.url, kind: 'real', visible_chars: visible.length })
    console.log('real', p.id, visible.length, 'chars visible')
  } catch (e) { console.log('real', p.id, 'FAILED', e.message.slice(0, 120)) }
  await page.close()
}
await browser.close()

// ── Synthetic scenes (exact ground truth) ────────────────────────────────────
const txt = (x, y, s, size, fill, family = 'Helvetica', extra = '') =>
  `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" fill="${fill}" ${extra}>${esc(s)}</text>`

// A grouped bar chart with NO printed values: the model has to read heights off
// a gridded axis. Values are the ground truth and appear nowhere in the image.
const BARS = [['Mon', 62], ['Tue', 118], ['Wed', 47], ['Thu', 155], ['Fri', 91], ['Sat', 133], ['Sun', 74]]
const chartSvg = () => {
  const x0 = 140, y0 = 760, h = 620, w = 1120, max = 200
  const bw = w / BARS.length
  const grid = Array.from({ length: 11 }, (_, i) => {
    const v = i * 20, y = y0 - (v / max) * h
    return `<line x1="${x0}" y1="${y}" x2="${x0 + w}" y2="${y}" stroke="#dde1e6"/>` + txt(x0 - 48, y + 6, String(v), 18, '#5f6368')
  }).join('')
  const bars = BARS.map(([d, v], i) => {
    const bh = (v / max) * h, x = x0 + i * bw + bw * 0.22
    return `<rect x="${x}" y="${y0 - bh}" width="${bw * 0.56}" height="${bh}" fill="#3b7ddd"/>` + txt(x + bw * 0.13, y0 + 34, d, 20, '#202124')
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><rect width="1440" height="900" fill="#ffffff"/>
    ${txt(140, 70, 'Support tickets opened per day — week 38', 26, '#202124')}
    ${txt(140, 100, 'No data labels; read values from the gridlines.', 16, '#5f6368')}
    ${grid}<line x1="${x0}" y1="${y0}" x2="${x0 + w}" y2="${y0}" stroke="#202124" stroke-width="2"/>${bars}</svg>`
}

// A code screenshot with ONE planted off-by-one, plus the failing assertion that
// proves it. Answer: line 12, `while (lo < hi)` should be `while (lo <= hi)`.
const CODE = [
  'package search;',
  '',
  'public class BinarySearch {',
  '',
  '    /** Returns the index of target, or -1 when absent. */',
  '    public static int indexOf(int[] a, int target) {',
  '        int lo = 0;',
  '        int hi = a.length - 1;',
  '        int guard = 0;',
  '',
  '        // narrow the window until the value is found',
  '        while (lo < hi) {',
  '            int mid = lo + (hi - lo) / 2;',
  '            if (a[mid] == target) return mid;',
  '            if (a[mid] < target) lo = mid + 1;',
  '            else hi = mid - 1;',
  '            guard++;',
  '        }',
  '        return -1;',
  '    }',
  '}',
]
const codeSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><rect width="1440" height="900" fill="#1f2430"/>
  <rect width="1440" height="34" fill="#2b3140"/>${txt(16, 23, 'BinarySearch.java — src/main/java/search', 13, '#c8cdd8')}
  ${CODE.map((c, i) => txt(40, 74 + i * 26, `${String(i + 1).padStart(2, ' ')}   ${c}`, 16, '#d7dce6', 'Menlo', 'xml:space="preserve"')).join('')}
  <rect x="40" y="640" width="1360" height="210" fill="#161a22"/>
  ${txt(60, 676, 'JUnit — BinarySearchTest', 16, '#9aa4b6')}
  ${txt(60, 712, 'FAILED indexOf_findsLastElement: expected 4 but was -1', 16, '#ff6b6b', 'Menlo')}
  ${txt(60, 744, '  a = [1, 3, 5, 7, 9], target = 9', 15, '#c8cdd8', 'Menlo')}
  ${txt(60, 780, 'PASSED indexOf_findsMiddleElement', 15, '#7ddd8f', 'Menlo')}
  ${txt(60, 812, 'PASSED indexOf_returnsMinusOneWhenAbsent', 15, '#7ddd8f', 'Menlo')}</svg>`

for (const [id, svg] of [['chart_nolabels', chartSvg()], ['code_bug', codeSvg()]]) {
  await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, `${id}.png`))
  captured.push({ id, kind: 'synthetic' })
  console.log('synthetic', id)
}
fs.writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify({ captured_at: new Date().toISOString(), viewport: '1440x900 @1x', bars: BARS, captured }, null, 1))
