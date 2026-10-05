# Spinning counter

## When to use

Numbers that change with fanfare — points, prices, follower counts, dashboards KPIs. Each digit is a clipped vertical reel of 0-9 cells; the strip translates up through several full spins before landing on the target digit, with a per-column stagger and a vertical-only SVG blur while moving.

Reach for this over **number pop-in** when the change should feel like an event (a jackpot roll) rather than a quiet update. The reels are built in JS — one `.t-reel-col` per digit — so bring the small builder snippet from the recipe.

## HTML usage

```html
<div class="t-reel"></div>  <!-- reels built in JS -->
```

Build one .t-reel-col per digit, each clipping a strip
(.t-reel-strip) of 0-9 cells; translate the strip up by
(spins*10 + digit) cells to spin then land. A directional
(vertical-only) SVG feGaussianBlur stdDeviation="0 Y" gives
the motion streak (CSS blur() would smear sideways); decay it
to 0 per column as each reel settles.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--reel-dur` | `1400ms` | sourced from `--p26-dur` |
| `--reel-cell` | `30px` | sourced from `--p26-cell` |
| `--reel-spin-blur` | `3px` | sourced from `--p26-spin-blur` |
| `--reel-stagger` | `90ms` | sourced from `--p26-stagger` |
| `--reel-ease` | `cubic-bezier(0.16, 1, 0.3, 1)` | sourced from `--p26-ease` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --reel-dur: 1400ms;
  --reel-cell: 30px;
  --reel-spin-blur: 3px;
  --reel-stagger: 90ms;
  --reel-ease: cubic-bezier(0.16, 1, 0.3, 1);
}
```

## CSS

```css
.t-reel { display: inline-flex; align-items: center; height: var(--reel-cell); font-variant-numeric: tabular-nums; }
.t-reel-col {
  position: relative; height: var(--reel-cell); overflow: hidden;
  /* Soft-fade the window edges instead of hard-cropping. */
  -webkit-mask-image: linear-gradient(to bottom, transparent 0%, #000 22%, #000 78%, transparent 100%);
  mask-image: linear-gradient(to bottom, transparent 0%, #000 22%, #000 78%, transparent 100%);
}
.t-reel-strip { display: flex; flex-direction: column; will-change: transform, filter; }
.t-reel-digit { height: var(--reel-cell); display: flex; align-items: center; justify-content: center; }
/* JS drives the tween: strip.style.transition =
     'transform var(--reel-dur) var(--reel-ease) ' + (col*var(--reel-stagger)) + 'ms';
   and decays each column's feGaussianBlur stdDeviation from
   var(--reel-spin-blur) to 0 over its own window. */

@media (prefers-reduced-motion: reduce) {
  .t-reel-strip { transition: none !important; filter: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

None — pure CSS. Toggle the documented HTML attributes or class names from whatever already drives state in your app.

