# Overlay auto expand / contract — motion

The overlay's automatic sizing carries **two different curves, one per axis**,
chosen by watching the candidates play in the real overlay side by side:

| axis | curve | note |
| --- | --- | --- |
| **width** (panel 600↔732) | `OVERLAY_RESIZE_SPRING` — 420ms weighted spring, bounce 0 | unchanged; what it has always been |
| **height** (chat viewport) | `OVERLAY_RESIZE_TWEEN` — 300ms / `cubic-bezier(0.22, 1, 0.36, 1)` | the [transitions.dev](https://transitions.dev) **Card resize** signature. Before 2026-09-13 this axis did not animate at all — it cut. |

Values live in `electron/utils/overlayResizeEasing.mjs`; the height channel's
branching lives in `src/lib/overlayHeightTween.mjs`.

Because the width is a spring, it retargets in flight natively (framer carries
the current velocity into the new target), so the scroll scanner re-firing
`startTransition` as code blocks cross the viewport edge needs no special case.
A tweened width did — that hybrid existed briefly and is gone.

**Why the snippet's `.t-resize` class could not just be pasted in.** The panel's
width is written every frame by a framer MotionValue, so a CSS `transition` on it
is inert (each write restarts it). And the card is `overflow-hidden` with the
footer at the bottom of a flex column, so lagging the *card's* height slices the
footer off for the whole tween. The signature is therefore adopted in the JS
channels, and the animated box is a clipping wrapper around the chat viewport —
the card's only elastic element.

**The two curves never run at the same time.** Two curves on two axes sounds like
it should tear when both change together, and it did: pressing the manual
expand/contract toggle made the width grow and *then* the height, reported from
the real app. The height was running its own 300ms curve while the width spring
re-wrapped the text underneath it, and every frame's fresh measurement restarted
that curve from zero velocity.

The rule that fixes it is in `decideHeightCommit`: **while a width transition is
in flight the height SNAPS.** When the panel widens, the viewport's natural
height changes as a *consequence*, every frame — that is the width's own motion
expressed on the other axis, not a discrete change to animate. Snapping restores
what the original design had for free, back when the card's height simply *was*
the content height. The bezier is then only ever the curve for a height change
that stands alone (a row mounts, the panel clears), which is where it was wanted.

**The OS window leads a growing panel; it never follows one.** The card is
`overflow-hidden` with the footer at the bottom, so any frame where the window is
shorter than the panel is a sliced send button. Following at 30fps left 9 such
frames (worst 36px) on the toggle; reporting every growth frame still left 38
(worst 34px), because `resizeOverlayWindow` is async IPC and lands a frame late.
The width transition therefore commits AHEAD by `STREAMING_HEIGHT_GROW_BUFFER_PX`
— armed up front, and topped up on a LOW-WATER MARK at half the buffer so the
panel never reaches the window's edge. Shrinking still follows, rate-limited: a
window taller than the panel is transparent and isn't hit-tested (the hover gate
uses the panel's rect). Measured after: `window >= card` on every frame, both
directions.

Lockstep is also why `startTransition`'s `onUpdate` calls
`syncViewportHeightToContent()` before its rate-limit check: the ResizeObserver
path is rAF-debounced and therefore one frame behind, and one frame of lag
between the axes is the artifact. Measured live on the toggle, collapse
direction: of 28 frames where the height moved, the width moved on **all 28**.

## Clips

Recordings are saved at `docs/motion/` (that path is gitignored in this repo —
`.gitignore:500 docs/*` — deliberately, so recordings never enter git history;
see the 870 MB docs-commit incident. Copy them out if you want to share them).

**Current:**

| File | What it shows |
| --- | --- |
| `overlay-auto-resize-options-real-ui.gif` | **The decision clip.** The real overlay, four candidate motions, 2×2 at near full size, same scripted send aligned on the keypress; real speed then half speed. Option 2 — spring width / bezier height — is what shipped. |
| `overlay-auto-resize-options.gif` | The same four candidates in the dev rig, over the full scenario including the code-width expand and the contract. Recorded BEFORE the lockstep rule landed, so its code-expand and collapse segments show the four options disagreeing on the mixed case; they no longer do. Its standalone height moments are still current. |

**Superseded** — these three were recorded when the 300ms bezier was on BOTH
axes, which is not what shipped. Kept because they are the only footage of the
height axis not animating at all (the "before"), which is still the useful
contrast; just don't read their "after" column as current:

| File | What it shows |
| --- | --- |
| `overlay-auto-resize-ab-live.gif` | The real overlay window, two builds side by side, expand only. A snaps to full height; B glides. Captured with `Page.startScreencast` on the overlay target — a desktop grab cannot record a transparent always-on-top window, and the window's edges are the thing being judged. No provider answered during those captures, so the expand shown is the viewport mounting with the question bubble and the thinking dot. |
| `overlay-auto-resize-ab-harness.gif` | The dev rig, full scenario: open → thinking → answer → code expand (width) → collapse → clear. |
| `overlay-auto-resize-ab-retarget.gif` | The retarget stress: five expand/collapse flips at 150ms. Only meaningful for a TWEENED width, which is no longer shipped — the width is a spring and retargets natively. |

**The contract is on film only in the rig.** In the real overlay it is verified by
measurement, not by a clip: driving `endMeeting` over CDP on a session that had a
real answer gave a glide of `box 300 → 45` in ~85ms of a 300ms curve (front-loaded
as expected), the card settling `614 → 314` with the window converging to the same
value and no transparent strip left behind.

## Reproducing

```sh
npm run dev                                    # vite, serves the harness
node scripts/overlay-motion/ab-options-probe.mjs          # settle time + overshoot, per option
node scripts/overlay-motion/ab-record.mjs <outdir> '<steps json>'   # side-by-side clip
#   HARNESS_W / HARNESS_H size the viewport; HARNESS_QUERY picks the columns,
#   e.g. HARNESS_QUERY='?v=before,after'
node scripts/overlay-motion/ab-compose-grid.mjs <out.gif> <label.png> <dir>x4   # 2x2 real-overlay grid
node scripts/overlay-motion/ab-label-grid.mjs <label.png> <cellW> <cellH> <labelH>

# Only relevant if a TWEENED width is ever reconsidered — the shipped width is a
# spring, which retargets natively and needs no hybrid:
node scripts/overlay-motion/ab-retarget-probe.mjs             # tween + spring hybrid
node scripts/overlay-motion/ab-retarget-probe.mjs 'retarget=tween'   # pure tween
```

The 2×2 real-overlay grid needs one screencast capture per candidate, which means
patching the two motion call sites, building, launching, recording and restoring
once per option — and verifying the source sha against a pristine copy afterwards.
That loop is not committed (it lives with the gitignored `cdp-*.mjs` drivers);
`cdp-screencast.mjs` is the piece that records one.

Drive the harness with Playwright and `channel: 'chrome'`, never the Chrome MCP
tools: that tab reports `visibilityState: 'hidden'`, which freezes `rAF`, so
framer-motion never advances and every frame comes out identical with no error.

## Measured

### Candidate options (dev rig, height travel 113px and 193px)

| option | width | height | settles | overshoot |
| --- | --- | --- | --- | --- |
| 1 | spring 420 | spring 420 | 600–724ms | none |
| **2 — shipped** | **spring 420** | **bezier 300** | **283–423ms** | 20px when both axes moved — fixed by the lockstep rule above |
| 3 | spring 420 b0.35 | same | 334–840ms | 8–10px, and it wobbles the **OS window edge** (321→332→327 over ~180ms of native `setBounds` calls) |
| 4 | spring 300 | spring 300 | 451–557ms | none |

Option 3 was first tried at bounce 0.15 and measured a **one pixel** overshoot —
invisible, so it was not a distinct option at all. Raised to 0.35 to make it a
real choice, at which point the window-edge wobble showed up.

### Retarget continuity (why the width stayed a spring)

Velocity step across a retarget instant (five retargets at 150ms, live CSS width
sampled per `rAF`):

| width channel | mean step | peak speed |
| --- | --- | --- |
| spring (before) | 0.55 px/ms | 0.66 px/ms |
| pure tween | 1.86 px/ms | 1.80 px/ms |
| **tween + spring on retarget (shipped)** | **0.54 px/ms** | **2.00 px/ms** |

A fresh transition gets the new curve; a transition retargeted in flight keeps
the spring's velocity continuity. See `startTransition` in
`src/components/NativelyInterface.tsx`.

Live expand on the shipping build — "In two sentences, what is a deadlock?",
sampled per `rAF` in the overlay renderer (`win` = `window.innerHeight`, i.e. the
OS window; `card` = the panel; `box` = the animated viewport). The window
pre-grows in one `setBounds` **before** the panel moves, so `win >= card` holds at
every sampled frame and the footer is never clipped:

```
t=  486ms  win=474  card=329  box=0     ← window leads, panel has not moved
t=  503ms  win=474  card=364  box=35
t=  536ms  win=474  card=416  box=87
t=  603ms  win=474  card=461  box=132
t=  720ms  win=474  card=474  box=145   ← settled
t= 8770ms  win=474  card=459  box=145   ← stream-end settle, window follows down
```

The absolute numbers depend on the question and on how much chrome the profile is
showing (an earlier run of the same check sat at 496); what is invariant, and what
this is pinning, is `win >= card` on every row and the card's travel spread across
~230ms instead of one frame.
