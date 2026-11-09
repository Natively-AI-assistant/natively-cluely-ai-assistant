# First-run Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A seven-step guide that walks a brand-new user through one real meeting (What to answer, screenshots, notepad, notes), then Plans & Billing, then their own keys, drawn inside the real launcher, overlay, notes window and Settings.

**Architecture:** One pure reducer (`src/lib/onboarding/firstRunGuide.mjs`) owns every rule. The main process stores its state in SettingsManager and broadcasts `guide:changed` to every window. Each window reports what it saw (`guide:dispatch`) and draws only its own step, with two shared pieces: a floating card (launcher, Settings) and an inline strip (overlay, notes window).

**Tech Stack:** Electron IPC (safeHandle / preload), React 18 + TypeScript, framer-motion, node:test `.mjs` tests (`npm run test:lib`), agent-browser over CDP for the UI walk.

**Spec:** `docs/superpowers/specs/2026-11-10-first-run-guide-design.md`. Visual reference: `src/dev/guideProto.tsx` (dev-only, deleted in Task 8).

## Global Constraints

- macOS and Windows: keycaps from `acceleratorToKeys(accelerator, platform)` (`src/lib/onboarding/shortcutKeys.mjs`), never hard-coded ⌘. Accelerators come from `getKeybinds()` ids `chat:whatToAnswer`, `general:take-screenshot`, `general:selective-screenshot`.
- No new window, no new BrowserWindow option, no focus call. The overlay strip lives in the overlay's own DOM (screen-share hiding unchanged).
- Lavender `#7C5CFF`; `Keycaps` and `LavenderButton` from `src/components/onboarding/welcomeShared.tsx`; card radius 18; strip radius 16, tint `rgba(124,92,255,0.06)` light / `0.10` dark, inset 1px lavender rim.
- Highlight = `data-guide-lit` attribute + CSS ring `0 0 0 1.5px #7C5CFF, 0 0 0 4px rgba(124,92,255,.16), 0 0 16px rgba(124,92,255,.28)`, never a measured cut-out.
- All copy through `useT()` (`src/i18n.tsx`) with English keys. Titles exactly as the spec: "Start your first meeting.", "They just asked you something.", "Show Natively your screen.", "Write while you talk.", "Your meeting, written up.", "Your free trial is almost used up.", "Set up Natively your way."
- Light and dark themes; `prefers-reduced-motion` → opacity only.
- Every step has "Skip guide". Skipped is permanent until "Show the guide again" in Settings > Help.
- Launch the dev app only with `NATIVELY_RAG_LOCAL_RERANK=off NATIVELY_RAG_SPECULATIVE_RERANK=off npm run dev:agent`; stop it after.

## Review Focus

1. **Two windows report the same event** (overlay and launcher both see the meeting stop): must advance exactly once. → Task 1 test `duplicate events are no-ops`.
2. **Meeting stopped before step 4 is done**: guide must not stay stuck on an overlay step that no longer exists. → Task 1 test `meeting_stopped mid-meeting jumps to notes`.
3. **Notes window closed when step 4 starts**: user must have a way in without the guide opening a window. → Task 5 strip shows an "Open notepad" button (`notesWindowToggle()`).
4. **Trial-ended card and guide both want the screen**: only the guide's step 6 shows while the guide is active. → Task 4 App.tsx gate + test `trial_out jumps to plans with variant`.
5. **User rebinds What to answer to something else, or is on Windows**: keycaps must show the real binding with Ctrl. → Task 3 test `guideKeys uses binding and platform`.

---

### Task 1: Guide reducer (pure rules)

**Files:**
- Create: `src/lib/onboarding/firstRunGuide.mjs`, `src/lib/onboarding/firstRunGuide.d.mts`
- Test: `src/lib/onboarding/__tests__/firstRunGuide.test.mjs`

**Interfaces:**
- Produces:
  ```ts
  export type GuideStepId = 'start'|'answer'|'screenshot'|'notepad'|'stop'|'notes'|'plans'|'keys';
  export type GuideStatus = 'idle'|'active'|'skipped'|'finished'|'expired';
  export interface GuideState { status: GuideStatus; step: GuideStepId; variant: 'normal'|'trial_out'|'no_trial';
    outcome: 'bought'|'own_keys'|null; startedAt: number|null; updatedAt: number|null; }
  export interface GuideFacts { hasOwnAiKey: boolean; hasNativelyKey: boolean; isPremium: boolean; launchCount: number; }
  export type GuideEvent =
    | { type: 'plans_closed'; facts: GuideFacts } | { type: 'meeting_started' } | { type: 'answer_shown' }
    | { type: 'screenshot_taken' } | { type: 'note_typed' } | { type: 'meeting_stopped' } | { type: 'notes_next' }
    | { type: 'trial_out' } | { type: 'trial_unavailable' } | { type: 'plan_changed'; facts: GuideFacts }
    | { type: 'own_keys' } | { type: 'keys_done' } | { type: 'skip' } | { type: 'restart' };
  export const GUIDE_RESUME_MS: number;           // 7 * 24 * 60 * 60 * 1000
  export const GUIDE_STEP_NUMBER: Record<GuideStepId, number>; // stop shares 4 with notepad
  export function emptyGuideState(): GuideState;
  export function normalizeGuideState(raw: unknown, now: number): GuideState; // bad input → empty; active and now-updatedAt > GUIDE_RESUME_MS → status 'expired'
  export function isGuideEligible(facts: GuideFacts): boolean;  // launchCount <= 3 && !hasOwnAiKey
  export function reduceGuide(state: GuideState, event: GuideEvent, now: number): GuideState; // returns the SAME object when nothing changes
  export function windowForStep(step: GuideStepId): 'launcher'|'overlay'|'notes'|'settings';
  ```
  `windowForStep`: start, notes → launcher; answer, screenshot, stop → overlay; notepad → notes; plans, keys → settings.

**Rules (plan decisions, not in the spec, marked):** `meeting_stopped` during answer/screenshot/notepad/stop → `notes` *(stopped early)*. `plans_closed` starts only from `idle` *(guide runs once)*. Eligibility uses launch count ≤ 3 from the card ledger and no own AI key *(the Plans card itself already requires no Natively key, so a key bought from that card still gets steps 1–5)*.

- [ ] **Step 1: Write the failing tests**

```js
// Run: node --test src/lib/onboarding/__tests__/firstRunGuide.test.mjs
const facts = { hasOwnAiKey: false, hasNativelyKey: false, isPremium: false, launchCount: 1 };
const T = 1_000;
test('plans_closed starts an eligible new user at start', () => {
  const s = reduceGuide(emptyGuideState(), { type: 'plans_closed', facts }, T);
  assert.deepEqual([s.status, s.step, s.startedAt], ['active', 'start', T]); });
test('not eligible: own AI key, or launch 4', () => {
  assert.equal(reduceGuide(emptyGuideState(), { type: 'plans_closed', facts: { ...facts, hasOwnAiKey: true } }, T).status, 'idle');
  assert.equal(reduceGuide(emptyGuideState(), { type: 'plans_closed', facts: { ...facts, launchCount: 4 } }, T).status, 'idle'); });
test('happy path start→answer→screenshot→notepad→stop→notes→plans', () => {
  let s = reduceGuide(emptyGuideState(), { type: 'plans_closed', facts }, T);
  for (const [ev, want] of [['meeting_started','answer'],['answer_shown','screenshot'],['screenshot_taken','notepad'],
    ['note_typed','stop'],['meeting_stopped','notes'],['notes_next','plans']]) { s = reduceGuide(s, { type: ev }, T); assert.equal(s.step, want); } });
test('duplicate events are no-ops (same object back)', () => {
  const s = reduceGuide(reduceGuide(emptyGuideState(), { type: 'plans_closed', facts }, T), { type: 'meeting_started' }, T);
  assert.equal(reduceGuide(s, { type: 'meeting_started' }, T + 1), s);
  assert.equal(reduceGuide(s, { type: 'note_typed' }, T + 1), s); });
test('meeting_stopped mid-meeting jumps to notes', () => { /* from 'answer' → step 'notes' */ });
test('trial_out jumps to plans with variant', () => { /* from 'screenshot' → step 'plans', variant 'trial_out' */ });
test('trial_unavailable at start → plans, variant no_trial', () => {});
test('plan_changed at plans: Natively key → finished bought; premium without key → keys; else unchanged', () => {});
test('plan_changed before plans changes nothing', () => {});
test('own_keys → keys; keys_done → finished own_keys', () => {});
test('skip from any active step → skipped; plans_closed after skip stays skipped', () => {});
test('restart from skipped/finished/expired → active start, variant normal, outcome null', () => {});
test('normalize: >7 days since update → expired; ≤7 days → unchanged; garbage → empty', () => {});
test('GUIDE_STEP_NUMBER: notepad and stop are both 4, keys is 7', () => {});
test('windowForStep maps every step', () => {});
```
Fill each stub with the transition named in its title and assert `step`, `status`, `variant`, `outcome` as named.

- [ ] **Step 2: Run, expect FAIL** — `node --test src/lib/onboarding/__tests__/firstRunGuide.test.mjs` → `Cannot find module`.
- [ ] **Step 3: Implement** `firstRunGuide.mjs` + `.d.mts` per the Interfaces block (plain JS, a `switch` on `event.type` guarded by `state.step`; every changed state gets `updatedAt = now`).
- [ ] **Step 4: Run, expect PASS**, then `npm run test:lib` (no new failures).
- [ ] **Step 5: Commit** `feat(guide): first-run guide rules`

---

### Task 2: Main-process store, IPC, preload, telemetry

**Files:**
- Modify: `electron/services/SettingsManager.ts` (add `firstRunGuide?: GuideState` beside `permissionsCard` ~L327)
- Modify: `electron/ipcHandlers.ts` (next to `permissions-card:get` ~L9315)
- Modify: `electron/preload.ts` (types near `permissionsCardGet` ~L1383, impl near ~L3671)
- Test: `src/lib/onboarding/__tests__/firstRunGuideWiring.test.mjs` (source-reading test, the repo's usual style for IPC wiring)

**Interfaces:**
- Consumes: Task 1 `normalizeGuideState`, `reduceGuide`, `GUIDE_STEP_NUMBER`.
- Produces (preload, `window.electronAPI`):
  ```ts
  guideGet(): Promise<GuideState>;
  guideDispatch(event: GuideEvent): Promise<GuideState>;
  onGuideChanged(cb: (s: GuideState) => void): () => void;   // channel 'guide:changed'
  ```
- IPC: `guide:get` → `normalizeGuideState(sm.get('firstRunGuide'), Date.now())` (write it back if it became `expired`). `guide:dispatch` → reduce; if the result is a new object, `sm.set('firstRunGuide', next)`, send `guide:changed` to every non-destroyed window, and track funnel `onboarding_stage` with `{ stage: 'guide', action, step, step_number, variant }` where action is `shown` (new step), `skipped`, or `finished` (+ `outcome`). Reject events whose `type` is not in the union with `{ error: 'invalid_event' }`.

- [ ] **Step 1: Failing test** — asserts `ipcHandlers.ts` contains `safeHandle('guide:get'` and `safeHandle('guide:dispatch'` and `'guide:changed'`; `preload.ts` contains `guideGet`, `guideDispatch`, `onGuideChanged` in both the type block and the implementation; `SettingsManager.ts` contains `firstRunGuide?:`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the three edits. Use the same funnel function the `funnel:track` handler calls (do not go through IPC from main).
- [ ] **Step 4: Run test PASS; `npm run typecheck:electron` clean.**
- [ ] **Step 5: Commit** `feat(guide): store guide state in main and sync every window`

---

### Task 3: Shared renderer pieces (hook, card, strip, highlight, keys)

**Files:**
- Create: `src/components/guide/useGuide.ts`, `src/components/guide/GuideCard.tsx`, `src/components/guide/GuideStrip.tsx`, `src/components/guide/guideLit.ts`, `src/components/guide/guide.css`, `src/lib/onboarding/guideKeys.mjs` + `.d.mts`
- Test: `src/lib/onboarding/__tests__/guideKeys.test.mjs`

**Interfaces:**
- Consumes: Task 2 preload API; `acceleratorToKeys`; `Keycaps`, `LavenderButton`, `useWelcomeTheme` from `welcomeShared.tsx`.
- Produces:
  ```ts
  useGuide(): { state: GuideState | null; justDone: boolean; dispatch(e: GuideEvent): void };
    // justDone = true for 1000 ms after `step` changes (renderer-only "Done" flash)
  useGuideLit(selector: string | null): void;   // sets data-guide-lit on the first matching visible element, clears all others; null clears
  guideKeys(keybinds: {id:string;accelerator:string}[], id: string, platform: string): string[];
  <GuideCard anchor: string /* CSS selector */ place: 'below'|'above' width?: number dx?: number dy?: number
     stepId: GuideStepId eyebrow title body list?: [label, 'done'|'now'|'todo', hint?][]
     action?: { label: string; onClick(): void } waiting?: string onSkip(): void />
  <GuideStrip stepId eyebrow title body keys?: string[][] keyLabels?: string[] waiting?: string
     note?: string /* extra line, e.g. "Not on a call? ..." */ action?: {label; onClick} onSkip(): void />
  ```
  Lift look, layout and CSS from `src/dev/guideProto.tsx` (floating card and inline mode) into these components; anchor by `data-guide="…"` attributes, not text matching. `guide.css` holds the `[data-guide-lit]` ring and the reduced-motion rule.

- [ ] **Step 1: Failing test** `guideKeys uses binding and platform`:
  ```js
  const kb = [{ id: 'chat:whatToAnswer', accelerator: 'CommandOrControl+1' }, { id: 'general:selective-screenshot', accelerator: 'CommandOrControl+Shift+H' }];
  assert.deepEqual(guideKeys(kb, 'chat:whatToAnswer', 'darwin'), acceleratorToKeys('CommandOrControl+1', 'darwin'));
  assert.deepEqual(guideKeys(kb, 'chat:whatToAnswer', 'win32'), acceleratorToKeys('CommandOrControl+1', 'win32'));
  assert.notDeepEqual(guideKeys(kb, 'chat:whatToAnswer', 'darwin'), guideKeys(kb, 'chat:whatToAnswer', 'win32'));
  // rebound key wins over the default; unknown id falls back to the KeybindManager default
  assert.deepEqual(guideKeys([{ id: 'chat:whatToAnswer', accelerator: 'Alt+Q' }], 'chat:whatToAnswer', 'win32'), acceleratorToKeys('Alt+Q', 'win32'));
  assert.deepEqual(guideKeys([], 'general:take-screenshot', 'darwin'), acceleratorToKeys('CommandOrControl+H', 'darwin'));
  ```
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `guideKeys` (defaults table: the three ids above with `CommandOrControl+1`, `CommandOrControl+H`, `CommandOrControl+Shift+H`), then the hook and components.
- [ ] **Step 4: Run PASS; `npm run typecheck:ts7` clean.**
- [ ] **Step 5: Commit** `feat(guide): guide card, strip and highlight`

---

### Task 4: Launcher — start, step 1, step 5, trial-ended gate, the card slot

**Files:**
- Modify: `src/components/onboarding/OrchestratedToasterHost.tsx:183-184` (plans case)
- Modify: `src/components/Launcher.tsx` (~L1185 Start Natively button: add `data-guide="start"`; render step 1 `GuideCard`)
- Modify: `src/components/MeetingDetails.tsx` (~L3170 tab row: add `data-guide="meeting-tabs"`; render step 5 `GuideCard`)
- Modify: `src/App.tsx` (~L613 and ~L867 trial-ended handling; meeting-state + trial auto-start listeners; card slot claim)
- Test: `src/components/__tests__/FirstRunGuideLauncher2026_11_10.test.mjs` (source-reading)

**Interfaces:**
- Consumes: Task 3 components and `useGuide`; orchestrator `claimExternalCard(id, {force})`, `releaseExternalCard(id)`; `onMeetingStateChanged`, `onTrialAutoStart`, `onLicenseStatusChanged`, `getStoredCredentials`.
- Produces: the launcher dispatches `plans_closed`, `meeting_started`, `meeting_stopped`, `notes_next`, `trial_out`, `trial_unavailable`, `skip`.

Behaviour:
- Plans case: wrap `closeWith('plans')` so that after it runs, the host dispatches `{ type: 'plans_closed', facts }`, with facts built from the orchestrator user state (`hasOwnAiKey`, `hasNativelyKey`, `isPremium`) and `launchesOf(ctx)` (`stageCatalog.ts`).
- While `state.status === 'active'`, App claims the slot with `claimExternalCard('first_run_guide', { force: true })` and releases it when the status changes. Nothing else needs the claim to succeed, but no promotional card appears while it holds.
- Trial-ended gate: where App would `setShowTrialExpiredModal(true)` or set `trialEndedDue`, if the guide is active and on a step before `plans`, dispatch `trial_out` instead and do not open the modal. A failed `onTrialAutoStart` (`state: 'failed'`) dispatches `trial_unavailable`.
- `onMeetingStateChanged`: `isActive` true → `meeting_started`, false → `meeting_stopped`.
- Step 5 card: shown on the meeting that just ended (the launcher already opens it via `onLauncherOpenMeeting`), anchored to `[data-guide="meeting-tabs"]`, button "Next" → `notes_next`, then `openSettingsTab('plans')`.
- Step 1 card anchors `[data-guide="start"]`, place below, `waiting` "Waiting for you"; body "Your free trial covers it. Join your call first, or start now."

- [ ] **Step 1: Failing source test**: host plans case contains `plans_closed`; `Launcher.tsx` contains `data-guide="start"`; `MeetingDetails.tsx` contains `data-guide="meeting-tabs"` and `notes_next`; `App.tsx` contains `'first_run_guide'`, `trial_out`, `trial_unavailable`, `meeting_started`.
- [ ] **Step 2: Run FAIL. Step 3: Implement. Step 4: Run PASS; `npm run typecheck:ts7`; `npm run test:lib`.**
- [ ] **Step 5: Commit** `feat(guide): launcher steps and start after the Plans card`

---

### Task 5: Overlay — steps 2, 3, the notepad hand-off and "stop"

**Files:**
- Modify: `src/components/overlay/overlayBannerSlots.mjs` (+ its `.d.mts` if present): add `'guide'` to `OVERLAY_BANNER_PRIORITY` directly after `'ambient-mic'` (before `'trial'`)
- Modify: `src/components/NativelyInterface.tsx` (~L11745 `pickOverlayBanners` input `guide: …`; a new `ChromeFold` with `testId="fold-guide"` placed just above the trial fold ~L12233; add `data-guide="what-to-answer"` to the What to answer button)
- Test: extend `src/components/overlay/__tests__/` banner-slot test with the new rank; source test in `src/components/__tests__/FirstRunGuideOverlay2026_11_10.test.mjs`

**Interfaces:**
- Consumes: Task 3 `GuideStrip`, `useGuide`, `useGuideLit`, `guideKeys`; `onIntelligenceSuggestedAnswer` (and the manual-result/refined variants the button path uses), `onScreenshotTaken`, `onScreenshotAttached`, `onNotesWindowVisibility`, `notesWindowToggle`.
- Produces: dispatches `answer_shown`, `screenshot_taken`, `skip`.

Behaviour:
- Strip wants a slot when `state.status === 'active'` and `windowForStep(step) === 'overlay'`, or step is `notepad` while the notes window is closed.
- `answer`: keys `guideKeys(…, 'chat:whatToAnswer', platform)`, waiting "Waiting for you", lights `[data-guide="what-to-answer"]`. Note "Not on a call? Play any interview video, or ask a question out loud." while no transcript line has been heard in this meeting.
- `screenshot`: two key rows (`general:take-screenshot`, `general:selective-screenshot`), labels "Whole screen" / "Drag an area", waiting "Try either one". No highlight.
- `notepad` with notes window closed: title "Write while you talk.", action "Open notepad" → `notesWindowToggle()`.
- `stop`: title "Stop the meeting when you're ready." No keys.
- Errors outrank the guide (cap 2); the guide outranks the trial banner.

- [ ] **Step 1: Failing tests**: `OVERLAY_BANNER_PRIORITY.indexOf('guide') === indexOf('ambient-mic') + 1`; with `{ 'auto-stop': true, 'stt-error': true, guide: true }` the picked set excludes `guide`; with `{ guide: true, trial: true, 'last-time': true }` it is `{guide, trial}`. Source test: `NativelyInterface.tsx` contains `fold-guide`, `data-guide="what-to-answer"`, `answer_shown`, `screenshot_taken`.
- [ ] **Step 2: Run FAIL. Step 3: Implement. Step 4: Run PASS; existing overlay banner tests still pass; `npm run typecheck:ts7`.**
- [ ] **Step 5: Commit** `feat(guide): overlay strip for What to answer and screenshots`

---

### Task 6: Notes window — step 4

**Files:**
- Modify: `src/components/NotesWindow.tsx` (strip above the editor), `src/components/notes/NotesEditor.tsx` only if NotesWindow has no change callback to hook
- Test: `src/components/__tests__/FirstRunGuideNotes2026_11_10.test.mjs` (source)

**Interfaces:** Consumes Task 3 `GuideStrip`, `useGuide`. Produces `note_typed` (first non-empty edit while step is `notepad`), `skip`.

Behaviour: step `notepad` → strip "Write while you talk." / "Jot a line. It goes into your meeting notes." / waiting "Type a line". Step `stop` → the same "Stop the meeting when you're ready." strip as the overlay. The strip must not take focus from the editor (Windows notes window is no-activate, PR #709): no `autoFocus`, no `.focus()`.

- [ ] **Step 1: Failing source test**: `NotesWindow.tsx` contains `GuideStrip` and `note_typed`, and no `autoFocus` inside the guide strip component file.
- [ ] **Step 2–4: FAIL → implement → PASS; typecheck.**
- [ ] **Step 5: Commit** `feat(guide): notepad step`

---

### Task 7: Settings — steps 6, 7 and "Show the guide again"

**Files:**
- Modify: `src/components/SettingsOverlay.tsx` (nav buttons: `data-guide="nav-plans"`, `data-guide="nav-ai-providers"`; render the settings-step `GuideCard`)
- Create: `src/components/guide/SettingsGuide.tsx` (steps 6–7 content)
- Modify: `src/components/settings/HelpSettings.tsx` (a "Show the guide again" row → `restart`, then `window.electronAPI.openSettingsTab` is not needed: the launcher shows step 1)
- Test: `src/components/__tests__/FirstRunGuideSettings2026_11_10.test.mjs` (source)

**Interfaces:** Consumes `getTrialStatus()`, `getStoredCredentials()` (`hasOwnAiKey`), `getSttProvider()`, `getEmbeddingStatus()` (`active.configured`), `onCredentialsChanged`, `onLicenseStatusChanged`, `openSettingsTab`. Produces `plan_changed`, `own_keys`, `keys_done`, `restart`, `skip`.

Behaviour:
- Step 6 (`plans`), anchored to `[data-guide="nav-plans"]`, below. Title by variant: normal "Your free trial is almost used up." (body states the real remaining amount from `getTrialStatus`; if nothing is left, title "Your free trial is used up."), `trial_out` "Your free trial is used up.", `no_trial` "Your free trial isn't available on this device." Body ends "Pick a plan on the right to keep Natively Pro. Or use your own AI keys, free." Action "Use my own keys" → `own_keys` + `openSettingsTab('ai-providers')`.
- On mount of step 6 and on every `onLicenseStatusChanged` / `onCredentialsChanged`, dispatch `plan_changed` with fresh facts (the reducer decides). When the result is `finished`/`bought`, the card shows "Thanks. You're all set." for 4 s, then unmounts.
- Step 7 (`keys`), anchored to `[data-guide="nav-ai-providers"]`: checklist rows AI provider (required, ticked when `hasOwnAiKey`), Speech-to-text (ticked when `getSttProvider()` is not the trial/Natively default), Retrieval (optional, ticked when `active.configured`), refreshed on `onCredentialsChanged`. Action "Done", enabled once AI provider is ticked → `keys_done`. Rows are AI provider, then speech-to-text, then retrieval.
- Help row label "Show the guide again"; it dispatches `restart` and opens the launcher home.

- [ ] **Step 1: Failing source test**: SettingsOverlay contains `data-guide="nav-plans"` and `data-guide="nav-ai-providers"`; SettingsGuide contains `own_keys`, `keys_done`, `plan_changed`, `getTrialStatus`; HelpSettings contains `Show the guide again` and `restart`.
- [ ] **Step 2–4: FAIL → implement → PASS; typecheck.**
- [ ] **Step 5: Commit** `feat(guide): plans and own-keys steps in Settings`

---

### Task 8: Clean-up and the real-app walk

**Files:** Delete `src/dev/guideProto.tsx`. No product changes unless the walk finds a defect (fix in the owning task's files, with a test).

- [ ] **Step 1:** `npm run test:lib`, `npm run typecheck:ts7`, `npm run typecheck:electron`, and the overlay/component tests touched above (`node --test <files>`). All pass.
- [ ] **Step 2:** Launch `NATIVELY_RAG_LOCAL_RERANK=off NATIVELY_RAG_SPECULATIVE_RERANK=off npm run dev:agent` with a fresh worktree userData. Walk all seven steps in light theme, screenshot each: Plans card → close → step 1 → start meeting → press What to answer (button, since shortcuts aren't driven over CDP) → screenshot → open notepad, type → stop → meeting tabs → Next → Plans → "Use my own keys" → AI Providers checklist. Repeat steps 1, 2 and 6 in dark theme. Check `agent-browser errors` is empty on each window.
- [ ] **Step 3:** Skip mid-guide; relaunch; guide does not return. Help → "Show the guide again" → step 1.
- [ ] **Step 4:** Stop the app through the launcher.
- [ ] **Step 5: Commit** `chore(guide): remove the dev prototype`
- [ ] **Step 6:** Completion report per CLAUDE.md. Expected: `Tested physically on macOS` (renderer walk only), `Covered by automated macOS/Windows branch tests` (guideKeys only), `Requires physical Windows verification` (keycaps, overlay growth without focus steal, notes no-activate window), `Requires physical macOS verification` (global shortcuts pressed for real, overlay growth during a real call).
