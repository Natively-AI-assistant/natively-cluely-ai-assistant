import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDiagramRequest, detectDiagramView, refersToDesign, designVocabulary } from '../diagramRequest.mjs';

const NOTIFICATION_DESIGN = {
  artifactId: 'design-1',
  view: 'architecture',
  source: [
    'flowchart LR',
    '    producer["Producer Service"] -->|"enqueue"| queue["Notification Queue"]',
    '    queue --> worker["Delivery Worker"]',
    '    worker -->|"send"| provider["Email / SMS Provider"]',
    '    worker --> db[("Delivery Log")]',
  ].join('\n'),
};

const resolve = (question, extra = {}) => resolveDiagramRequest({ question, ...extra });

describe('first questions — design asks', () => {
  for (const q of [
    'Design a URL shortener.',
    'How would you architect a chat application for a million users?',
    'Design a notification service with retries.',
    'Design a distributed rate limiter',
    'Design a parking lot',
  ]) {
    test(`"${q}" → architecture diagram with text`, () => {
      const r = resolve(q, { answerType: 'system_design_answer' });
      assert.equal(r.enabled, true);
      assert.equal(r.operation, 'create');
      assert.equal(r.view, 'architecture');
      assert.equal(r.output, 'text-and-diagram');
      assert.equal(r.basis, 'proposed-design');
      assert.equal(r.withCode, false);
      assert.equal(r.parentArtifactId, undefined);
    });
  }

  test('a design ask is recognised without a planner verdict (Direct Assist has none)', () => {
    assert.equal(resolve('Design a URL shortener').enabled, true);
    assert.equal(resolve('How would you design a notification system that handles retries?').enabled, true);
    assert.equal(resolve('walk me through the system design for a ride sharing backend').enabled, true);
  });

  test('product-name interview asks are design asks ("Design Twitter")', () => {
    for (const q of ['Design Twitter', 'How would you design something like Uber?', "Let's design a clone of Dropbox", 'Architect YouTube for me']) {
      assert.equal(resolve(q).enabled, true, q);
    }
    // …but mentioning a product is not a design ask.
    assert.equal(resolve('Have you used Slack at work?').enabled, false);
    assert.equal(resolve('What do you think of the Twitter redesign?').enabled, false);
  });

  test('the mode-specific planner route does not hide a design ask', () => {
    // Sales / lecture / custom modes can route the same words elsewhere; the
    // request is still semantically a design task.
    const r = resolve('Design a notification service for our customers', { answerType: 'sales_answer' });
    assert.equal(r.enabled, true);
    assert.equal(r.operation, 'create');
  });
});

describe('first questions — explicit diagram asks that are not architecture interviews', () => {
  test('"Show the authentication sequence" → sequence', () => {
    const r = resolve('Show the authentication sequence.');
    assert.equal(r.enabled, true);
    assert.equal(r.explicit, true);
    assert.equal(r.view, 'sequence');
  });

  test('"Draw an order lifecycle as a state machine" → state', () => {
    const r = resolve('Draw an order lifecycle as a state machine.');
    assert.equal(r.enabled, true);
    assert.equal(r.view, 'state');
    assert.equal(r.operation, 'create');
  });

  test('"Draw the request flow through this architecture" → sequence', () => {
    const r = resolve('Draw the request flow through this architecture.');
    assert.equal(r.enabled, true);
    assert.equal(r.view, 'sequence');
  });

  test('a non-software process can still be drawn when asked', () => {
    const r = resolve('Draw the stages of the water cycle as a flowchart', { answerType: 'technical_concept_answer' });
    assert.equal(r.enabled, true);
    assert.equal(r.view, 'flowchart');
    assert.equal(r.basis, 'proposed-design');
  });

  test('"Turn the system we just discussed into an architecture diagram" → reconstruct the meeting', () => {
    const r = resolve('Turn the system we just discussed into an architecture diagram.');
    assert.equal(r.enabled, true);
    assert.equal(r.view, 'architecture');
    assert.equal(r.basis, 'meeting-reconstruction');
  });

  test('"Draw our actual architecture from the doc" → reconstruct from the source', () => {
    const r = resolve('Draw our actual architecture from the doc');
    assert.equal(r.enabled, true);
    assert.equal(r.basis, 'source-reconstruction');
  });
});

describe('turns that must NOT get a diagram', () => {
  test('"Implement a rate limiter in Python" stays a programming answer', () => {
    const r = resolve('Implement a rate limiter in Python', { answerType: 'coding_question_answer' });
    assert.equal(r.enabled, false);
  });

  test('"Write rate limiter code in Python" stays a programming answer', () => {
    assert.equal(resolve('Write rate limiter code in Python', { answerType: 'coding_question_answer' }).enabled, false);
  });

  test('"What is rate limiting?" / "What is caching?" are explanations', () => {
    assert.equal(resolve('What is rate limiting?', { answerType: 'technical_concept_answer' }).enabled, false);
    assert.equal(resolve('What is caching?', { answerType: 'technical_concept_answer' }).enabled, false);
  });

  test('"Have you built distributed systems?" is a question about the user', () => {
    assert.equal(resolve('Have you built distributed systems?').enabled, false);
    // …even if a router mislabels it.
    assert.equal(resolve('Have you designed a notification system before?', { answerType: 'system_design_answer' }).enabled, false);
    assert.equal(resolve('Tell me about a time you designed a data pipeline').enabled, false);
  });

  test('"What is Natively\'s actual architecture?" is answered from sources, with no invented diagram', () => {
    assert.equal(resolve("What is Natively's actual architecture?").enabled, false);
  });

  test('"What is the architecture of a flower?" is not software design', () => {
    assert.equal(resolve('What is the architecture of a flower?').enabled, false);
    assert.equal(resolve('Design a logo for my bakery').enabled, false);
  });

  test('questions ABOUT diagrams are not requests for one', () => {
    assert.equal(resolve('What is a sequence diagram?').enabled, false);
    assert.equal(resolve('Have you used state machines at work?').enabled, false);
  });

  test('small talk, acknowledgements and recap asks', () => {
    for (const q of ['Sounds good, thanks.', 'How was your weekend?', 'Can you recap what we covered?', 'What questions should I ask next?']) {
      assert.equal(resolve(q).enabled, false, q);
    }
  });

  test('without a design on the table, follow-up phrasings mean nothing special', () => {
    assert.equal(resolve('Add Redis between the API and database.').enabled, false);
    assert.equal(resolve('Make this multi-region.').enabled, false);
    assert.equal(resolve('Why do we need the queue?').enabled, false);
  });

  test('the feature switch turns every diagram decision off', () => {
    assert.equal(resolve('Design a URL shortener', { answerType: 'system_design_answer', featureEnabled: false }).enabled, false);
    assert.equal(resolve('Draw the login sequence', { featureEnabled: false }).enabled, false);
    assert.equal(resolve('Add a cache', { featureEnabled: false, activeDesign: NOTIFICATION_DESIGN }).attachActiveDesign, false);
  });
});

describe('explicit output constraints win', () => {
  test('"no diagram" keeps the design answer and drops the artifact', () => {
    const r = resolve('Design a URL shortener, no diagram please', { answerType: 'system_design_answer' });
    assert.equal(r.enabled, true);
    assert.equal(r.output, 'text-only');
  });

  test('"explain only" / "just explain"', () => {
    assert.equal(resolve('Design a chat system, explain only', { answerType: 'system_design_answer' }).output, 'text-only');
    assert.equal(resolve('Just explain how you would design a chat system', { answerType: 'system_design_answer' }).output, 'text-only');
  });

  test('"just Mermaid source" → source only', () => {
    assert.equal(resolve('Design a URL shortener, just give me the Mermaid source', { answerType: 'system_design_answer' }).output, 'source-only');
    assert.equal(resolve('Give me the mermaid code for a login sequence').output, 'source-only');
  });

  test('"diagram only" → no prose', () => {
    assert.equal(resolve('Design a URL shortener — diagram only', { answerType: 'system_design_answer' }).output, 'diagram-only');
    assert.equal(resolve('Draw the order lifecycle, no explanation').output, 'diagram-only');
  });

  test('a standing "no diagrams" instruction is honoured', () => {
    const r = resolve('Design a URL shortener', { answerType: 'system_design_answer', userInstructions: 'Keep answers short. No diagrams.' });
    assert.equal(r.output, 'text-only');
  });

  test('an explicit view beats the default', () => {
    assert.equal(resolve('Design a checkout system and show it as a sequence diagram', { answerType: 'system_design_answer' }).view, 'sequence');
    assert.equal(resolve('Design the order service as a state machine', { answerType: 'system_design_answer' }).view, 'state');
  });
});

describe('mixed design + code', () => {
  test('"Design a payment system and implement the idempotency handler" keeps both', () => {
    const r = resolve('Design a payment system and implement the idempotency handler', { answerType: 'coding_question_answer' });
    assert.equal(r.enabled, true);
    assert.equal(r.operation, 'create');
    assert.equal(r.withCode, true);
    assert.equal(r.output, 'text-and-diagram');
  });

  test('V3 mixed question types mark the code half without dropping the design half', () => {
    const r = resolve('Design a job queue system and write the worker in Go', { questionTypes: ['SYSTEM_DESIGN', 'CODING_TASK'] });
    assert.equal(r.enabled, true);
    assert.equal(r.withCode, true);
  });

  test('a V3 SYSTEM_DESIGN tag alone is not enough ("throughput" trips it)', () => {
    assert.equal(resolve('What throughput did you see?', { questionTypes: ['SYSTEM_DESIGN'] }).enabled, false);
  });
});

describe('follow-ups on the design on the table', () => {
  const withDesign = (q, extra = {}) => resolve(q, { activeDesign: NOTIFICATION_DESIGN, ...extra });

  for (const q of [
    'Add Redis between the API and database.',
    'Add retry handling and a dead-letter queue',
    'Make this multi-region.',
    'Replace Kafka with RabbitMQ.',
    'Add the timeout and retry branches.',
    'How does this scale to ten million users?',
    'Okay, now add a rate limiter in front of the producer',
    'What if we use SQS instead of the queue?',
  ]) {
    test(`"${q}" → update the same design`, () => {
      const r = withDesign(q);
      assert.equal(r.enabled, true, r.reason);
      assert.equal(r.operation, 'update');
      assert.equal(r.parentArtifactId, 'design-1');
      assert.equal(r.attachActiveDesign, true);
      assert.equal(r.output, 'text-and-diagram');
    });
  }

  test('"Show it as a sequence diagram" → a new view of the same system', () => {
    const r = withDesign('Show it as a sequence diagram.');
    assert.equal(r.enabled, true);
    assert.equal(r.operation, 'create');
    assert.equal(r.view, 'sequence');
    assert.equal(r.parentArtifactId, 'design-1');
    assert.equal(r.attachActiveDesign, true);
  });

  test('"Show the delivery sequence" → sequence view of that system', () => {
    const r = withDesign('Show the delivery sequence');
    assert.equal(r.view, 'sequence');
    assert.equal(r.parentArtifactId, 'design-1');
  });

  test('"Show the write path only" → a filtered view, same family', () => {
    const r = withDesign('Show the write path only.');
    assert.equal(r.enabled, true);
    assert.equal(r.parentArtifactId, 'design-1');
    assert.equal(r.view, 'architecture');
  });

  test('"Why do we need the queue?" → explain, no new diagram', () => {
    const r = withDesign('Why do we need the queue?');
    assert.equal(r.enabled, true);
    assert.equal(r.operation, 'explain');
    assert.equal(r.output, 'text-only');
    assert.equal(r.attachActiveDesign, true);
  });

  test('"Make your answer shorter" → prose changes, the diagram is preserved', () => {
    for (const q of ['Make your answer shorter', 'shorten', 'Can you rephrase that?', 'make it more concise']) {
      const r = withDesign(q);
      assert.equal(r.operation, 'refine', q);
      assert.equal(r.parentArtifactId, 'design-1');
    }
  });

  test('"Design a parking lot" → a fresh task, not a continuation', () => {
    const r = withDesign('Design a parking lot', { answerType: 'system_design_answer' });
    assert.equal(r.operation, 'create');
    assert.equal(r.parentArtifactId, undefined);
    assert.equal(r.attachActiveDesign, false);
  });

  test('"Redesign this for multi-region" points at the current design', () => {
    const r = withDesign('Redesign this system for multi-region', { answerType: 'system_design_answer' });
    assert.equal(r.operation, 'update');
    assert.equal(r.parentArtifactId, 'design-1');
  });

  test('"Now write the worker in TypeScript" → code, grounded in the design, no diagram', () => {
    const r = withDesign('Now write the worker in TypeScript', { answerType: 'coding_question_answer' });
    assert.equal(r.enabled, false);
    assert.equal(r.attachActiveDesign, true);
  });

  test('the router calling a design follow-up "coding" does not take it away from the design', () => {
    // "queue", "cache" and "add" are keywords the answer planner reads as
    // coding / DSA. With a design on the table these are design follow-ups.
    for (const [q, answerType, operation] of [
      ['Add retry handling and a dead-letter queue', 'coding_question_answer', 'update'],
      ['Why do we need the queue?', 'dsa_question_answer', 'explain'],
      ['Replace Kafka with RabbitMQ.', 'coding_question_answer', 'update'],
      ['How does this scale to ten million users?', 'technical_concept_answer', 'update'],
      ['Show it as a sequence diagram', 'coding_question_answer', 'create'],
    ]) {
      const r = withDesign(q, { answerType });
      assert.equal(r.enabled, true, `${q}: ${r.reason}`);
      assert.equal(r.operation, operation, q);
      assert.equal(r.withCode, false, q);
    }
  });

  test('the router calling a follow-up "system design" does not restart the design', () => {
    // AnswerPlanner re-routes design follow-ups to system_design_answer, and its
    // own patterns ("scale to", "notification system") do the same. Only the
    // words of a fresh design ask start a new design.
    for (const [q, operation] of [
      ['Add retry handling and a dead-letter queue', 'update'],
      ['How does this scale to ten million users?', 'update'],
      ['Why do we need the queue?', 'explain'],
      ['Show the delivery sequence', 'create'],
    ]) {
      const r = withDesign(q, { answerType: 'system_design_answer' });
      assert.equal(r.operation, operation, q);
      assert.equal(r.parentArtifactId, 'design-1', q);
      assert.equal(r.attachActiveDesign, true, q);
    }
    const fresh = withDesign('Design a chat system', { answerType: 'system_design_answer' });
    assert.equal(fresh.operation, 'create');
    assert.equal(fresh.parentArtifactId, undefined);
  });

  test('an explicit request for code is still a coding turn', () => {
    for (const q of ['Now write the worker in TypeScript', 'Implement the retry queue', 'Add a function that validates the payload', 'Write unit tests for the delivery worker']) {
      const r = withDesign(q, { answerType: 'coding_question_answer' });
      assert.equal(r.enabled, false, q);
    }
    // …and stays grounded in the design when it names one of its parts.
    assert.equal(withDesign('Implement the retry queue', { answerType: 'coding_question_answer' }).attachActiveDesign, true);
  });

  test('after a code answer, a bare "this" means the code, not the design', () => {
    const behindCode = { ...NOTIFICATION_DESIGN, foreground: false };
    const after = (q, extra = {}) => resolve(q, { activeDesign: behindCode, ...extra });
    assert.equal(after('Why is this O(n)?', { answerType: 'dsa_question_answer' }).enabled, false);
    assert.equal(after('Make it iterative', { answerType: 'coding_question_answer' }).enabled, false);
    assert.equal(after('Add error handling', { answerType: 'coding_question_answer' }).enabled, false);
    // Naming the design, or one of its components, brings it back into focus.
    assert.equal(after('Add a retry queue to the design').operation, 'update');
    assert.equal(after('Why does the delivery worker write to the log?').operation, 'explain');
    assert.equal(after('Update the diagram to use two queues').operation, 'update');
  });

  test('an unrelated question leaves the design alone', () => {
    const r = withDesign('What are your salary expectations?');
    assert.equal(r.enabled, false);
    assert.equal(r.attachActiveDesign, false);
  });

  test('"Add X, no diagram" explains the change without redrawing', () => {
    const r = withDesign('Add a cache in front of the delivery log, no diagram');
    assert.equal(r.operation, 'explain');
    assert.equal(r.output, 'text-only');
  });
});

describe('helpers', () => {
  test('detectDiagramView', () => {
    assert.equal(detectDiagramView('show the login sequence'), 'sequence');
    assert.equal(detectDiagramView('order lifecycle'), 'state');
    assert.equal(detectDiagramView('a flowchart of the deploy process'), 'flowchart');
    assert.equal(detectDiagramView('high-level architecture'), 'architecture');
    assert.equal(detectDiagramView('hello'), null);
  });

  test('designVocabulary pulls distinctive label words, including CamelCase states', () => {
    const vocab = designVocabulary(NOTIFICATION_DESIGN.source);
    assert.ok(vocab.has('queue') && vocab.has('worker') && vocab.has('notification'));
    assert.ok(!vocab.has('service'));
    const states = designVocabulary('stateDiagram-v2\n    Placed --> PaymentFailed: declined');
    assert.ok(states.has('payment') && states.has('failed') && states.has('placed'));
  });

  test('refersToDesign matches pronouns and component names, singular or plural', () => {
    assert.equal(refersToDesign('why two queues?', NOTIFICATION_DESIGN), true);
    assert.equal(refersToDesign('is this safe?', NOTIFICATION_DESIGN), true);
    assert.equal(refersToDesign('how was lunch', NOTIFICATION_DESIGN), false);
    assert.equal(refersToDesign('why the queue', null), false);
  });
});
