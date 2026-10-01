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
    s.observeAnswer('The queue decouples producers from a slow provider.');
    assert.deepEqual(s.get(), v1, 'a prose answer changes nothing');
    s.observeAnswer('```ts\nexport async function worker() {}\n```');
    // Same design, same version — only the focus moved to the code.
    assert.deepEqual({ ...s.get(), foreground: true }, v1);
  });

  test('a code answer after the design moves focus off it; a new diagram brings it back', () => {
    const s = createActiveDesignState();
    assert.equal(s.observeAnswer(answer('First.', NOTIFY_V1)).foreground, true);
    s.observeAnswer('The queue decouples producers.');
    assert.equal(s.get().foreground, true, 'prose does not move focus');
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
    const text = `${fence(NOTIFY_V1)}\n\nthen\n\n${fence(NOTIFY_SEQ)}\n\nand code\n\n\`\`\`ts\nconst x = 1;\n\`\`\``;
    assert.equal(latestDiagramInAnswer(text).view, 'sequence');
    assert.equal(latestDiagramInAnswer('no diagram'), null);
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
