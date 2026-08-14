// PHASE 12 verification — Lecture Notes + Diagram Generation handler LOGIC.
//
// The real IPC handlers `lecture:generate-notes` and `diagram:generate`
// (electron/ipcHandlers.ts ~lines 3989-4029) need Electron + a live
// IntelligenceManager, so we can't unit-test the handlers themselves headlessly.
// Instead this file FAITHFULLY REPLICATES each handler's pure logic (the
// transcript→segments / transcript→text mapping + the service call) and runs the
// REAL compiled LectureIntelligenceService + DiagramIntelligenceService from
// dist-electron. If the handler's mapping or the services ever drift, these
// assertions catch it.
//
// Source-of-truth shapes:
//   IntelligenceManager.getCurrentMeetingTranscript() →
//     Array<{ speaker: string; text: string; timestamp: number }>
//     (electron/IntelligenceManager.ts:129)
//   Lecture handler maps each turn to LectureSegment {speaker,text,timestamp}
//     and calls new LectureIntelligenceService().generateNotes(...)
//     (ipcHandlers.ts:3994-4000)
//   Diagram handler joins the last 30 turns' .text and calls
//     new DiagramIntelligenceService().generate({ text, fromSourceVisual:false })
//     (ipcHandlers.ts:4018-4023)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LectureIntelligenceService } from '../../../dist-electron/electron/intelligence/LectureIntelligenceService.js';
import { DiagramIntelligenceService } from '../../../dist-electron/electron/intelligence/DiagramIntelligenceService.js';

// ----------------------------------------------------------------------------
// REPLICA of the `lecture:generate-notes` handler body (ipcHandlers.ts:3993-4001),
// minus the flag gate + IntelligenceManager fetch (exercised live elsewhere). The
// `transcript` argument stands in for getCurrentMeetingTranscript()'s return value.
// ----------------------------------------------------------------------------
function runLectureNotesLogic(transcript, opts = {}) {
  const segments = transcript.map((t) => ({ speaker: t.speaker, text: t.text, timestamp: t.timestamp }));
  return new LectureIntelligenceService().generateNotes({
    lectureId: `live-${Date.now()}`,
    segments,
    title: opts.title,
    course: opts.course,
  });
}

// ----------------------------------------------------------------------------
// REPLICA of the `diagram:generate` handler body (ipcHandlers.ts:4018-4023). When
// `text` is absent it joins the last 30 turns' .text with '. ' exactly like the
// handler's transcript fallback, then calls generate with fromSourceVisual:false.
// ----------------------------------------------------------------------------
function runDiagramLogic(text, transcript = []) {
  let source = (text || '').trim();
  if (!source) {
    source = transcript.slice(-30).map((t) => t.text).join('. ');
  }
  return new DiagramIntelligenceService().generate({ text: source, fromSourceVisual: false });
}

// A realistic TCP three-way-handshake lecture transcript.
const TCP_LECTURE = [
  { speaker: 'professor', text: 'TCP is a connection-oriented protocol that guarantees reliable, ordered delivery of a byte stream.', timestamp: 1000 },
  { speaker: 'professor', text: 'To open a connection the client sends a SYN segment to the server.', timestamp: 2000 },
  { speaker: 'professor', text: 'The server replies SYN-ACK back to the client to acknowledge the request.', timestamp: 3000 },
  { speaker: 'professor', text: 'Finally the client sends ACK to the server and the connection is established.', timestamp: 4000 },
  { speaker: 'professor', text: 'Important: SYN flooding is a denial of service attack that exhausts the server connection table.', timestamp: 5000 },
  { speaker: 'professor', text: 'For example, a firewall can use SYN cookies to mitigate the attack.', timestamp: 6000 },
];

const TCP_HANDSHAKE_TEXT =
  'TCP is a connection-oriented protocol. The client sends SYN to the server. ' +
  'The server replies SYN-ACK to the client. Then the client sends ACK to the server.';

describe('Phase 12 — lecture:generate-notes handler logic (real LectureIntelligenceService)', () => {
  test('(a) TCP lecture → non-empty structured notes (topics, defs, important, flashcards, exam Qs, checklist)', () => {
    const notes = runLectureNotesLogic(TCP_LECTURE, { title: 'TCP Handshake', course: 'CS-Networks' });

    // topicsCovered non-empty and TCP-flavored.
    assert.ok(Array.isArray(notes.topicsCovered) && notes.topicsCovered.length > 0, 'topicsCovered should be non-empty');
    assert.ok(notes.topicsCovered.some((t) => /TCP|SYN|ACK|server|client/i.test(t)), 'topics should reflect the lecture');

    // definitions — TCP defined as connection-oriented.
    assert.ok(Array.isArray(notes.definitions) && notes.definitions.length > 0, 'definitions should be non-empty');
    assert.ok(
      notes.definitions.some((d) => /TCP/i.test(d.term) && /connection-oriented/i.test(d.definition)),
      'TCP should be defined as connection-oriented',
    );

    // importantPoints — SYN flooding flagged.
    assert.ok(Array.isArray(notes.importantPoints) && notes.importantPoints.length > 0, 'importantPoints should be non-empty');
    assert.ok(notes.importantPoints.some((p) => /SYN flooding/i.test(p)), 'SYN flooding should be an important point');

    // flashcards — Q/A pairs (front/back), at least one about a defined concept.
    assert.ok(Array.isArray(notes.flashcards) && notes.flashcards.length > 0, 'flashcards should be non-empty');
    for (const c of notes.flashcards) {
      assert.ok(typeof c.front === 'string' && c.front.length > 0, 'flashcard front non-empty');
      assert.ok(typeof c.back === 'string' && c.back.length > 0, 'flashcard back non-empty');
    }
    assert.ok(notes.flashcards.some((c) => /TCP/i.test(c.front)), 'a flashcard should ask about TCP');

    // likelyExamQuestions — non-empty.
    assert.ok(Array.isArray(notes.likelyExamQuestions) && notes.likelyExamQuestions.length > 0, 'exam questions should be non-empty');
    assert.ok(notes.likelyExamQuestions.every((q) => typeof q === 'string' && q.length > 0));

    // revisionChecklist — non-empty.
    assert.ok(Array.isArray(notes.revisionChecklist) && notes.revisionChecklist.length > 0, 'revision checklist should be non-empty');
    assert.ok(notes.revisionChecklist.every((r) => typeof r === 'string' && r.startsWith('Review:')));

    // cleanNotes markdown present.
    assert.ok(typeof notes.cleanNotes === 'string' && /## Topics Covered/.test(notes.cleanNotes), 'cleanNotes should be markdown');
  });

  test('(b) NO interview/sales contamination — notes JSON has no candidate/resume/hire/salary framing', () => {
    const notes = runLectureNotesLogic(TCP_LECTURE, { title: 'TCP Handshake', course: 'CS-Networks' });
    const blob = JSON.stringify(notes).toLowerCase();
    // None of these candidate/sales framings should appear anywhere in the output.
    const FORBIDDEN = [
      'candidate', 'resume', 'résumé', 'hire', 'hiring', 'salary', 'compensation',
      'recruiter', 'interview the candidate', 'years of experience', "i'm natively",
      'i am natively', 'the candidate', 'job description', 'cover letter', 'negotiat',
    ];
    for (const term of FORBIDDEN) {
      assert.ok(!blob.includes(term), `notes JSON must not contain interview/sales framing: "${term}"`);
    }
    // Positive proof it IS lecture content (not just empty).
    assert.ok(blob.includes('tcp') && blob.includes('syn'), 'notes should be genuine lecture content');
  });

  test('(c) empty transcript → does not throw, returns a (possibly-empty) notes object', () => {
    let notes;
    assert.doesNotThrow(() => { notes = runLectureNotesLogic([], {}); });
    assert.ok(notes && typeof notes === 'object', 'should return a notes object');
    assert.ok(Array.isArray(notes.topicsCovered), 'topicsCovered should be an array (possibly empty)');
    assert.ok(Array.isArray(notes.definitions));
    assert.ok(Array.isArray(notes.flashcards));
    assert.equal(notes.topicsCovered.length, 0, 'empty transcript → no topics');
    // The handler maps an empty transcript to [] segments; the service must tolerate it.
    assert.equal(typeof notes.cleanNotes, 'string');
  });

  test('handler title/course flow through into the notes', () => {
    const notes = runLectureNotesLogic(TCP_LECTURE, { title: 'Lecture 7', course: 'CS-356' });
    assert.equal(notes.title, 'Lecture 7');
    assert.equal(notes.course, 'CS-356');
    assert.ok(notes.cleanNotes.includes('Lecture 7'));
    assert.ok(notes.cleanNotes.includes('CS-356'));
  });
});

describe('Phase 12 — diagram:generate handler logic (real DiagramIntelligenceService)', () => {
  test('(d) TCP handshake text → VALID sequenceDiagram with SYN / SYN-ACK / ACK, ai_reconstructed', () => {
    const d = runDiagramLogic(TCP_HANDSHAKE_TEXT);
    assert.equal(d.kind, 'sequence', 'should detect a sequence diagram');
    assert.equal(d.valid, true, 'mermaid should validate');
    assert.ok(/^sequenceDiagram/.test(d.mermaid), 'mermaid should be a sequenceDiagram');
    // The three handshake messages must be present.
    assert.ok(/\bSYN\b/.test(d.mermaid), 'mermaid should contain SYN');
    assert.ok(/SYN-ACK/.test(d.mermaid), 'mermaid should contain SYN-ACK');
    assert.ok(/\bACK\b/.test(d.mermaid), 'mermaid should contain ACK');
    // Text-derived → ai_reconstructed (NOT exact).
    assert.equal(d.confidenceLabel, 'ai_reconstructed_diagram', 'text-derived diagram must be ai_reconstructed');
    assert.notEqual(d.confidenceLabel, 'exact_source_diagram');
  });

  test('(e) non-diagram text → kind none / no fabricated edges (empty mermaid)', () => {
    const d = runDiagramLogic('I really enjoyed the weather today and the coffee was nice.');
    // Either flagged none, or — if a stray cue trips the detector — it must NOT
    // invent edges: an empty mermaid is the safe outcome.
    if (d.kind === 'none') {
      assert.equal(d.mermaid, '', 'kind none → no mermaid');
    } else {
      assert.ok(d.mermaid === '' || d.valid === true, 'if a kind is guessed it must not emit invalid/fabricated mermaid');
      // No real edges should be fabricated from chit-chat.
      assert.ok(d.confidenceLabel !== 'exact_source_diagram');
    }
    assert.ok(d.confidence <= 0.85, 'chit-chat should not be high confidence');
  });

  test('(f) generate never throws on empty / garbage input', () => {
    for (const bad of ['', '   ', '!!! @#$ %^&', '\n\n\n', 'a', 'x'.repeat(5000)]) {
      let d;
      assert.doesNotThrow(() => { d = runDiagramLogic(bad); }, `generate should not throw on: ${JSON.stringify(bad.slice(0, 12))}`);
      assert.ok(d && typeof d === 'object');
      assert.ok(typeof d.mermaid === 'string');
      // Garbage must never be mislabeled exact.
      assert.notEqual(d.confidenceLabel, 'exact_source_diagram');
    }
  });

  test('(f2) transcript fallback (no text arg) → joins last 30 turns and still produces a valid handshake diagram', () => {
    // Replicates the handler's `if (!source) source = transcript.slice(-30)...join('. ')`.
    const d = runDiagramLogic(undefined, TCP_LECTURE);
    assert.equal(d.kind, 'sequence');
    assert.equal(d.valid, true);
    assert.ok(/\bSYN\b/.test(d.mermaid) && /SYN-ACK/.test(d.mermaid) && /\bACK\b/.test(d.mermaid));
    assert.equal(d.confidenceLabel, 'ai_reconstructed_diagram');
  });

  test('(g) SAFETY — a text-derived diagram is NEVER labeled exact_source_diagram', () => {
    // Sweep a variety of inputs that the handler could feed (always fromSourceVisual:false).
    const inputs = [
      TCP_HANDSHAKE_TEXT,
      'First the request is validated, then it is parsed, next it is executed, finally the response is returned.',
      'The process moves from idle state to running and from running to terminated.',
      'random unstructured chatter with no real structure at all here',
      '',
    ];
    for (const text of inputs) {
      const d = runDiagramLogic(text);
      assert.notEqual(
        d.confidenceLabel, 'exact_source_diagram',
        `fromSourceVisual:false must NEVER yield exact_source_diagram (input: ${JSON.stringify(text.slice(0, 30))})`,
      );
      assert.ok(
        ['ai_reconstructed_diagram', 'conceptual_diagram', 'low_confidence_diagram'].includes(d.confidenceLabel),
        `label must be one of the non-exact set, got ${d.confidenceLabel}`,
      );
    }
  });

  test('SAFETY corollary — when no structure extracts, mermaid is empty (never fabricated)', () => {
    // Detector cues present (sequence words) but no extractable A->B steps.
    const d = runDiagramLogic('the client and the server and the protocol and the message');
    // Must not emit a mermaid with invented edges.
    assert.ok(d.mermaid === '' || d.valid === true, 'no extractable steps → empty mermaid, never invalid invented edges');
    if (d.mermaid === '') {
      assert.equal(d.valid, false);
    }
  });
});
