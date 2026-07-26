// tools/app-intelligence-investigation/trace-app-flow.ts
//
// Read-only STATIC trace of the three primary user-question lifecycles in
// Natively:
//
//   A. manual chat           (user types into the chat overlay)
//   B. what-to-answer (WTA)  (live, audio-driven, posted to the overlay)
//   C. live meeting          (audio capture + STT + transcript + summary)
//
// This trace does NOT import any stateful service. It scans the static import
// graph inside `electron/llm/*` and `electron/intelligence/*` (which are pure
// TypeScript modules) and produces a *pure call graph* — the modules each
// leaf depends on. The runtime plumbing (IPC → handler → engine) is captured
// in prose and cross-referenced to the report at
// docs/NATIVELY_INTELLIGENCE_SYSTEM_CURRENT_STATE_REPORT.md (sections 2, 3,
// 4, 12, 13).
//
// Run with:
//   npx tsx tools/app-intelligence-investigation/trace-app-flow.ts

import * as fs from 'node:fs';
import * as path from 'node:path';

type StaticEdge = { from: string; to: string };

const PURE_DIRS = ['electron/llm', 'electron/intelligence'];
const PURE_FILE_SUFFIX_OK = (f: string): boolean =>
  /\.(ts|tsx)$/.test(f) && !f.endsWith('.d.ts') && !f.includes('__tests__') && !f.includes('.test.');

function rootDir(): string {
  return path.resolve(__dirname, '..', '..');
}

function listPureFiles(): string[] {
  const root = rootDir();
  const out: string[] = [];
  for (const dir of PURE_DIRS) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    walk(abs, out);
  }
  return out.map((f) => path.relative(root, f));
}

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(p, out);
    } else if (entry.isFile() && PURE_FILE_SUFFIX_OK(entry.name)) {
      out.push(p);
    }
  }
}

function parseImports(file: string): string[] {
  const text = fs.readFileSync(file, 'utf-8');
  const rel = path.relative(rootDir(), file);
  const dir = path.dirname(rel);
  const imports: string[] = [];
  const reImport = /import\s+[^"']*?from\s+["']([^"']+)["']/g;
  const reSideEffect = /import\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = reImport.exec(text)) !== null) imports.push(m[1]);
  while ((m = reSideEffect.exec(text)) !== null) imports.push(m[1]);
  const resolved: string[] = [];
  for (const spec of imports) {
    if (spec.startsWith('.')) {
      // Relative import: resolve against the importing file.
      const abs = path.resolve(path.join(rootDir(), dir), spec);
      const withExt = /\.tsx?$/.test(abs) ? abs : existsAnyExt(abs) ? abs : abs;
      const relPath = path.relative(rootDir(), withExt);
      resolved.push(normalizeImport(relPath));
    } else {
      // Skip node_modules / package imports — we only care about local pure files.
      continue;
    }
  }
  return resolved;
}

function existsAnyExt(p: string): string {
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const c = p + ext;
    if (fs.existsSync(c)) return c;
  }
  return p;
}

function normalizeImport(p: string): string {
  // Drop Windows separators and drop trailing slash.
  let n = p.replace(/\\/g, '/');
  if (n.endsWith('/')) n = n.slice(0, -1);
  return n;
}

function buildEdges(files: string[]): StaticEdge[] {
  const set = new Set(files);
  const out: StaticEdge[] = [];
  for (const f of files) {
    for (const dep of parseImports(f)) {
      const depClean = dep.replace(/\.tsx?$/, '');
      if (set.has(depClean + '.ts') || set.has(depClean + '.tsx')) {
        out.push({ from: f, to: depClean + (set.has(depClean + '.ts') ? '.ts' : '.tsx') });
      } else if (set.has(depClean)) {
        out.push({ from: f, to: depClean });
      }
    }
  }
  return out;
}

function findFilesByName(needle: string): string[] {
  return listPureFiles().filter((f) => f.toLowerCase().includes(needle.toLowerCase()));
}

function flowTraceA(): void {
  console.log('====================================================================');
  console.log('A. MANUAL CHAT — STATIC CALL GRAPH (pure modules only)');
  console.log('====================================================================');
  console.log('# The renderer entry is `electron/preload.ts:streamGeminiChat`.');
  console.log('# IPC channel: gemini-chat-stream.');
  console.log('# Handler:    electron/ipcHandlers.ts (gemini-chat-stream safeHandle).');
  console.log('# Wiring:     LLMHelper.streamChat  →  _streamChatInner.');
  console.log('# Pure modules consulted along the way:');
  for (const f of [
    'electron/llm/AnswerPlanner.ts',
    'electron/llm/AnswerValidator.ts',
    'electron/llm/contextRoute.ts',
    'electron/llm/sourceOwnership.ts',
    'electron/llm/customModeExecutionContract.ts',
    'electron/llm/manualProfileIntelligence.ts',
    'electron/llm/profileAnswerBackend.ts',
    'electron/llm/ProfileOutputValidator.ts',
    'electron/llm/ProfileIntelligenceRouter.ts',
    'electron/llm/documentGroundedPrompt.ts',
    'electron/llm/profileEvidenceValidator.ts',
    'electron/llm/streamContextPolicy.ts',
    'electron/llm/manualIdentityRouting.ts',
    'electron/llm/speakability.ts',
    'electron/llm/humanLikeness.ts',
    'electron/llm/answerStyle.ts',
    'electron/llm/answerPolish.ts',
    'electron/llm/codingContract.ts',
    'electron/llm/codingStreamGate.ts',
    'electron/llm/codingFollowup.ts',
    'electron/services/context/PromptAssembler.ts',
    'electron/services/context/TrustLevels.ts',
    'electron/services/context/ContextPacket.ts',
    'electron/intelligence/ContextRouter.ts',
    'electron/intelligence/ContextFusionEngine.ts',
    'electron/intelligence/ProfileTreeService.ts',
    'electron/intelligence/intelligenceFlags.ts',
  ]) {
    const abs = path.join(rootDir(), f);
    if (fs.existsSync(abs)) console.log('  ✓ ' + f);
    else console.log('  ✗ ' + f + '  (not present)');
  }
}

function flowTraceB(): void {
  console.log('');
  console.log('====================================================================');
  console.log('B. WHAT-TO-ANSWER — STATIC CALL GRAPH (pure modules only)');
  console.log('====================================================================');
  console.log('# Renderer entry: window.electronAPI.generateSuggestion(...)');
  console.log('# IPC channel:   generate-what-to-say (mirror __e2e__:wta-ask)');
  console.log('# Handler:      electron/ipcHandlers.ts (generate-what-to-say).');
  console.log('# Wiring:       IntelligenceEngine.runWhatShouldISay →');
  console.log('#               WhatToAnswerLLM.generateStream → PromptAssembler.');
  console.log('# Pure modules consulted along the way:');
  for (const f of [
    'electron/llm/WhatToAnswerLLM.ts',
    'electron/llm/AnswerPlanner.ts',
    'electron/llm/contextRoute.ts',
    'electron/llm/sourceOwnership.ts',
    'electron/llm/customModeExecutionContract.ts',
    'electron/llm/liveSessionMemory.ts',
    'electron/llm/liveSessionMemoryConfig.ts',
    'electron/llm/SessionMemory.ts',
    'electron/llm/TemporalContextBuilder.ts',
    'electron/llm/transcriptQuestionExtractor.ts',
    'electron/llm/transcriptCleaner.ts',
    'electron/llm/transcriptEntityExtractor.ts',
    'electron/llm/liveDeadlines.ts',
    'electron/llm/whatToAnswerRequestSnapshot.ts',
    'electron/llm/sessionFollowupResolver.ts',
    'electron/llm/manualProfileIntelligence.ts',
    'electron/llm/profileAnswerBackend.ts',
    'electron/llm/documentGroundedPrompt.ts',
    'electron/services/context/PromptAssembler.ts',
    'electron/services/context/TrustLevels.ts',
    'electron/services/context/ContextPacket.ts',
    'electron/intelligence/LiveTranscriptBrain.ts',
    'electron/intelligence/LiveMomentRouter.ts',
    'electron/intelligence/ContextFusionEngine.ts',
    'electron/intelligence/intelligenceFlags.ts',
  ]) {
    const abs = path.join(rootDir(), f);
    if (fs.existsSync(abs)) console.log('  ✓ ' + f);
    else console.log('  ✗ ' + f + '  (not present)');
  }
}

function flowTraceC(): void {
  console.log('');
  console.log('====================================================================');
  console.log('C. LIVE MEETING — STATIC CALL GRAPH (pure modules only)');
  console.log('====================================================================');
  console.log('# Renderer entry: window.electronAPI.startMeeting(metadata).');
  console.log('# IPC channel:   start-meeting, end-meeting, regenerate-meeting-summary, ...');
  console.log('# Pure modules consulted along the way:');
  for (const f of [
    'electron/services/meeting/MeetingContextAssembler.ts',
    'electron/services/meeting/MeetingSummaryV3.ts',
    'electron/services/meeting/MeetingSummaryReducer.ts',
    'electron/services/meeting/ChunkSummaryGenerator.ts',
    'electron/services/meeting/FollowUpDraftGenerator.ts',
    'electron/services/meeting/SpeakerLabelService.ts',
    'electron/services/meeting/CrossMeetingRecall.ts',
    'electron/services/meeting/MeetingModeDetector.ts',
    'electron/services/meeting/MeetingRecipes.ts',
    'electron/services/meeting/MeetingSummarySchemaValidator.ts',
    'electron/services/meeting/MeetingSummaryStrategySelector.ts',
    'electron/services/meeting/SummaryPolisher.ts',
    'electron/services/meeting/SectionPromptCompiler.ts',
    'electron/services/meeting/TranscriptChunker.ts',
    'electron/services/meeting/TranscriptNormalizer.ts',
    'electron/services/post-call/PostCallWorkflow.ts',
    'electron/llm/RecapLLM.ts',
    'electron/llm/FollowUpLLM.ts',
    'electron/intelligence/MeetingMemoryService.ts',
    'electron/intelligence/ConversationMemoryService.ts',
    'electron/intelligence/LiveTranscriptBrain.ts',
    'electron/intelligence/LiveMomentRouter.ts',
    'electron/intelligence/LectureIntelligenceService.ts',
    'electron/intelligence/DiagramIntelligenceService.ts',
    'electron/intelligence/intelligenceFlags.ts',
  ]) {
    const abs = path.join(rootDir(), f);
    if (fs.existsSync(abs)) console.log('  ✓ ' + f);
    else console.log('  ✗ ' + f + '  (not present)');
  }
}

function importGraphOverview(): void {
  console.log('');
  console.log('====================================================================');
  console.log('D. STATIC IMPORT GRAPH — pure modules only');
  console.log('====================================================================');
  const files = listPureFiles();
  const edges = buildEdges(files);
  // Sort by out-degree to find chokepoints.
  const outDeg = new Map<string, number>();
  for (const e of edges) outDeg.set(e.from, (outDeg.get(e.from) || 0) + 1);
  const hubs = [...outDeg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log('# Top 15 import hubs in electron/llm + electron/intelligence:');
  for (const [file, n] of hubs) {
    console.log(`  ${String(n).padStart(3)} ← ${file}`);
  }

  // Most-imported (in-degree) tells us which pure modules are leafs of the
  // pure dependency tree — these are the modules a future change must respect.
  const inDeg = new Map<string, number>();
  for (const e of edges) inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1);
  const leaves = [...inDeg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log('');
  console.log('# Top 15 most-imported pure modules (fan-in):');
  for (const [file, n] of leaves) {
    console.log(`  ${String(n).padStart(3)} → ${file}`);
  }

  // A few canonical file probes — for each, list the modules that import it
  // (its callers). This is the "who would a future change break?" view.
  console.log('');
  console.log('# Caller fan-in for the most-critical pure modules:');
  const TARGETS = [
    'electron/llm/sourceOwnership.ts',
    'electron/llm/customModeExecutionContract.ts',
    'electron/llm/contextRoute.ts',
    'electron/llm/documentGroundedPrompt.ts',
    'electron/llm/AnswerPlanner.ts',
    'electron/llm/manualProfileIntelligence.ts',
    'electron/llm/profileAnswerBackend.ts',
    'electron/intelligence/ContextRouter.ts',
    'electron/intelligence/LiveTranscriptBrain.ts',
    'electron/intelligence/ProfileTreeService.ts',
  ];
  for (const t of TARGETS) {
    const callers = edges.filter((e) => e.to === t).map((e) => e.from);
    if (callers.length === 0) {
      console.log(`  ${t}  ← (no pure-module callers)`);
      continue;
    }
    console.log(`  ${t}  ←`);
    for (const c of callers.slice(0, 12)) console.log(`     ${c}`);
    if (callers.length > 12) console.log(`     ... and ${callers.length - 12} more`);
  }
}

function main(): void {
  console.log('# Static call-graph trace — pure modules only.');
  console.log('# This script NEVER imports stateful services. It walks the static');
  console.log('# import graph of electron/llm/* and electron/intelligence/* and emits');
  console.log('# a structural view of how the three primary flows are wired.');
  console.log('');
  flowTraceA();
  flowTraceB();
  flowTraceC();
  importGraphOverview();
  console.log('');
  console.log('# End of trace-app-flow.ts output.');
}

main();