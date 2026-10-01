// Reviewed reference diagrams attached to a system-design prompt.
//
// These exist to keep *representation* consistent — how big a first diagram
// is, how nodes are named, where assumptions go — not to hand the model an
// architecture to copy. At most two are attached to a request (one by
// default), chosen locally by diagram view and topic words. No embeddings, no
// second model call.
//
// Adding an example (see docs/diagrams/README.md):
//   1. append an entry below with a new `id` and bump DIAGRAM_EXAMPLES_VERSION;
//   2. keep it small (the generation contract asks for 5–10 components);
//   3. run `npm run test:diagram` — every example is parsed and rendered with
//      the exact Mermaid version the app ships, and checked against
//      diagramPolicy, so an example that does not draw fails the suite.
//
// Entry fields:
//   id          stable identifier
//   view        'architecture' | 'sequence' | 'flowchart' | 'state'
//   topics      lower-case words/phrases used by the local selector
//   question    the question this answers
//   constraints what the asker stated
//   assumptions what the answer had to assume (never presented as stated)
//   rationale   one or two sentences on why the diagram has this shape
//   mermaid     the diagram source

export const DIAGRAM_EXAMPLES_VERSION = 1;

/** Rough ceiling for all examples attached to one request (~4 chars/token). */
export const DIAGRAM_EXAMPLE_TOKEN_BUDGET = 800;

export const DIAGRAM_EXAMPLES = Object.freeze([
  {
    id: 'url-shortener-internal',
    view: 'architecture',
    topics: ['url shortener', 'short link', 'link shortener', 'internal tool', 'small', 'simple'],
    question: 'Design a URL shortener for internal company links.',
    constraints: ['Internal users only', 'A few thousand links'],
    assumptions: ['Traffic is low enough for one service instance and one database'],
    rationale:
      'At this size a single service and a durable table is the whole design. A cache or queue would be extra parts with nothing to do.',
    mermaid: [
      'flowchart LR',
      '    user["Employee Browser"] -->|"create / open link"| app["Shortener Service"]',
      '    app -->|"read and write"| db[("URL Table")]',
      '    app -.->|"SSO check"| idp["Company Identity Provider"]',
    ].join('\n'),
  },
  {
    id: 'url-shortener-high-traffic',
    view: 'architecture',
    topics: ['url shortener', 'short link', 'tinyurl', 'bitly', 'redirect', 'read heavy', 'million', 'scale', 'cache'],
    question: 'Design a URL shortener that serves a very large number of redirects.',
    constraints: ['Redirects far outnumber link creation'],
    assumptions: ['Assumed: redirects are about 100x creations', 'Assumed: click analytics can lag by seconds'],
    rationale:
      'Reads and writes are split because they scale differently. Redirects hit a cache first and fall back to the store, which is partitioned by short code. Analytics leaves the hot path through a queue.',
    mermaid: [
      'flowchart LR',
      '    client["Client"] --> lb["Load Balancer"]',
      '    lb -->|"create link"| createApi["Create API"]',
      '    lb -->|"open link"| redirectApi["Redirect API"]',
      '    createApi --> idgen["ID Generator"]',
      '    createApi -->|"insert mapping"| store[("URL Store, partitioned by code")]',
      '    redirectApi -->|"lookup"| cache[("Redirect Cache")]',
      '    redirectApi -->|"on cache miss"| store',
      '    redirectApi -.->|"click event"| queue["Event Queue"]',
      '    queue --> analytics["Analytics Worker"]',
    ].join('\n'),
  },
  {
    id: 'chat-realtime',
    view: 'architecture',
    topics: ['chat', 'messaging', 'messenger', 'whatsapp', 'slack', 'realtime', 'websocket', 'presence', 'delivery'],
    question: 'Design a one-to-one chat system.',
    constraints: ['Messages must not be lost', 'Recipients may be offline'],
    assumptions: ['Assumed: at-least-once delivery with client-side de-duplication by message id'],
    rationale:
      'The gateway only holds connections. A message is stored before it is fanned out, so delivery can be retried from the store; offline recipients get a push and fetch on reconnect.',
    mermaid: [
      'flowchart LR',
      '    sender["Sender App"] <-->|"WebSocket"| gateway["Realtime Gateway"]',
      '    recipient["Recipient App"] <-->|"WebSocket"| gateway',
      '    gateway -->|"send message"| chat["Chat Service"]',
      '    chat -->|"append, then ack"| messages[("Message Store")]',
      '    chat -->|"publish"| bus["Message Bus"]',
      '    bus -->|"recipient online"| gateway',
      '    bus -->|"recipient offline"| push["Push Notifier"]',
      '    gateway -->|"who is connected where"| registry[("Connection Registry")]',
    ].join('\n'),
  },
  {
    id: 'notification-jobs',
    view: 'architecture',
    topics: ['notification', 'job', 'queue', 'worker', 'retry', 'retries', 'dead letter', 'dlq', 'email', 'sms', 'background', 'task', 'scheduler', 'webhook'],
    question: 'Design a notification service with retries.',
    constraints: ['A failing provider must not lose or duplicate-spam notifications'],
    assumptions: ['Assumed: a bounded number of attempts with backoff', 'Assumed: sends carry an idempotency key'],
    rationale:
      'Producers only enqueue. The worker owns delivery and records every attempt; failures go back through a delayed retry queue, and anything out of attempts lands in a dead-letter queue for inspection.',
    mermaid: [
      'flowchart LR',
      '    producer["Producer Service"] -->|"enqueue"| queue["Notification Queue"]',
      '    queue --> worker["Delivery Worker"]',
      '    worker -->|"send with idempotency key"| provider["Email / SMS Provider"]',
      '    worker -->|"record attempt"| log[("Delivery Log")]',
      '    worker -->|"failed, attempts left"| retry["Retry Queue with backoff"]',
      '    retry --> worker',
      '    worker -->|"attempts exhausted"| dlq["Dead-Letter Queue"]',
    ].join('\n'),
  },
  {
    id: 'auth-login-sequence',
    view: 'sequence',
    topics: ['authentication', 'auth', 'login', 'sign in', 'session', 'token', 'oauth', 'password', 'credential', 'handshake', 'request flow'],
    question: 'Show the login sequence for a web app with server-side sessions.',
    constraints: ['Wrong credentials must not reveal which part was wrong'],
    assumptions: ['Assumed: password login with a session cookie, no second factor'],
    rationale:
      'A sequence diagram follows the calls in the order the system makes them. The failure branch is drawn next to the success branch so both outcomes of the same check are visible.',
    mermaid: [
      'sequenceDiagram',
      '    participant U as User',
      '    participant C as Client App',
      '    participant A as Auth Service',
      '    participant D as User Store',
      '    U->>C: Enter email and password',
      '    C->>A: POST /login',
      '    A->>D: Load user and password hash',
      '    D-->>A: User record',
      '    alt Credentials valid',
      '        A-->>C: 200 with session cookie',
      '        C-->>U: Signed in',
      '    else Credentials invalid',
      '        A-->>C: 401 with generic error',
      '        C-->>U: Show error, allow retry',
      '    end',
    ].join('\n'),
  },
  {
    id: 'order-lifecycle-state',
    view: 'state',
    topics: ['order', 'lifecycle', 'state machine', 'status', 'checkout', 'payment', 'cancel', 'refund', 'shipping', 'workflow states'],
    question: 'Draw the lifecycle of an order as a state machine.',
    constraints: ['Orders can be cancelled before shipping', 'Payment can fail'],
    assumptions: ['Assumed: a failed payment can be retried before the order is cancelled'],
    rationale:
      'Every transition names the event that causes it, and every way out (delivered, cancelled, refunded) is an explicit end state rather than an implied one.',
    mermaid: [
      'stateDiagram-v2',
      '    [*] --> Placed',
      '    Placed --> Paid: payment captured',
      '    Placed --> PaymentFailed: payment declined',
      '    Placed --> Cancelled: customer cancels',
      '    PaymentFailed --> Placed: retry payment',
      '    PaymentFailed --> Cancelled: retries exhausted',
      '    Paid --> Shipped: carrier pickup',
      '    Paid --> Refunded: cancelled before shipping',
      '    Shipped --> Delivered: delivery confirmed',
      '    Delivered --> [*]',
      '    Cancelled --> [*]',
      '    Refunded --> [*]',
    ].join('\n'),
  },
]);

function estimateTokens(text) {
  return Math.ceil(String(text).length / 4);
}

/** The prompt text of one example. */
export function renderDiagramExample(example) {
  const lines = [`Question: ${example.question}`];
  if (example.constraints?.length) lines.push(`Stated constraints: ${example.constraints.join('; ')}`);
  if (example.assumptions?.length) lines.push(`Assumptions: ${example.assumptions.join('; ')}`);
  lines.push(`Why this shape: ${example.rationale}`);
  lines.push('```mermaid', example.mermaid, '```');
  return lines.join('\n');
}

function scoreExample(example, question, view) {
  let score = 0;
  // Architecture and flowchart share a Mermaid family; treat them as near.
  if (view && example.view === view) score += 3;
  else if (view && ((view === 'flowchart' && example.view === 'architecture') || (view === 'architecture' && example.view === 'flowchart'))) score += 1;
  const q = ` ${String(question || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  for (const topic of example.topics) {
    if (q.includes(` ${topic} `) || (topic.includes(' ') && q.includes(topic))) score += topic.includes(' ') ? 3 : 2;
  }
  return score;
}

/**
 * Pick 0–2 examples for a request.
 *
 * @param {{ question?: string, view?: string, max?: number, tokenBudget?: number }} input
 * @returns {Array<typeof DIAGRAM_EXAMPLES[number]>}
 */
export function selectDiagramExamples(input = {}) {
  const max = Math.max(0, Math.min(2, Number.isFinite(input.max) ? input.max : 1));
  if (max === 0) return [];
  const budget = Number.isFinite(input.tokenBudget) ? input.tokenBudget : DIAGRAM_EXAMPLE_TOKEN_BUDGET;
  const ranked = DIAGRAM_EXAMPLES.map((example, index) => ({
    example,
    index,
    score: scoreExample(example, input.question, input.view),
  }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const picked = [];
  let used = 0;
  for (const r of ranked) {
    if (picked.length >= max) break;
    const cost = estimateTokens(renderDiagramExample(r.example));
    if (used + cost > budget) continue;
    picked.push(r.example);
    used += cost;
  }
  return picked;
}

/**
 * The prompt block for the chosen examples, or '' when there are none. The
 * framing sentence is part of the contract: examples are style references,
 * never evidence about the user's meeting or system.
 */
export function renderDiagramExamplesBlock(examples) {
  if (!examples || examples.length === 0) return '';
  const body = examples.map((e, i) => `Reference ${i + 1}\n${renderDiagramExample(e)}`).join('\n\n');
  return [
    'DIAGRAM REFERENCE (style only):',
    'These show the size, naming and labelling to aim for. They are NOT facts about this conversation, this company or this system. Design for the actual question and its stated constraints; do not copy an architecture from a reference.',
    '',
    body,
  ].join('\n');
}
