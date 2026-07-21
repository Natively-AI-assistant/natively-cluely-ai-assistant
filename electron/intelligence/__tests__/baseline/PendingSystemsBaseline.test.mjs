// PHASE 2 BASELINE — pending systems (NOT BUILT YET).
// The prompt requires real tests for existing systems and pending/skipped TODO tests
// for systems that don't exist yet, so the harness records the gap without failing.
// These become real tests in their respective phases (10/11/12/13/14/15/16).
import { test, describe } from 'node:test';

describe('PHASE2 baseline — pending systems (TODO until their phase)', () => {
  test('Meeting Memory V2: first-class entities/topics/decisions tables (Phase 10)', { todo: 'NOT FOUND — only summary_json + RAG chunks today' }, () => {});
  test('Global Search V2: fusion-ranked search orchestrator (Phase 11)', { todo: 'NOT FOUND — only rag:query-global; Launcher literal search is fake' }, () => {});
  test('In-Meeting Search V2: fast local FTS/fuzzy + timestamps (Phase 12)', { todo: 'NOT FOUND — only rag:query-live' }, () => {});
  test('Conversation Memory: cross-session follow-up service (Phase 13)', { todo: 'NOT FOUND — same-session liveSessionMemory only' }, () => {});
  test('Lecture Intelligence V2: notes/concepts/flashcards/course memory (Phase 14)', { todo: 'NOT FOUND — lecture is a meeting mode only' }, () => {});
  test('Diagram Intelligence: Mermaid/PlantUML generation + validation (Phase 15)', { todo: 'NOT FOUND — no diagram generation in repo' }, () => {});
  test('Hindsight adapter + MemoryProvider + Noop fallback (Phase 16)', { todo: 'NOT FOUND — researched in Phase 0, adapter to be built' }, () => {});
  test('Context Fusion Engine + PromptContextContract (Phase 8)', { todo: 'NOT FOUND — fusion implicit in PromptAssembler trust-sort today' }, () => {});
  test('Privacy isolation: cross-user meeting-memory leak guard (Phase 16/18)', { todo: 'Needs memory layer first; ProfileTree isolation already covered' }, () => {});
});
