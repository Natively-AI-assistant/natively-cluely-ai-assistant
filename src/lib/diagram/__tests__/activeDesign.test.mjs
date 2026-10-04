import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createActiveDesignState, activeDesignFromHistory, designOverlap, latestDiagramInAnswer, ACTIVE_DESIGN_TTL_MS } from '../activeDesign.mjs';

const fence = (source) => '```mermaid\n' + source + '\n```';

const NOTIFY_V1 = [
  'flowchart LR',
  '    producer["Producer Service"] -->|"enqueue"| queue["Notification Queue"]',
  '    queue --> worker["Delivery Worker"]',
  '    worker -->|"send"| provider["Email / SMS Provider"]',
].join('\n');
const NOTIFY_V2 = NOTIFY_V1 + '\n    worker -->|"failed"| retry["Retry Queue"]\n    worker -->|"exhausted"| dlq["Dead-Letter Queue"]';
const NOTIFY_SEQ = [
  'sequenceDiagram',
  '    participant P as Producer Service',
  '    participant Q as Notification Queue',
  '    participant W as Delivery Worker',
  '    P->>Q: enqueue',
  '    Q->>W: deliver',
].join('\n');
const PARKING = [
  'flowchart LR',
  '    gate["Entry Gate"] --> allocator["Spot Allocator"]',
  '    allocator --> floors[("Floor Map")]',
  '    gate --> tickets["Ticket Printer"]',
].join('\n');

const answer = (lead, source, tail = 'Explanation follows.') => `${lead}\n\n${fence(source)}\n\n${tail}`;

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('active design state', () => {
  test('starts empty; an answer without a diagram leaves it empty', () => {
    const s = createActiveDesignState();
    assert.equal(s.get(), null);
    assert.equal(s.observeAnswer('Rate limiting caps how often a client may call.'), null);
    assert.equal(s.get(), null);
  });

  test('the first diagram becomes version 1 with the question it was drawn for', () => {
    const s = createActiveDesignState();
    s.noteDesignQuestion('Design a notification system');
    const d = s.observeAnswer(answer("I'd queue every send.", NOTIFY_V1));
    assert.equal(d.version, 1);
    assert.equal(d.artifactId, 'design-1.v1');
    assert.equal(d.parentArtifactId, undefined);
    assert.equal(d.view, 'architecture');
    assert.equal(d.source, NOTIFY_V1);
    assert.equal(d.question, 'Design a notification system');
  });

  test('an update is a NEW version pointing at its parent; the old source is not rewritten', () => {
    const s = createActiveDesignState();
    const v1 = s.observeAnswer(answer('First.', NOTIFY_V1));
    const v2 = s.observeAnswer(answer('Adding retries and a dead-letter queue.', NOTIFY_V2));
    assert.equal(v2.version, 2);
    assert.equal(v2.artifactId, 'design-1.v2');
    assert.equal(v2.parentArtifactId, v1.artifactId);
    assert.equal(v2.lineageId, v1.lineageId);
    assert.equal(v1.source, NOTIFY_V1, 'the earlier snapshot is untouched');
  });

  test('another view of the same system stays in the lineage and changes the view', () => {
    const s = createActiveDesignState();
    s.observeAnswer(answer('First.', NOTIFY_V1));
    const seq = s.observeAnswer(answer('The delivery sequence.', NOTIFY_SEQ));
    assert.equal(seq.view, 'sequence');
    assert.equal(seq.lineageId, 'design-1');
    assert.equal(seq.version, 2);
  });

  test('an explanation or a code answer keeps the design as it is', () => {
    const s = createActiveDesignState();
    const v1 = s.observeAnswer(answer('First.', NOTIFY_V1));
    // "Why do we need the queue?" — a turn about the design, answered in prose.
    s.touch();
    s.observeAnswer('The queue decouples producers from a slow provider.');
    assert.deepEqual({ ...s.get(), updatedAt: v1.updatedAt }, v1, 'an explanation of the design changes nothing');
    s.observeAnswer('```ts\nexport async function worker() {}\n```');
    // Same design, same version — only the focus moved to the code.
    assert.deepEqual({ ...s.get(), foreground: true, updatedAt: v1.updatedAt }, v1);
  });

  test('a code answer after the design moves focus off it; a new diagram brings it back', () => {
    const s = createActiveDesignState();
    assert.equal(s.observeAnswer(answer('First.', NOTIFY_V1)).foreground, true);
    s.touch();
    s.observeAnswer('The queue decouples producers.');
    assert.equal(s.get().foreground, true, 'an answer ABOUT the design does not move focus');
    s.observeAnswer('Here is the worker:\n\n```ts\nexport async function worker() {}\n```');
    assert.equal(s.get().foreground, false);
    assert.equal(s.get().source, NOTIFY_V1, 'the design itself is still on the table');
    assert.equal(s.observeAnswer(answer('Updated.', NOTIFY_V2)).foreground, true);
  });

  test('a refined answer that keeps the same diagram does not create a version', () => {
    const s = createActiveDesignState();
    const v1 = s.observeAnswer(answer('A long first answer.', NOTIFY_V1));
    const again = s.observeAnswer(answer('Shorter.', NOTIFY_V1, 'Done.'));
    assert.equal(again.version, 1);
    assert.equal(again.artifactId, v1.artifactId);
  });

  test('an unrelated new design starts a new lineage', () => {
    const s = createActiveDesignState();
    s.observeAnswer(answer('First.', NOTIFY_V1));
    const parking = s.observeAnswer(answer('A parking lot.', PARKING));
    assert.equal(parking.lineageId, 'design-2');
    assert.equal(parking.version, 1);
    assert.equal(parking.parentArtifactId, undefined);
  });

  test('a fresh design ask starts a new lineage even when component names overlap', () => {
    const s = createActiveDesignState();
    s.observeAnswer(answer('First.', NOTIFY_V1));
    s.noteDesignQuestion('Design an email campaign system');
    const d = s.observeAnswer(answer('Another queue-and-worker design.', NOTIFY_V2));
    assert.equal(d.lineageId, 'design-2');
    assert.equal(d.question, 'Design an email campaign system');
  });

  test('a block that fails policy, or is cut off, never becomes the design', () => {
    const s = createActiveDesignState();
    s.observeAnswer(answer('Bad.', 'pie title Pets\n    "Dogs" : 3'));
    assert.equal(s.get(), null);
    s.observeAnswer('Cut off.\n\n```mermaid\nflowchart LR\n    a --> b');
    assert.equal(s.get(), null);
    s.observeAnswer(answer('Unsafe.', 'flowchart LR\n    a["<script>x</script>"] --> b'));
    assert.equal(s.get(), null);
  });

  test('clear() drops it (new meeting, mode switch, session reset)', () => {
    const s = createActiveDesignState();
    s.observeAnswer(answer('First.', NOTIFY_V1));
    s.clear();
    assert.equal(s.get(), null);
  });

  test('it expires after a quiet half hour', () => {
    const c = clock();
    const s = createActiveDesignState({ now: c.now });
    s.observeAnswer(answer('First.', NOTIFY_V1));
    c.advance(ACTIVE_DESIGN_TTL_MS - 1);
    assert.ok(s.get());
    c.advance(2);
    assert.equal(s.get(), null);
  });

  test('applyRepair swaps only the exact broken source', () => {
    const s = createActiveDesignState();
    s.observeAnswer(answer('First.', NOTIFY_V1));
    assert.equal(s.applyRepair('flowchart LR\n    other --> thing', NOTIFY_V2), false, 'different source is refused');
    assert.equal(s.get().source, NOTIFY_V1);
    assert.equal(s.applyRepair(NOTIFY_V1, 'pie title no'), false, 'a repair that fails policy is refused');
    assert.equal(s.applyRepair(NOTIFY_V1, NOTIFY_V2), true);
    assert.equal(s.get().source, NOTIFY_V2);
    assert.equal(s.get().version, 1, 'a repair is not a new version');
  });

  test('get() returns a copy', () => {
    const s = createActiveDesignState();
    s.observeAnswer(answer('First.', NOTIFY_V1));
    s.get().source = 'tampered';
    assert.equal(s.get().source, NOTIFY_V1);
  });
});

describe('helpers', () => {
  test('latestDiagramInAnswer picks the last valid closed block', () => {
    const code = '```ts\nconst x = 1;\n```';
    assert.equal(latestDiagramInAnswer(`${fence(NOTIFY_SEQ)}\n\nand code\n\n${code}`).view, 'sequence');
    assert.equal(latestDiagramInAnswer(`${fence(NOTIFY_SEQ)}\n\nthen\n\n${fence(NOTIFY_V1)}`).view, 'architecture');
    assert.equal(latestDiagramInAnswer('no diagram'), null);
  });

  // Found in review: the supplementary view replaced the system as the design
  // on the table, so "add Redis" afterwards edited a sequence diagram.
  test('an answer that draws the system and then a view of it is about the system', () => {
    const text = `${fence(NOTIFY_V1)}\n\nAnd the call order:\n\n${fence(NOTIFY_SEQ)}`;
    const found = latestDiagramInAnswer(text);
    assert.equal(found.view, 'architecture');
    assert.equal(found.source, NOTIFY_V1);
  });

  test('designOverlap is high for versions of one design and low across designs', () => {
    assert.ok(designOverlap(NOTIFY_V1, NOTIFY_V2) > 0.8);
    assert.ok(designOverlap(NOTIFY_V1, NOTIFY_SEQ) > 0.6);
    assert.ok(designOverlap(NOTIFY_V1, PARKING) < 0.2);
  });

  test('activeDesignFromHistory finds the latest design in assistant turns only', () => {
    const turns = [
      { role: 'user', text: 'Design a notification system ' + fence(PARKING) },
      { role: 'assistant', text: answer('First.', NOTIFY_V1) },
      { role: 'user', text: 'add retries' },
      { role: 'assistant', text: answer('Updated.', NOTIFY_V2) },
      { role: 'assistant', text: 'The queue absorbs bursts.' },
    ];
    const d = activeDesignFromHistory(turns);
    assert.equal(d.source, NOTIFY_V2);
    assert.equal(d.version, 2);
    assert.equal(d.foreground, true);
    assert.equal(activeDesignFromHistory([...turns, { role: 'assistant', text: '```ts\nconst x = 1;\n```' }]).foreground, false);
    assert.equal(activeDesignFromHistory([{ role: 'assistant', text: 'nothing' }]), null);
    assert.equal(activeDesignFromHistory(null), null);
  });
});

// Found in review: one diagram stayed "in focus" until a code answer or thirty
// minutes passed, and claimed most of what was said in between.
describe('focus follows the conversation', () => {
  const design = () => {
    const s = createActiveDesignState();
    s.observeAnswer(answer('First.', NOTIFY_V1));
    return s;
  };

  test('an answer to a turn that was not about the design moves focus off it', () => {
    const s = design();
    s.observeAnswer('I led a team of four for two years.');
    assert.equal(s.get().foreground, false);
    assert.equal(s.get().source, NOTIFY_V1, 'it is still on the table, to be named');
  });

  test('a run of follow-ups keeps it in focus, turn after turn', () => {
    const s = design();
    for (const reply of ['The queue absorbs bursts.', 'Retries are capped at five.', 'The log is append-only.']) {
      s.touch();
      s.observeAnswer(reply);
      assert.equal(s.get().foreground, true);
    }
    s.observeAnswer('Sure, Tuesday works.');
    assert.equal(s.get().foreground, false);
  });

  test('a touch is spent by the answer it was for', () => {
    const s = design();
    s.touch();
    s.observeAnswer('About the queue.');
    s.observeAnswer('About something else.');
    assert.equal(s.get().foreground, false);
  });

  test('a discussion of the design keeps it from expiring; silence about it does not', () => {
    let clock = 0;
    const s = createActiveDesignState({ now: () => clock, ttlMs: 30 * 60 * 1000 });
    s.observeAnswer(answer('First.', NOTIFY_V1));
    for (let minute = 5; minute <= 60; minute += 5) {
      clock = minute * 60 * 1000;
      s.touch();
      s.observeAnswer('Still about the design.');
    }
    assert.ok(s.get(), 'an hour of follow-ups, and it is still there');
    clock += 31 * 60 * 1000;
    assert.equal(s.get(), null);
  });

  test('a design that was asked for and not drawn leaves no question behind', () => {
    const s = design();
    s.noteDesignQuestion('Design a chat system');
    s.observeAnswer('Stopped before anything was drawn.');
    // The next drawing shares the first design's words: it is version 2 of it,
    // not a new design "drawn for: Design a chat system".
    const next = s.observeAnswer(answer('With a dead-letter queue.', NOTIFY_V2));
    assert.equal(next.lineageId, 'design-1');
    assert.equal(next.version, 2);
    assert.notEqual(next.question, 'Design a chat system');
  });

  test('a follow-up drops a question noted for a fresh design', () => {
    const s = design();
    s.noteDesignQuestion('Design a chat system');
    s.touch();
    const next = s.observeAnswer(answer('With a dead-letter queue.', NOTIFY_V2));
    assert.equal(next.version, 2);
    assert.equal(next.lineageId, 'design-1');
  });

  test('one shared word does not make two diagrams one design', () => {
    const a = 'flowchart LR\n    web["Web App"] --> gw["Gateway"]';
    const b = 'flowchart LR\n    gw["Gateway"] --> ledger["Ledger"]';
    const s = createActiveDesignState();
    s.observeAnswer(answer('One.', a));
    const next = s.observeAnswer(answer('Two.', b));
    assert.equal(next.lineageId, 'design-2');
    assert.equal(next.version, 1);
  });
});

// Second review (2026-10-02): focus is decided by evidence, not by one flag.
describe('focus: what the answer says is evidence too', async () => {
  const { answerIsAbout } = await import('../activeDesign.mjs');
  const ORDERS = 'flowchart LR\n    client["Client"] --> gateway["API Gateway"]\n    gateway --> orders["Order Service"]\n    orders --> queue["Notification Queue"]\n    queue --> email["Email Worker"]';
  const drawn = () => {
    const s = createActiveDesignState();
    s.observeAnswer(`The design.\n\n\`\`\`mermaid\n${ORDERS}\n\`\`\``);
    return s;
  };

  test('an answer that talks about the drawing\'s own parts keeps it in focus, whatever the question was', () => {
    const s = drawn();
    s.observeAnswer('The API gateway authenticates the request and hands it to the order service, which writes the order and drops a message on the notification queue.');
    assert.equal(s.get().foreground, true);
    s.observeAnswer('The role is hybrid, three days a week in the office.');
    assert.equal(s.get().foreground, false);
  });

  test('two everyday words are not "about the drawing"', () => {
    assert.equal(answerIsAbout('Your order shipped, and the email went out this morning.', ORDERS), false);
    assert.equal(answerIsAbout('The notification queue feeds the email worker.', ORDERS), true);
    assert.equal(answerIsAbout('', ORDERS), false);
  });

  test('a follow-up that was resolved and never answered does not mark the next answer', () => {
    const s = drawn();
    s.touch();
    s.untouch();
    s.observeAnswer('The role is hybrid, three days a week in the office.');
    assert.equal(s.get().foreground, false);
  });

  test('a mark is for the answer that follows its turn, not for one minutes later', () => {
    let clock = 1_000;
    const s = createActiveDesignState({ now: () => clock });
    s.observeAnswer(`The design.\n\n\`\`\`mermaid\n${ORDERS}\n\`\`\``);
    s.touch();
    clock += 10 * 60 * 1000;
    s.observeAnswer('The role is hybrid, three days a week in the office.');
    assert.equal(s.get().foreground, false);
  });

  test('only what the assistant wrote can be the design derived from history', () => {
    const pasted = `Here is ours:\n\n\`\`\`mermaid\n${ORDERS}\n\`\`\``;
    assert.equal(activeDesignFromHistory([{ role: 'human', content: pasted }]), null);
    assert.equal(activeDesignFromHistory([{ role: 'user', content: pasted }]), null);
    assert.equal(activeDesignFromHistory([{ role: 'assistant', content: pasted }]).view, 'architecture');
  });
});
