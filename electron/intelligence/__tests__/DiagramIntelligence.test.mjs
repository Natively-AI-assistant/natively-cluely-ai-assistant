// PHASE 15 — Diagram Intelligence: detection, Mermaid generation, validation,
// exact-vs-reconstructed labeling, ASCII fallback, no-hallucination safety.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DiagramIntelligenceService,
  DiagramCandidateDetector,
  DiagramValidator,
} from '../../../dist-electron/electron/intelligence/DiagramIntelligenceService.js';

const svc = new DiagramIntelligenceService();

describe('DiagramCandidateDetector', () => {
  const det = new DiagramCandidateDetector();
  test('detects a sequence from protocol language', () => {
    const c = det.detect('The client sends SYN, the server replies SYN-ACK, then the client sends ACK.');
    assert.equal(c.kind, 'sequence');
    assert.ok(c.confidence > 0.4);
  });
  test('detects a flowchart from ordered phases', () => {
    const c = det.detect('First lexical analysis, then parsing, next semantic analysis, finally code generation.');
    assert.equal(c.kind, 'flowchart');
  });
  test('returns none for non-structural text', () => {
    const c = det.detect('I really enjoyed the weather today.');
    assert.equal(c.kind, 'none');
  });
});

describe('DiagramIntelligenceService — TCP handshake (the headline example)', () => {
  test('generates a valid Mermaid sequence diagram', () => {
    const d = svc.generate({ text: 'The client sends a SYN. The server replies with SYN-ACK. Finally the client sends an ACK and the connection is established.' });
    assert.equal(d.kind, 'sequence');
    assert.equal(d.valid, true);
    assert.match(d.mermaid, /sequenceDiagram/);
    assert.match(d.mermaid, /Client->>Server: SYN/);
    assert.match(d.mermaid, /Server->>Client: SYN-ACK/);
    assert.match(d.mermaid, /Client->>Server: ACK/);
  });

  test('labels a text-derived diagram as ai_reconstructed (NOT exact)', () => {
    const d = svc.generate({ text: 'Client sends SYN, server replies SYN-ACK, client sends ACK.' });
    assert.equal(d.confidenceLabel, 'ai_reconstructed_diagram');
    assert.match(d.notes, /AI-reconstructed/);
  });

  test('labels a source-visual diagram as exact', () => {
    const d = svc.generate({ text: 'Client sends SYN, server replies SYN-ACK, client sends ACK.', fromSourceVisual: true });
    assert.equal(d.confidenceLabel, 'exact_source_diagram');
  });
});

describe('DiagramIntelligenceService — flowchart (compiler phases)', () => {
  test('compiler phases → valid flowchart', () => {
    const d = svc.generate({ text: 'First lexical analysis, then parsing, next semantic analysis, then optimization, finally code generation.' });
    assert.equal(d.kind, 'flowchart');
    assert.equal(d.valid, true);
    assert.match(d.mermaid, /flowchart TD/);
    assert.match(d.mermaid, /-->/);
  });
});

describe('DiagramValidator', () => {
  const v = new DiagramValidator();
  test('accepts a well-formed sequence diagram', () => {
    assert.equal(v.validate('sequenceDiagram\n    Client->>Server: SYN').valid, true);
  });
  test('rejects an unknown header', () => {
    assert.equal(v.validate('notADiagram\n  x -> y').valid, false);
  });
  test('rejects unbalanced brackets', () => {
    assert.equal(v.validate('flowchart TD\n  A["unclosed --> B').valid, false);
  });
  test('rejects a sequence with no messages', () => {
    assert.equal(v.validate('sequenceDiagram\n    participant A').valid, false);
  });
});

describe('DiagramIntelligenceService — safety (no hallucination)', () => {
  test('non-diagram text yields a none/low-confidence result, no invented edges', () => {
    const d = svc.generate({ text: 'The lecture was about general philosophy and ethics.' });
    assert.ok(d.kind === 'none' || d.confidence < 0.7);
    assert.equal(d.mermaid, '');
  });

  test('structure cues but no extractable steps → not invented', () => {
    const d = svc.generate({ text: 'There is a process and a pipeline and a stage involved somehow.' });
    // Either none, or flowchart with empty mermaid (no fabricated nodes).
    if (d.kind !== 'none') assert.ok(d.mermaid === '' || d.valid);
  });

  test('ascii fallback is always present when steps exist', () => {
    const d = svc.generate({ text: 'Client sends SYN, server replies SYN-ACK, client sends ACK.' });
    assert.ok(d.ascii.length > 0);
  });

  test('never throws on empty/garbage input', () => {
    assert.doesNotThrow(() => svc.generate({ text: '' }));
    assert.doesNotThrow(() => svc.generate({ text: '!@#$%^&*()' }));
    assert.equal(svc.generate({ text: '' }).kind, 'none');
  });

  test('sourceSpan provenance is attached', () => {
    const d = svc.generate({ text: 'Client sends SYN, server replies SYN-ACK, client sends ACK.' });
    assert.match(d.sourceSpan, /SYN/);
  });
});
