# Accordion expand

## When to use

A disclosure / accordion / collapsible section whose panel grows and shrinks in height when toggled, with the header chevron flipping between a downward "v" and an upward "^". Use for settings groups, FAQs, filter sections, "show more" details — any header + collapsible body.

Height animates via `grid-template-rows: 0fr ↔ 1fr`, so there's **no JS height measuring** and content of any size animates cleanly. The chevron flips vertically (`scaleY`) from a "v" to a "^", passing through a flat line at the midpoint.

## HTML usage

```html
<div class="t-acc" data-open="false">
  <button class="t-acc-head" aria-expanded="false">
    Title
    <span class="t-acc-chevron">
      <svg viewBox="0 0 16 16"><path d="M4 6.5L8 10.5L12 6.5"/></svg>
    </span>
  </button>
  <div class="t-acc-panel"><div class="t-acc-panel-inner"> … </div></div>
</div>
```

Toggle `data-open` on the item. The panel animates via
grid-template-rows 0fr ↔ 1fr (no JS height measuring) and
the chevron flips vertically (scaleY) from a "v" to a "^".

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--acc-expand` | `250ms` | sourced from `--p21-expand-dur` |
| `--acc-collapse` | `250ms` | sourced from `--p21-collapse-dur` |
| `--acc-chevron` | `250ms` | sourced from `--p21-chevron-dur` |
| `--acc-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p21-ease` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --acc-expand: 250ms;
  --acc-collapse: 250ms;
  --acc-chevron: 250ms;
  --acc-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
```

## CSS

```css
/* grid-template-rows 0fr → 1fr gives a clean height animation
   with no JS measurement; the inner element clips overflow. */
.t-acc-panel {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--acc-collapse) var(--acc-ease);
}
.t-acc[data-open="true"] .t-acc-panel {
  grid-template-rows: 1fr;
  transition: grid-template-rows var(--acc-expand) var(--acc-ease);
}
.t-acc-panel-inner {
  overflow: hidden;
  opacity: 0;
  filter: blur(2px);
  transition:
    opacity var(--acc-collapse) var(--acc-ease),
    filter var(--acc-collapse) var(--acc-ease);
}
.t-acc[data-open="true"] .t-acc-panel-inner {
  opacity: 1;
  filter: blur(0);
  transition:
    opacity var(--acc-expand) var(--acc-ease),
    filter var(--acc-expand) var(--acc-ease);
}
/* Flip the chevron vertically to turn the "v" into a "^".
   scaleY(-1) about the centre passes through a flat line at
   the midpoint (same look as a `d:` path morph) but animates
   in every browser, unlike CSS `d:` morphing (Chromium only).
   The chevron path is symmetric about the 16x16 viewBox
   centre, so the flip lands exactly on the "^"; non-scaling
   -stroke keeps the stroke width constant through the flip. */
.t-acc-chevron {
  display: inline-flex;
  transform: scaleY(1);
  transform-origin: center;
  transition: transform var(--acc-chevron) var(--acc-ease);
}
.t-acc-chevron path { vector-effect: non-scaling-stroke; }
.t-acc[data-open="true"] .t-acc-chevron {
  transform: scaleY(-1);
}

@media (prefers-reduced-motion: reduce) {
  .t-acc-panel, .t-acc-panel-inner, .t-acc-chevron {
    transition: none !important;
  }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

```js
// Toggle data-open on the item; CSS owns the height + chevron morph.
const acc = document.querySelector(".t-acc");
const head = acc.querySelector(".t-acc-head");

head.addEventListener("click", () => {
  const open = acc.getAttribute("data-open") === "true";
  acc.setAttribute("data-open", String(!open));
  head.setAttribute("aria-expanded", String(!open));
});
```

### Two-element panel + padding placement

The panel needs the two-element structure (`.t-acc-panel` grid track + `.t-acc-panel-inner` with `overflow: hidden`). The `0fr → 1fr` track can only collapse a child that clips its own overflow. Keep padding on `.t-acc-panel-inner`, never on `.t-acc-panel` — padding on the `0fr` track leaves a residual height strip so the panel never fully closes.

### Why the chevron flips instead of morphing its path

The natural way to turn the "v" into a "^" is to morph the chevron's SVG `d` between two vertex sets — but CSS `d:` path interpolation is **Chromium-only**, so on mobile Safari and Firefox it snaps (or doesn't move at all). A vertical flip (`transform: scaleY(-1)`) reproduces the same motion — it passes through a flat horizontal line at the midpoint, exactly like the path morph — and animates in every browser. Two requirements make it land cleanly: the chevron path must be **symmetric about the centre of its viewBox** (so the flip maps the "v" onto the "^"), and the path needs `vector-effect: non-scaling-stroke` so the stroke width stays constant while the box is squashed mid-flip.

