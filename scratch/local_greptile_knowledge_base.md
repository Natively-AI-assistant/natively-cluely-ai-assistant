# Unified Local Greptile Knowledge Base

## 🔍 Discovered Local Scanning Tools
- **Electron main compiler**: `npm run build:electron` / `npm run build:electron:tsc`
- **TypeScript Typecheck**: `npm run typecheck:electron`
- **Playwright E2E**: `npx playwright test`
- **Node Test Runner**: `node --test electron/services/__tests__/**/*.test.mjs`

## 🛡️ Critical Historical Design & Security Rules
1. **Process Isolation & Shared Constants**:
   - Never duplicate constants across renderer and main processes.
   - Place all shared bounds/limits inside `src/constants/domCapture.ts` and import cleanly.
2. **Reverse/Cross-Layer Imports**:
   - Service layers (e.g. `PromptAssembler.ts`) must never import from infrastructure (`ipcHandlers.ts`).
3. **Escaping Sequence Order**:
   - Always run HTML-escaping first, then check for prompt injections: `escapePromptInjection(escapeUserContent(...))`.
4. **Sanitized Metadata (evidenceRefs)**:
   - Metadata excerpts (`evidenceRefs.text`) must go through escaping/sanitization and be fully redacted to `[REDACTED]` if block-level redaction is triggered.
5. **No Production Console Leaks**:
   - Always use `console.debug` instead of `console.log` for debugging traces inside standard user interactions.
6. **RegExp State Safety**:
   - Always reset `regex.lastIndex = 0` after running `.test()` on global RegExp instances to avoid match offsets.

---
Knowledge Base compiled by Agent 3. Ready for Agent 4 execution.
