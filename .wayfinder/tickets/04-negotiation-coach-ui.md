# Implement NegotiationCoachingCard UI stub

**Labels:** `wayfinder:task`  
**Map:** [Natively Pro Features — Open Source Reimplementation](../map.md)  
**Blocked by:** 01, 06

## Question

`NegotiationCoachingCard` is a null stub from the premium loader. The IPC handlers `profile:generate-negotiation`, `profile:get-negotiation-state`, and `profile:reset-negotiation` are wired but call `orchestrator.generateNegotiationScriptOnDemand()` / `orchestrator.getNegotiationScript()` which will be stubs on the OSS KnowledgeOrchestrator. What is the minimal useful UI for this card?

## Scope

- Implement `premium/src/NegotiationCoachingCard.tsx` (or move to `src/components/`) so it is no longer a null component
- Minimal UI: show a "Generate negotiation script" button; on click call `profile:generate-negotiation`; display result or a clear "Requires resume + JD to be uploaded" message if orchestrator returns no data
- The OSS KnowledgeOrchestrator (ticket 06) stubs `getNegotiationScript()` → returns `null`; UI should handle this gracefully with a placeholder message
- Blocked by ticket 06 because the card renders inside the profile intelligence flow which requires KnowledgeOrchestrator to exist

## Answer

Replaced the null-stub premium `NegotiationCoachingCard` with a real renderer
component. Minimal, stub-quality card that matches the in-meeting AI-response
card idiom.

### Files changed (renderer only)

- `src/components/NegotiationCoachingCard.tsx` — **new** default-export
  component. Renders the "Negotiation Coach" card: header label, optional
  `tacticalNote`, optional offer/target line, script body, and a "Generate
  negotiation script" button with loading + empty states. Styling copies the
  existing `ai-response-card` / `cardBgBorderClass` / `labelColorClass` /
  `headerBorderClass` tokens from `NativelyInterface.tsx`; button copies the
  light/dark idiom. Uses `useT()` from `../i18n` for all UI strings. Target
  size min-height 24px for WCAG 2.5.8.
- `src/components/NativelyInterface.tsx` — swapped the import from
  `import { NegotiationCoachingCard } from '../premium'` to
  `import NegotiationCoachingCard from './NegotiationCoachingCard'`. Call site
  (~line 4462) is unchanged; the new component accepts the same props (added
  optional `showSilenceTimer` / `onSilenceTimerEnd` to the interface so the
  existing spread + handler stays type-clean; both are accepted and ignored —
  silence-timer behavior is out of scope for this stub).
- `src/premium/index.tsx` — left untouched; other null stubs still route
  through it. `NegotiationCoachingCard` simply no longer imports from it.

### IPC channels consumed

- `profileGenerateNegotiation(force)` (`window.electronAPI`, channel
  `profile:generate-negotiation`) — called with `force = true` on button click.

`profileGetNegotiationState` and `profileResetNegotiation` are exposed on
`electronAPI` but not needed for this minimal card (no persisted-state
rehydration or reset UI in the stub). Noted, not wired.

### Null / stub handling

The OSS `KnowledgeOrchestrator` stubs `generateNegotiationScriptOnDemand()` →
`null`, so the handler returns `{ success: false, error: 'Could not generate
negotiation script. Ensure a resume and job description are uploaded.' }`. The
card:

1. Shows a loading label ("Generating…") while the promise is in flight.
2. On `success: false` or empty `script`, renders the handler's `error`
   string, falling back to a translated placeholder ("Negotiation scripts
   require a resume and job description to be uploaded.") if no error text is
   present. Also catches thrown errors into the same placeholder.
3. `extractScriptText()` tolerates whatever `script` shape a real
   (non-stub) orchestrator returns — string, or object with
   `exactScript` / `script` / `text` / `talkingPoints[]` — and only stringifies
   as a last resort. No blank card, no crash.

The card also still renders inline coaching data (`tacticalNote`, `exactScript`,
offer/target) when passed from the live `onIntelligenceNegotiationCoaching`
event path, hiding the generate button once a script is present.

### Verify

`npx tsc --noEmit -p tsconfig.json` → **No errors found** (node_modules present;
full project typecheck clean, no errors in the changed files or anywhere else).
