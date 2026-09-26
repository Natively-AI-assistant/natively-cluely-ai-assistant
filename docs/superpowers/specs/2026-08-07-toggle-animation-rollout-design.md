# Toggle Animation Rollout — Design

Date: 2026-08-07
Owner: Natively renderer
Scope: renderer-only (macOS + Windows share the same renderer bundle)

## Goal

Apply the supplied Transitions.dev toggle animation to every toggle control in the renderer so the thumb always travels with a double-bounce and the track color cross-fades on its own clock, while preserving each control's existing size, color tokens, focus rings, and accessibility semantics.

The supplied CSS block is included verbatim (variables, keyframes, and the `prefers-reduced-motion` rule are unchanged).

## Scope

Every renderer-side toggle/switch control currently rendered in the app:

1. `AipSwitch` — `src/components/settings/AIProvidersSettings.tsx:992`. Also used by `ProviderCard.tsx:202` and `LocalWhisperModelPanel.tsx:536`.
2. Hand-rolled switches in `src/components/SettingsOverlay.tsx:1846, :1872, :2225`.
3. Phone Mirror switches in `src/components/settings/PhoneMirrorSettings.tsx:314, :447, :779`.
4. Profile Intelligence switch in `src/components/ProfileIntelligenceSettings.tsx:1593` (`.pi-toggle-track` / `.pi-toggle-thumb`).
5. Onboarding permission switch in `src/components/onboarding/PermissionsOnboardingFull.tsx:51`.

Out of scope:

- Star-rating radios in `ReviewModal.tsx` (not a toggle).
- Form checkboxes in renderer.
- Native menu items in `electron/` (native code, separate surface).

## Shared animation asset

Append the supplied CSS block to `src/index.css` unchanged:

```css
:root {
  --toggle-dur: 350ms;
  --toggle-travel: 14.66px;
  --toggle-ov1: 1px;
  --toggle-ov2: 0px;
  --toggle-track: 0ms;
  --toggle-ease: cubic-bezier(0.34, 1.35, 0.64, 1);
}

.t-toggle { transition: background var(--toggle-track) var(--toggle-ease); }
.t-toggle-thumb { translate: 0 0; will-change: translate; }
.t-toggle[data-on="true"] .t-toggle-thumb { translate: var(--toggle-travel) 0; }
.t-toggle.is-init[data-on="true"] .t-toggle-thumb { animation: t-toggle-on var(--toggle-dur) var(--toggle-ease) both; }
.t-toggle.is-init[data-on="false"] .t-toggle-thumb { animation: t-toggle-off var(--toggle-dur) var(--toggle-ease) both; }
@keyframes t-toggle-on { /* … verbatim … */ }
@keyframes t-toggle-off { /* … verbatim … */ }

@media (prefers-reduced-motion: reduce) {
  .t-toggle-thumb { animation: none !important; }
}
```

The block is appended near the bottom of `src/index.css`, after the existing `.pi-*` and `.aip-*` rules, so it can be removed in isolation if needed.

### Per-control travel override

Two sizes exist in the app:

- 34×20 `AipSwitch`: keep travel `14.66px` (matches current `translateX(14px)`).
- 44×24/26 controls (Phone Mirror, Settings Overlay, Profile Intelligence, Onboarding): override travel to `20px` via a `.t-toggle-lg` modifier that sets `--toggle-travel: 20px`.

```css
.t-toggle.t-toggle-lg { --toggle-travel: 20px; }
```

The keyframes read `--toggle-travel` through `calc()`, so swapping the variable changes travel without editing the keyframes.

### Per-control track fade

`.t-toggle { transition: background … }` already cross-fades the track on the same easing when `--toggle-track` is `0ms`. For panels that already cross-fade on a custom clock, set `--toggle-track` on the element (e.g. `--toggle-track: 220ms`) instead of relying on the global transition.

## Component migration

### New shared primitive: `src/components/controls/TToggle.tsx`

Thin wrapper that renders a `<button role="switch">` with a `.t-toggle-thumb` child. Props:

| Prop           | Type                                | Notes                                                              |
| -------------- | ----------------------------------- | ------------------------------------------------------------------ |
| `checked`      | `boolean`                           | Drives `aria-checked` and `data-on`.                               |
| `onChange`     | `(next: boolean) => void`           | Called with `!checked` on click/Space/Enter.                       |
| `label`        | `string?`                           | Forwarded to `aria-label`.                                         |
| `title`        | `string?`                           | Forwarded to `title`.                                              |
| `disabled`     | `boolean?`                          | Visual + ARIA disabled; click no-op.                               |
| `hardDisabled` | `boolean?`                          | Adds native `disabled` for native form behavior.                   |
| `size`         | `'sm' \| 'lg'`                      | `'sm'` (default) = 14.66 travel; `'lg'` = `.t-toggle-lg` modifier. |
| `className`    | `string?`                           | Extra classes merged onto the button.                              |

Internal state: a `useRef<boolean>` flips to `true` on the first `pointerdown` or `keydown`; the corresponding handler adds `.is-init` to the button. The first user interaction enables keyframes; on load the thumb sits at the data-on position without playing the off-load animation.

Accessibility:

- `role="switch"`, `aria-checked={checked}`, `aria-disabled` when disabled, `aria-label` from `label`.
- Keyboard activation via native `<button>` (Space, Enter).
- Honors `prefers-reduced-motion` automatically through the global media query.

### Migration map

| Consumer                                                           | Action                                                                                          |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `src/components/settings/AIProvidersSettings.tsx:992` (`AipSwitch`) | Replace body with `<TToggle size="sm" …/>`; keep class hook (`.aip-switch`) for color tokens.   |
| `src/components/settings/ProviderCard.tsx:202`                     | Uses `AipSwitch`; no direct change beyond the `AipSwitch` rewrite.                             |
| `src/components/LocalWhisperModelPanel.tsx:536`                    | Uses `AipSwitch`; no direct change beyond the `AipSwitch` rewrite.                             |
| `src/components/SettingsOverlay.tsx:1846, :1872, :2225`            | Replace each hand-rolled `<div role="switch">…` block with `<TToggle size="lg" …/>`.           |
| `src/components/settings/PhoneMirrorSettings.tsx:314, :447, :779`  | Replace inner `<button role="switch">…<span>` with `<TToggle size="lg" …/>`. Drop translate-x / w-5 classes. |
| `src/components/ProfileIntelligenceSettings.tsx:1593`              | Replace `.pi-toggle-track` + `.pi-toggle-thumb` markup with `<TToggle size="lg" …/>`. Delete `.pi-toggle-track` / `.pi-toggle-thumb` rules (handled by `TToggle` styles). |
| `src/components/onboarding/PermissionsOnboardingFull.tsx:51`       | Replace the `ToggleSwitch` local component body with `<TToggle size="lg" …/>`. Drop `motion.div layout`, `useReducedMotion`, the spring `transition`, and the inline-style shadow. |

### Removed styles

- `src/components/ProfileIntelligenceSettings.tsx`: `.pi-toggle-track`, `.pi-toggle-thumb`, `[data-checked='true']`, `[data-disabled='true']` selectors. The 18/22px thumb was inside `.pi-toggle-card` and is now owned by `TToggle`.
- `src/components/onboarding/PermissionsOnboardingFull.tsx`: the inline shadow, glow, and Framer Motion transition block on the thumb.

### Untouched

- Track color tokens: `var(--aip-switch-off)`, `var(--aip-accent)`, `bg-bg-toggle-switch`, `bg-bg-item-active`, `bg-accent-primary`, `bg-amber-500`, `var(--pi-accent)`, `COLORS.iosGreen`. The migration keeps these classes on `TToggle` via `className`.
- Focus rings: `focus:ring-2 focus:ring-accent-focus` are forwarded through `className`.

## Files changed

New:

- `src/components/controls/TToggle.tsx`
- `src/components/controls/__tests__/TToggle.test.tsx`

Modified:

- `src/index.css` (append the supplied CSS block + `.t-toggle-lg` rule)
- `src/components/settings/AIProvidersSettings.tsx`
- `src/components/settings/ProviderCard.tsx`
- `src/components/settings/PhoneMirrorSettings.tsx`
- `src/components/LocalWhisperModelPanel.tsx`
- `src/components/SettingsOverlay.tsx`
- `src/components/ProfileIntelligenceSettings.tsx`
- `src/components/onboarding/PermissionsOnboardingFull.tsx`

## Cross-platform

Renderer-only. Both macOS and Windows load the same renderer bundle and CSS. No native code, IPC, Electron window, `process.platform` switch, or `electron/` source is touched. The animation does not depend on display compositor behavior beyond standard CSS keyframes, which Chromium handles identically on both platforms.

## Validation

- Existing test suites must remain green. Run vitest + RTL suites and the existing Electron test runner (`ELECTRON_RUN_AS_NODE=1 electron --test`) before considering this work complete.
- New RTL tests in `src/components/controls/__tests__/TToggle.test.tsx`:
  - Renders `role="switch"` and reflects `aria-checked` from the `checked` prop.
  - Click toggles `aria-checked` and calls `onChange(!checked)`.
  - Space and Enter keys toggle.
  - `disabled` swallows click and skips `onChange`.
  - `is-init` class is added on the first `pointerdown` (not on mount).
  - `size="lg"` adds `.t-toggle-lg`.
- Manual verification in dev mode:
  - Toggle each migrated control and confirm the bounce plays once.
  - Confirm disabled controls freeze and ignore clicks.
  - Confirm the animation is silenced under `prefers-reduced-motion: reduce`.
- Document explicitly:
  - **Not physically tested on Windows** for this renderer-only animation.
  - **Not covered by automated Windows-only tests** since CSS keyframes are OS-independent; per the project's prior rule for renderer-only changes, this is acceptable when the change has no `process.platform` branch.

## Out-of-scope risks

- Star rating buttons in `ReviewModal.tsx` use `role="radio"` and a different interaction model; intentionally excluded.
- If the animation block is later removed from `src/index.css` without removing the migrated consumers, every migrated control will fall back to a static thumb. A quick smoke test ("toggle still moves at all") catches this.
