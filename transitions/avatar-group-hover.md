# Avatar group hover

## When to use

Hovering an item in a horizontal stack (avatar row, chip group, badge cluster, segmented button) should lift the hovered item, gently lift its neighbors with a power-falloff, then snap everything back with an overshoot spring on `mouseleave`. Direction-aware easing (clean ease-in on hover, bouncy ease-out on return) is what gives the group its springy, physical feel.

Equally good for: pill stacks in a tag editor, chips in a filter bar, reaction-emoji rows, anywhere a horizontal row benefits from a "comb" interaction signal.

## HTML usage

```html
<!-- Apply .t-avatar to each item in your group (avatar,
     chip, badge, button — anything). Bring your own size,
     shape, and stacking; this stylesheet only owns the
     hover transform + transition. -->
<div class="t-avatar-group">
  <div class="t-avatar"><!-- your item --></div>
  <div class="t-avatar"><!-- your item --></div>
  <!-- … -->
</div>
```

Wire-up (vanilla JS):
  On `mouseenter` of any .t-avatar, walk every sibling and
  set inline:
    el.style.setProperty('--shift',
      (lift * Math.pow(falloff, distance)).toFixed(3) + 'px');
    el.style.setProperty('--scale-active',
      i === activeIdx ? scale : 1);
  Set transition-timing-function inline BEFORE the
  variable writes — use --avatar-ease-in on hover-in and
  --avatar-ease-out on the root's `mouseleave` (resets
  --shift to 0 and --scale-active to 1).

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--avatar-lift` | `-4px` | sourced from `--p11-lift` |
| `--avatar-dur` | `320ms` | sourced from `--p11-dur` |
| `--avatar-scale` | `1.05` | sourced from `--p11-scale` |
| `--avatar-falloff` | `0.45` | sourced from `--p11-falloff` |
| `--avatar-ease-in` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p11-ease-in` |
| `--avatar-ease-out` | `cubic-bezier(0.34, 3.85, 0.64, 1)` | sourced from `--p11-ease-out` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --avatar-lift: -4px;
  --avatar-dur: 320ms;
  --avatar-scale: 1.05;
  --avatar-falloff: 0.45;
  --avatar-ease-in: cubic-bezier(0.22, 1, 0.36, 1);
  --avatar-ease-out: cubic-bezier(0.34, 3.85, 0.64, 1);
}
```

## CSS

```css
/* Hover-spring transition only — bring your own avatar/chip
   styling (size, shape, border, stacking, background). */
.t-avatar {
  transform-origin: center;
  /* translateY before scale so scale doesn't amplify the lift offset. */
  transform:
    translateY(var(--shift, 0px))
    scale(var(--scale-active, 1));
  transition: transform var(--avatar-dur) var(--avatar-ease-in);
  will-change: transform;
}

@media (prefers-reduced-motion: reduce) {
  .t-avatar { transition: none !important; transform: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

```js
// Distance-falloff lift with direction-aware easing. The trick
// is setting transition-timing-function inline BEFORE writing the
// CSS variables — the browser uses whatever timing-function is
// current at the moment a transitionable property changes, so this
// gives us ease-in on the way up and a bouncy spring on the return
// without two separate transition declarations.
const root = document.querySelector(".t-avatar-group");
const avatars = Array.from(root.querySelectorAll(".t-avatar"));
const cs = getComputedStyle(document.documentElement);
const num = (name, fb) => {
  const v = parseFloat(cs.getPropertyValue(name));
  return Number.isFinite(v) ? v : fb;
};
const ease = (name, fb) =>
  cs.getPropertyValue(name).trim() || fb;

function setShifts(activeIdx, phase) {
  const lift    = num("--avatar-lift", -4);
  const falloff = num("--avatar-falloff", 0.45);
  const scale   = num("--avatar-scale", 1.05);
  const tf      = phase === "out"
    ? ease("--avatar-ease-out", "cubic-bezier(0.34, 3.85, 0.64, 1)")
    : ease("--avatar-ease-in",  "cubic-bezier(0.22, 1, 0.36, 1)");

  avatars.forEach((el, i) => {
    el.style.transitionTimingFunction = tf;
    if (activeIdx == null) {
      el.style.setProperty("--shift", "0px");
      el.style.setProperty("--scale-active", "1");
      return;
    }
    const d = Math.abs(i - activeIdx);
    el.style.setProperty(
      "--shift",
      (lift * Math.pow(falloff, d)).toFixed(3) + "px"
    );
    el.style.setProperty(
      "--scale-active",
      i === activeIdx ? String(scale) : "1"
    );
  });
}

avatars.forEach((el, i) => {
  el.addEventListener("mouseenter", () => setShifts(i, "in"));
});
root.addEventListener("mouseleave", () => setShifts(null, "out"));
```

### React form

```jsx
import { useRef } from "react";

// `items` is any list of React nodes (avatars, chips, badges, …)
// — this hook only owns the hover-spring transition. Each item is
// wrapped in a .t-avatar so it picks up the transform/transition
// rules from CSS.
export function AvatarGroup({ items }) {
  const rootRef = useRef(null);

  const setShifts = (activeIdx, phase) => {
    if (!rootRef.current) return;
    const cs = getComputedStyle(document.documentElement);
    const num = (name, fb) => {
      const v = parseFloat(cs.getPropertyValue(name));
      return Number.isFinite(v) ? v : fb;
    };
    const ease = (name, fb) =>
      cs.getPropertyValue(name).trim() || fb;

    const lift    = num("--avatar-lift", -4);
    const falloff = num("--avatar-falloff", 0.45);
    const scale   = num("--avatar-scale", 1.05);
    const tf      = phase === "out"
      ? ease("--avatar-ease-out", "cubic-bezier(0.34, 3.85, 0.64, 1)")
      : ease("--avatar-ease-in",  "cubic-bezier(0.22, 1, 0.36, 1)");

    rootRef.current.querySelectorAll(".t-avatar").forEach((el, i) => {
      el.style.transitionTimingFunction = tf;
      if (activeIdx == null) {
        el.style.setProperty("--shift", "0px");
        el.style.setProperty("--scale-active", "1");
        return;
      }
      const d = Math.abs(i - activeIdx);
      el.style.setProperty(
        "--shift",
        (lift * Math.pow(falloff, d)).toFixed(3) + "px"
      );
      el.style.setProperty(
        "--scale-active",
        i === activeIdx ? String(scale) : "1"
      );
    });
  };

  return (
    <div ref={rootRef} onMouseLeave={() => setShifts(null, "out")}>
      {items.map((node, i) => (
        <div
          key={i}
          className="t-avatar"
          onMouseEnter={() => setShifts(i, "in")}
        >
          {node}
        </div>
      ))}
    </div>
  );
}
```

### Why the timing-function is set inline before the variable writes

Both the lift (hover-in) and the return (mouseleave) animate the same property — `transform`. If we declared one fixed `transition-timing-function` in CSS, both directions would share it. Setting it inline immediately before mutating `--shift` / `--scale-active` means each new transition picks up the timing-function that was current at the moment the property changed, giving us a clean curve on the way up and a bouncy overshoot on the way back without a second `.is-leaving` class.

