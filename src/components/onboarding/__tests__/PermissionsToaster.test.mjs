/**
 * PermissionsToaster.test.mjs
 *
 * Source-level tests for the permissions onboarding card. This project runs
 * `node --test` with no JSX renderer, so the component is read as text and
 * its contracts asserted directly. Which rows show, and what each one says,
 * is permissionRowPolicy's job and is covered in src/lib/__tests__/.
 *
 * What these pin is how the card opens and closes: through GenieModal, like
 * every other popup, pouring one picture of itself instead of dozens of live
 * copies of its DOM, with its pictures kept per permission state.
 *
 * Run: node --test src/components/onboarding/__tests__/PermissionsToaster.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[^\n]*?\/\/[^\n]*$/gm, '');
const source = readFileSync(resolve(__dirname, '../PermissionsToaster.tsx'), 'utf8');
const rendered = stripComments(source);
const modal = stripComments(readFileSync(resolve(__dirname, '../../ui/GenieModal.tsx'), 'utf8'));
const snapshots = stripComments(readFileSync(resolve(__dirname, '../genieSnapshots.ts'), 'utf8'));

test('pours out of one picture of itself, like every other popup', () => {
  // useGenieCard on its own has no pictures, so it pours dozens of live copies
  // of the card (49 copies, 3,136 nodes on macOS), which replay the card's
  // entrance and arrive empty. GenieModal hands it the pictures.
  assert.ok(source.includes("import { GenieModal } from '../ui/GenieModal';"));
  assert.ok(rendered.includes('<GenieModal') && rendered.includes('label="PermissionsToaster"'));
  assert.ok(!/useGenieCard/.test(rendered), 'no direct hook: that is the live-copy genie');
  assert.ok(modal.includes('const genie = useGenieCard(presence.mounted, label, {') && modal.includes('    snapshots,'),
    'GenieModal gives the hook its pictures');
});

test('pictures are kept per permission state', () => {
  // What the card shows is decided by the statuses, so a picture of one state
  // must never pour out when the card opens in another.
  const view = rendered.match(/const genieView = `([^`]*)`;/);
  assert.ok(view, 'the view is built from the statuses');
  for (const part of ['${platform}', '${micStatus}', '${isMac ? scrStatus :']) {
    assert.ok(view[1].includes(part), part);
  }
  assert.ok(rendered.includes('openingView={genieView}'), 'the open looks up this state, not the last one remembered');
  assert.ok(rendered.includes("'data-genie-view': genieView"), 'pictures taken while open are filed under this state');
  assert.ok(snapshots.includes("const own = card.getAttribute('data-genie-view');"),
    'viewOf reads the card\'s own attribute first');
  // A picture taken while the consent prompt is up shows a spinner.
  assert.ok(rendered.includes('keepPictures={requesting === null}'));
});

test('opens once the statuses are read, and every way out reports after the genie', () => {
  assert.ok(rendered.includes('refreshStatus().then(() => setReady(true));'));
  assert.ok(rendered.includes('open={ready}'));
  const closeThen = rendered.slice(rendered.indexOf('const closeThen'), rendered.indexOf('const colors'));
  assert.ok(closeThen.includes('if (afterCloseRef.current) return;'), 'the first way out wins');
  assert.ok(closeThen.includes('setReady(false);'));
  assert.ok(!/after\s*\(/.test(closeThen), 'closeThen only schedules the report');
  assert.ok(rendered.includes('onClosed={() => { const after = afterCloseRef.current; afterCloseRef.current = null; after?.(); }}'));
  // The host unmounts the card the moment it hears onDismiss.
  const dismiss = rendered.slice(rendered.indexOf('const handleDismiss'), rendered.indexOf('const isMac'));
  assert.ok(/closeThen\(\(\) => \{\s*localStorage\.setItem\(STORAGE_KEY, '1'\);\s*onDismiss\(\);\s*\}\);/.test(dismiss));
  assert.ok(rendered.includes('onBackdropClick={handleDismiss}'));
  assert.ok(modal.includes("pointerEvents: closing ? 'none' : 'auto'"), 'clicks pass through while it drains away');
});

test('the genie pours the card out whole: nothing inside animates in on top of it', () => {
  assert.ok(rendered.includes('const enter = reduced || landed;'));
  assert.ok(rendered.includes('onOpened={() => setLanded(true)}'), 'content that arrives after landing still animates in');
  assert.ok(rendered.includes('if (!isOpen) { setReady(false); setLanded(false); return; }'));
  // Every entrance in the file waits on `enter`.
  const initials = [...rendered.matchAll(/initial=\{([^\n]*)/g)].map(m => m[1]);
  assert.ok(initials.length >= 6, `found ${initials.length} entrances`);
  for (const i of initials) {
    assert.ok(/^(enter \?|!enter \?)/.test(i), `ungated entrance: initial={${i}`);
  }
  const rise = rendered.slice(rendered.indexOf('const rise = (delay: number) =>'), rendered.indexOf('return (', rendered.indexOf('const rise')));
  assert.ok(rise.includes('!enter') && rise.includes('initial: false as const'), 'the guide steps too');
});

test('macOS and Windows share the split card; anything else keeps the compact one', () => {
  assert.ok(rendered.includes("const isMac = platform === 'darwin';"));
  assert.ok(rendered.includes("const isWin = platform === 'win32';"));
  assert.ok(rendered.includes('const hasGuide = isMac || isWin;'));
  // One size and one frame for both: the Windows card was a narrower, shorter
  // single column that did not look like the same product.
  assert.ok(rendered.includes("const CARD_W = hasGuide ? '600px' : '420px';"));
  assert.ok(rendered.includes("wrapStyle={{ width: CARD_W, maxWidth: '92vw' }}"));
  assert.ok(rendered.includes("minHeight: hasGuide ? '440px' : undefined"));
  assert.ok(rendered.includes("flex: hasGuide ? '1 1 58%' : 1"));
  assert.ok(rendered.includes('{!hasGuide && ('), 'only the compact card closes from its corner');
  assert.ok(/\{hasGuide && \(\s*<PermItem\s+icon=\{Monitor\}/.test(rendered), 'both show the Screen Recording row');
  assert.ok(/\{hasGuide && \(\s*<motion\.div[\s\S]{0,200}flex: '0 0 40%'/.test(rendered), 'both have the guide panel');
  // The platform is known before the first status read, so a failed read on
  // Windows cannot leave the macOS card (and its macOS settings link) on screen.
  assert.ok(rendered.includes("useState<string>(() => window.electronAPI?.platform ?? 'darwin')"));
});

test('each platform is shown its own settings, never the other one\'s', () => {
  // Which picture: macOS the alert, Windows the microphone page.
  assert.ok(/: isMac\s*\? <GuideSteps isLight=\{isLight\}[^\n]*\/>\s*: <GuideStepsWindows isLight=\{isLight\}/.test(rendered));
  const mac = rendered.slice(rendered.indexOf('function GuideSteps('), rendered.indexOf('function GuideStepsWindows('));
  const win = rendered.slice(rendered.indexOf('function GuideStepsWindows('), rendered.indexOf('function MockGlassButton('));
  assert.ok(mac.length > 500 && win.length > 500);
  assert.ok(mac.includes('System Settings → Privacy &amp; Security'));
  assert.doesNotMatch(mac, /desktop app|windowsMicPage|page\.switches/);
  // The names and the path are Windows's own, per release, from the policy:
  // nothing about the page is spelled out a second time in the component.
  assert.ok(rendered.includes("import { windowsMicPage } from '../../lib/micPermissionPolicy.mjs';"));
  // Every switch the policy lists, in its order, laid out as the page lays
  // them out: the device switch a card of its own, the desktop switch inside
  // the apps card, under it, with no glyph of its own.
  assert.ok(win.includes('const [device, apps, desktopApps] = page.switches;'));
  assert.match(win, /<div style=\{card\}>\{setting\(device, Mic\)\}<\/div>/);
  assert.match(win, /\{setting\(apps, LayoutList\)\}\s*<div aria-hidden style=\{\{ height: '1px', background: w\.rule \}\} \/>\s*\{setting\(desktopApps, null\)\}/);
  // No "Natively" row: Windows lists a desktop app there only once it has used the microphone.
  assert.doesNotMatch(win, /nativelyIcon|>Natively</);
  // Drawn as the Settings window itself: its name in the title bar, the rest of
  // the path as the page's breadcrumb.
  assert.ok(win.includes('const [app, ...crumbs] = page.path;') && win.includes('{crumbs.map((crumb, i) => ('));
  assert.ok(win.includes('<ArrowLeft') && win.includes('{[Minus, Square, X].map((Glyph, i) => ('), 'back, and the three caption buttons');
  assert.doesNotMatch(win, /Let desktop apps|Privacy &amp; security|Allow apps/, 'no second copy of the names');
  assert.doesNotMatch(win, /System Settings|Privacy &amp; Security|macOS|MockGlassButton|Deny|record the screen/,
    'no macOS alert or wording in the Windows guide');
  // One page, so one card: no connector between steps, as the macOS guide has.
  assert.ok(mac.includes('colors.connector') && !win.includes('colors.connector'));
  assert.ok(win.includes('All three switches on'));
  // No outline round a row: on this card that reads as a focus ring.
  assert.doesNotMatch(win, /inset 0 0 0 1px|outline/);
  // It is the microphone page; the monitor glyph means Screen Recording on this card.
  assert.doesNotMatch(win, /<Monitor/);
  // The Windows sentence says which of the two rows is the one to act on.
  assert.ok(rendered.includes("? 'Screen recording is already allowed. Natively only needs your microphone.'"));
});

test('on Windows the Screen Recording row is already allowed and is never the thing to do', async () => {
  const { describePermRow, allPermissionsResolved } = await import('../../../lib/permissionRowPolicy.mjs');
  for (const status of ['granted', 'denied', 'not-determined', 'restricted', 'unknown', 'loading']) {
    const row = describePermRow('win32', 'screen', status);
    assert.equal(row.tone, 'granted', `win32 screen "${status}" must read as allowed`);
    assert.equal(row.actionable, false);
    assert.equal(row.sublabel, 'Already allowed');
  }
  // It never holds the card open and never becomes the footer's target.
  assert.equal(allPermissionsResolved('win32', { microphone: 'granted', screen: 'denied' }), true);
  assert.equal(allPermissionsResolved('win32', { microphone: 'denied', screen: 'granted' }), false);
  assert.ok(rendered.includes("const screen = platform === 'darwin' ? describePermRow(platform, 'screen', scrStatus) : null;"));
  assert.ok(rendered.includes("const checking = micStatus === 'loading' || (isMac && scrStatus === 'loading');"));
  // macOS is untouched: its row still has to be granted.
  assert.equal(describePermRow('darwin', 'screen', 'not-determined').tone, 'action');
  assert.equal(describePermRow('darwin', 'screen', 'granted').sublabel, 'Access granted');
});

test('dialog semantics', () => {
  assert.ok(rendered.includes("role: 'dialog'"));
  assert.ok(rendered.includes("'aria-modal': true"));
  assert.ok(rendered.includes("'aria-labelledby': 'perm-toast-title'") && rendered.includes('id="perm-toast-title"'));
  assert.ok(rendered.includes("'aria-describedby': 'perm-toast-desc'") && rendered.includes('id="perm-toast-desc"'));
});

test('the Windows guide names the switches as that Windows does, 10 or 11', async () => {
  const { windowsMicPage } = await import('../../../lib/micPermissionPolicy.mjs');
  const eleven = windowsMicPage('15.0.0');
  assert.equal(eleven.release, '11');
  assert.deepEqual(eleven.path, ['Settings', 'Privacy & security', 'Microphone']);
  assert.deepEqual(eleven.switches, [
    'Microphone access',
    'Let apps access your microphone',
    'Let desktop apps access your microphone',
  ]);
  const ten = windowsMicPage('10.0.0');
  assert.equal(ten.release, '10');
  assert.deepEqual(ten.path, ['Settings', 'Privacy', 'Microphone']);
  assert.deepEqual(ten.switches, [
    'Microphone access for this device',
    'Allow apps to access your microphone',
    'Allow desktop apps to access your microphone',
  ]);
  // Windows 11 starts at 13; every Windows 10 build reports 1 to 10.
  assert.equal(windowsMicPage('13.0.0').release, '11');
  assert.equal(windowsMicPage('1.0.0').release, '10');
  // No answer, or one that cannot be read, is drawn as the current release.
  for (const v of [null, undefined, '', 'abc', '0.0.0', '0.3.0']) {
    assert.equal(windowsMicPage(v).release, '11', String(v));
  }
  // Three switches either way: the desktop one is last, under the one that gates it.
  for (const p of [eleven, ten]) {
    assert.equal(p.switches.length, 3);
    assert.match(p.switches[2], /desktop apps/);
    assert.equal(p.path.at(-1), 'Microphone');
  }

  // The row says what is off, from one rule; the picture is the same page in
  // every state, every switch on and at full strength.
  const { windowsMicBlocker } = await import('../../../lib/micPermissionPolicy.mjs');
  assert.equal(windowsMicBlocker('restricted'), 'device');
  assert.equal(windowsMicBlocker('denied'), 'apps');
  for (const st of ['not-determined', 'granted', 'unknown', 'loading', undefined, null]) {
    assert.equal(windowsMicBlocker(st), null, String(st));
  }
  const at = rendered.indexOf("width: '26px', height: '13px'");
  assert.ok(at > 0);
  assert.doesNotMatch(rendered.slice(at - 600, at + 400), /opacity: back|turnOn/);
  assert.ok(!rendered.includes('turnOn'));

  // The release is read from the UA client hint, on Windows only, and a card
  // that gets no answer keeps the Windows 11 page rather than an empty one.
  assert.ok(rendered.includes('const [winMicPage, setWinMicPage] = useState(() => windowsMicPage(null));'));
  assert.ok(rendered.includes("if (platform !== 'win32') return;"));
  assert.ok(rendered.includes("hints?.getHighEntropyValues?.(['platformVersion'])"));
  assert.ok(rendered.includes('page={winMicPage}'));
});

// ── The footer action: one Liquid Glass button on both platforms ─────────────

test('Open Settings is the onboarding glass in the card\'s blue, in both themes', () => {
  const button = rendered.slice(rendered.indexOf('function PrimaryButton('), rendered.indexOf('function AllSetPanel('));
  assert.ok(rendered.includes("import { LiquidGlassButton } from '../../ui-components/LiquidGlassButton';"), 'the kit, not a local imitation');
  assert.ok(button.includes("variant={glass ? 'lavender' : 'green'}"), 'the welcome button\'s material');
  assert.ok(button.includes("...OPEN_SETTINGS_GLASS[isLight ? 'light' : 'dark']"), 'its colours follow the resolved theme');
  // Blue, and this card's own set: the welcome tokens also colour the welcome
  // CTA and Settings' tiles, and their light theme is a pale tint, not a blue.
  assert.ok(!rendered.includes("from './welcomeButtonTokens'"));
  const tokens = rendered.slice(rendered.indexOf('const OPEN_SETTINGS_GLASS = {'), rendered.indexOf('} as const;') + 11);
  for (const theme of ['light', 'dark']) {
    const set = tokens.slice(tokens.indexOf(`${theme}: {`), tokens.indexOf('},', tokens.indexOf(`${theme}: {`)));
    assert.ok(set.includes("'--lg-lav-bg': T.blue"), `${theme}: the fill is the card's blue`);
    assert.ok(set.includes("'--lg-lav-fg': '#FFFFFF'"), `${theme}: a white label`);
    // Every tinted token, or the kit's lavender shows at the rim and in the glow.
    for (const t of ['--lg-lav-hover', '--lg-lav-rim', '--lg-rim-2', '--lg-rim-3', '--lg-lens-rim-soft', '--lg-lav-glow', '--lg-lav-under', '--lg-lav-drop']) {
      assert.ok(set.includes(`'${t}':`), `${theme}: ${t}`);
    }
  }
  assert.ok(rendered.includes("blue:  '#007AFF'"));
  assert.ok(button.includes('className="lg-sm lg-wide"'), 'rim for this scale, cap stops for a container-set width');
  assert.ok(!button.includes("'action'"), 'no longer the flat action fill');
  // This card is opaque and its blur layers were bisected against an OOM.
  assert.ok(button.includes("backdropFilter: 'none'") && button.includes("WebkitBackdropFilter: 'none'"));
  // Disabled dims the material's parts, never the whole element.
  assert.ok(!/opacity:\s*disabled/.test(button), 'no blanket opacity when disabled');
});

test('the footer is one control on macOS and Windows', () => {
  const start = rendered.indexOf('<PrimaryButton');
  const call = rendered.slice(start, rendered.indexOf('/>', start));
  assert.ok(call.includes('label="Open Settings"') && call.includes('onClick={openSettingsForNext}'));
  assert.ok(call.includes('isLight={isLight}'), 'the theme reaches the button');
  assert.ok(!/isMac|platform/.test(call), 'not gated or restyled per platform');
  // The microphone panel is resolved per platform in the main process; only
  // the Screen Recording URI is built here, and only behind its darwin gate.
  assert.ok(rendered.includes('await window.electronAPI?.openMicSettings?.();'));
  assert.ok(/const openScreenSettings = useCallback\(\(\) => \{\s*if \(platform !== 'darwin'\) return;/.test(rendered));
});

test('on either platform the footer always has somewhere to send the user', async () => {
  // The walk below is openSettingsForNext's; this pins that the component does it the same way.
  assert.ok(rendered.includes("const outstanding = (row: RowPresentation) => row.tone !== 'granted' && row.tone !== 'blocked';"));
  assert.ok(rendered.includes("if (screen && outstanding(screen)) { await handleRowAction('screen', screen.remedy); return; }"));
  assert.ok(rendered.includes("if (outstanding(mic)) await handleRowAction('microphone', mic.remedy);"));
  const { describePermRow, allPermissionsResolved } = await import('../../../lib/permissionRowPolicy.mjs');
  const statuses = ['denied', 'not-determined', 'restricted', 'unknown', 'granted'];
  for (const platform of ['darwin', 'win32']) {
    for (const microphone of statuses) {
      for (const screen of platform === 'darwin' ? statuses : ['granted']) {
        // The button only shows while something is outstanding.
        if (allPermissionsResolved(platform, { microphone, screen })) continue;
        // openSettingsForNext: the first outstanding row, screen before microphone.
        const rows = [
          ...(platform === 'darwin' ? [describePermRow(platform, 'screen', screen)] : []),
          describePermRow(platform, 'microphone', microphone),
        ];
        // A row blocked by policy cannot be acted on, so it is passed over.
        const next = rows.find((row) => row.tone !== 'granted' && row.tone !== 'blocked');
        assert.ok(next, `${platform} mic=${microphone} screen=${screen}: nothing outstanding yet the card is unresolved`);
        assert.ok(['request', 'settings'].includes(next.remedy),
          `${platform} mic=${microphone} screen=${screen}: remedy "${next.remedy}" is not one the footer handles`);
        // There is no consent prompt off macOS, so Windows must always get the panel.
        if (platform === 'win32') assert.equal(next.remedy, 'settings');
      }
    }
  }
});

test('the alert in the macOS guide draws its two buttons in the same glass, as pictures', () => {
  const mock = rendered.slice(rendered.indexOf('function MockGlassButton('), rendered.indexOf('function GuideResolved('));
  const guide = rendered.slice(rendered.indexOf('function GuideSteps('), rendered.indexOf('function MockGlassButton('));
  assert.ok(guide.includes('<MockGlassButton isLight={isLight} color={colors.mockSecondaryText}>Deny</MockGlassButton>'));
  assert.ok(guide.includes('<MockGlassButton isLight={isLight} primary>Settings</MockGlassButton>'), 'the default stays on the right');
  assert.ok(!guide.includes('T.blue'), 'no hand-painted blue button left in the alert');
  // The kit's material: the footer's glass for the default, clear glass for the other.
  assert.ok(mock.includes("className={`lg-button ${primary ? 'lg-lavender' : 'lg-clear'} lg-sm lg-wide`}"));
  assert.ok(mock.includes("...OPEN_SETTINGS_GLASS[isLight ? 'light' : 'dark']"), 'the same blue as the footer');
  assert.ok(mock.includes("backdropFilter: 'none'"));
  // Pictures, not controls: no <button>, no lens, nothing for the pointer or Tab to land on.
  assert.ok(/<span\s+className=\{`lg-button/.test(mock) && !/<button|<LiquidGlassButton|lg-lens|onClick|tabIndex/.test(mock));
  assert.ok(mock.includes("pointerEvents: 'none'"));
  // An alert's buttons, not the footer's pill: two equal rounded rectangles,
  // the shape the mock had before it moved to the kit.
  assert.ok(mock.includes("flex: '1 1 0'") && !mock.includes("'0 0 auto'"), 'an even split');
  assert.ok(mock.includes("['--lg-radius' as string]: '6px'"), 'squared off, not half the height');
  assert.ok(mock.includes("['--lg-cap-2' as string]: '6px'"), 'the rim follows the corner');
  // The footer keeps the pill: it never sets a radius of its own.
  const footer = rendered.slice(rendered.indexOf('function PrimaryButton('), rendered.indexOf('function AllSetPanel('));
  assert.ok(!footer.includes('--lg-radius'));
  // These two belong to the macOS guide only; Windows is shown its own page.
  assert.ok(/: isMac\s*\? <GuideSteps isLight=\{isLight\}/.test(rendered));
});
