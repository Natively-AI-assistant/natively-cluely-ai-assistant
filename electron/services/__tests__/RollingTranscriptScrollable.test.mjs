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
  });

  test('exposes a three-line scroll handle for shortcut routing', () => {
    assert.match(transcriptSource, /const TRANSCRIPT_SCROLL_LINES = 3;/, 'shortcut scroll should move three lines');
    assert.match(transcriptSource, /firstElementChild instanceof HTMLElement/, 'line scroll should use rendered transcript text metrics');
    assert.match(transcriptSource, /export interface RollingTranscriptHandle/, 'component should expose an imperative handle type');
    assert.match(transcriptSource, /scrollByLines: \(direction: -1 \| 1\) => boolean;/, 'handle should expose scrollByLines');
    assert.match(transcriptSource, /useImperativeHandle\(ref/, 'component should wire the imperative handle');
    assert.match(transcriptSource, /Math\.abs\(nextTop - el\.scrollTop\) < 1\) return false;/, 'scroll shortcuts should fall through when transcript cannot move further');
    assert.match(transcriptSource, /setAutoScroll\(maxTop - nextTop <= 4\)/, 'scrolling down to bottom should re-enable auto-scroll');
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
