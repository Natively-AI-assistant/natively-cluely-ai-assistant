// electron/services/__tests__/CompanyResearchModeGate2026_09_04.test.mjs
//
// Routing audit follow-up (2026-09-04). The orchestrator's company-research
// gate was `needsCompanyResearch(question) && this.activeJD`, with no notion of
// the active mode. `needsCompanyResearch` is a substring test over
// COMPANY_RESEARCH_PATTERNS — which contains the bare tokens `company`,
// `reviews` and `funding` — OR'd with a NEGOTIATION verdict, and the second
// condition is only that a JD happens to be loaded. A JD persists across
// sessions and across modes.
//
// So a Team Meet turn containing "reviews" could put a query on the wire to an
// external search provider. In exactly those modes the host then DISCARDS the
// whole knowledge result: LLMHelper's intercept gate runs after processQuestion
// has already returned. The call could never change the answer, only leak the
// query and spend the budget.
//
// The per-mode verdicts are already covered by ModesManager.test.mjs (issue
// #272). This file pins the invariant that test cannot see: that company
// research now asks the SAME question, so the set of modes that discard the
// result stays identical to the set that no longer requests it. Drift between
// those two sets is the failure mode, and it is silent.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(repoRoot, p), 'utf8');

describe('company research is gated by the active mode', () => {
  test('the compiled orchestrator exposes the opt-in setter', async () => {
    const mod = await import(
      pathToFileURL(path.join(repoRoot, 'dist-electron/premium/electron/knowledge/KnowledgeOrchestrator.js')).href
    );
    const Orchestrator = mod.KnowledgeOrchestrator;
    assert.ok(Orchestrator, 'KnowledgeOrchestrator must be exported');
    assert.equal(
      typeof Orchestrator.prototype.setCompanyResearchAllowedFn,
      'function',
      'the host has no way to narrow company research without this setter',
    );
  });

  test('the dossier gate consults the predicate', () => {
    const src = read('premium/electron/knowledge/KnowledgeOrchestrator.ts');
    assert.match(
      src,
      /if \(needsCompanyResearch\(question\) && this\.activeJD && this\.isCompanyResearchAllowed\(\)\) \{/,
      'the mode predicate must be part of the dossier gate itself, not a later branch',
    );
  });

  test('an unwired or throwing predicate fails OPEN', () => {
    const src = read('premium/electron/knowledge/KnowledgeOrchestrator.ts');
    const start = src.indexOf('private isCompanyResearchAllowed()');
    assert.ok(start > -1, 'the predicate helper must exist');
    const body = src.slice(start, src.indexOf('\n    }', start));

    // Unset must mean allow: a host that never wires this keeps today's
    // behaviour byte for byte. A submodule must not narrow its consumers.
    assert.match(body, /if \(!this\.companyResearchAllowedFn\) return true;/,
      'unset must default to allow');
    // A broken host predicate must not silently disable a paid capability.
    assert.match(body, /catch\s*\{[\s\S]*return true;/,
      'a throwing predicate must fail open, not closed');
  });

  test('the host wires it to the SAME predicate that discards the result', () => {
    const main = read('electron/main.ts');
    const wireIdx = main.indexOf('setCompanyResearchAllowedFn(');
    assert.ok(wireIdx > -1, 'main.ts must wire the predicate or the fix is inert');

    const block = main.slice(wireIdx, wireIdx + 700);
    assert.match(
      block,
      /isPremiumKnowledgeInterceptAllowed\(\)/,
      'company research must ask the same question as the consumption gate, or the two sets drift',
    );

    // Optional-capability guard, matching the sibling premium wiring: an older
    // premium build without the setter must not throw at startup.
    const before = main.slice(Math.max(0, wireIdx - 300), wireIdx);
    assert.match(
      before,
      /typeof this\.knowledgeOrchestrator\.setCompanyResearchAllowedFn === 'function'/,
      'the wiring must be guarded so an older premium build still boots',
    );
  });

  test('the consumption gate still uses the predicate this fix mirrors', () => {
    // If LLMHelper ever stops gating on isPremiumKnowledgeInterceptAllowed, the
    // justification for narrowing research ("the result is discarded anyway")
    // no longer holds and this fix must be revisited rather than left in place.
    const helper = read('electron/LLMHelper.ts');
    assert.match(
      helper,
      /this\.isPremiumKnowledgeInterceptAllowed\(\)/,
      'the premise of this fix is that the host discards the result in these modes',
    );
  });
});
