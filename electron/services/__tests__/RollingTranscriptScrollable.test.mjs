// Regression test for issue #300: the live interviewer transcript should be a
// vertical, scrollable transcript view rather than a one-line horizontal ticker.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const transcriptSource = read('src/components/ui/RollingTranscript.tsx');
const interfaceSource = read('src/components/NativelyInterface.tsx');
const keybindSource = read('electron/services/KeybindManager.ts');
const mainSource = read('electron/main.ts');
const shortcutHookSource = read('src/hooks/useShortcuts.ts');
const settingsSource = read('src/components/SettingsOverlay.tsx');

describe('RollingTranscript vertical scrolling', () => {
  test('renders as a bounded vertical scroller', () => {
    assert.match(transcriptSource, /max-h-\[84px\]/, 'transcript should show about three lines');
    assert.match(transcriptSource, /overflow-y-auto/, 'transcript must be vertically scrollable');
    assert.match(transcriptSource, /whitespace-pre-wrap/, 'transcript text should wrap vertically');
    assert.match(transcriptSource, /break-words/, 'long transcript words should not force horizontal scroll');
    assert.doesNotMatch(transcriptSource, /whitespace-nowrap/, 'must not regress to horizontal ticker wrapping');
    assert.doesNotMatch(transcriptSource, /scrollLeft/, 'auto-scroll should be vertical, not horizontal');
    assert.match(transcriptSource, /transparent 0px, black 8px, black 100%/, 'mask should fade only the top edge so newest bottom text remains readable');
    assert.doesNotMatch(transcriptSource, /black 60%, transparent 100%/, 'bottom fade must not obscure the newest auto-scrolled text');
  });

  test('exposes a three-line scroll handle for shortcut routing', () => {
    assert.match(transcriptSource, /const TRANSCRIPT_SCROLL_LINES = 3;/, 'shortcut scroll should move three lines');
    assert.match(transcriptSource, /firstElementChild instanceof HTMLElement/, 'line scroll should use rendered transcript text metrics');
    assert.match(transcriptSource, /export interface RollingTranscriptHandle/, 'component should expose an imperative handle type');
    assert.match(transcriptSource, /scrollByLines: \(direction: -1 \| 1\) => boolean;/, 'handle should expose scrollByLines');
    assert.match(transcriptSource, /useImperativeHandle\(ref/, 'component should wire the imperative handle');
    assert.match(transcriptSource, /direction < 0 && el\.scrollTop <= 1/, 'scroll shortcuts should fall through at the transcript top edge');
    assert.match(transcriptSource, /direction > 0 && maxTop - el\.scrollTop <= 1/, 'scroll shortcuts should fall through at the transcript bottom edge');
  });

  test('programmatic scroll-to-bottom stays pinned while smooth scrolling', () => {
    assert.match(transcriptSource, /const programmaticAutoScrollRef = useRef\(false\);/, 'component should track programmatic auto-scroll');
    assert.match(transcriptSource, /const programmaticAutoScrollTimerRef = useRef<number \| null>\(null\);/, 'component should clear stale programmatic scroll state');
    assert.match(transcriptSource, /const lastAutoScrolledTextRef = useRef<string \| null>\(null\);/, 'component should remember the last text it auto-scrolled for');
    assert.match(transcriptSource, /lastAutoScrolledTextRef\.current === text/, 'auto-scroll effect should not re-run for the same transcript text');
    assert.match(transcriptSource, /setProgrammaticAutoScroll\(true\);[\s\S]*el\.scrollTo\(\{ top: el\.scrollHeight, behavior: 'smooth' \}\);/, 'auto-scroll effect should use guarded smooth scrolling instead of snapping');
    assert.doesNotMatch(transcriptSource, /scrollTop\s*=\s*el\.scrollHeight/, 'auto-scroll should not jump directly to the bottom');
    assert.match(transcriptSource, /if \(programmaticAutoScrollRef\.current\) \{[\s\S]*setAutoScroll\(true\);[\s\S]*return;/, 'intermediate programmatic scroll events should not disable auto-scroll');
    assert.match(transcriptSource, /window\.setTimeout\(\(\) => \{[\s\S]*programmaticAutoScrollRef\.current = false;[\s\S]*\}, 500\);/, 'programmatic scroll state should time out');
    assert.match(transcriptSource, /window\.clearTimeout\(programmaticAutoScrollTimerRef\.current\);/, 'programmatic scroll timeout should be cleaned up');
  });

  test('held transcript scroll shortcuts use momentum, not repeated smooth animations', () => {
    assert.match(transcriptSource, /const transcriptScrollMomentumRef = useRef\(\{/, 'component should keep transcript scroll momentum state');
    assert.match(transcriptSource, /const startTranscriptMomentum = useCallback/, 'component should have a dedicated transcript momentum loop');
    assert.match(transcriptSource, /window\.requestAnimationFrame\(tick\)/, 'manual transcript scrolling should run on requestAnimationFrame');
    assert.match(transcriptSource, /momentum\.velocity \*= Math\.pow\(0\.5, dt \/ TRANSCRIPT_SCROLL_FRICTION_HALF_LIFE\)/, 'manual transcript scrolling should decay smoothly');
    assert.match(transcriptSource, /el\.scrollTop = nextTop/, 'manual transcript scrolling should write scrollTop directly');
    assert.match(transcriptSource, /lineHeight \* TRANSCRIPT_SCROLL_LINES \* \(Math\.LN2 \/ TRANSCRIPT_SCROLL_FRICTION_HALF_LIFE\)/, 'one key press should still map to roughly three rendered lines');
    assert.match(transcriptSource, /lineHeight \* TRANSCRIPT_SCROLL_TERMINAL_LINES_PER_SECOND/, 'held key repeats should clamp to a steady terminal speed');

    const scrollByLinesBody = transcriptSource.slice(
      transcriptSource.indexOf('const scrollByLines = useCallback'),
      transcriptSource.indexOf('useImperativeHandle', transcriptSource.indexOf('const scrollByLines = useCallback')),
    );
    assert.doesNotMatch(scrollByLinesBody, /behavior: 'smooth'/, 'manual key repeats must not restart smooth-scroll animations');
    assert.match(scrollByLinesBody, /setProgrammaticAutoScroll\(false\)/, 'manual transcript scroll should cancel in-progress auto-scroll guards');
    assert.match(scrollByLinesBody, /startTranscriptMomentum\(\)/, 'manual transcript scroll should kick the momentum loop');
  });

  test('overlay scroll shortcuts try transcript before chat history only when chat panel is hidden', () => {
    assert.match(interfaceSource, /import RollingTranscript, \{ type RollingTranscriptHandle \}/, 'interface should import transcript handle');
    assert.match(interfaceSource, /const rollingTranscriptRef = useRef<RollingTranscriptHandle>\(null\);/, 'interface should keep transcript ref');
    assert.match(interfaceSource, /const scrollRollingTranscript = useCallback\(\(direction: -1 \| 1\) => \{[\s\S]*scrollByLines\(direction\)/, 'interface should expose unconditional transcript scrolling');
    assert.match(interfaceSource, /if \(showAnswerPanelRef\.current\) return false;/, 'chat panel should keep priority when visible');
    assert.match(interfaceSource, /if \(tryScrollRollingTranscript\(-1\)\) return;[\s\S]*upHeld = true;/, 'focused scroll up should fall back to chat');
    assert.match(interfaceSource, /if \(tryScrollRollingTranscript\(1\)\) return;[\s\S]*downHeld = true;/, 'focused scroll down should fall back to chat');
    assert.match(interfaceSource, /if \(!tryScrollRollingTranscript\(-1\)\) inertialScrollRef\.current\?\.kick\('vert', -1\);/, 'global scroll up should fall back to chat');
    assert.match(interfaceSource, /if \(!tryScrollRollingTranscript\(1\)\) inertialScrollRef\.current\?\.kick\('vert', 1\);/, 'global scroll down should fall back to chat');
    assert.match(interfaceSource, /<RollingTranscript[\s\S]*ref=\{rollingTranscriptRef\}/, 'rendered transcript should receive ref');
  });

  test('dedicated transcript scroll keybinds route to transcript even when chat is visible', () => {
    assert.match(keybindSource, /id: 'chat:transcriptScrollUp'[\s\S]*label: 'Transcript Scroll Up'[\s\S]*CommandOrControl\+Alt\+Up/, 'up keybind should be a dedicated global shortcut');
    assert.match(keybindSource, /id: 'chat:transcriptScrollDown'[\s\S]*label: 'Transcript Scroll Down'[\s\S]*CommandOrControl\+Alt\+Down/, 'down keybind should be a dedicated global shortcut');
    assert.match(mainSource, /actionId === 'chat:transcriptScrollUp'/, 'main should recognize transcript scroll up');
    assert.match(mainSource, /'chat:transcriptScrollUp': 'transcriptScrollUp'/, 'main should dispatch transcript scroll up');
    assert.match(mainSource, /'chat:transcriptScrollDown': 'transcriptScrollDown'/, 'main should dispatch transcript scroll down');
    assert.match(shortcutHookSource, /transcriptScrollUp: string\[\];/, 'hook state should expose transcript scroll up');
    assert.match(shortcutHookSource, /kb\.id === 'chat:transcriptScrollUp'[\s\S]*newShortcuts\.transcriptScrollUp = keys/, 'hook should load transcript scroll up from backend');
    assert.match(shortcutHookSource, /case 'transcriptScrollUp': backendId = 'chat:transcriptScrollUp'; break;/, 'hook should save transcript scroll up to backend');
    assert.match(settingsSource, /id: 'transcriptScrollUp'[\s\S]*label: 'Transcript Scroll Up'/, 'settings should render transcript scroll up recorder');
    assert.match(settingsSource, /id: 'transcriptScrollDown'[\s\S]*label: 'Transcript Scroll Down'/, 'settings should render transcript scroll down recorder');
    assert.match(interfaceSource, /isShortcutPressed\(e, 'transcriptScrollUp'\)[\s\S]*scrollRollingTranscript\(-1\);/, 'focused transcript scroll up should call transcript directly');
    assert.match(interfaceSource, /isShortcutPressed\(e, 'transcriptScrollDown'\)[\s\S]*scrollRollingTranscript\(1\);/, 'focused transcript scroll down should call transcript directly');
    assert.match(interfaceSource, /action === 'transcriptScrollUp'\) scrollRollingTranscript\(-1\);/, 'global transcript scroll up should call transcript directly');
    assert.match(interfaceSource, /action === 'transcriptScrollDown'\) scrollRollingTranscript\(1\);/, 'global transcript scroll down should call transcript directly');
  });
});
