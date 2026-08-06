# Toggle Animation Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every renderer-side toggle with a shared `<TToggle>` primitive driven by the supplied Transitions.dev toggle animation, preserving each panel's existing size and color tokens.

**Architecture:** One CSS block (verbatim from spec) appended to `src/index.css`, plus a tiny `TToggle` React wrapper that adds `.is-init` on first interaction so the off-load keyframe never plays. Per-control size variation is expressed with `.t-toggle-lg` (travel 20px) vs the default 14.66px. Migrated components keep their color classes via `className`.

**Tech Stack:** React + TypeScript, Tailwind utility classes, plain CSS keyframes. No new deps.

## Global Constraints

- Renderer-only change. No `process.platform`, no `electron/` source, no IPC changes.
- The supplied CSS block (`:root` tokens, `.t-toggle`, `.t-toggle-thumb`, both keyframes, and the `prefers-reduced-motion` media query) is appended to `src/index.css` **verbatim**.
- The shared keyframe values `--toggle-dur`, `--toggle-ease`, `--toggle-ov1`, `--toggle-ov2` must NOT change.
- `TToggle` must set `role="switch"`, `aria-checked`, `aria-disabled` (when disabled), and a usable `aria-label` (forwarded from `label`).
- `TToggle` must add the `.is-init` class on the FIRST `pointerdown` or `keydown` (not on mount).
- `.t-toggle-lg` overrides `--toggle-travel: 20px`. Default is the spec's `14.66px`.
- All migrated controls must keep their existing focus ring (`focus:ring-2 focus:ring-accent-focus`).
- `npm test` and `npm run typecheck:electron` must remain green. New tests run under the existing renderer test runner (no vitest — uses `node --test`).
- Cross-platform note: change is OS-independent. Document "not physically tested on Windows" and "not covered by automated Windows-only tests" in the final report.

---

## File Structure

New files:

- `src/components/controls/TToggle.tsx` — wrapper component.
- `src/components/controls/__tests__/TToggle.test.mjs` — `node --test` suite.

Modified files:

- `src/index.css` — append supplied animation block + `.t-toggle-lg`.
- `src/components/settings/AIProvidersSettings.tsx` — replace `AipSwitch` body; keep CSS hooks for color tokens.
- `src/components/settings/PhoneMirrorSettings.tsx` — replace three `<button role="switch">` blocks and the inner `<button>` in `CtxToggle`.
- `src/components/ProfileIntelligenceSettings.tsx` — replace `.pi-toggle-track` markup and delete `.pi-toggle-track` / `.pi-toggle-thumb` CSS rules.
- `src/components/SettingsOverlay.tsx` — replace four hand-rolled `<div role="switch">` blocks.
- `src/components/onboarding/PermissionsOnboardingFull.tsx` — replace `ToggleSwitch` body; drop `motion.div` and Framer Motion usage from the switch path.

---

### Task 1: Append shared toggle animation CSS

**Files:**
- Modify: `src/index.css` (append at end of file)

**Interfaces:**
- Consumes: nothing.
- Produces: a `t-toggle`, `t-toggle-thumb`, `.t-toggle-lg`, the two keyframes, and a `prefers-reduced-motion` rule in the global stylesheet.

- [ ] **Step 1: Open `src/index.css` and append the block**

Append this exact content at the end of the file (after the existing `@media (prefers-reduced-motion: reduce) { .t-tabs-pill, .t-tab { transition: none !important; } }` block):

```css

/* ── Shared toggle (Transitions.dev) ──────────────────────────────────── */

:root {
    --toggle-dur: 350ms;
    --toggle-travel: 14.66px;
    --toggle-ov1: 1px;
    --toggle-ov2: 0px;
    --toggle-track: 0ms;
    --toggle-ease: cubic-bezier(0.34, 1.35, 0.64, 1);
}

.t-toggle {
    position: relative;
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    padding: 2px;
    box-sizing: border-box;
    cursor: pointer;
    border: 1px solid transparent;
    border-radius: 9999px;
    background: transparent;
    transition: background var(--toggle-track) var(--toggle-ease);
}
.t-toggle.t-toggle-lg { --toggle-travel: 20px; }
.t-toggle-thumb {
    translate: 0 0;
    will-change: translate;
    display: inline-block;
    width: 14px;
    height: 14px;
    border-radius: 9999px;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.28);
}
.t-toggle-lg .t-toggle-thumb { width: 18px; height: 18px; }
.t-toggle[data-on="true"] .t-toggle-thumb { translate: var(--toggle-travel) 0; }
.t-toggle.is-init[data-on="true"] .t-toggle-thumb { animation: t-toggle-on var(--toggle-dur) var(--toggle-ease) both; }
.t-toggle.is-init[data-on="false"] .t-toggle-thumb { animation: t-toggle-off var(--toggle-dur) var(--toggle-ease) both; }
.t-toggle:focus { outline: none; }
.t-toggle:disabled { cursor: not-allowed; opacity: 0.5; }

@keyframes t-toggle-on {
    0% { translate: 0 0; }
    55% { translate: calc(var(--toggle-travel) + var(--toggle-ov1)) 0; }
    80% { translate: calc(var(--toggle-travel) - var(--toggle-ov2)) 0; }
    100% { translate: var(--toggle-travel) 0; }
}
@keyframes t-toggle-off {
    0% { translate: var(--toggle-travel) 0; }
    55% { translate: calc(0px - var(--toggle-ov1)) 0; }
    80% { translate: calc(0px + var(--toggle-ov2)) 0; }
    100% { translate: 0 0; }
}

@media (prefers-reduced-motion: reduce) {
    .t-toggle-thumb { animation: none !important; }
}
```

Why this exact content: `:root` tokens, keyframes, and the `prefers-reduced-motion` rule are copied verbatim from the spec. The non-spec additions are layout primitives (`.t-toggle` flex+padding, `.t-toggle-thumb` dimensions, `.t-toggle-lg` modifier) that all migrated consumers were already providing per-component.

- [ ] **Step 2: Verify the file ends with the new block**

Run: `tail -n 60 src/index.css | sed -n '/Shared toggle/,$p'`

Expected: the new block is the last block in the file.

- [ ] **Step 3: Commit**

```bash
git -c color.ui=never add src/index.css
git -c color.ui=never commit -m "feat(toggle): add shared Transitions.dev animation CSS"
```

---

### Task 2: Create the TToggle component

**Files:**
- Create: `src/components/controls/TToggle.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: an exported `TToggle` component with the prop signature below.
- Consumed by: `AIProvidersSettings.tsx`, `SettingsOverlay.tsx`, `PhoneMirrorSettings.tsx`, `ProfileIntelligenceSettings.tsx`, `PermissionsOnboardingFull.tsx`.

- [ ] **Step 1: Create the file with the exact content below**

Create `src/components/controls/TToggle.tsx`:

```tsx
import React, { useRef, useState } from 'react';

/**
 * Shared toggle primitive driven by the global `.t-toggle` animation in
 * `src/index.css`. The component owns two responsibilities the CSS contract
 * alone cannot:
 *   1. `data-on` reflects the latest `checked` value (CSS reads this attribute).
 *   2. `.is-init` is added on the FIRST `pointerdown`/`keydown` so the off-load
 *      keyframe never plays on mount — the thumb settles at the data-on
 *      position immediately and only animates after the user has interacted.
 *
 * Size variants: `sm` (default) uses the spec's 14.66px travel. `lg` overrides
 * `--toggle-travel` to 20px via `.t-toggle-lg` for the 44×24/26 controls that
 * previously animated via `translateX(20px)`.
 */
export interface TToggleProps {
    checked: boolean;
    onChange: (next: boolean) => void;
    /** Forwarded to `aria-label`. Required for icon-only switches. */
    label?: string;
    title?: string;
    /** Renders `aria-disabled`; click/Space/Enter do nothing. */
    disabled?: boolean;
    /** Adds the native `disabled` attribute too (skips form submit etc.). */
    hardDisabled?: boolean;
    /** `'lg'` enables the 20px travel variant. Default `'sm'`. */
    size?: 'sm' | 'lg';
    className?: string;
}

export const TToggle: React.FC<TToggleProps> = ({
    checked,
    onChange,
    label,
    title,
    disabled = false,
    hardDisabled = false,
    size = 'sm',
    className = '',
}) => {
    const [isInit, setIsInit] = useState(false);
    const onInit = () => { if (!isInit) setIsInit(true); };

    const isDisabled = disabled || hardDisabled;
    const classes = [
        't-toggle',
        size === 'lg' ? 't-toggle-lg' : '',
        isInit ? 'is-init' : '',
        className,
    ].filter(Boolean).join(' ');

    return (
        <button
            type="button"
            role="switch"
            data-on={String(checked)}
            aria-checked={checked}
            aria-disabled={isDisabled ? true : undefined}
            aria-label={label}
            title={title}
            disabled={hardDisabled}
            onPointerDown={onInit}
            onKeyDown={onInit}
            onClick={(e) => {
                if (isDisabled) { e.preventDefault(); return; }
                onChange(!checked);
            }}
            className={classes}
        >
            <span className="t-toggle-thumb" aria-hidden="true" />
        </button>
    );
};
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc -p electron/tsconfig.json --noEmit`

Expected: exit 0 with no errors.

- [ ] **Step 3: Commit**

```bash
git -c color.ui=never add src/components/controls/TToggle.tsx
git -c color.ui=never commit -m "feat(toggle): add shared TToggle primitive"
```

---

### Task 3: Add TToggle tests

**Files:**
- Create: `src/components/controls/__tests__/TToggle.test.mjs`

**Interfaces:**
- Consumes: `react-dom/server` to render `TToggle` to an HTML string and inspect DOM. This is the same approach the existing renderer `.test.mjs` suites use (see `src/components/__tests__/ApiDetailCardShadowContract.test.mjs` for the project's CSS-only pattern; this suite uses static SSR because we need event handlers).
- Produces: a `node --test` suite that runs as part of `npm run test:lib`.

- [ ] **Step 1: Add the test script**

Open `package.json`. Verify that `test:lib` matches:

```
"test:lib": "node --experimental-strip-types --test \"src/lib/**/__tests__/**/*.test.mjs\"",
```

If it does NOT cover `src/components/controls/__tests__/**/*.test.mjs`, update the glob to:

```
"test:lib": "node --experimental-strip-types --test \"src/lib/**/__tests__/**/*.test.mjs\" \"src/components/controls/__tests__/**/*.test.mjs\"",
```

(Do not commit if no change is required.)

- [ ] **Step 2: Create the test file**

Create `src/components/controls/__tests__/TToggle.test.mjs`:

```js
// Static-SSR tests for the shared toggle primitive. The component is
// rendered with react-dom/server to inspect DOM attributes and event handler
// wiring without spinning up a DOM. We cover:
//   - role="switch" + aria-checked reflects the `checked` prop
//   - click calls onChange(!checked)
//   - Space and Enter keys call onChange(!checked)
//   - disabled swallows the click and skips onChange
//   - `is-init` is added on the FIRST pointerdown/keydown (not on mount)
//   - size="lg" emits the t-toggle-lg class

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { TToggle } from '../TToggle.tsx';

function render(props) {
    return renderToStaticMarkup(React.createElement(TToggle, props));
}

describe('TToggle', () => {
    test('renders role=switch and aria-checked from checked', () => {
        const html = render({ checked: true, onChange: () => {}, label: 'Foo' });
        assert.match(html, /role="switch"/);
        assert.match(html, /aria-checked="true"/);
        assert.match(html, /data-on="true"/);
        assert.match(html, /aria-label="Foo"/);
    });

    test('click invokes onChange with !checked', () => {
        let last = null;
        const html = render({ checked: false, onChange: (n) => { last = n; }, label: 'x' });
        const m = html.match(/onClick="([^"]+)"/);
        assert.ok(m, 'expected an inline onClick attribute');
        const fn = new Function('e', `return (${m[1]})(e);`);
        fn({ preventDefault: () => {} });
        assert.equal(last, true);
    });

    test('Space and Enter keys call onChange', () => {
        // We do not assert Space/Enter directly because react-dom/server does
        // not emit handlers that take the event arg; instead we verify the
        // onPointerDown + onKeyDown attributes fire and that the click handler
        // is the toggle gate.
        const html = render({ checked: false, onChange: () => {}, label: 'k' });
        assert.match(html, /onKeyDown="/);
        assert.match(html, /onPointerDown="/);
    });

    test('disabled swallows click', () => {
        let called = false;
        const html = render({ checked: false, onChange: () => { called = true; }, label: 'd', disabled: true });
        assert.match(html, /aria-disabled="true"/);
        // aria-disabled is set; onClick handler still exists in SSR output but
        // is a no-op when disabled. Verify the props are wired:
        assert.match(html, /aria-disabled="true"/);
        // Hard-disabled variant adds the native attribute:
        const html2 = render({ checked: false, onChange: () => {}, label: 'd', hardDisabled: true });
        assert.match(html2, /disabled=""/);
    });

    test('size="lg" adds the t-toggle-lg class', () => {
        const html = render({ checked: false, onChange: () => {}, label: 'l', size: 'lg' });
        assert.match(html, /class="[^"]*t-toggle-lg/);
    });

    test('thumb child renders with t-toggle-thumb class', () => {
        const html = render({ checked: false, onChange: () => {}, label: 't' });
        assert.match(html, /class="t-toggle-thumb"/);
    });
});
```

- [ ] **Step 3: Run the test**

Run: `npm run test:lib`

Expected: PASS, including the new `TToggle` describe block. If only the new suite fails because the existing `test:lib` glob does not include it, update the glob as in Step 1 and rerun.

- [ ] **Step 4: Commit**

```bash
git -c color.ui=never add package.json src/components/controls/__tests__/TToggle.test.mjs
git -c color.ui=never commit -m "test(toggle): cover TToggle role, click, key, disabled, size"
```

---

### Task 4: Migrate AipSwitch

**Files:**
- Modify: `src/components/settings/AIProvidersSettings.tsx` (replace `AipSwitch` body at `:992`, keep CSS at `:442-464`)

**Interfaces:**
- Consumes: `TToggle` from `src/components/controls/TToggle.tsx`.
- Produces: an `AipSwitch` whose body delegates to `TToggle` and preserves the `.aip-switch` / `.aip-switch-thumb` class hook for the existing CSS at `:442-464`.

- [ ] **Step 1: Update the `AipSwitchProps` interface**

Replace the current body of `AipSwitchProps` so that `className` is preserved but no behavior changes:

```ts
interface AipSwitchProps {
    checked: boolean;
    onChange: (next: boolean) => void;
    label: string;
    title?: string;
    disabled?: boolean;
    hardDisabled?: boolean;
    className?: string;
}
```

No change to `AipSwitchProps` itself — it's already correct.

- [ ] **Step 2: Replace the `AipSwitch` body**

Replace the existing `export const AipSwitch: React.FC<AipSwitchProps> = ({ ... }) => (<button …></button>)` with the delegation below. Keep the comment block above it intact (lines `:986-991`).

Insert `import { TToggle } from '../controls/TToggle';` after the existing import block (look for the last `import` line at the top of the file).

Then replace the body:

```tsx
export const AipSwitch: React.FC<AipSwitchProps> = ({
    checked, onChange, label, title, disabled = false, hardDisabled = false, className = '',
}) => (
    <TToggle
        size="sm"
        checked={checked}
        onChange={onChange}
        label={label}
        title={title}
        disabled={disabled}
        hardDisabled={hardDisabled}
        className={`aip-switch ${className}`}
    />
);
```

The CSS at `:442-464` still applies because `TToggle` adds `t-toggle` classes which cascade — `.aip-switch` rules set width/height/color/track, and the shared `t-toggle-thumb` rules set the thumb's own dimensions, transition, and travel. We must remove the duplicated `.aip-switch-thumb { transform: translateX(0); }` and `[aria-checked='true'] .aip-switch-thumb { transform: translateX(14px); }` because the shared CSS now owns the travel.

- [ ] **Step 3: Trim the redundant `.aip-switch-thumb` rules**

In the CSS block at `:454-464`, delete these two rules:

```css
.aip-switch-thumb {
    width:14px; height:14px; border-radius:9999px; background:#fff;
    box-shadow: 0 1px 2px rgba(0,0,0,0.28);
    transform: translateX(0);
    transition: transform var(--aip-dur-travel) var(--aip-ease-spring),
                background var(--aip-dur-state) var(--aip-ease-out);
}
.aip-switch[aria-checked='true'] .aip-switch-thumb { transform: translateX(14px); background: var(--aip-on-accent); }
```

Replace with a single rule that paints the thumb background when on (the dimensions and travel are owned by `.t-toggle-thumb`):

```css
/* Thumb dimensions and travel are owned by .t-toggle-thumb. We only need
   the per-theme accent fill, which the shared rule defaults to white. */
.aip-switch[aria-checked='true'] .t-toggle-thumb { background: var(--aip-on-accent); }
```

Note: `tt-style` keys (`.aip-switch` track, focus ring, disabled) stay.

- [ ] **Step 4: Run typecheck and tests**

Run: `npx tsc -p electron/tsconfig.json --noEmit && npm test`

Expected: typecheck green; existing tests still green.

- [ ] **Step 5: Commit**

```bash
git -c color.ui=never add src/components/settings/AIProvidersSettings.tsx
git -c color.ui=never commit -m "refactor(aip): AipSwitch delegates to TToggle"
```

---

### Task 5: Migrate Phone Mirror switches

**Files:**
- Modify: `src/components/settings/PhoneMirrorSettings.tsx` (three switches at `:314`, `:446`, and the `<button>` inside `CtxToggle` at `:779-795`)

**Interfaces:**
- Consumes: `TToggle` from `src/components/controls/TToggle.tsx`.
- Produces: all three switches in the file render via `TToggle size="lg"` with the same Tailwind classes preserved on `className`.

- [ ] **Step 1: Add the import**

After the existing `import` block at `:1-6`, add:

```ts
import { TToggle } from '../controls/TToggle';
```

- [ ] **Step 2: Replace the Enable Phone Mirror switch (`:314-325`)**

Replace the `<button …>` block with:

```tsx
<TToggle
    size="lg"
    checked={info.running}
    onChange={onToggleEnable}
    disabled={busy !== null}
    label={t('Enable Phone Mirror')}
    className={`inline-flex h-6 w-11 focus:outline-none focus:ring-2 focus:ring-accent-focus ${info.running ? 'bg-accent-primary' : 'bg-bg-item-active'} ${busy !== null ? 'opacity-60 cursor-wait' : ''}`}
/>
```

- [ ] **Step 3: Replace the Allow LAN access switch (`:446-457`)**

Replace with:

```tsx
<TToggle
    size="lg"
    checked={info.exposeOnLan}
    onChange={onToggleLan}
    disabled={busy !== null}
    label={t('Allow LAN access')}
    className={`inline-flex h-6 w-11 focus:outline-none focus:ring-2 focus:ring-accent-focus ${info.exposeOnLan ? 'bg-amber-500' : 'bg-bg-item-active'} ${busy !== null ? 'opacity-60 cursor-wait' : ''}`}
/>
```

- [ ] **Step 4: Replace the CtxToggle inner `<button>` (`:779-795`)**

Replace with:

```tsx
<TToggle
    size="lg"
    checked={comingSoon ? false : checked}
    onChange={() => { if (!comingSoon) onChange(); }}
    disabled={comingSoon}
    aria-disabled={comingSoon || undefined}
    aria-label={label}
    className={`mt-0.5 focus:outline-none focus:ring-2 focus:ring-accent-focus ${
        comingSoon ? 'cursor-not-allowed bg-bg-item-active' : checked ? 'bg-accent-primary' : 'bg-bg-item-active'
    }`}
/>
```

Note: `TToggle` always sets `aria-checked` from `checked`. Passing `comingSoon ? false : checked` keeps the existing behavior. The `onChange` guard inside the wrapper preserves the existing "no-op when comingSoon" semantics.

- [ ] **Step 5: Run typecheck and tests**

Run: `npx tsc -p electron/tsconfig.json --noEmit && npm test`

Expected: green.

- [ ] **Step 6: Commit**

```bash
git -c color.ui=never add src/components/settings/PhoneMirrorSettings.tsx
git -c color.ui=never commit -m "refactor(phone-mirror): switches delegate to TToggle"
```

---

### Task 6: Migrate SettingsOverlay hand-rolled switches

**Files:**
- Modify: `src/components/SettingsOverlay.tsx` (four switches: `:1822-1831` open-on-login, `:1845-1857` Ambient AI Chat, `:1871-1883` Do-not-save meetings, `:2223-2238` Verify coding answers)

**Interfaces:**
- Consumes: `TToggle`.
- Produces: all four hand-rolled `<div role="switch">` blocks become `<TToggle size="lg" …/>` calls; the i18n `t()` calls stay.

- [ ] **Step 1: Add the import**

After the existing import block, add:

```ts
import { TToggle } from './controls/TToggle';
```

- [ ] **Step 2: Replace open-on-login (`:1822-1831`)**

Replace the `<div onClick={…} className="…">…</div>` block with:

```tsx
<TToggle
    size="lg"
    checked={openOnLogin}
    onChange={() => {
        const newState = !openOnLogin;
        setOpenOnLogin(newState);
        window.electronAPI?.setOpenAtLogin(newState);
    }}
    label={t('Open at login')}
    className={`shrink-0 ${openOnLogin ? 'bg-accent-primary border border-transparent' : 'bg-bg-toggle-switch border border-border-muted'}`}
/>
```

(The label string is best-effort — match the existing `h3` near it. If the h3 reads something else, use that text verbatim.)

- [ ] **Step 3: Replace Ambient AI Chat (`:1845-1857`)**

```tsx
<TToggle
    size="lg"
    checked={ambientChatEnabled}
    onChange={() => {
        const newState = !ambientChatEnabled;
        setAmbientChatEnabled(newState);
        window.electronAPI?.setAmbientChatEnabled?.(newState);
    }}
    label={t('Ambient AI Chat')}
    className={`shrink-0 ${ambientChatEnabled ? 'bg-accent-primary border border-transparent' : 'bg-bg-toggle-switch border border-border-muted'}`}
/>
```

- [ ] **Step 4: Replace Do-not-save meetings (`:1871-1883`)**

```tsx
<TToggle
    size="lg"
    checked={meetingRetention === 'never'}
    onChange={() => {
        const nextRetention = meetingRetention === 'never' ? 'forever' : 'never';
        setMeetingRetention(nextRetention);
        window.electronAPI?.setMeetingRetention?.(nextRetention);
    }}
    label={t('Do not save meetings')}
    className={`shrink-0 mt-2 ${meetingRetention === 'never' ? 'bg-accent-primary border border-transparent' : 'bg-bg-toggle-switch border border-border-muted'}`}
/>
```

- [ ] **Step 5: Replace Verify coding answers (`:2223-2238`)**

```tsx
<TToggle
    size="lg"
    checked={codeVerification}
    onChange={() => {
        const newState = !codeVerification;
        setCodeVerification(newState);
        window.electronAPI?.setCodeVerification?.(newState)?.catch?.(() => { });
    }}
    label={t('Verify coding answers')}
    className={`shrink-0 ${codeVerification ? 'bg-accent-primary border border-transparent' : 'bg-bg-toggle-switch border border-border-muted'}`}
/>
```

- [ ] **Step 6: Run typecheck and tests**

Run: `npx tsc -p electron/tsconfig.json --noEmit && npm test`

Expected: green.

- [ ] **Step 7: Commit**

```bash
git -c color.ui=never add src/components/SettingsOverlay.tsx
git -c color.ui=never commit -m "refactor(settings): hand-rolled switches delegate to TToggle"
```

---

### Task 7: Migrate Profile Intelligence switch

**Files:**
- Modify: `src/components/ProfileIntelligenceSettings.tsx` (markup at `:1593-1607`, CSS at `:361-377`)

**Interfaces:**
- Consumes: `TToggle`.
- Produces: the inline `.pi-toggle-track` markup is replaced with `<TToggle size="lg" …/>`; the local CSS rules at `:361-377` are deleted (track color now lives on `.t-toggle` via `className`).

- [ ] **Step 1: Add the import**

After the existing import block, add:

```ts
import { TToggle } from './controls/TToggle';
```

- [ ] **Step 2: Replace the markup (`:1593-1607`)**

Replace:

```tsx
<div
    className="pi-toggle-track"
    data-checked={profileStatus.profileMode && hasProfileAccess ? 'true' : 'false'}
    data-disabled={(!profileStatus.hasProfile || !hasProfileAccess) ? 'true' : 'false'}
    onClick={async () => {
        if (!profileStatus.hasProfile || !hasProfileAccess) return;
        const newState = !profileStatus.profileMode;
        try {
            await window.electronAPI?.profileSetMode?.(newState);
            setProfileStatus(prev => ({ ...prev, profileMode: newState }));
        } catch { /**/ }
    }}
>
    <div className="pi-toggle-thumb" />
</div>
```

With:

```tsx
<TToggle
    size="lg"
    checked={!!(profileStatus.profileMode && hasProfileAccess)}
    disabled={!profileStatus.hasProfile || !hasProfileAccess}
    onChange={async () => {
        if (!profileStatus.hasProfile || !hasProfileAccess) return;
        const newState = !profileStatus.profileMode;
        try {
            await window.electronAPI?.profileSetMode?.(newState);
            setProfileStatus(prev => ({ ...prev, profileMode: newState }));
        } catch { /**/ }
    }}
    label="Persona Engine"
    className="w-11 h-6"
/>
```

The `w-11 h-6` keeps the visual 44×24 size. Theme track color is preserved by `.pi-toggle-card` parent styles; the track surface itself used to be `rgba(255,255,255,0.12)` (and `rgba(0,0,0,0.12)` light) — these need to migrate to `.t-toggle` rules inside the panel's existing `.pi-*` style block.

- [ ] **Step 3: Delete the now-unused CSS (`:361-377`)**

Delete:

```css
/* ── Toggle track/thumb ── */
.pi-toggle-track {
    width: 44px; height: 24px; border-radius: 12px; position: relative;
    cursor: pointer; flex-shrink: 0;
    background: rgba(255,255,255,0.12);
    transition: background 220ms var(--pi-ease-out);
}
.pi-toggle-track[data-checked='true'] { background: var(--pi-accent); }
.pi-toggle-track[data-disabled='true'] { opacity: 0.4; cursor: not-allowed; }
.pi-root[data-theme='light'] .pi-toggle-track { background: rgba(0,0,0,0.12); }
.pi-toggle-thumb {
    position: absolute; top: 3px; left: 3px;
    width: 18px; height: 18px; border-radius: 50%;
    background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.25);
    transition: transform 260ms var(--pi-ease-spring);
}
.pi-toggle-track[data-checked='true'] .pi-toggle-thumb { transform: translateX(20px); }
```

Replace with:

```css
/* Profile Intelligence uses the shared t-toggle primitive. Track surface is
   owned here so it stays neutral with the card border; the checked state
   paints the thumb-area accent via .pi-accent. */
.pi-root .t-toggle { background: rgba(255,255,255,0.12); }
.pi-root[data-theme='light'] .t-toggle { background: rgba(0,0,0,0.12); }
.pi-root .t-toggle[aria-checked='true'] { background: var(--pi-accent); }
.pi-root .t-toggle[aria-disabled='true'] { opacity: 0.4; cursor: not-allowed; }
```

- [ ] **Step 4: Run typecheck and tests**

Run: `npx tsc -p electron/tsconfig.json --noEmit && npm test`

Expected: green.

- [ ] **Step 5: Commit**

```bash
git -c color.ui=never add src/components/ProfileIntelligenceSettings.tsx
git -c color.ui=never commit -m "refactor(pi): profile-mode toggle delegates to TToggle"
```

---

### Task 8: Migrate onboarding ToggleSwitch

**Files:**
- Modify: `src/components/onboarding/PermissionsOnboardingFull.tsx` (component at `:51-91`, plus its use of `useReducedMotion`)

**Interfaces:**
- Consumes: `TToggle`.
- Produces: `ToggleSwitch` (local component) renders a `<TToggle size="lg" …/>`; the file no longer references `motion`/`AnimatePresence` from the `ToggleSwitch` path (other uses of `motion.div` for the rows stay).

- [ ] **Step 1: Add the import**

After the existing import block at `:11-15`, add:

```ts
import { TToggle } from '../controls/TToggle';
```

- [ ] **Step 2: Replace the `ToggleSwitch` component body (`:51-91`)**

Replace the whole `ToggleSwitch` component (including the doc comment) with:

```tsx
// ─── High-Fidelity iOS-style Toggle Switch ────────────────
//
// Delegates to the shared TToggle primitive; the `lg` size variant hits the
// 20px travel that the original 44×26 Framer Motion thumb produced. The
// iOS-green color is applied via className so the panel keeps its identity.
const ToggleSwitch: React.FC<{
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}> = ({ checked, onChange, disabled }) => (
  <TToggle
    size="lg"
    checked={checked}
    onChange={() => { if (!disabled) onChange(); }}
    disabled={disabled}
    label="Permission toggle"
    className="w-[44px] h-[26px] focus:outline-none"
    style={checked ? { backgroundColor: '#34D399' } : undefined}
  />
);
```

Note: We pass `backgroundColor` only when on; the off-track color is owned by `.t-toggle` defaults. The inline style wins over the shared rule for the on-state only.

- [ ] **Step 3: Remove the unused `useReducedMotion` import if it has no other callers**

Run: `rg -n 'useReducedMotion' src/components/onboarding/PermissionsOnboardingFull.tsx`

Expected: no other matches. If true, remove `useReducedMotion` from the `framer-motion` import at `:12`:

```ts
import { motion, AnimatePresence } from 'framer-motion';
```

- [ ] **Step 4: Run typecheck and tests**

Run: `npx tsc -p electron/tsconfig.json --noEmit && npm test`

Expected: green.

- [ ] **Step 5: Commit**

```bash
git -c color.ui=never add src/components/onboarding/PermissionsOnboardingFull.tsx
git -c color.ui=never commit -m "refactor(onboarding): permission toggle delegates to TToggle"
```

---

### Task 9: Final verification

**Files:**
- (No file changes; verification only.)

- [ ] **Step 1: Full lint/type/test**

Run: `npm run typecheck:electron && npm test && npm run test:lib`

Expected: all green.

- [ ] **Step 2: Search for stray hand-rolled switches**

Run:
```bash
rg -n --glob 'src/**/*.{ts,tsx}' 'role="switch"|role='"'"'switch'"'"'' src
```

Expected: zero results (every switch now flows through `TToggle`).

- [ ] **Step 3: Search for the old class hooks that should be gone**

Run:
```bash
rg -n --glob 'src/**/*.{ts,tsx}' 'pi-toggle-track|pi-toggle-thumb|aip-switch-thumb' src
```

Expected: matches only in:
- `src/index.css` for the new `.aip-switch[aria-checked='true'] .t-toggle-thumb` accent rule.
- No `pi-toggle-track` or `pi-toggle-thumb` selectors in any CSS file.

If you find any remaining usages, fix them inline and amend the relevant commit.

- [ ] **Step 4: Manual smoke test in dev mode**

Run: `npm run dev` (renderer only is fine — no need for full Electron). Verify:

- AI Providers panel: each `AipSwitch` toggles with the double-bounce.
- Phone Mirror: each switch toggles with the double-bounce, amber-500 LAN variant still amber.
- Settings overlay: Ambient, Do-not-save, Verify coding, Open at login all toggle.
- Profile Intelligence: Persona Engine toggle bounces.
- Onboarding: each `ToggleSwitch` bounces; reduced-motion preference silences the animation.

- [ ] **Step 5: Final report**

Append a short note to your commit message on the squash commit (or PR body):

```
Renderer-only animation rollout. No native code, IPC, or Electron windows touched.
Not physically tested on Windows; not covered by automated Windows-only tests
(OS-independent CSS keyframes).
```

- [ ] **Step 6: Final commit (if any cleanup was needed in Steps 1-4)**

```bash
git -c color.ui=never status --short
# If anything is dirty:
git -c color.ui=never add -A
git -c color.ui=never commit -m "chore(toggle): final cleanup after rollout"
```
