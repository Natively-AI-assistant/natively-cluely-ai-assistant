# Menu dropdown

## When to use

Contextual menus, dropdowns, popovers — anything that opens from a trigger and should visually grow from that trigger's position. Origin-aware via `data-origin` (top-left, top-center, top-right, bottom-*).

## HTML usage

```html
<div class="t-dropdown" data-origin="top-center">
  <!-- your menu contents -->
</div>
```

State:
  - Add `.is-open` to show.
  - On close, swap `.is-open` for `.is-closing`, then remove
    `.is-closing` after --dropdown-close-dur.

data-origin values: top-left | top-center | top-right |
                    bottom-left | bottom-center | bottom-right.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--dropdown-open-dur` | `250ms` | sourced from `--p2-open-dur` |
| `--dropdown-close-dur` | `150ms` | sourced from `--p2-close-dur` |
| `--dropdown-pre-scale` | `0.97` | sourced from `--p2-pre-scale` |
| `--dropdown-closing-scale` | `0.99` | sourced from `--p2-closing-scale` |
| `--dropdown-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p2-ease` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --dropdown-open-dur: 250ms;
  --dropdown-close-dur: 150ms;
  --dropdown-pre-scale: 0.97;
  --dropdown-closing-scale: 0.99;
  --dropdown-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
```

## CSS

```css
.t-dropdown {
  transform-origin: top left;
  transform: scale(var(--dropdown-pre-scale));
  opacity: 0;
  pointer-events: none;
  transition:
    transform var(--dropdown-open-dur) var(--dropdown-ease),
    opacity   var(--dropdown-open-dur) var(--dropdown-ease);
  will-change: transform, opacity;
}
.t-dropdown[data-origin="top-right"]     { transform-origin: top right; }
.t-dropdown[data-origin="top-center"]    { transform-origin: top center; }
.t-dropdown[data-origin="bottom-left"]   { transform-origin: bottom left; }
.t-dropdown[data-origin="bottom-center"] { transform-origin: bottom center; }
.t-dropdown[data-origin="bottom-right"]  { transform-origin: bottom right; }

.t-dropdown.is-open {
  transform: scale(1);
  opacity: 1;
  pointer-events: auto;
}
.t-dropdown.is-closing {
  transform: scale(var(--dropdown-closing-scale));
  opacity: 0;
  pointer-events: none;
  transition:
    transform var(--dropdown-close-dur) var(--dropdown-ease),
    opacity   var(--dropdown-close-dur) var(--dropdown-ease);
}

@media (prefers-reduced-motion: reduce) {
  .t-dropdown { transition: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

```js
// Toggle .is-open / .is-closing with a setTimeout cleanup so the closing
// scale animates before the element resets to its pre-open rest state.
const dropdown = document.querySelector(".t-dropdown");
const closeMs = parseFloat(
  getComputedStyle(document.documentElement).getPropertyValue("--dropdown-close-dur")
) || 150;

function openDropdown() {
  dropdown.classList.remove("is-closing");
  dropdown.classList.add("is-open");
}
function closeDropdown() {
  dropdown.classList.remove("is-open");
  dropdown.classList.add("is-closing");
  setTimeout(() => dropdown.classList.remove("is-closing"), closeMs);
}
```

