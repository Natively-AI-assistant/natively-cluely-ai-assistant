# First-run guide: design

Date: 2026-11-10
Status: draft, waiting on Evin's review

## Why

A brand-new user (no Natively key, no own AI key, no earlier install) sees the
Welcome screens, then the launcher, then the "Unlock Pro." card with three plans
(Pro Pack $5, API Pro $15, Pro Yearly $30). Most close that card and are left
alone on the launcher. They have a free trial that covers a real meeting, but
nothing walks them through one. The guide does that. They learn what the app
does by doing it, and the trial ending leads either to a plan or to setting up
their own keys.

Success means a new user finishes one real meeting with an answer, a
screenshot, a notepad line and the written-up notes. They then either buy or
leave with a working AI provider and speech-to-text.

## What the user sees

The guide starts when the user closes the Unlock Pro card ("Continue for free"
or the close button) on their first launch. It has seven steps, shown in the real
windows where the action happens. A dev-only mock of the look is in
`src/dev/guideProto.tsx`. It isn't imported by the app; use it as the visual
reference, and delete it when the real guide lands. Screenshots of every step:
`guide-in-app.png` from the 2026-11-10 session.

| # | Window | What it says | Moves on when |
|---|--------|--------------|---------------|
| 1 | Launcher: a card under the "Start Natively" button, button highlighted | "Start your first meeting." Your free trial covers it. | A meeting starts |
| 2 | Overlay: an inline strip above the Free trial pill, "What to answer?" button highlighted | "They just asked you something." Keys ⌘ 1 | A What to answer reply arrives |
| 3 | Overlay: the same strip | "Show Natively your screen." Keys ⌘ H (whole screen), ⌘ ⇧ H (drag an area) | Either screenshot is taken |
| 4 | Notes window: a strip at the top | "Write while you talk." | The user types a line in the notepad |
| 5 | Launcher, on the finished meeting: a card under the Summary / Transcript tabs | "Your meeting, written up." | The user presses Next |
| 6 | Settings > Plans & Billing: a card under the left menu | "Your free trial is almost used up." Button: "Use my own keys" | A plan is bought (guide ends), or "Use my own keys" |
| 7 | Settings > AI Providers: a card with a checklist | AI provider (required), Speech-to-text, Retrieval (optional) | Each row ticks itself when that setting is saved |

Between steps 4 and 5 the user has to stop the meeting. When step 4 is done the
strip changes to "Stop the meeting when you're ready" and points at the stop
control. It is not a separate numbered step.

### Look

- Use the app's own pieces: `Keycaps` and `LavenderButton` from
  `src/components/onboarding/welcomeShared.tsx`, lavender #7C5CFF, the window's
  font. No new visual language.
- Launcher and Settings: a floating card (radius 18, frosted white in light, near
  black in dark), with a "N of 7 · label" line, progress dots, the title, one
  or two lines of body, and a footer with "Skip guide" plus either a button or a
  "waiting" status.
- Overlay and notes window: a flat inline strip that sits in the window's own
  layout and makes the window grow. The overlay is a small window sized to its
  content (about 732×205), so a floating card doesn't fit. Strip: radius 16,
  lavender tint at 6% (light) or 10% (dark), a 1px lavender inner rim. Text on
  the left, keycaps and status on the right.
- The real control is highlighted with a lavender ring and soft glow on the
  element itself (`data-guide-lit` style), not a cut-out over the window.
  The overlay is zoomed, so measured rectangles are wrong there.
- Keycaps show ⌘ / ⇧ on macOS and Ctrl / Shift on Windows. They are read from
  the user's real key bindings, not hard-coded. The defaults are
  CommandOrControl+1, CommandOrControl+H and CommandOrControl+Shift+H.
- Light and dark themes both. Reduced motion: fades only.

### Behaviour

- Action steps (1–4) have no Next button. They wait for the real action, then
  show a short "Done" state for about a second and move on. Every step has
  "Skip guide".
- Skipping ends the guide for good. It can be restarted from Settings > Help
  ("Show the guide again").
- If the user quits mid-guide, the next launch resumes at the same step, unless
  more than 7 days have passed; then the guide is dropped.
- Step 6 reads the real trial status (`getTrialStatus`) and shows what's
  actually left, so the copy is never false. If the trial is already gone, it
  says so ("Your free trial is used up").
- If the user buys Pro Pack or API Pro at step 6, the guide ends with a short
  thank-you on the same card (those plans include AI and speech-to-text).
  If they buy Pro Yearly, which runs on the user's own keys, the guide goes on
  to step 7. If they choose "Use my own keys", Settings opens AI Providers and
  step 7 starts. *(Builder's call: Pro Yearly continues, so every buyer ends with
  working AI.)*
- If the trial runs out during steps 1–5, the guide jumps to step 6, and step 6
  takes the place of the usual trial-ended card while the guide runs, so the two
  don't fight over the one card slot. *(Builder's call.)*
- If no trial is available (it failed to start, or this device already used it),
  step 1 doesn't promise one. The guide goes straight to step 6 with the copy
  "Your free trial isn't available on this device." *(Builder's call.)*
- Step 7 order: AI provider first, because nothing works without it. Then
  speech-to-text, then retrieval (optional). Evin listed retrieval first; this
  order is a builder call that can be swapped.

## Who gets it

- New users only: no Natively key, no own AI key, and no sign of an earlier
  install. Use the same "new user" test the card ledger and orchestrator
  already use.
- It starts the first time the Plans card closes, on whatever launch that is.
  On macOS, granting Screen Recording often forces a relaunch, so this may be
  launch 2. "Continue for free", the close button and the card's plan buttons
  all count. If the user bought a plan from the card, steps 1–5 still run and
  steps 6–7 follow the purchase rules below. *(Builder's call.)*
- Never during the review prompt or any other full-window card. The guide takes
  the orchestrator's single slot while it runs, so no promotional card
  interrupts it. The "No promotional card during a free trial" rule in
  `stageCatalog.ts` already keeps most cards away.
- Not shown to existing users after an update.

## How it fits the code (builder's call within these lines)

- Guide state (current step, started at, skipped, finished) lives in the main
  process and is saved with the other onboarding state. Each window asks for it
  and listens for changes over IPC. Each window renders only its own steps.
  This keeps the launcher, overlay and notes window in sync without
  window-to-window messages.
- The guide is one new orchestrator stage (or an equivalent hook) that starts
  right after `plans` closes in `OrchestratedToasterHost.tsx`. It doesn't
  bypass the card ledger.
- Moving on reuses events that already exist where possible:
  `onMeetingStateChanged`, the What to answer answer events
  (`onIntelligenceSuggestedAnswer` and friends), `onScreenshotTaken` /
  `onScreenshotAttached`, `onLiveNotesState`, `onLauncherOpenMeeting`, the
  trial and plan events, and the credentials-changed signals for step 7.
- Telemetry: `guide_step_shown`, `guide_step_done`, `guide_skipped` (with the step),
  `guide_finished` (bought / own keys), through the existing funnel
  (`onboarding_stage`).

## Non-goals

- Not a replacement for the Welcome screens or their key tour.
- No fake overlay or recorded demo in place of the real windows. Evin rejected
  the HTML mock-up and asked for the real app.
- No guide for existing users, and no tips after the guide ends.
- No new pricing, plans or checkout. Step 6 opens the existing Plans & Billing.

## Anti-goals (fails even if it works)

- It looks like a generic coach-mark library: dark tooltips, arrows and a heavy
  dim over everything. Evin rejected that look twice.
- It blocks the user. Every step can be skipped, and the app works normally
  underneath.
- It lies about the trial ("almost used up" when most is left).
- It shows ⌘ to a Windows user.
- It pops up again after the user skipped it.

## Constraints

- macOS and Windows (see CLAUDE.md): keycaps, overlay sizing, the notes window
  (which on Windows is a no-activate window, PR #709), and focus behaviour
  must be checked on both. Overlay growth must not steal focus from the
  meeting app.
- The overlay must stay hidden from screen share exactly as it is now. The strip
  is part of the overlay's own DOM.
- Renderer UI is checked with agent-browser over CDP (`npm run dev:agent`), launched
  with local models off. Shortcuts, window levels and focus need physical checks.

## Step 1 is a real meeting (Evin, 2026-11-10)

Step 1 starts a real meeting with the normal Start Natively button, and the trial
pays for it. There is no practice call and no recorded voice. If nothing has been
heard yet when step 2 shows, the strip adds one line: "Not on a call? Play any
interview video, or ask a question out loud." Once a question has been heard,
the line goes away.

## Left to the builder

- Exact copy beyond the titles above (keep it short and plain).
- Animation details, within the app's motion rules.
- Where the "Show the guide again" row sits in Help.
- How to detect "earlier install" if the existing check isn't enough.
