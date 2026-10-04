// F-120 regression pin (audit/autopilot-2026-08-14).
//
// EmbeddingPipeline broadcasts 'embedding:fallback-activated' and
// 'embedding:space-persist-failed' — silent semantic-search degradation —
// and repo-wide each had one producer and zero consumers, while the sibling
// channels (incompatible-provider warning, reindex progress) were fully
// wired. Live-reproduced in scripts/audit/F-120-repro.mjs.
//
// Contracts pinned here: preload subscribes both channels under
// onEmbeddingDegraded, and App.tsx consumes it into the corner notice
// (ProviderChangeNotice), beside the re-index progress.
//
// 2026-09-25: it used to reach the launcher's centre status pill. That pill is
// whitespace-nowrap in a flex-1 slot, so the long degraded line widened it and
// pushed the Start Natively button aside. It now reaches the corner card, and
// must not go back to the pill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..', '..');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.ts'), 'utf8');
const appTsx = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
const notice = fs.readFileSync(path.join(root, 'src', 'components', 'ProviderChangeNotice.tsx'), 'utf8');
const glassCss = fs.readFileSync(path.join(root, 'src', 'ui-components', 'LiquidGlassButton.css'), 'utf8');

test('preload subscribes both embedding degradation channels', () => {
  const idx = preload.indexOf('onEmbeddingDegraded:');
  assert.notEqual(idx, -1, 'preload must expose onEmbeddingDegraded (F-120)');
  const body = preload.slice(idx, idx + 900);
  assert.ok(/ipcRenderer\.on\('embedding:fallback-activated'/.test(body), 'must subscribe embedding:fallback-activated');
  assert.ok(/ipcRenderer\.on\('embedding:space-persist-failed'/.test(body), 'must subscribe embedding:space-persist-failed');
  assert.ok(/removeListener\('embedding:fallback-activated'/.test(body), 'unsubscribe must remove both listeners');
});

test('App.tsx consumes onEmbeddingDegraded into the corner notice', () => {
  const idx = appTsx.indexOf('window.electronAPI.onEmbeddingDegraded(');
  assert.notEqual(idx, -1, 'App.tsx must register an onEmbeddingDegraded listener (F-120)');
  // To the close of the `if (window.electronAPI?.onEmbeddingDegraded)` block.
  const body = appTsx.slice(idx, appTsx.indexOf('\n    }\n', idx));
  assert.ok(/setEmbeddingNotice\(\{ kind: data\.kind, fallbackProvider: data\.fallbackProvider \}\)/.test(body),
    'the listener must hand the notice to the corner card state');
  assert.ok(/setTimeout\(\(\) => setEmbeddingNotice\(null\), \d+\)/.test(body), 'and let it go after a few seconds');
  assert.ok(/clearTimeout\(embeddingNoticeTimer\)/.test(body), 'a burst re-arms one timer');
  const cleanup = appTsx.slice(appTsx.indexOf('if (removeEmbeddingDegraded) removeEmbeddingDegraded();'));
  assert.ok(/^[\s\S]{0,400}if \(embeddingNoticeTimer\) clearTimeout\(embeddingNoticeTimer\);/.test(cleanup),
    'the timer is cleared on unmount');
  assert.ok(/<ProviderChangeNotice\b[^>]*\bdegraded=\{embeddingNotice\}/.test(appTsx), 'the card is given the notice');
  assert.ok(/open=\{isDefault && \([^)]*!!embeddingNotice\)\}/.test(appTsx), 'and opens for it alone');
});

test('the degraded notice never reaches the launcher centre pill', () => {
  const idx = appTsx.indexOf('window.electronAPI.onEmbeddingDegraded(');
  // To the close of the `if (window.electronAPI?.onEmbeddingDegraded)` block.
  const body = appTsx.slice(idx, appTsx.indexOf('\n    }\n', idx));
  for (const call of ['showTransientBannerFailure', 'setOllamaPullStatus', 'setOllamaPullMessage']) {
    assert.ok(!body.includes(call), `${call} widens the nowrap pill beside Start Natively`);
  }
});

test('ProviderChangeNotice renders both degraded kinds as a row of its own', () => {
  assert.ok(/<Collapse open=\{!!degraded\}>/.test(notice), 'a row of its own beside the progress or warning, not instead of it');
  assert.ok(notice.includes("'Semantic search degraded'") && notice.includes('Switched to fallback embeddings'), 'fallback copy');
  assert.ok(notice.includes("'Search may need a re-index'") && notice.includes('The embedding space could not be saved.'), 'persist-failed copy');
  assert.ok(/const isAlert = !!warning && !progress;/.test(notice)
    && notice.includes("lg-notice${isAlert ? ' lg-notice-alert' : ''} "),
    'only the provider warning takes the red hairline; degraded alone does not');
  // The Liquid Glass kit's clear pane (ui-components/LiquidGlassButton.css).
  assert.ok(notice.includes("import '../ui-components/LiquidGlassButton.css';"), 'the kit stylesheet is loaded with the card');
  const rule = (sel) => { const i = glassCss.indexOf(`${sel} {`); assert.notEqual(i, -1, `${sel} rule`); return glassCss.slice(i, glassCss.indexOf('}', i)); };
  assert.ok(/\bbackdrop-filter: blur\(\d+px\) saturate\(/.test(rule('.lg-notice')), 'saturation goes on the BACKDROP, not the card');
  assert.ok(!/(^|\s)saturate-\[/.test(notice), 'no element saturate() over-saturating the card\'s own ink');
  // Light theme: a white fill over the near-white launcher reads as paper, so
  // the body stays clear (low-alpha white, blurred page showing through) and
  // the specular is a diagonal ring rather than the dark theme's top-only rim.
  const light = rule("[data-theme='light'] .lg-notice");
  assert.ok(/backdrop-filter: blur\(\d+px\) saturate\(/.test(light), 'light glass blurs and saturates the page behind it');
  const alphas = [...light.match(/background:[^;]+;/)[0].matchAll(/rgba\(255, 255, 255, \.(\d+)\)/g)].map(m => Number('0.' + m[1]));
  assert.ok(alphas.length && Math.max(...alphas) <= 0.4, `light body stays clear, not a white card (max white ${Math.max(...alphas)})`);
  assert.ok(!notice.includes('bg-bg-elevated/'), 'no dead bare-var opacity class');
  // Dark: the rim is aimed (two masks intersected), lit across the top, not a
  // uniform ring. Light: a diagonal conic ring. (A diagonal ring in dark was
  // tried and rejected on 2026-09-25; the top-lit rim was preferred.)
  assert.ok(/mask-composite: intersect;/.test(rule('.lg-notice::before')), 'dark rim is aimed, not a uniform ring');
  assert.ok(/conic-gradient\(/.test(rule("[data-theme='light'] .lg-notice::before")), 'light specular is the diagonal ring');
  assert.ok(!/conic-gradient\(/.test(rule('.lg-notice::before')), 'dark keeps the top-lit rim, not the diagonal ring');
});

test('the notice animates what changes inside an open card (transitions.dev)', () => {
  const css = fs.readFileSync(path.join(root, 'src', 'components', 'ProviderChangeNotice.css'), 'utf8');
  assert.ok(notice.includes("import './ProviderChangeNotice.css';"), 'the motion stylesheet is loaded with the card');
  // Every snippet keeps its reduced-motion guard.
  for (const sel of ['.t-acc-panel, .t-acc-panel-inner, .t-acc-chevron', '.t-text-swap { transition: none', '.t-icon-swap .t-icon { transition: none',
                     '.t-success-check { animation: none', '.t-digit-group .t-digit { animation: none']) {
    assert.ok(css.includes(sel), `reduced-motion guard kept: ${sel}`);
  }
  // Variables scoped to the card, not :root, so tuning cannot leak.
  assert.ok(!/:root\s*\{/.test(css) && /^\.lg-notice \{[\s\S]*?--acc-expand:/m.test(css), 'snippet variables scoped to .lg-notice');
  // The accordion's grid item is a bare div; its spacing sits on a child, or
  // the collapse floors at the padding.
  assert.ok(/<div className="t-acc-panel-inner">\s*<div className="pb-3">/.test(notice), 'grid item stays bare');
  // Rows join and leave through the accordion, holding their content while they close.
  assert.ok(/<Collapse open=\{!!liveMain\}>/.test(notice) && /<Collapse open=\{isAlert\}>/.test(notice), 'main row and actions collapse too');
  assert.ok(/const shownDegraded = degraded \?\? lastDegraded\.current;/.test(notice), 'the degraded row keeps its text while it closes');
  // A row that opens AGAIN mounts on its new state (new key), never swapping in
  // from the text it held while closed.
  assert.ok(/key=\{episodes\.current\.degraded\}/.test(notice) && /key=\{episodes\.current\.main\}/.test(notice), 'rows re-key on reopen');
  // Text swaps key on STATE; the live count only pops its digits.
  assert.ok(!/swapKey=\{[^}]*progress\.done/.test(notice), 'no text swap keyed on the ticking count');
  assert.ok(/<Digits value=\{main\.progress\.done\} \/>/.test(notice), 'the count pops in instead');
  // Icons centre in their orb: every icon-swap slot is a flex box. A bare span
  // leaves the svg on a text baseline, 1.5-4.5px above centre (measured).
  const slots = notice.match(/<span className="t-icon[^"]*" data-icon=/g) ?? [];
  assert.ok(slots.length === 3 && slots.every(t => t.includes('t-icon flex')), 'icon slots are flex, not baseline-aligned');
  // The done moment draws its check; 24 is lucide Check's path length rounded up.
  assert.ok(/data-state=\{main\.kind === 'done' \? 'in' : 'out'\}/.test(notice) && /stroke-dasharray: 24;/.test(css), 'success check calibrated');
});

test('the notice slides in from the right edge and back out, like a macOS banner', () => {
  const css = fs.readFileSync(path.join(root, 'src', 'components', 'ProviderChangeNotice.css'), 'utf8');
  assert.ok(!notice.includes('<GenieModal'), 'no genie for this card');
  // The slide is on a wrapper, the fade and blur on the frosted pane itself:
  // opacity or a filter on an ANCESTOR would cut the pane's backdrop off.
  assert.ok(/className=\{`lg-notice-slide max-w-\[340px\]\$\{entered \? ' is-open' : ''\}`\}/.test(notice), 'wrapper carries the slide');
  assert.ok(/className=\{`t-toast\$\{entered \? ' is-open' : ''\} lg-notice/.test(notice), 'the pane carries the toast fade + blur');
  const slide = css.slice(css.indexOf('/* ADDED: the horizontal travel'));
  assert.ok(/\.lg-notice-slide \{\s*transform: translateX\(calc\(100% \+ var\(--notice-edge-gap\)\)\);/.test(slide), 'starts and ends past the right edge');
  assert.ok(!/opacity|filter/.test(slide.slice(0, slide.indexOf('@media'))), 'the wrapper never fades or filters');
  // Open slower than close; neither curve overshoots; reduced-motion guards kept.
  // The curves are the corner slide's (genieMotion.mjs SLIDE, 2026-10-04): an
  // ease-out cubic in, and out a swipe that is fastest at the edge.
  const v = (n) => parseFloat(css.match(new RegExp(`--toast-${n}: (\\d+)ms`))[1]);
  assert.ok(v('open') > v('close'), 'open is the slower clock');
  assert.ok(/--toast-ease: cubic-bezier\(0\.33, 1, 0\.68, 1\);/.test(css), 'the way in: ease-out, y never above 1');
  assert.ok(/--notice-travel-close-ease: cubic-bezier\(0\.4, 0\.2, 1, 0\.8\);/.test(css), 'the way out: accelerating, y never above 1');
  assert.ok(/\.lg-notice-slide \{\s*transform: translateX\(calc\(100% \+ var\(--notice-edge-gap\)\)\);\s*transition: transform var\(--toast-close\) var\(--notice-travel-close-ease\);/.test(slide));
  assert.ok(css.includes('.t-toast { transition: none !important; }') && css.includes('.lg-notice-slide { transition: none !important; }'), 'reduced-motion guards');
  // It keeps what it showed while it slides out, and mounts in the closed pose first.
  assert.ok(/const \{ warning, progress, degraded = null, onDismiss, onReindex \} = open \? props : lastOpen\.current;/.test(notice), 'content frozen while closing');
  assert.ok(/void slideRef\.current\?\.offsetWidth;/.test(notice), 'reflow before sliding in');
  // Durations read from CSS honour the unit: the production minifier writes
  // 350ms as .35s, and a bare parseFloat made the slide-out last 0.35ms.
  assert.ok(!/parseFloat\(getComputedStyle/.test(notice) && !/parseFloat\([^)]*getPropertyValue/.test(notice), 'no unit-blind parse of a CSS time');
  assert.ok(/raw\.endsWith\('ms'\) \? n : raw\.endsWith\('s'\) \? n \* 1000 : fallback/.test(notice), 'ms and s both handled');
  assert.ok(/const closeMs = cssMs\(slideRef\.current, '--toast-close', 350\);/.test(notice), 'the slide-out timer uses it');
});

test('the quota and long-term-memory notices share the corner notice glass', () => {
  const quota = fs.readFileSync(path.join(root, 'src', 'components', 'NativelyQuotaBanner.tsx'), 'utf8');
  const hind = fs.readFileSync(path.join(root, 'src', 'components', 'HindsightStatusBanner.tsx'), 'utf8');
  assert.ok(quota.includes('cardClassName="lg-notice lg-notice-warn ') && quota.includes("import '../ui-components/LiquidGlassButton.css';"), 'quota card is .lg-notice with the amber hairline');
  assert.ok(/cardClassName=\{`lg-notice\$\{isFailing \? ' lg-notice-warn' : ''\}`\}/.test(hind) && hind.includes("import '../ui-components/LiquidGlassButton.css';"), 'hindsight card is .lg-notice, amber while failing');
  // An inline background or box-shadow on the card would override the glass.
  const cardStyle = hind.slice(hind.indexOf('cardStyle={{'), hind.indexOf('}}', hind.indexOf('cardStyle={{')));
  assert.ok(!/background|boxShadow/.test(cardStyle), 'no inline surface over the glass');
  // Text follows the theme: no hardcoded white copy left on either card.
  assert.ok(!/text-white\/|#E0E0E0/.test(quota), 'quota text uses theme tokens');
  assert.ok(!/color: '#FFFFFF'|rgba\(230,230,235/.test(hind), 'hindsight text uses theme tokens');
  const warnDark = glassCss.indexOf('.lg-notice.lg-notice-warn {'), warnLight = glassCss.indexOf("[data-theme='light'] .lg-notice.lg-notice-warn {");
  assert.ok(warnDark !== -1 && warnLight !== -1, 'amber hairline in both themes');
  assert.ok(/var\(--lg-notice-edge\)/.test(glassCss.slice(warnLight, glassCss.indexOf('}', warnLight))), 'light warn keeps the edge thickness');
});
