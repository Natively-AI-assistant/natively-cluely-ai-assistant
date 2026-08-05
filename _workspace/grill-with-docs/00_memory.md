## Prior Glossary Terms

- **phone-mirror glossary** — *Not found.* Queries for “Phone Mirror companion mobile USB stealth” / “phone-mirror glossary” returned no dedicated terms. Do not invent a phone-mirror vocabulary from memory; this grill must define it.
- **InterviewMan-style short context cap** — Competitor knobs (~screenshots-per-session, ~10 minutes of conversation in the prompt) are *context retention caps* (prompt physics), not interview wall-clock end. Marketing still sells unlimited session duration. Prior win-first grill treated this as a **non-goal memory model**, not as a mobile-product reference.
- **InterviewMan (memory sense only)** — Appears in agentmemory as a *retention competitor* for Natively’s SD/TI path, **not** as a documented USB/phone companion product. Current topic’s “InterviewMan-like” mobile companion is a **new framing** relative to stored glossary.
- **Stealth mode (desktop Electron)** — Observed runtime: `app.dock.hide()`, overlay as stealth **NSPanel** (no Dock icon → easy to misread as “crashed”). Visibility toggle historically **`Cmd+B`**; tray/menu-bar icon also restores. This is **desktop overlay stealth**, not a phone app.
- **Stealth globals** — Global hotkeys that keep stealth operable. Shortcuts-overlay grill locked: **do not break/unregister stealth globals** when shipping other overlay UX.
- **Shortcuts overlay / mouse passthrough** — Mid-session Cluely-parity frosted modal (`⌘/`); opening temporarily disables mouse passthrough until dismiss. Distinct from stealth itself, but couples to overlay input behavior.
- **commercial-surface-strip “phone home”** — Trial-backend strip language (“cannot start, phone home, or wipe profile”) means **telemetry/call-home**, not a mobile companion. False friend for this topic.
- **Fork-only / sondo-appfolio** — All GitHub/git mutations target `sondo-appfolio/natively-cluely-ai-assistant` only; never create/update upstream (`Natively-AI-assistant`) PRs or branches.
- **Skip-premium** — Do not init/checkout `natively-premium` or chase CI green by wiring premium; fork `electron-entry-smoke` structurally red without premium is accepted.
- **Win-first retention (adjacent prior grill)** — Retain commitments/durable interview state; TI SD path; `getDurableContext(3600)` + sparsify 48 as 1-hour floor; keep ~12k pack ceiling. Out of scope for phone-mirror product shape unless grilling explicitly reopens.

## Prior Decisions

1. **No prior product decision on a USB mobile companion / Phone Mirror app** — agentmemory has zero locked architecture for phone↔desktop stealth via USB. Treat as greenfield for this grill.
2. **InterviewMan in prior sessions = retention competitor, not mobile companion** — Win-first non-goals: reject “InterviewMan ~10min as memory model”; do not disable all token budgets / dump maximal raw transcript. If this session uses InterviewMan as a *UX/stealth product* analogue, that is a **new sense** and must be grilled separately from retention non-goals.
3. **Desktop stealth must stay operable** — Shortcuts overlay non-goals: no mass Cluely remaps; **do not break/unregister stealth globals**; no auto first-run. Any companion that drives or mirrors the overlay must not violate this.
4. **Stealth UX facts (observed, not a phone-mirror ADR)** — Stealth = dock-hidden NSPanel overlay; restore via `Cmd+B` or tray. “Invisible” ≠ process death.
5. **Repo ops (hard invariants)** — Fork-only (`sondo-appfolio`); never touch upstream PR/branch; verify owner before GitHub mutations. **Skip premium entirely** (user confirmed; overlay e2e fork PR #19 merged under that policy).
6. **Workflow** — New product ideas (including this companion) route through `/grill-with-docs` → `/to-spec` → tickets; do not ship architecture from analogy alone.
7. **Commercial strip (adjacent)** — Strip donation/trial/checkout/upsell/engagement; hard-disable trial backend; keep Natively identity; BYOK stays. Non-goals: product rename, restoring premium, re-enabling paywall.

## Conflicts with Current Session

- **“InterviewMan-like” mobile companion vs prior InterviewMan = retention non-goal:** Current topic cites InterviewMan as a *phone/USB stealth companion* pattern. Prior memory only locked InterviewMan as a *short context-cap memory model to reject*. Grill must not import win-first non-goals as if they forbid an InterviewMan-*style phone UX*, nor assume prior glossary already defines the companion product.
- **No phone-mirror glossary vs expectation of reusable terms:** Memory/search for “phone-mirror glossary” and “Phone Mirror companion mobile USB stealth” found **nothing on-topic** (noise: Docker registry mirrors, Mosh mobile shell, companion-PR gates, commercial “phone home”). Expect to **mint** glossary in this grill; do not pretend prior terms exist.
- **Desktop stealth invariants vs phone-as-display:** Prior decisions protect desktop stealth globals, NSPanel/dock-hide, and passthrough. A USB companion that relocates or mirrors the answer UI may collide with “overlay stays on Mac” assumptions — unsettled until grilled.
- **Skip-premium / fork-only vs any new mobile surface:** Shipping a companion app must not reopen premium submodule, upstream PRs, or paywall — same hard ops constraints as prior grills.
- **Adjacent win-first / commercial-strip decisions are not phone-mirror decisions:** Do not treat 1-hour retention pack budgets or commercial-strip scope as answers to USB companion architecture; they only constrain shared desktop stealth + fork ops.
