# Input clear with dissolve

## When to use

Clearing a text field — search box, filter input, any field with a clear (×) button. The typed text flies down + blurs + fades while a soft per-word streak ignites under each word, and the placeholder falls in from above. Per-frame JS is required: the streak envelope and per-word gradient stack cannot be expressed as static @keyframes.

## HTML usage

```html
<!-- Drop .t-clear on a wrapper that you've sized like an
     input field (positioning, padding, border, radius are
     yours). Inside it stack a real <input>, a mirror that
     visualizes the value, a fake placeholder for the new
     empty state, and a glow layer that gets the per-word
     radial-gradient stack written into it from JS. -->
<div class="t-clear has-value">
  <input type="text" value="…" />
  <div class="t-clear-mirror" aria-hidden="true">…</div>
  <div class="t-clear-placeholder" aria-hidden="true">Search</div>
  <div class="t-clear-glow" aria-hidden="true"></div>
  <button class="t-clear-btn" aria-label="Clear">…</button>
</div>
```

Pair with a small JS routine (mirrors the gallery code) that
flips `.is-clearing`, animates the mirror's translateY/opacity
per frame, mirrors the math on the placeholder, and writes a
stack of `radial-gradient(...)` layers onto .t-clear-glow's
background so each word gets its own streak. Per-frame JS is
unavoidable: the streak's rise/peak/fall envelope cannot be
expressed as a static @keyframe.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--clear-dur` | `1000ms` | sourced from `--p13-clear-dur` |
| `--clear-out-dur` | `400ms` | sourced from `--p13-text-out-dur` |
| `--clear-in-dur` | `400ms` | sourced from `--p13-text-in-dur` |
| `--clear-out-fly` | `12px` | sourced from `--p13-text-out-fly` |
| `--clear-in-fly` | `12px` | sourced from `--p13-text-in-fly` |
| `--clear-out-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p13-text-out-ease` |
| `--clear-in-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p13-text-in-ease` |
| `--clear-blur` | `2px` | sourced from `--p13-blur` |
| `--glow-delay` | `50ms` | sourced from `--p13-glow-delay` |
| `--glow-peak-at` | `0.15` | sourced from `--p13-glow-peak-at` |
| `--glow-opacity` | `0.42` | sourced from `--p13-glow-opacity` |
| `--glow-spread` | `1.5` | sourced from `--p13-glow-spread` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --clear-dur: 1000ms;
  --clear-out-dur: 400ms;
  --clear-in-dur: 400ms;
  --clear-out-fly: 12px;
  --clear-in-fly: 12px;
  --clear-out-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --clear-in-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --clear-blur: 2px;
  --glow-delay: 50ms;
  --glow-peak-at: 0.15;
  --glow-opacity: 0.42;
  --glow-spread: 1.5;
}
```

## CSS

```css
/* The wrap clips the glow to its rounded box. The hairline
   border is `inset` so it sits inside that clip — when the
   glow's mix-blend-mode darkens its area, the border
   underneath darkens with it. Bring your own width / height /
   border-radius / surface color. */
.t-clear {
  position: relative;
  overflow: hidden;
}
.t-clear-mirror,
.t-clear-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
  z-index: 2;
}
.t-clear-mirror { opacity: 0; }
.t-clear.has-value .t-clear-mirror,
.t-clear.is-clearing .t-clear-mirror { opacity: 1; }
/* Hide the input's own glyphs while the mirror owns them so
   the cleared text doesn't double-render with the fly-up. */
.t-clear.has-value > input,
.t-clear.is-clearing > input {
  -webkit-text-fill-color: transparent;
}
.t-clear.has-value .t-clear-placeholder { opacity: 0; }
/* The streak overlay: empty by default; JS writes a stack of
   `radial-gradient(...)` layers into background during a clear,
   then animates opacity. mix-blend-mode: multiply darkens the
   underlying input + hairline; flip to `screen` in dark mode
   so the same alpha values lighten instead of vanish. */
.t-clear-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  z-index: 3;
  mix-blend-mode: multiply;
}

/* The transitions live in JS (per-frame transform/opacity/
   filter writes), so this stylesheet only owns the resting
   state + the variables that JS reads. Read them with
   `parseFloat(getComputedStyle(root).getPropertyValue(...))`
   so live tweaks apply on the next clear without a reload. */

@media (prefers-reduced-motion: reduce) {
  .t-clear-glow { opacity: 0 !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

```js
// One clear routine per .t-clear. Reads timing/geometry from the
// CSS variables each call so live tweaks apply without a reload.
const root = document.documentElement;
const num = (name, fb) => {
  const v = parseFloat(getComputedStyle(root).getPropertyValue(name));
  return Number.isFinite(v) ? v : fb;
};
// Minimal cubic-bezier(x1,y1,x2,y2) sampler so JS easing matches CSS.
function bezier(str) {
  const m = String(str).match(/cubic-bezier\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\)/);
  if (!m) return (t) => t;
  const [x1, y1, x2, y2] = m.slice(1).map(parseFloat);
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 8; i++) {
      const dx = ((ax * s + bx) * s + cx) * s - t;
      const d = (3 * ax * s + 2 * bx) * s + cx;
      if (Math.abs(dx) < 1e-6 || d === 0) break;
      s -= dx / d;
    }
    return ((ay * s + by) * s + cy) * s;
  };
}

document.querySelectorAll(".t-clear").forEach((wrap) => {
  const input  = wrap.querySelector("input");
  const mirror = wrap.querySelector(".t-clear-mirror");
  const phold  = wrap.querySelector(".t-clear-placeholder");
  const glow   = wrap.querySelector(".t-clear-glow");
  const btn    = wrap.querySelector(".t-clear-btn");
  const canvas = document.createElement("canvas").getContext("2d");
  let clearing = false;

  const sync = () => {
    const has = input.value.length > 0;
    wrap.classList.toggle("has-value", has);
    if (has) mirror.textContent = input.value.replace(/ /g, "\u00a0");
  };

  function buildGlow(text) {
    canvas.font = getComputedStyle(input).font;
    const isDark = root.getAttribute("data-theme") === "dark";
    const rgb = isDark ? "255,255,255" : "0,0,0";
    const w = wrap.clientWidth || 280;
    const padLeft = parseFloat(getComputedStyle(input).paddingLeft) || 12;
    const spread = num("--glow-spread", 1.5);
    const layers = [];
    let x = 0;
    text.split(/(\s+)/).forEach((seg) => {
      const segW = canvas.measureText(seg).width;
      if (seg.trim()) {
        const cx = padLeft + x + segW / 2;
        const hw = Math.max(segW * 0.45, 8) * spread;
        [[0, 0.8, 7, 0.22], [hw * 0.45, 0.55, 8, 0.18],
         [-hw * 0.4, 0.65, 6, 0.16], [hw * 0.15, 0.9, 5, 0.14]]
          .forEach(([dx, rwm, rh, a]) => {
            const lx = (((cx + dx) / w) * 100).toFixed(2);
            layers.push(
              `radial-gradient(ellipse ${Math.max(hw * rwm, 2).toFixed(1)}px ${rh}px at ${lx}% 100%, rgba(${rgb},${a}), transparent)`
            );
          });
      }
      x += segW;
    });
    return layers.join(", ");
  }

  function clearWithAnimation() {
    if (clearing || !input.value) return;
    clearing = true;
    const keepFocus = document.activeElement === input;
    mirror.textContent = input.value.replace(/ /g, "\u00a0");

    const total = num("--clear-dur", 1000);
    const outDur = num("--clear-out-dur", 400);
    const inDur  = num("--clear-in-dur", 400);
    const outFly = num("--clear-out-fly", 12);
    const inFly  = num("--clear-in-fly", 12);
    const blur   = num("--clear-blur", 2);
    const delay  = num("--glow-delay", 50);
    const peakAt = num("--glow-peak-at", 0.15);
    const gOp    = num("--glow-opacity", 0.42);
    const easeOut = bezier(getComputedStyle(root).getPropertyValue("--clear-out-ease"));
    const easeIn  = bezier(getComputedStyle(root).getPropertyValue("--clear-in-ease"));

    input.value = "";
    wrap.classList.remove("has-value");
    wrap.classList.add("is-clearing");
    glow.style.background = buildGlow(mirror.textContent);
    glow.style.opacity = "0";
    phold.style.transform = `translateY(-${inFly}px)`;
    phold.style.opacity = "0.9";
    phold.style.filter = `blur(${blur}px)`;

    const t0 = performance.now();
    (function tick(now) {
      const el = now - t0;
      const eo = easeOut(Math.min(1, el / outDur));
      mirror.style.transform = `translateY(${(eo * outFly).toFixed(1)}px)`;
      mirror.style.opacity = (1 - eo).toFixed(3);
      mirror.style.filter = `blur(${(eo * blur).toFixed(1)}px)`;

      const ei = easeIn(Math.min(1, el / inDur));
      phold.style.transform = `translateY(${(-inFly + ei * inFly).toFixed(1)}px)`;
      phold.style.opacity = (0.9 + ei * 0.1).toFixed(3);
      phold.style.filter = `blur(${(blur - ei * blur).toFixed(1)}px)`;

      let g = 0;
      if (el > delay) {
        const gp = Math.min(1, (el - delay) / Math.max(1, total - delay));
        g = gp < peakAt ? gp / peakAt : 1 - (gp - peakAt) / (1 - peakAt);
      }
      glow.style.opacity = (g * gOp).toFixed(3);

      if (el < total) {
        requestAnimationFrame(tick);
      } else {
        wrap.classList.remove("is-clearing");
        [mirror, phold].forEach((el) => (el.style.cssText = ""));
        mirror.textContent = "";
        glow.style.opacity = "0";
        glow.style.background = "";
        clearing = false;
        if (keepFocus) requestAnimationFrame(() => input.focus({ preventScroll: true }));
      }
    })(performance.now());
  }

  const keep = (e) => { if (document.activeElement === input) e.preventDefault(); };
  btn.addEventListener("pointerdown", keep);
  btn.addEventListener("mousedown", keep);
  btn.addEventListener("click", clearWithAnimation);
  input.addEventListener("input", sync);
  sync();
});
```

### Dark mode

The glow uses `mix-blend-mode: multiply` in light mode. In dark mode flip to `screen`, bump `--glow-opacity` to ~0.85, and paint **white** gradients in JS — multiply over a dark surface vanishes.

