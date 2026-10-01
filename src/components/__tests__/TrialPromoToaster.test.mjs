/**
 * TrialPromoToaster.test.mjs
 *
 * Source-level tests for the free-trial onboarding card (`node --test`, no JSX
 * renderer, so the component is read as text):
 *
 *   1. Behaviour: start-trial success/failure, manual setup, every dismissal,
 *      and that what the card promises is read from TRIAL_FALLBACK_LIMITS.
 *   2. Accessibility: dialog semantics, and WCAG contrast COMPUTED from the
 *      ink tokens, so ratios quoted in the source cannot drift from what ships.
 *   3. Design contracts shared with the other onboarding cards.
 *
 * Run: node --test src/components/__tests__/TrialPromoToaster.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, '../trial/TrialPromoToaster.tsx'), 'utf8');
const rendered = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[^\n]*?\/\/[^\n]*$/gm, '');

const between = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));

// ─── Behaviour ──────────────────────────────────────────────────

test('what the card promises comes from the trial limits, not literals', () => {
  assert.ok(source.includes("import { TRIAL_FALLBACK_LIMITS, formatCompact } from '../../types/nativelyUsage'"));
  for (const key of ['ai_tokens', 'stt_minutes', 'search_requests']) {
    assert.ok(rendered.includes(`TRIAL_FALLBACK_LIMITS.${key}`), `the card no longer reads ${key}`);
  }
});

test('start trial: hides on success, stays open and says why otherwise', () => {
  const start = between('const handleStartTrial', 'const handleManual');
  assert.ok(start.includes('if (starting || blocked) return;'), 'a second click cannot start a second trial');
  assert.ok(start.includes("try { kind = await onStartTrial(); } catch { kind = 'failed'; }"), 'a throw is our error too');
  assert.ok(start.indexOf("if (kind === 'started') { closeThen(() => onDismiss()); return; }") > start.indexOf('kind = await onStartTrial();'),
    'the card only hides after the trial actually started');
  assert.ok(start.includes('setOutcome(kind);') && start.includes('setStarting(false);'),
    'anything else re-enables the card and says why');
  assert.ok(rendered.includes('role="alert"'), 'the message is announced');
});

// Toaster policy Phase 3 (spec §6 rows 7-8): the card never shows a raw code,
// says "already used" plainly and offers the two ways forward, and a close
// after OUR error (network, server) is not a strike.
test('the message is the vetted copy for the outcome, never an error string', () => {
  assert.ok(source.includes("import { TRIAL_START_COPY, type TrialStartKind } from '../../lib/trial/trialStart.mjs';"));
  assert.ok(rendered.includes("const message = outcome && outcome !== 'started' ? TRIAL_START_COPY[outcome] : null;"));
  assert.ok(!/e\??\.message/.test(rendered), 'no exception text reaches the card');
});

test('rate limited: the start button waits; failed: it says Try again', () => {
  assert.ok(rendered.includes("const blocked = outcome === 'rate_limited' || outcome === 'unavailable';"));
  assert.ok(rendered.includes("disabled={starting || outcome === 'rate_limited'}"));
  assert.ok(rendered.includes("outcome === 'failed' ? 'Try again' : 'Start free trial'"));
});

test('trial unavailable: Get a Natively key and Use my own keys', () => {
  assert.ok(rendered.includes("onClick={outcome === 'unavailable' ? handleGetKey : handleStartTrial}"), 'the primary becomes Get a key');
  assert.ok(rendered.includes("outcome === 'unavailable' ? 'Get a Natively key'"));
  assert.ok(rendered.includes("{outcome === 'unavailable' ? 'Use my own keys' : \"I'll set up manually\"}"));
  assert.ok(between('const handleGetKey', 'const ctaDur').includes('closeThen(() => { onGetKey(); onDismiss(); })'));
});

test('a close after our own error reports it, so the host counts no strike', () => {
  assert.ok(rendered.includes("const handleDismiss = () => closeThen(() => onDismiss(ourErrorRef.current ? 'after_error' : undefined));"));
  assert.ok(rendered.includes("ourErrorRef.current = kind === 'failed' || kind === 'rate_limited';"));
});

test('host: retries our error once, retires on "already used", no strike after our error', () => {
  const host = readFileSync(resolve(__dirname, '../onboarding/OrchestratedToasterHost.tsx'), 'utf8');
  const trial = host.slice(host.indexOf("case 'trial_promo':"), host.indexOf("case 'quiet_window':"));
  // The surface is named so a failed start is reported from where it was asked (funnel).
  assert.ok(trial.includes("const kind = await startTrialWithRetry(() => window.electronAPI?.startTrial?.('trial_promo') ?? Promise.resolve(undefined));"));
  assert.ok(trial.includes("if (kind === 'unavailable') { orch.setUserState({ trialClaimed: true }); recorder.outcome('never'); }"));
  assert.ok(trial.includes("onGetKey={() => openSettings('plans')}"));
  assert.ok(host.includes("if (reason === 'after_error') recorder.end();"), 'our error: the showing ends with no outcome');
});

test('manual setup and every dismissal still work, but not mid-start', () => {
  assert.ok(between('const handleManual', 'const ctaDur').includes('onManualSetup()'));
  assert.ok(rendered.includes("if (e.key === 'Escape' && !starting) handleDismiss();"));
  assert.ok(rendered.includes('onBackdropClick={() => { if (!starting) handleDismiss(); }}'));
  assert.ok(rendered.includes('aria-label="Close"'));
});

test('the close can actually play', () => {
  // The orchestrator unmounts the card the moment it hears "dismissed", so
  // every way out closes the card first (the genie) and reports from onClosed.
  assert.ok(!/if \(!visible\) return null/.test(rendered));
  assert.match(rendered, /<GenieModal\s+open=\{visible\}/);
  assert.ok(rendered.includes('onClosed={() => { const after = afterCloseRef.current; afterCloseRef.current = null; after?.(); }}'));
});

// ─── Accessibility ──────────────────────────────────────────────

test('dialog semantics point at elements that exist', () => {
  // On the genie's card element, via GenieModal's cardProps.
  assert.ok(rendered.includes("role: 'dialog'"));
  assert.ok(rendered.includes("'aria-modal': true"));
  assert.ok(rendered.includes("'aria-labelledby': 'trial-toast-title'") && rendered.includes('id="trial-toast-title"'));
  assert.ok(rendered.includes("'aria-describedby': 'trial-toast-desc'") && rendered.includes('id="trial-toast-desc"'));
});

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
function parseColour(value, ground) {
  if (value.startsWith('#')) return hexToRgb(value);
  const m = value.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  assert.ok(m, `unparseable colour ${value}`);
  const [r, g, b, a] = [+m[1], +m[2], +m[3], +m[4]];
  return [r, g, b].map((c, i) => a * c + (1 - a) * ground[i]);
}
function luminance([r, g, b]) {
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function inkSet(name) {
  const block = source.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\};`));
  assert.ok(block, `${name} missing`);
  return Object.fromEntries([...block[1].matchAll(/(\w+):\s*'([^']+)'/g)].map(m => [m[1], m[2]]));
}

for (const [name, groundHex] of [['INK_DARK', '#1C1C1E'], ['INK_LIGHT', '#F7F8FC']]) {
  test(`${name} clears WCAG AA on its own ground (${groundHex})`, () => {
    assert.ok(source.includes(`'${groundHex}'`), `the card ground ${groundHex} is still what ships`);
    const ground = hexToRgb(groundHex);
    const ink = inkSet(name);
    assert.ok(contrast(parseColour(ink.strong, ground), ground) >= 7, `${name}.strong below 7:1`);
    for (const tier of ['body', 'quiet', 'faint']) {
      const ratio = contrast(parseColour(ink[tier], ground), ground);
      assert.ok(ratio >= 4.5, `${name}.${tier} is ${ratio.toFixed(2)}:1, below AA`);
    }
  });
}

// ─── Design contracts ───────────────────────────────────────────

test('split layout with the flower art, one tree for both themes', () => {
  assert.ok(source.includes("import flowerArt from '../../assets/cards/flower.jpg'"));
  assert.match(rendered, /backgroundImage:\s*`url\(\$\{flowerArt\}\)`/);
  assert.ok(!/isLight\s*\?\s*\(\s*</.test(rendered), 'no JSX forked on the theme');
  assert.ok(rendered.includes("background: isLight ? '#F7F8FC' : '#1C1C1E'"));
});

test('the scrim dims but never blurs, and nothing idles in a loop', () => {
  assert.ok(!/backdropFilter|WebkitBackdropFilter|backdrop-blur/.test(rendered));
  assert.ok(!/\binfinite\b|repeat:\s*Infinity/.test(rendered), 'no perpetual animation (the old aurora)');
});

test('CTA is outlined and neutral; the flower carries the colour', () => {
  assert.ok(rendered.includes('Start free trial'));
  assert.ok(!/#8B5CF6|#7C3AED|#A78BFA|#6D28D9/i.test(rendered), 'no violet left in the chrome');
  assert.ok(rendered.includes("transform: ctaPressed && !reduced ? 'scale(0.97)' : 'none'"));
  assert.ok(!/transition:[^`']*\ball\b/.test(rendered), 'never transition all');
});

test('copy is present, sentence case, and dash-free', () => {
  for (const s of ['Try everything.', 'No card needed.', 'Start free trial', "I'll set up manually", 'No sign-in.']) {
    assert.ok(rendered.includes(s), `missing copy: ${s}`);
  }
  assert.ok(!/textTransform:\s*'uppercase'/.test(rendered), 'no tracked-out caps');
  for (const glyph of ['—', '–', '−']) {
    assert.ok(!rendered.includes(glyph), `rendered copy contains ${glyph}`);
  }
});
