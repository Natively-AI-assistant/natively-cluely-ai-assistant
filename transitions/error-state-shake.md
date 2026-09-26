# Error state shake

## When to use

Form validation feedback — invalid email, wrong password, missing required field, mismatched confirmation. The input shakes left/right with overshoot, the border switches to error color, and a message reveals beneath. After a hold timer (long enough to read the message), border + message fade back to neutral. Optional: typing into the input cancels the auto-revert immediately.

The `t-` snippet is also a fit for any "this is wrong, try again" moment that needs a percussive hint without an OS-level alert — a wrong-PIN field on a lock screen, a duplicate-tag warning in a tag editor, a "name already taken" username field.

## HTML usage

```html
<!-- Apply .t-input-wrap to your wrapper, .t-input to the
     element that should shake (your input field, its
     bordered wrapper — whatever owns the visible border),
     and .t-error-msg to the message you want to reveal.
     Bring your own sizing, padding, border colors, and
     typography. -->
<div class="t-input-wrap">
  <div class="t-input">
    <input type="text">
  </div>
  <p class="t-error-msg">Please enter a valid email.</p>
</div>
```

Trigger:
  - Add `.is-error` to .t-input-wrap and .t-input. Your
    own border-color rules drive the visible color; this
    stylesheet only owns the tween.
  - Restart the shake by removing `.is-shaking` from
    .t-input, forcing a reflow, then re-adding it.
  - Optional: after --revert-hold ms, drop both
    `.is-error` classes so border + message fade back
    to neutral over --revert-dur.

Per-segment ease: each keyframe stop carries its own
animation-timing-function so each leg follows the Figma
cubic-bezier curve independently.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--shake-distance` | `6px` | sourced from `--p12-shake-distance` |
| `--shake-overshoot` | `4px` | sourced from `--p12-shake-overshoot` |
| `--shake-dur-a` | `80ms` | sourced from `--p12-shake-dur-a` |
| `--shake-dur-b` | `60ms` | sourced from `--p12-shake-dur-b` |
| `--shake-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p12-shake-ease` |
| `--revert-hold` | `3000ms` | sourced from `--p12-revert-hold` |
| `--revert-dur` | `280ms` | sourced from `--p12-revert-dur` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --shake-distance: 6px;
  --shake-overshoot: 4px;
  --shake-dur-a: 80ms;
  --shake-dur-b: 60ms;
  --shake-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --revert-hold: 3000ms;
  --revert-dur: 280ms;
}
```

## CSS

```css
/* Border-color tween. Define your input's default / focused
   / error border-color in your own component CSS — this rule
   only owns the interpolation. Use a constant border-width
   across states so the tween never shifts inner content. */
.t-input {
  transition: border-color 150ms ease-out;
  will-change: transform;
}
.t-input.is-error {
  /* Error border auto-reverts on the hold timer, so the
     fade-out uses the slower revert duration (matches the
     message fade). */
  transition: border-color var(--revert-dur, 280ms) ease-out;
}

/* Error message reveal. Visibility is delayed by --revert-dur
   on hide so the message stays painted for the full opacity
   fade-out. Entering .is-error drops the delay to 0 so the
   message becomes visible immediately. */
.t-error-msg {
  opacity: 0;
  visibility: hidden;
  transition:
    opacity    var(--revert-dur, 280ms) ease-out,
    visibility 0s linear var(--revert-dur, 280ms);
}
.t-input-wrap.is-error .t-error-msg {
  opacity: 1;
  visibility: visible;
  transition:
    opacity    var(--revert-dur, 280ms) ease-out,
    visibility 0s linear 0s;
}

/* Multi-segment keyframe with per-stop easing so each leg
   of the shake follows its own cubic-bezier independently.
   %-stops are cumulative durations as a fraction of the
   total (80, 60, 80, 60 = 280ms): 28.57%, 57.14%, 78.57%,
   100%. Recompute if any segment duration changes. */
.t-input.is-shaking {
  animation: t-input-shake calc(
      var(--shake-dur-a) * 2 + var(--shake-dur-b) * 2
    ) linear;
}
@keyframes t-input-shake {
  0%      { transform: translateX(0);                                 animation-timing-function: var(--shake-ease); }
  28.57%  { transform: translateX(var(--shake-distance));             animation-timing-function: var(--shake-ease); }
  57.14%  { transform: translateX(calc(var(--shake-distance) * -1)); animation-timing-function: var(--shake-ease); }
  78.57%  { transform: translateX(var(--shake-overshoot));            animation-timing-function: var(--shake-ease); }
  100%    { transform: translateX(0); }
}

@media (prefers-reduced-motion: reduce) {
  .t-input { animation: none !important; transform: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

```js
// Trigger the error state, replay the shake, and schedule the
// auto-revert. Cancel any in-flight revert so the timer always
// tracks the latest call.
const wrap = document.querySelector(".t-input-wrap");
const input = wrap.querySelector(".t-input");

const cs = getComputedStyle(document.documentElement);
const ms = (name, fb) => {
  const v = parseFloat(cs.getPropertyValue(name));
  return Number.isFinite(v) ? v : fb;
};

function showError() {
  wrap.classList.add("is-error");
  input.classList.add("is-error");

  // Replay the shake from a clean baseline.
  input.classList.remove("is-shaking");
  void input.offsetWidth; // force reflow
  input.classList.add("is-shaking");

  const shakeMs =
    ms("--shake-dur-a", 80) * 2 +
    ms("--shake-dur-b", 60) * 2;
  setTimeout(() => input.classList.remove("is-shaking"), shakeMs + 20);

  // Auto-revert: hold long enough to read the message, then fade
  // border + message back to neutral via the CSS transitions.
  if (wrap._revertTimer) clearTimeout(wrap._revertTimer);
  const hold = ms("--revert-hold", 3000);
  wrap._revertTimer = setTimeout(() => {
    wrap._revertTimer = null;
    wrap.classList.remove("is-error");
    input.classList.remove("is-error");
  }, shakeMs + hold);
}

// Optional but recommended: typing cancels the auto-revert and
// clears the error so the user isn't shaking at a value they're
// already correcting.
const inputEl = wrap.querySelector("input, textarea");
  inputEl?.addEventListener("input", () => {
  if (wrap._revertTimer) {
    clearTimeout(wrap._revertTimer);
    wrap._revertTimer = null;
  }
  wrap.classList.remove("is-error");
  input.classList.remove("is-error");
});
```

### Recomputing the keyframe stops

The `%`-stops in `@keyframes t-input-shake` are cumulative leg durations as a fraction of the total. The default leg pattern is **A, A, B, B** — the two big-swing legs (right peak → left peak) take `--shake-dur-a` each, the two recovery legs (left peak → overshoot → rest) take `--shake-dur-b` each:

```
total                = 2·A + 2·B  =  2·80 + 2·60 = 280ms
stop 1 (start)       =   0  / 280 =   0%      (rest)
stop 2 (after A)     =  80  / 280 =  28.57%   (peak right,    +distance)
stop 3 (after 2·A)   = 160  / 280 =  57.14%   (peak left,    -distance)
stop 4 (after 2·A+B) = 220  / 280 =  78.57%   (overshoot,   +overshoot)
stop 5 (end)         = 280  / 280 = 100%      (rest)
```

The total in the CSS uses `calc(var(--shake-dur-a) * 2 + var(--shake-dur-b) * 2)` — so the math stays consistent with the variables, but the **percentages** are baked literals. If you tune `--shake-dur-a` and `--shake-dur-b` to a different ratio, recompute the percentages by hand or the legs will drift out of sync with the duration calc.

### Why three classes (`.is-error` on wrap + input, `.is-shaking` on input)

- `.is-error` on `.t-input-wrap` controls the **message** visibility — the message lives in the wrap, not the input.
- `.is-error` on `.t-input` controls the **border color** — the input owns the border.
- `.is-shaking` on `.t-input` is **separate** from `.is-error` so you can replay the shake (remove → reflow → add) without flickering the error state on/off in the same tick. Keeping the shake state orthogonal also lets you trigger the shake on its own (e.g. for a "hint" jiggle) without the full error treatment.

