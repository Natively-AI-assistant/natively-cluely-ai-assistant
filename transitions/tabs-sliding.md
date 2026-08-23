# Tabs sliding

## When to use

A segmented control / tab bar where the active pill slides between options — view switchers, filter segments, small mutually-exclusive button sets. JS writes the active tab's `offsetLeft` / `offsetWidth` onto the pill; CSS owns the tween.

## HTML usage

```html
<div class="t-tabs" role="tablist">
  <span class="t-tabs-pill" aria-hidden="true"></span>
  <button class="t-tab" role="tab" aria-selected="true">Plan</button>
  <button class="t-tab" role="tab" aria-selected="false">Debug</button>
  <button class="t-tab" role="tab" aria-selected="false">Ask</button>
</div>
```

Wire-up:
  On click, flip aria-selected on each tab and write the
  active tab's offsetLeft / offsetWidth onto the pill:
    pill.style.transform = `translateX(${tab.offsetLeft}px)`;
    pill.style.width     = `${tab.offsetWidth}px`;
  On first paint and resize, write the same values WITHOUT
  a transition (suspend with `transition: none`, force a
  reflow, restore) so the pill snaps to position before any
  animation can run.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--tabs-dur` | `250ms` | sourced from `--p16-dur` |
| `--tabs-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p16-ease` |
| `--tabs-text-muted` | `rgba(15, 15, 15, 0.8)` | sourced from `--p16-text-muted` |
| `--tabs-text-active` | `#0f0f0f` | sourced from `--p16-text-active` |
| `--tabs-bar-bg` | `#f1f1f1` | sourced from `--p16-bar-bg` |
| `--tabs-pill-bg` | `#ffffff` | sourced from `--p16-pill-bg` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --tabs-dur: 250ms;
  --tabs-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --tabs-text-muted: rgba(15, 15, 15, 0.8);
  --tabs-text-active: #0f0f0f;
  --tabs-bar-bg: #f1f1f1;
  --tabs-pill-bg: #ffffff;
}
```

## CSS

```css
/* The bar is just a flex container with padding for the pill
   to sit inside. Tabs sit on z-index: 1, the pill on z-index: 0,
   so labels read above the pill background. */
.t-tabs {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px;
  border-radius: 48px;
  background: var(--tabs-bar-bg);
}
.t-tab {
  position: relative;
  appearance: none;
  border: 0;
  background: transparent;
  height: 30px;
  padding: 4px 12px;
  color: var(--tabs-text-muted);
  cursor: pointer;
  border-radius: 48px;
  z-index: 1;
  transition: color var(--tabs-dur) var(--tabs-ease);
}
.t-tab:not([aria-selected="true"]):hover,
.t-tab[aria-selected="true"] {
  color: var(--tabs-text-active);
}

/* The pill: width + transform are written inline by JS so
   the transition tweens between the previous and next
   measured positions. */
.t-tabs-pill {
  position: absolute;
  top: 3px;
  left: 0;
  height: 30px;
  width: 0;
  background: var(--tabs-pill-bg);
  border-radius: 48px;
  transform: translateX(0);
  transition:
    transform var(--tabs-dur) var(--tabs-ease),
    width     var(--tabs-dur) var(--tabs-ease);
  will-change: transform, width;
  z-index: 0;
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .t-tabs-pill, .t-tab { transition: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

```js
const bar = document.querySelector(".t-tabs");
const pill = bar.querySelector(".t-tabs-pill");
const tabs = [...bar.querySelectorAll(".t-tab")];

function moveTo(tab, animate) {
  if (!animate) {
    const prev = pill.style.transition;
    pill.style.transition = "none";
    pill.style.transform = `translateX(${tab.offsetLeft}px)`;
    pill.style.width = `${tab.offsetWidth}px`;
    void pill.offsetWidth;
    pill.style.transition = prev;
  } else {
    pill.style.transform = `translateX(${tab.offsetLeft}px)`;
    pill.style.width = `${tab.offsetWidth}px`;
  }
}
const active = () =>
  tabs.find((t) => t.getAttribute("aria-selected") === "true") || tabs[0];

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) =>
      t.setAttribute("aria-selected", t === tab ? "true" : "false")
    );
    moveTo(tab, true);
  });
});
requestAnimationFrame(() => moveTo(active(), false));
window.addEventListener("resize", () => moveTo(active(), false));
```

