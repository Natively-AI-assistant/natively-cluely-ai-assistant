# Like button

## When to use

Like / favorite / heart buttons — anywhere a single tap flips a boolean and deserves a tiny celebration. The heart's stroke fills with color, the icon pops with an overshoot scale, and eight tiny particles sprinkle outward before fading.

Toggle `data-liked` on the button. Unliking reverses the fill without the particles — the celebration only plays on the way in.

## HTML usage

```html
<button class="t-like" data-liked="false">
  <span class="t-like-icon"><svg class="t-like-heart">…</svg></span>
  <span class="t-like-particles"><i></i>…8 total…<i></i></span>
  Like
</button>
```

Toggle `data-liked` to fill the heart + spring-pop it. Add
`.is-bursting` (then remove it after the particle duration)
to fire the burst; set each dot's --px/--py/--pdur/--pdelay/
--p-end-scale/--psize in JS per like for an organic spray.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--like-color` | `#f40051` | sourced from `--p23-color` |
| `--like-fill` | `150ms` | sourced from `--p23-fill-dur` |
| `--like-pop` | `350ms` | sourced from `--p23-pop-dur` |
| `--like-pop-ease` | `cubic-bezier(0.34, 1.96, 0.64, 1)` | sourced from `--p23-pop-ease` |
| `--like-particle-dur` | `600ms` | sourced from `--p23-particle-dur` |
| `--like-particle-dist` | `20px` | sourced from `--p23-particle-dist` |
| `--like-particle-size` | `2.5px` | sourced from `--p23-particle-size` |
| `--like-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p23-ease` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --like-color: #f40051;
  --like-fill: 150ms;
  --like-pop: 350ms;
  --like-pop-ease: cubic-bezier(0.34, 1.96, 0.64, 1);
  --like-particle-dur: 600ms;
  --like-particle-dist: 20px;
  --like-particle-size: 2.5px;
  --like-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
```

## CSS

```css
.t-like-heart { color: currentColor; transition: color var(--like-fill) var(--like-ease); }
.t-like-heart path {
  fill: transparent; stroke: currentColor;
  transition: fill var(--like-fill) var(--like-ease), stroke var(--like-fill) var(--like-ease);
}
.t-like[data-liked="true"] .t-like-heart { color: var(--like-color); }
.t-like[data-liked="true"] .t-like-heart path { fill: currentColor; }
/* Pop scale lives on an HTML wrapper, never the <svg> itself:
   transforming an inline SVG makes Chromium rasterise it at 1×
   (pixelated on hi-DPI). Wrapping keeps the vector crisp. */
.t-like[data-liked="true"] .t-like-icon { animation: t-like-pop var(--like-pop) var(--like-pop-ease); }
@keyframes t-like-pop { 0% { transform: scale(1); } 30% { transform: scale(0.82); } 100% { transform: scale(1); } }

/* Particle burst — 8 dots flung along per-particle vectors. */
.t-like-particles { position: absolute; left: 50%; top: 50%; width: 0; height: 0; pointer-events: none; color: var(--like-color); }
.t-like-particles i {
  position: absolute;
  left: calc(var(--like-particle-size) * var(--psize, 1) / -2);
  top: calc(var(--like-particle-size) * var(--psize, 1) / -2);
  width: calc(var(--like-particle-size) * var(--psize, 1));
  height: calc(var(--like-particle-size) * var(--psize, 1));
  border-radius: 50%; background: currentColor; opacity: 0;
}
@keyframes t-like-burst {
  0%   { opacity: 0; transform: translate(0, 0) scale(0.4); }
  20%  { opacity: 1; transform: translate(calc(var(--px) * 0.25), calc(var(--py) * 0.25)) scale(1); }
  100% { opacity: 0; transform: translate(var(--px), var(--py)) scale(var(--p-end-scale, 0.6)); }
}
.t-like.is-bursting .t-like-particles i {
  animation: t-like-burst var(--pdur, var(--like-particle-dur)) ease-out var(--pdelay, 0ms) forwards;
}

@media (prefers-reduced-motion: reduce) {
  .t-like-icon, .t-like-particles i { animation: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

None — pure CSS. Toggle the documented HTML attributes or class names from whatever already drives state in your app.

