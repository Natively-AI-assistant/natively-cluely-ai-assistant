# Toggle

## When to use

On/off switches — settings rows, theme toggles, feature flags. The thumb travels across the track with a two-step overshoot (past the end, back, settle) while the track color cross-fades on its own clock.

Toggle `data-on` on the switch. Add `.is-init` on first interaction so the "off" keyframes don't animate on page load — without it every switch on the page plays its return bounce once at mount.

## HTML usage

```html
<button class="t-toggle" role="switch" data-on="false">
  <span class="t-toggle-thumb"></span>
</button>
```

Toggle `data-on`. Add `.is-init` on first interaction so the
"off" keyframes don't play on load. The thumb travels with a
double bounce (overshoot past the end, swing back, settle);
the track colour cross-fades on its own clock.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--toggle-dur` | `350ms` | sourced from `--p27-dur` |
| `--toggle-travel` | `14.66px` | sourced from `--p27-travel` |
| `--toggle-ov1` | `1px` | sourced from `--p27-ov1` |
| `--toggle-ov2` | `0px` | sourced from `--p27-ov2` |
| `--toggle-track` | `0ms` | sourced from `--p27-track-dur` |
| `--toggle-ease` | `cubic-bezier(0.34, 1.35, 0.64, 1)` | sourced from `--p27-ease` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --toggle-dur: 350ms;
  --toggle-travel: 14.66px;
  --toggle-ov1: 1px;
  --toggle-ov2: 0px;
  --toggle-track: 0ms;
  --toggle-ease: cubic-bezier(0.34, 1.35, 0.64, 1);
}
```

## CSS

```css
.t-toggle { transition: background var(--toggle-track) var(--toggle-ease); }
.t-toggle-thumb { translate: 0 0; will-change: translate; }
.t-toggle[data-on="true"] .t-toggle-thumb { translate: var(--toggle-travel) 0; }
.t-toggle.is-init[data-on="true"] .t-toggle-thumb { animation: t-toggle-on var(--toggle-dur) var(--toggle-ease) both; }
.t-toggle.is-init[data-on="false"] .t-toggle-thumb { animation: t-toggle-off var(--toggle-dur) var(--toggle-ease) both; }
@keyframes t-toggle-on {
  0% { translate: 0 0; }
  55% { translate: calc(var(--toggle-travel) + var(--toggle-ov1)) 0; }
  80% { translate: calc(var(--toggle-travel) - var(--toggle-ov2)) 0; }
  100% { translate: var(--toggle-travel) 0; }
}
@keyframes t-toggle-off {
  0% { translate: var(--toggle-travel) 0; }
  55% { translate: calc(0px - var(--toggle-ov1)) 0; }
  80% { translate: var(--toggle-ov2) 0; }
  100% { translate: 0 0; }
}

@media (prefers-reduced-motion: reduce) {
  .t-toggle-thumb { animation: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

None — pure CSS. Toggle the documented HTML attributes or class names from whatever already drives state in your app.

