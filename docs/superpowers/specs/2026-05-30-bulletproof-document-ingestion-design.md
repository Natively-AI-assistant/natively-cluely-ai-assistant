# Bulletproof Document Ingestion — Design

**Date:** 2026-05-30
**Status:** Approved (design); pending implementation
**Branch context:** `fix/overlay-startup-slide` (the PDF worker hotfix landed here this session)
**Owner module:** `premium/electron/knowledge/` (git submodule)

---

## 1. Problem

Resume / JD ingestion must **never fail**, accept **any common format**, and handle documents **up to 10 pages**.

The immediate failure this session: scanned/normal PDF upload threw
`Setting up fake worker failed: Cannot find module .../pdf.worker.mjs`
because esbuild bundles `pdfjs-dist` into `main.js` but never emits the worker file
that pdfjs dynamic-`import()`s. A one-line `PDFParse.setWorker(file://…)` fix already
landed (verified: real resume → 4315 chars). This spec covers the broader robustness
upgrade so ingestion degrades gracefully instead of throwing, across all formats.

### Goals
- Never throw past the extraction boundary — every outcome is a typed verdict.
- Native text extraction for PDF (text), DOCX, legacy DOC, TXT/MD/RTF.
- Cloud-vision OCR fallback for scanned PDFs and image files (JPG/PNG/HEIC).
- Up to 10 pages OCR'd; native text path uncapped.
- When text genuinely can't be obtained → user pastes text directly (never blocked).

### Non-goals
- Local/offline OCR (tesseract) — rejected; we reuse existing cloud LLM vision.
- Documents > 10 MiB (existing cap stays).
- OCR beyond 10 pages (bounded for cost/latency).

---

## 2. Key findings (verified this session)

- `generateContentFn(contents: any[])` already accepts image parts
  `{ inlineData: { mimeType, data } }` (used at `electron/LLMHelper.ts:378`).
  `KnowledgeOrchestrator` already holds `this.generateContentFn`. **OCR needs no new dependency.**
- `pdf-parse` v2.4.5 exposes `getScreenshot()` which renders each page to a PNG buffer
  in Node. Verified: page 1 of the real resume → valid 527 KB PNG, 1224×1584.
- pdfjs `NodeCanvasFactory` does a **runtime** `createRequire(...)('@napi-rs/canvas')`
  (line ~14385 of `pdfjs-dist/legacy/build/pdf.mjs`). `@napi-rs/canvas@0.1.80` and
  `sharp@0.34.5` (HEIC-capable) are already installed; their native `.node` binaries
  are already covered by `asarUnpack: ["**/*.node"]`. No new deps for the whole chain.
- `StructuredExtractor` embeds the **full** raw text in its prompt with no truncation,
  so 10-page docs already work on the LLM side once extraction succeeds.
- Two extraction sites exist: `DocumentReader.ts` (resume/JD — this spec) and the
  `modes:upload-reference-file` handler in `electron/ipcHandlers.ts` (out of scope here).

---

## 3. Architecture

`DocumentReader.ts` becomes a **router + ordered fallback chain**. Public entry stays
`extractDocumentText`, but the signature gains options and the return type changes from
`string` to `ExtractionResult`. **The function never rejects.**

```
extractDocumentText(filePath, { generateContentFn?, signal? })
  │
  ├─ 1. Sniff: magic bytes + extension → format enum
  │        %PDF→pdf · PK\x03\x04→docx · D0CF11E0→legacy-doc/ole
  │        FFD8→jpeg · 89504E47→png · ftypheic/heix→heic · else→text
  │
  ├─ 2. Native text layer  (each wrapped in withTimeout, 20s)
  │        pdf   → pdf-parse .getText()   (worker fix applied)
  │        docx  → mammoth.extractRawText
  │        doc   → try mammoth; else → step 4 (render+OCR)
  │        txt/md/rtf → BOM-aware decode (+ strip RTF control words)
  │        image → skip to step 4
  │
  ├─ 3. Quality gate isUsableText():
  │        PASS → { method:'native', text, pageCount }
  │        FAIL → step 4
  │
  ├─ 4. Vision OCR (cap 10 pages, 45s)
  │        pdf   → getScreenshot() per page → PNG buffers
  │        image → read file; HEIC→JPEG + normalize via sharp
  │        → visionOcr(pngBuffers, generateContentFn)
  │        → { method:'ocr', text, pageCount, pagesProcessed, warnings:['ocr-used'] }
  │
  └─ 5. Total failure (encrypted/corrupt/empty-OCR/no-llm)
           → { method:'failed', text:'', reason, needsManualPaste:true }
```

### New modules (each single-purpose, in `premium/electron/knowledge/`)
- `documentSniffer.ts` — magic-byte → `DocFormat` enum. Pure, no I/O.
- `visionOcr.ts` — `(pngBuffers, generateContentFn) → { text, warnings }`. Owns the OCR
  prompt, page batching, and the 10-page cap.
- `DocumentReader.ts` — the router; orchestrates the chain and timeouts.

---

## 4. Contracts & data flow

```ts
type DocMethod = 'native' | 'ocr' | 'manual' | 'failed';

interface ExtractionResult {
  text: string;               // '' only when method==='failed'
  method: DocMethod;
  pageCount: number;          // pages seen pre-cap; 0 for non-paged
  pagesProcessed: number;     // pages actually OCR'd (≤10)
  warnings: string[];         // e.g. ['ocr-used','page-cap-hit:14→10']
  reason?: ExtractFailReason; // only when method==='failed'
  needsManualPaste?: boolean; // true → UI shows paste box
}

type ExtractFailReason =
  | 'encrypted' | 'corrupt' | 'empty-scan' | 'unsupported' | 'no-llm' | 'timeout';
```

### Signature change
```ts
extractDocumentText(
  filePath: string,
  opts?: { generateContentFn?: (contents: any[]) => Promise<string>; signal?: AbortSignal }
): Promise<ExtractionResult>
```
`KnowledgeOrchestrator.ingestDocument` passes `this.generateContentFn` through (one-line
change at ~line 231). If absent, the chain skips OCR and falls to manual-paste (`reason:'no-llm'`).

### OCR call shape (reuses existing LLM part format)
```ts
generateContentFn([
  { text: OCR_PROMPT },                                   // "Transcribe ALL text verbatim…"
  { inlineData: { mimeType: 'image/png', data: b64Page1 } },
  …                                                        // up to 10 pages, single call
])
```
One multi-image call preserves order and minimizes round-trips. If page count exceeds the
model's per-call image limit, batch in groups and concatenate in order.

### Paths
- **Happy (text PDF, current case):** sniff→pdf, `getText()`→4315 chars, gate passes,
  `{method:'native'}`. Behavior identical to today; the wrapping is transparent.
- **Scanned:** `getText()`→few chars, gate fails, `getScreenshot()`→PNGs→`visionOcr`→
  `{method:'ocr', warnings:['ocr-used']}`. Orchestrator continues unchanged.
- **Manual paste:** new IPC `profile:ingest-pasted-text(text, docType)` →
  new `orchestrator.ingestRawText(text, type)` (the shared tail of `ingestDocument`
  from structured-extraction onward, refactored out — no duplication).

---

## 5. Error handling, caps & guarantees

**Never-fail guarantee:** `extractDocumentText` wraps its whole body in try/catch and always
resolves. The orchestrator maps any verdict to `{ success, error?, needsManualPaste? }`.
No stack trace ever reaches the UI.

| Cap | Value | On exceed |
|---|---|---|
| File size | 10 MiB (existing) | reject before parse with size message |
| OCR pages | 10 | OCR first 10 + warning `page-cap-hit:N→10` |
| Native pages | uncapped | read all (cheap) |
| Per-layer timeout | 20s native / 45s OCR | fall to next layer, don't crash |
| Total wall-clock | 90s | hard stop → manual-paste |
| OCR sanity | ≥ MIN_CHARS (~50) | empty/garbage → failed + manual-paste |

**Failure reasons → UI messages (all end in a paste box):**
- `encrypted` → "This PDF is password-protected. Remove the password and re-upload, or paste the text below."
- `corrupt` → "Couldn't read this file — it may be corrupted. Paste the text below."
- `empty-scan` → "This looks like a blank or unreadable scan. Paste the text below."
- `unsupported` → "Unsupported file type. Paste the text below."
- `no-llm` → "Couldn't auto-read this scan. Paste the text below."
- `timeout` → "Reading this file took too long. Paste the text below." (hit the 90s ceiling)

**Quality gate `isUsableText`:** `≥ MIN_CHARS` **and** an adequate printable-character ratio
(rejects subsetted-font mojibake). The one piece of real logic → dedicated unit tests.

**Sniffing beats extension:** a renamed file routes by content; extension is a tiebreaker only.

---

## 6. Testing strategy

Convention: `.test.mjs` + `node:test`, alongside existing
`electron/services/__tests__/KnowledgeOrchestratorIngest.test.mjs`. Fake only the external
boundary (`generateContentFn`, `embedFn`); test sniffer/gate/chain/OCR-batching for real.

- **documentSniffer** — each magic byte → format; renamed `.txt`-holding-`%PDF` → pdf.
- **isUsableText** — clean resume usable; 12-char stub not; mojibake not; empty not.
- **visionOcr** (fake `generateContentFn`) — N buffers → N ordered parts; >10 → cap + warning;
  throw → empty + `ocr-failed`, never rejects.
- **extractDocumentText chain** (injected fakes) — native success skips OCR; native empty →
  OCR; encrypted/corrupt → `failed`+reason and **resolves**; no `generateContentFn`+scan →
  `no-llm`+`needsManualPaste`.
- **ingestRawText** — pasted text runs the shared structured→chunk→embed tail.
- **Integration fixtures** (tiny, committed under `__fixtures__/`): real text PDF→native;
  DOCX/TXT/RTF→native. (Render-to-PNG already proven this session; LLM call faked in CI.)
- **Regression:** existing `KnowledgeOrchestratorIngest.test.mjs` must still pass.

---

## 7. Packaging note (production DMG)

- pdfjs renders via a **runtime** require of `@napi-rs/canvas` → not bundled by esbuild;
  resolves from `node_modules` at runtime (ships in `files`). OK.
- Native `.node` binaries (`@napi-rs/canvas`, `sharp`) already covered by
  `asarUnpack: ["**/*.node"]`.
- The `pdf.worker.mjs` dynamic `import()` from inside asar may fail in packaged builds;
  add the worker to `asarUnpack` (e.g. `**/pdf-parse/dist/pdf-parse/cjs/pdf.worker.mjs`)
  before shipping. Dev (asar-free) already works.

---

## 8. Files touched

**`premium` submodule (commit there, bump pointer in main repo):**
- `premium/electron/knowledge/DocumentReader.ts` — rewrite as router/chain
- `premium/electron/knowledge/documentSniffer.ts` — new
- `premium/electron/knowledge/visionOcr.ts` — new
- `premium/electron/knowledge/KnowledgeOrchestrator.ts` — pass `generateContentFn`; add `ingestRawText`
- `premium/electron/knowledge/__tests__/*` — new unit tests + fixtures

**Main repo:**
- `electron/ipcHandlers.ts` — new `profile:ingest-pasted-text` handler; surface
  `needsManualPaste`/`reason` from resume + JD upload handlers
- `electron/preload.ts` — expose the paste IPC
- `src/components/ProfileIntelligenceSettings.tsx` — paste-text fallback UI on failure
- `package.json` — (packaging) add worker to `asarUnpack`
