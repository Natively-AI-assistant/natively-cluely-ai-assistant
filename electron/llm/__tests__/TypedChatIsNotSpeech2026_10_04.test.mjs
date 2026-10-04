// A typed "hi" reached the model twice in one prompt (2026-10-04): once as a
// "User:" line, and once as "[ME]: hi" in the block the prompt describes as
// "the meeting's own recent speech". Typed chat is the user's, but nobody said
// it aloud; it now carries its own label.
//
// Also pinned here: only a reply to TYPED chat is tagged as a chat reply. The
// Answer button sends a SPOKEN question through the same handler, and its
// reply is a live suggestion.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const dist = (p) => import(pathToFileURL(path.resolve(root, 'dist-electron/electron', p)).href);

const { SessionTracker, TYPED_TURN_LABEL } = await dist('SessionTracker.js');
const { stripPriorAssistantTurns } = await dist('llm/conversationHistoryPolicy.js');
const { stripAssistantTurns } = await dist('llm/retrievalQueryPolicy.js');
const { TranscriptNormalizer } = await dist('services/meeting/TranscriptNormalizer.js');

const quiet = (fn) => {
  const log = console.log, warn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try { return fn(); } finally { console.log = log; console.warn = warn; }
};
const now = () => Date.now();

describe('the rolling context', () => {
  test('a typed line is labelled as typed, a spoken one as before', () => {
    const session = new SessionTracker();
    quiet(() => {
      session.addTranscript({ speaker: 'user', text: 'hi', timestamp: now() - 3000, final: true, origin: 'manual_chat' });
      session.addTranscript({ speaker: 'user', text: 'I led the billing migration.', timestamp: now() - 2000, final: true, origin: 'stt', confidence: 0.9 });
      session.addTranscript({ speaker: 'interviewer', text: 'How long did it take?', timestamp: now() - 1000, final: true, origin: 'stt', confidence: 0.9 });
    });
    assert.equal(TYPED_TURN_LABEL, 'ME TYPED');
    assert.equal(session.getFormattedContext(120), '[ME TYPED]: hi\n[ME]: I led the billing migration.\n[INTERVIEWER]: How long did it take?');
  });

  test('"what was said" leaves typed lines out', () => {
    const session = new SessionTracker();
    quiet(() => {
      session.addTranscript({ speaker: 'user', text: 'draw the architecture we described', timestamp: now() - 3000, final: true, origin: 'manual_chat' });
      session.addTranscript({ speaker: 'interviewer', text: 'The gateway talks to three services.', timestamp: now() - 2000, final: true, origin: 'stt', confidence: 0.9 });
    });
    assert.equal(session.getFormattedSpeech(600), '[INTERVIEWER]: The gateway talks to three services.');
  });

  test('the label is upper-case words only, so the label strippers still match it', () => {
    assert.match(TYPED_TURN_LABEL, /^[A-Z][A-Z0-9 _-]*$/);
  });
});

describe('the two parsers that split the context into turns', () => {
  const window = '[ASSISTANT (PREVIOUS SUGGESTION)]: I would start with the cache.\nIt is the cheapest fix.\n[ME TYPED]: make it shorter\n[INTERVIEWER]: Why the cache?';

  test('a typed line after an assistant turn starts a new turn (history policy)', () => {
    assert.equal(stripPriorAssistantTurns(window), '[ME TYPED]: make it shorter\n[INTERVIEWER]: Why the cache?');
  });

  test('a typed line after an assistant turn starts a new turn (retrieval query policy)', () => {
    const labelled = '[ASSISTANT]: I would start with the cache.\nIt is the cheapest fix.\n[ME TYPED]: make it shorter\n[ME]: Sure.';
    assert.equal(stripAssistantTurns(labelled).trim(), '[ME TYPED]: make it shorter\n[ME]: Sure.');
  });

  test('the prompt says what the label means', () => {
    const composer = fs.readFileSync(path.resolve(root, 'electron/context-intelligence/generation/prompt-composer.ts'), 'utf8');
    assert.match(composer, /a \[ME TYPED\] line is something the user typed to you, not something said in the meeting/);
  });
});

describe('which assistant lines are replies to typed chat', () => {
  const lastSaved = (session) => session.getFullTranscript().at(-1);

  test('a reply on the typed-chat surface is tagged', () => {
    const session = new SessionTracker();
    quiet(() => session.addAssistantMessage('Postgres fits that workload well.', undefined, 'manual_chat'));
    assert.deepEqual([lastSaved(session).origin, lastSaved(session).chatReply], ['assistant', true]);
  });

  test('a reply to a SPOKEN question sent through the same handler is not', () => {
    const session = new SessionTracker();
    quiet(() => session.addAssistantMessage('I led the billing migration over two quarters.', { answersSpokenQuestion: true }, 'manual_chat'));
    assert.equal(lastSaved(session).origin, 'assistant');
    assert.equal('chatReply' in lastSaved(session), false);
  });

  test('a live suggestion on another surface is not', () => {
    const session = new SessionTracker();
    quiet(() => session.addAssistantMessage('I would mention the latency numbers here.', undefined, 'what_to_answer'));
    assert.equal('chatReply' in lastSaved(session), false);
  });

  test('so the Answer-button exchange puts no Assistant line in the notes', () => {
    const session = new SessionTracker();
    quiet(() => {
      session.addTranscript({ speaker: 'user', text: 'What is your biggest weakness?', timestamp: now() - 2000, final: true, origin: 'stt', confidence: 0.9 });
      session.addAssistantMessage('I used to take on too much myself before delegating.', { answersSpokenQuestion: true }, 'manual_chat');
    });
    const normalized = new TranscriptNormalizer().normalize(session.getFullTranscript());
    assert.deepEqual(normalized.segments.map(s => [s.speaker, s.chat ?? null]), [['Me', null]]);
  });

  test('the reply is tagged from what was recorded, on every legacy-path write', () => {
    const src = fs.readFileSync(path.resolve(root, 'electron/ipcHandlers.ts'), 'utf8');
    // Only when the question is already on record as speech — a question that
    // had to be added as a typed line keeps its reply as a chat reply, so the
    // pair is never split.
    assert.match(src, /questionOnRecordAsSpeech \? \{ \.\.\.\(decision \?\? \(\{\} as T\)\), answersSpokenQuestion: true \} : decision/);
    const handlerStart = src.indexOf('const _geminiChatStreamHandler = async (');
    const handlerEnd = src.indexOf("safeHandle('gemini-chat-stream', _geminiChatStreamHandler);");
    const legacy = src.slice(src.indexOf('} catch (v3Err: any) {', handlerStart), handlerEnd);
    const writes = legacy.match(/intelligenceManager\.addAssistantMessage\([^;]*'manual_chat'\)/g) || [];
    assert.ok(writes.length >= 6, `expected the legacy path's reply writes, found ${writes.length}`);
    assert.deepEqual(writes.filter(call => !call.includes('forThisTurn(')), [], 'a legacy-path reply recorded without the turn marker');
  });
});

describe('the second formatter (What to Answer context)', () => {
  test('it uses the same label for a typed line', async () => {
    const tcb = await dist('llm/TemporalContextBuilder.js');
    const ctx = tcb.buildTemporalContext(
      [
        { role: 'user', typed: true, text: 'hi', timestamp: now() - 3000 },
        { role: 'user', text: 'I led the billing migration.', timestamp: now() - 2000 },
        { role: 'interviewer', text: 'How long did it take?', timestamp: now() - 1000 },
      ],
      [],
      180,
    );
    const rendered = JSON.stringify(ctx);
    assert.ok(rendered.includes('[ME TYPED]: hi'), rendered.slice(0, 300));
    assert.ok(rendered.includes('[ME]: I led the billing migration.'));
  });

  test('one constant, shared by both formatters', () => {
    const read = (p) => fs.readFileSync(path.resolve(root, p), 'utf8');
    assert.match(read('electron/llm/TemporalContextBuilder.ts'), /import \{ TYPED_TURN_LABEL \} from '\.\/typedTurnLabel';/);
    assert.match(read('electron/SessionTracker.ts'), /import \{ TYPED_TURN_LABEL \} from '\.\/llm\/typedTurnLabel';/);
  });
});
