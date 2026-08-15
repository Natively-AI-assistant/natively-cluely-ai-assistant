# Notification badge

## When to use

A small badge appearing on top of a trigger (bell, inbox, button). Slides in diagonally and pops the dot independently of the trigger so the trigger itself never moves.

## HTML usage

```html
<!-- Place .t-badge inside your trigger (bell icon, button, etc.). -->
<!-- The trigger must be position: relative so .t-badge can anchor to it. -->
<button class="your-trigger" style="position: relative">
  <!-- your icon / trigger contents -->
  <span class="t-badge" data-open="false">
    <span class="t-badge-dot">1</span>
  </span>
</button>
```

State: toggle data-open="true" / "false" on .t-badge.
Only the badge slides + pops — the trigger itself stays put.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--badge-slide-dur` | `260ms` | sourced from `--p1-pos-open-dur` |
| `--badge-pop-dur` | `500ms` | sourced from `--p1-scale-open-dur` |
| `--badge-pop-close-dur` | `180ms` | sourced from `--p1-scale-close-dur` |
| `--badge-fade-dur` | `400ms` | sourced from `--p1-opacity-open-dur` |
| `--badge-fade-close-dur` | `180ms` | sourced from `--p1-opacity-close-dur` |
| `--badge-blur` | `2px` | sourced from `--p1-blur` |
| `--badge-offset-x` | `-8.2px` | sourced from `--p1-distance-x` |
| `--badge-offset-y` | `12.4px` | sourced from `--p1-distance-y` |
| `--badge-slide-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p1-ease-pos-open` |
| `--badge-pop-ease` | `cubic-bezier(0.34, 1.36, 0.64, 1)` | sourced from `--p1-ease-scale-open` |
| `--badge-close-ease` | `cubic-bezier(0.4, 0, 0.2, 1)` | sourced from `--p1-ease-close` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --badge-slide-dur: 260ms;
  --badge-pop-dur: 500ms;
  --badge-pop-close-dur: 180ms;
  --badge-fade-dur: 400ms;
  --badge-fade-close-dur: 180ms;
  --badge-blur: 2px;
  --badge-offset-x: -8.2px;
  --badge-offset-y: 12.4px;
  --badge-slide-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --badge-pop-ease: cubic-bezier(0.34, 1.36, 0.64, 1);
  --badge-close-ease: cubic-bezier(0.4, 0, 0.2, 1);
}
```

## CSS

```css
@keyframes t-badge-slide-in {
  from { transform: translate(var(--badge-offset-x), var(--badge-offset-y)); }
  to   { transform: translate(0, 0); }
}

/* .t-badge is the absolutely-positioned wrapper for the dot.
   Adjust top/right (or left/bottom) to anchor it on your trigger. */
.t-badge {
  position: absolute;
  top: -6px;
  right: -8px;
  pointer-events: none;
  will-change: transform;
}
.t-badge[data-open="true"] {
  animation: t-badge-slide-in var(--badge-slide-dur) var(--badge-slide-ease);
}

.t-badge-dot {
  display: block;
  transform-origin: center;
  transform: scale(1);
  opacity: 1;
  filter: blur(0);
  transition:
    transform var(--badge-pop-dur)  var(--badge-pop-ease),
    opacity   var(--badge-fade-dur) var(--badge-pop-ease),
    filter    var(--badge-pop-dur)  var(--badge-pop-ease);
  will-change: transform, opacity, filter;
}
.t-badge[data-open="false"] .t-badge-dot {
  transform: scale(0);
  opacity: 0;
  filter: blur(var(--badge-blur));
  transition:
    transform var(--badge-pop-close-dur)  var(--badge-close-ease),
    opacity   var(--badge-fade-close-dur) var(--badge-close-ease),
    filter    var(--badge-pop-close-dur)  var(--badge-close-ease);
}

@media (prefers-reduced-motion: reduce) {
  .t-badge, .t-badge-dot { animation: none !important; transition: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

None — pure CSS. Toggle the documented HTML attributes or class names from whatever already drives state in your app.

