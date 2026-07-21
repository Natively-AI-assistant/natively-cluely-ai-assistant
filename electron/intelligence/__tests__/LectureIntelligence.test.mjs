// PHASE 14 — Lecture Intelligence: structured notes, concepts, definitions,
// flashcards, exam questions, revision, course memory. Sample transcripts per prompt.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  LectureIntelligenceService,
  LectureConceptExtractor,
  LectureNoteGenerator,
  CourseMemoryService,
} from '../../../dist-electron/electron/intelligence/LectureIntelligenceService.js';

const TCP = [
  { text: 'Today we cover the TCP three-way handshake.', timestamp: 0 },
  { text: 'TCP is a connection-oriented protocol that guarantees ordered delivery.', timestamp: 1 },
  { text: 'The client sends a SYN segment to the server.', timestamp: 2 },
  { text: 'The server replies with a SYN-ACK segment.', timestamp: 3 },
  { text: 'Finally the client sends an ACK and the connection is established.', timestamp: 4 },
  { text: 'It is important to remember that SYN flooding is a denial of service attack.', timestamp: 5 },
  { text: 'For example, a half-open connection consumes server resources.', timestamp: 6 },
];

const DEADLOCK = [
  { text: 'A deadlock is a situation where two processes wait for each other forever.', timestamp: 0 },
  { text: 'The four Coffman conditions are mutual exclusion, hold and wait, no preemption, and circular wait.', timestamp: 1 },
  { text: 'Remember that breaking any one condition prevents deadlock.', timestamp: 2 },
];

describe('LectureConceptExtractor', () => {
  test('extracts concepts and definitions from the TCP lecture', () => {
    const ex = new LectureConceptExtractor();
    const { concepts, definitions } = ex.extract(TCP);
    assert.ok(concepts.some(c => /TCP|SYN|ACK/i.test(c.term)));
    assert.ok(definitions.some(d => /TCP/i.test(d.term) && /connection-oriented/i.test(d.definition)));
  });

  test('extracts the deadlock definition', () => {
    const ex = new LectureConceptExtractor();
    const { definitions } = ex.extract(DEADLOCK);
    assert.ok(definitions.some(d => /deadlock/i.test(d.term)));
  });
});

describe('LectureNoteGenerator — structured notes', () => {
  const gen = new LectureNoteGenerator();

  test('produces all the spec note sections for TCP', () => {
    const notes = gen.build({ lectureId: 'l1', segments: TCP, title: 'TCP Handshake', course: 'CN101', date: 100 });
    assert.equal(notes.title, 'TCP Handshake');
    assert.equal(notes.course, 'CN101');
    assert.ok(notes.topicsCovered.length > 0);
    assert.ok(notes.coreConcepts.length > 0);
    assert.ok(notes.definitions.length > 0);
    assert.ok(notes.importantPoints.some(p => /SYN flooding|important|remember/i.test(p)));
    assert.ok(notes.examples.some(e => /for example|half-open/i.test(e)));
    assert.ok(notes.likelyExamQuestions.length > 0);
    assert.ok(notes.flashcards.length > 0);
    assert.ok(notes.revisionChecklist.length > 0);
    assert.match(notes.cleanNotes, /## Topics Covered/);
    assert.match(notes.cleanNotes, /## Key Definitions/);
  });

  test('flashcards are Q/A pairs grounded in definitions', () => {
    const notes = gen.build({ lectureId: 'l1', segments: TCP, title: 'TCP' });
    const tcpCard = notes.flashcards.find(c => /TCP/i.test(c.front));
    assert.ok(tcpCard);
    assert.match(tcpCard.front, /^What is/);
    assert.match(tcpCard.back, /connection-oriented/i);
  });

  test('exam questions reference the concepts', () => {
    const notes = gen.build({ lectureId: 'l1', segments: DEADLOCK, title: 'Deadlock' });
    assert.ok(notes.likelyExamQuestions.some(q => /deadlock|Coffman|condition/i.test(q)));
  });

  test('NO interview/sales contamination (lecture stays a learning artifact)', () => {
    const notes = gen.build({ lectureId: 'l1', segments: TCP, title: 'TCP' });
    const blob = JSON.stringify(notes);
    assert.doesNotMatch(blob, /candidate|resume|hire|salary|objection|I am Natively/i);
  });

  test('never throws on empty transcript', () => {
    assert.doesNotThrow(() => gen.build({ lectureId: 'x', segments: [] }));
  });
});

describe('CourseMemoryService — cross-lecture memory', () => {
  test('tracks which lectures mention a concept', () => {
    const cm = new CourseMemoryService();
    cm.addLecture({ courseId: 'OS', lectureId: 'l1', topics: ['Deadlock'], concepts: ['Deadlock', 'Coffman'], summary: 's' });
    cm.addLecture({ courseId: 'OS', lectureId: 'l2', topics: ['Scheduling'], concepts: ['RoundRobin'], summary: 's' });
    const hits = cm.lecturesMentioning('OS', 'deadlock');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].lectureId, 'l1');
  });

  test('aggregates course concepts for a revision plan; re-processing is idempotent', () => {
    const cm = new CourseMemoryService();
    cm.addLecture({ courseId: 'OS', lectureId: 'l1', topics: ['Deadlock'], concepts: ['Deadlock'], summary: 's' });
    cm.addLecture({ courseId: 'OS', lectureId: 'l1', topics: ['Deadlock'], concepts: ['Deadlock', 'Mutex'], summary: 's2' }); // re-process
    assert.equal(cm.lectureCount('OS'), 1, 'same lecture replaces, not duplicates');
    assert.ok(cm.courseConcepts('OS').includes('Mutex'));
  });
});

describe('LectureIntelligenceService — facade', () => {
  test('generateNotes also populates course memory', () => {
    const svc = new LectureIntelligenceService();
    svc.generateNotes({ lectureId: 'l1', segments: TCP, title: 'TCP', course: 'CN101' });
    assert.equal(svc.courseMemory.lectureCount('CN101'), 1);
    assert.ok(svc.courseMemory.courseConcepts('CN101').length > 0);
  });
});
