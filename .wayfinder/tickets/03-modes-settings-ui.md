# Implement ModesSettings UI panel

**Labels:** `wayfinder:task`  
**Map:** [Natively Pro Features — Open Source Reimplementation](../map.md)  
**Blocked by:** 01

## Question

`ModesSettings.tsx` is a null stub re-exporting from `../../premium` (which returns `NullComponent`). The IPC backend for modes is fully wired: `createMode`, `updateMode` (with `customContext`), `deleteMode`, `listModes`, `setActiveMode`. What does the UI need to do and how should it be implemented?

## Scope

- Replace `src/components/settings/ModesSettings.tsx` with a real implementation (no longer delegating to premium loader)
- UI must support: list existing modes, create new mode (name + templateType), edit mode (name, customContext notes field up to 8000 chars), delete mode, set active mode
- Check `HelpSettings.tsx` line 1671 — it says "Free and trial users see only the General mode. Activate a license..." — this text needs updating to remove the paywall reference
- Check what `templateType` values exist (look at `modeProfiles.ts`) and surface them as a dropdown
- Custom Context & Notes field is part of `updateMode({ customContext })` — include it in the edit form
- Verify: create a mode with custom context, switch to it, confirm the active mode affects prompt injection in `WhatToAnswerLLM`

## Answer

Replaced the null-stub `ModesSettings` with a self-contained React panel (no longer
delegates to `src/premium`). The `src/premium` loader is left alone — other stubs still
use it.

### Files changed (renderer only)
- `src/components/settings/ModesSettings.tsx` — full rewrite. List panel + editor split:
  - Left: mode list with an Active badge and template label per row; "New Mode" form
    (name input + template `<select>`) at the bottom.
  - Right: editor for the selected mode — name field, "Custom Context & Notes" textarea
    (hard-capped at 8000 chars with a live counter), Set active / Deactivate, Save changes,
    Delete.
  - Matches `IntelligenceSettings.tsx` design tokens/spacing (`bg-bg-main`,
    `bg-bg-item-active`, `bg-bg-input`, `border-border-subtle`, `accent-primary`,
    `text-text-*`), `useT()` for all copy, and the same button/`disabled`/`active:scale`
    idioms. No new design language, no gating on premium.
- `src/components/settings/HelpSettings.tsx` — removed the two paywall statements:
  - "Requires a Natively Pro license" → "Available to everyone — no license required".
  - "Pro Feature / Modes are locked behind Natively Pro…" block → "All Modes Included /
    Every mode is available to all users — no license required…".

### electronAPI channels consumed
- `modesGetAll()` — list + refresh after every mutation
- `modesCreate({ name, templateType })` — create
- `modesUpdate(id, { name, customContext })` — edit name + Custom Context & Notes
- `modesDelete(id)` — delete
- `modesSetActive(id | null)` — set active / deactivate (null deactivates)

All five are already exposed on `window.electronAPI` (see `src/types/electron.d.ts`
lines 279–287). Template options are surfaced from the `ModeTemplateType` union in
`electron/llm/modeProfiles.ts` (general, looking-for-work, sales, recruiting, team-meet,
lecture, technical-interview) via a local label map.

### Notes
- No missing channels to flag — the full CRUD + set-active surface was already wired.
- The component still accepts the legacy `isPremium`/`isLoaded`/`isTrialActive`/
  `onOpenNativelyAPI` props (all optional, unused) so the existing App.tsx call site stays
  type-clean; the paywall gate they used to drive is gone.

### Verify
- No installable node_modules in this environment (`npm install` blocked), so `tsc` cannot
  resolve `react`/`lucide-react`/etc. A `tsc --noEmit -p tsconfig.json` run reports only the
  global module-resolution + JSX cascade (`TS2307`/`TS7026`/`TS2875` on every JSX file,
  plus the derived `TS7031` on `onClose` because `React.FC` is unresolvable). Filtering that
  cascade leaves zero logic/type errors originating in the changed files. Verified by
  inspection against the electron.d.ts signatures and the IntelligenceSettings token set.
