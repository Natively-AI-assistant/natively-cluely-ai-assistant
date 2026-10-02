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
// Since version 2 the library also covers the nine meeting modes: ER and class
// diagrams, charts, timelines, schedules, decision trees and the two notation
// models. Those entries add:
//   fence       'mermaid' (default) | 'natively-chart' | 'natively-diagram' | 'table'
//   body        the block content for a non-Mermaid entry (`mermaid` holds it otherwise)
//   modes       built-in modes the example is most at home in (a tie-breaker only)
//   chartIntent for a chart: forecast | breakeven | funnel | trend | …
// Every entry is still checked by the suite: Mermaid ones are drawn with the
// pinned Mermaid, chart and notation ones are compiled by the local adapters.
// The numbers in a chart example are hypothetical on purpose, and say so.
//
// Entry fields:
//   id          stable identifier
//   view        'architecture' | 'sequence' | 'flowchart' | 'state' | … (see visualCatalog.mjs)
//   topics      lower-case words/phrases used by the local selector
//   question    the question this answers
//   constraints what the asker stated
//   assumptions what the answer had to assume (never presented as stated)
//   rationale   one or two sentences on why the diagram has this shape
//   mermaid     the diagram source

export const DIAGRAM_EXAMPLES_VERSION = 3;

/** Rough ceiling for all examples attached to one request (~4 chars/token). */
export const DIAGRAM_EXAMPLE_TOKEN_BUDGET = 800;

// Payload examples are written compactly: they cost tokens in a prompt, and a
// model copies the form it is shown.
const json = (value) => JSON.stringify(value);

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

  // ── version 2: the wider catalog ──────────────────────────────────────────
  {
    id: 'er-customer-order',
    view: 'er',
    modes: ['technical-interview', 'team-meet', 'lecture'],
    topics: ['customer', 'customers', 'order', 'orders', 'users', 'payments', 'data model', 'schema', 'tables', 'entities'],
    question: 'Model customers and their orders.',
    constraints: ['A customer can have no orders yet', 'Every order belongs to one customer'],
    assumptions: ['Order has its own key, so it only refers to the customer'],
    rationale:
      'The marker beside CUSTOMER says how many customers one order has (exactly one); the marker beside ORDER says how many orders one customer has (zero or many). The line is dashed because an order is identified by its own key, not by the customer.',
    mermaid: [
      'erDiagram',
      '    CUSTOMER ||..o{ ORDER : places',
      '    CUSTOMER {',
      '        int customer_id PK',
      '        string name',
      '    }',
      '    ORDER {',
      '        int order_id PK',
      '        int customer_id FK',
      '        decimal total',
      '    }',
    ].join('\n'),
  },
  {
    id: 'class-parking-lot',
    view: 'class',
    modes: ['technical-interview', 'lecture'],
    topics: ['parking lot', 'objects', 'classes', 'object model', 'inheritance', 'elevator', 'vending machine', 'library'],
    question: 'Design the objects for a parking lot.',
    constraints: ['Several levels, each with spots', 'Spots come in more than one size'],
    assumptions: ['One vehicle per spot'],
    rationale:
      'A level cannot exist without its lot, so that is composition; a lot merely holds spots, which is aggregation; spot sizes are subclasses. Each symbol sits at the end it describes.',
    mermaid: [
      'classDiagram',
      '    class ParkingLot {',
      '        +park(Vehicle v) Ticket',
      '    }',
      '    class Level',
      '    class Spot {',
      '        <<abstract>>',
      '        +isFree() bool',
      '    }',
      '    class CompactSpot',
      '    class Vehicle',
      '    ParkingLot "1" *-- "1..*" Level',
      '    Level "1" o-- "0..*" Spot',
      '    Spot <|-- CompactSpot',
      '    Spot "0..1" --> "0..1" Vehicle : holds',
    ].join('\n'),
  },
  {
    id: 'chart-forecast-net-growth',
    view: 'chart',
    chartIntent: 'forecast',
    fence: 'natively-chart',
    modes: ['sales', 'general', 'team-meet'],
    topics: ['revenue', 'growth', 'forecast', 'projection', 'monthly', 'mrr', 'arr', 'billings'],
    question: 'Assume billings are €48,200 a month now. Show the next four months at 2% net monthly growth.',
    constraints: ['Starting value, rate, period and horizon were all stated'],
    assumptions: ['Hypothetical inputs given by the asker'],
    rationale:
      'The payload carries the inputs only; the app computes the values, so they cannot be mistyped. The title names the scenario, and no computed number is repeated in the prose.',
    body: json({
        v: 1,
        type: 'line',
        title: 'Monthly billings at 2% net growth',
        x: { label: 'Month' },
        y: { label: 'Billings', unit: 'EUR' },
        compute: { kind: 'compound_growth', baseline: 48200, ratePercent: 2, period: 'month', periods: 4 },
        assumptions: ['Net growth stays at 2% every month'],
    }),
  },
  {
    id: 'chart-break-even',
    view: 'chart',
    chartIntent: 'breakeven',
    fence: 'natively-chart',
    modes: ['sales'],
    topics: ['savings', 'break even', 'breakeven', 'payback', 'cost', 'roi'],
    question: 'It costs $12,000 to set up and saves $2,500 a month. Show when it pays for itself over eight months.',
    constraints: ['Cost, saving and horizon were all stated'],
    assumptions: ['The saving is the same every month'],
    rationale: 'A cumulative line that starts below zero shows the pay-back point directly. The saving is a saving, not revenue.',
    body: json({
        v: 1,
        type: 'line',
        title: 'Cumulative net saving',
        y: { label: 'Net position', unit: 'USD' },
        compute: { kind: 'break_even', initialCost: 12000, periodSaving: 2500, period: 'month', periods: 8 },
        assumptions: ['The saving is constant at 2,500 a month'],
    }),
  },
  {
    id: 'chart-stage-counts',
    view: 'chart',
    chartIntent: 'funnel',
    fence: 'natively-chart',
    modes: ['sales', 'recruiting'],
    topics: ['pipeline', 'funnel', 'stages', 'conversion', 'deals', 'candidates', 'dropping'],
    question: 'Of the 200 leads created in Q3, 120 were qualified, 60 got a proposal and 22 closed. Where do they drop out?',
    constraints: ['One cohort: leads created in Q3', 'A count for every stage'],
    assumptions: [],
    rationale: 'Stage counts of one cohort, in order. The app works out the step-to-step rates; the payload only names the cohort and where the counts came from.',
    body: json({
        v: 1,
        type: 'funnel',
        title: 'Q3 leads by stage',
        status: 'observed',
        cohort: 'leads created in Q3',
        sources: ['counts stated in the meeting'],
        stages: [
          { label: 'Leads', value: 200 },
          { label: 'Qualified', value: 120 },
          { label: 'Proposal', value: 60 },
          { label: 'Closed', value: 22 },
        ],
    }),
  },
  {
    id: 'chart-observed-trend',
    view: 'chart',
    chartIntent: 'trend',
    fence: 'natively-chart',
    modes: ['team-meet', 'call-center', 'general'],
    topics: ['trend', 'metric', 'changed', 'over time', 'weekly', 'tickets', 'incidents', 'sprint'],
    question: 'Open tickets were 120, 134, 150 and 141 over the last four weeks, and week three of the export is missing. Plot it.',
    constraints: ['Four weekly observations, one of them missing'],
    assumptions: [],
    rationale: 'Real observations over ordered time are a line. The missing week is null, which draws as a gap rather than a zero.',
    body: json({
        v: 1,
        type: 'line',
        title: 'Open tickets by week',
        x: { label: 'Week', kind: 'time', values: ['W1', 'W2', 'W3', 'W4', 'W5'] },
        y: { label: 'Open tickets' },
        series: [{ name: 'Open tickets', status: 'observed', values: [120, 134, null, 150, 141], source: 'support dashboard export shared in the meeting' }],
    }),
  },
  {
    id: 'decision-troubleshooting',
    view: 'decision',
    modes: ['call-center', 'sales', 'general'],
    topics: ['troubleshoot', 'diagnose', 'diagnosing', 'issue', 'refund', 'eligibility', 'objection', 'decision tree'],
    question: 'Walk me through diagnosing a router that keeps dropping the connection.',
    constraints: ['Steps come from the support runbook'],
    assumptions: [],
    rationale: 'Each diamond is one check with labelled answers, and every path ends in an outcome. A check the runbook does not cover is marked, not invented.',
    mermaid: [
      'flowchart TD',
      '    start(["Connection drops"]) --> lights{"Internet light on?"}',
      '    lights -->|"no"| cable{"Cable seated?"}',
      '    lights -->|"yes"| devices{"All devices affected?"}',
      '    cable -->|"no"| reseat["Reseat the cable"]',
      '    cable -->|"yes"| outage["Check for an area outage"]',
      '    devices -->|"yes"| reboot["Restart the router"]',
      '    devices -->|"no"| single["Device issue (not covered)"]',
      '    reseat --> resolved(["Resolved or escalate"])',
      '    reboot --> resolved',
      '    outage --> resolved',
    ].join('\n'),
  },
  {
    id: 'timeline-career',
    view: 'timeline',
    modes: ['looking-for-work', 'recruiting', 'general'],
    topics: ['career', 'progression', 'history', 'milestones', 'chronology', 'timeline', 'events'],
    question: 'Summarize my career progression.',
    constraints: ['Dates and roles as written in the résumé'],
    assumptions: [],
    rationale: 'Only dated facts from the résumé, in order. Nothing is inferred about why a move happened.',
    mermaid: [
      'timeline',
      '    title Career so far',
      '    2018 : Junior engineer at Acme',
      '    2020 : Senior engineer at Acme',
      '         : Led the billing rewrite',
      '    2023 : Staff engineer at Globex',
    ].join('\n'),
  },
  {
    id: 'gantt-rollout',
    view: 'gantt',
    modes: ['sales', 'team-meet', 'seminar', 'looking-for-work', 'recruiting'],
    topics: ['rollout', 'implementation', 'schedule', 'plan', 'release', 'phases', 'gantt', 'preparation'],
    question: 'Show the rollout: a one-week pilot from October 5th, then a two-week rollout, then a review.',
    constraints: ['Start date and durations were stated'],
    assumptions: [],
    rationale: 'Real dates and durations make a schedule. Tasks that follow each other use `after`, so one date drives the rest.',
    mermaid: [
      'gantt',
      '    title Rollout',
      '    dateFormat YYYY-MM-DD',
      '    section Pilot',
      '    Pilot team :p1, 2026-10-05, 5d',
      '    section Rollout',
      '    All teams :r1, after p1, 10d',
      '    Review :milestone, after r1, 0d',
    ].join('\n'),
  },
  {
    id: 'mindmap-topics',
    view: 'mindmap',
    modes: ['lecture', 'general', 'seminar'],
    topics: ['concepts', 'ideas', 'topics', 'organize', 'mind map', 'notes', 'framework'],
    question: 'Organize the ideas we covered on database indexing.',
    constraints: ['Only topics that were raised'],
    assumptions: [],
    rationale: 'A mind map shows what belongs under what. Plain text nodes, three levels at most.',
    mermaid: [
      'mindmap',
      '  Database indexing',
      '    Structures',
      '      B-tree',
      '      Hash index',
      '    Costs',
      '      Slower writes',
      '      Extra storage',
      '    When to use',
      '      Selective filters',
    ].join('\n'),
  },
  {
    id: 'dependency-blockers',
    view: 'dependency',
    modes: ['team-meet', 'seminar', 'general', 'lecture'],
    topics: ['blocks', 'blocked', 'blocking', 'dependencies', 'depends', 'prerequisites', 'waiting'],
    question: 'Show which work blocks which.',
    constraints: ['Blockers as stated in the stand-up'],
    assumptions: [],
    rationale: 'Every arrow is labelled and they all read the same way: the thing at the tail must finish first. A blocker and a plain prerequisite are different labels.',
    mermaid: [
      'flowchart LR',
      '    schema["Schema migration"] -->|"blocks"| api["Orders API"]',
      '    api -->|"blocks"| mobile["Mobile checkout"]',
      '    design["Checkout design"] -->|"needs"| mobile',
      '    api -->|"blocks (unconfirmed)"| reports["Reports"]',
    ].join('\n'),
  },
  {
    id: 'responsibility-buying',
    view: 'responsibility',
    modes: ['sales', 'call-center', 'recruiting', 'team-meet', 'general'],
    topics: ['who', 'owns', 'approves', 'involved', 'buying', 'stakeholders', 'escalation', 'handles', 'interviews', 'responsible'],
    question: 'Map who is involved in buying.',
    constraints: ['Roles as the customer described them'],
    assumptions: [],
    rationale: 'Each arrow says what the relation is. Who signs is unknown, so that is what the node says.',
    mermaid: [
      'flowchart TD',
      '    champion["Ops lead (champion)"] -->|"recommends to"| director["Operations director"]',
      '    director -->|"approves budget"| finance["Finance"]',
      '    security["Security team"] -->|"reviews"| director',
      '    signer["Signer: unknown"] -.->|"signs (not stated)"| finance',
    ].join('\n'),
  },
  {
    id: 'matrix-requirements-evidence',
    view: 'matrix',
    fence: 'table',
    modes: ['recruiting', 'looking-for-work', 'seminar', 'general', 'team-meet'],
    topics: ['requirements', 'experience', 'evidence', 'candidate', 'role', 'skills', 'compare', 'options', 'offers', 'baselines'],
    question: "Map this candidate's experience to the role.",
    constraints: ['Requirements from the job description', 'Evidence from the CV and this interview'],
    assumptions: [],
    rationale: 'One row per requirement, with where the evidence is. A requirement nobody has evidence for is "unknown", not a gap in the person.',
    body: [
      '| Requirement | Evidence | Status | Source |',
      '| --- | --- | --- | --- |',
      '| Kubernetes in production | Ran a 40-node cluster for two years | supported | CV, interview |',
      '| Led a team | Mentored two engineers | partial | interview |',
      '| On-call experience | Not discussed yet | unknown | none yet |',
    ].join('\n'),
  },
  {
    id: 'process-research-method',
    view: 'flowchart',
    modes: ['seminar', 'lecture', 'looking-for-work', 'recruiting', 'general', 'sales', 'call-center'],
    topics: ['method', 'workflow', 'process', 'protocol', 'stages', 'steps', 'pipeline', 'procedure', 'approved'],
    question: 'Draw the method described in this paper.',
    constraints: ['Stages as the paper describes them'],
    assumptions: [],
    rationale: 'Steps in order, with the one decision as a diamond. A stage the source does not detail says so in its label instead of being filled in.',
    mermaid: [
      'flowchart TD',
      '    collect["Collect the corpus"] --> clean["Filter and deduplicate"]',
      '    clean --> split["Split train and test"]',
      '    split --> train["Train the model"]',
      '    train --> evalq{"Meets the baseline?"}',
      '    evalq -->|"yes"| report["Report results"]',
      '    evalq -->|"no"| tune["Tune (details not given)"]',
      '    tune --> train',
    ].join('\n'),
  },
  {
    id: 'chen-customer-order',
    view: 'chen',
    fence: 'natively-diagram',
    modes: ['lecture', 'technical-interview'],
    topics: ['chen', 'er', 'entity', 'relationship', 'weak entity', 'participation'],
    question: 'Draw customers and orders in Chen notation.',
    constraints: ['One customer places many orders', 'Every order has a customer'],
    assumptions: [],
    rationale:
      'Cardinality belongs to each participant. Whether every customer must have an order was not stated, so that participation is left out and shows as open.',
    body: json({
        kind: 'chen-er',
        title: 'Customers and orders',
        entities: [
          { name: 'Customer', attributes: [{ name: 'customer_id', key: true }, { name: 'name' }] },
          { name: 'Order', attributes: [{ name: 'order_id', key: true }, { name: 'total' }] },
        ],
        relationships: [
          {
            name: 'places',
            participants: [
              { entity: 'Customer', cardinality: '1' },
              { entity: 'Order', cardinality: 'N', participation: 'total' },
            ],
          },
        ],
    }),
  },
  {
    id: 'automaton-ends-in-ab',
    view: 'automaton',
    fence: 'natively-diagram',
    modes: ['lecture', 'technical-interview'],
    topics: ['dfa', 'nfa', 'automaton', 'automata', 'language', 'strings', 'accept', 'regular'],
    question: 'Construct a DFA over {a, b} that accepts strings ending in ab.',
    constraints: ['Alphabet {a, b}', 'Deterministic'],
    assumptions: [],
    rationale: 'Each state remembers how much of "ab" has just been read. Every state has a move on every symbol, so the transition function is complete.',
    body: json({
        kind: 'automaton',
        type: 'dfa',
        title: 'Ends in ab',
        alphabet: ['a', 'b'],
        states: ['q0', 'q1', 'q2'],
        start: 'q0',
        accepting: ['q2'],
        transitions: [
          { from: 'q0', symbol: 'a', to: 'q1' },
          { from: 'q0', symbol: 'b', to: 'q0' },
          { from: 'q1', symbol: 'a', to: 'q1' },
          { from: 'q1', symbol: 'b', to: 'q2' },
          { from: 'q2', symbol: 'a', to: 'q1' },
          { from: 'q2', symbol: 'b', to: 'q0' },
        ],
    }),
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
  const fence = example.fence || 'mermaid';
  // A table example is written as the table itself: that is what the answer holds.
  if (fence === 'table') lines.push(example.body);
  else lines.push(`\`\`\`${fence}`, example.body ?? example.mermaid, '```');
  return lines.join('\n');
}

/** The four original views share examples with each other and with nothing else. */
const LEGACY_EXAMPLE_VIEWS = new Set(['architecture', 'sequence', 'flowchart', 'state']);

function scoreExample(example, question, view, mode, chartIntent) {
  let score = 0;
  if (view && example.view === view) score += 3;
  // Architecture and flowchart share a Mermaid family; treat them as near.
  else if (view && ((view === 'flowchart' && example.view === 'architecture') || (view === 'architecture' && example.view === 'flowchart'))) score += 1;
  // Any other view takes examples of its own view only: an ER question never
  // gets an architecture as its reference, whatever words they share.
  else if (view) return 0;
  // Version-2 entries (they carry `modes`) are for the catalog; a system-design
  // turn with no mode keeps the examples it always had.
  if (example.modes && LEGACY_EXAMPLE_VIEWS.has(example.view) && !mode) return 0;
  // A chart reference teaches ONE kind of chart. A breakdown, a quadrant or a
  // function plot is not taught by a forecast (every intent without its own
  // example used to get the forecast one, numbers and all).
  if (example.view === 'chart' && chartIntent) {
    const wanted = chartIntent === 'generic' || chartIntent === 'comparison' ? 'trend' : chartIntent;
    if (example.chartIntent !== wanted) return 0;
    score += 4;
  }
  if (mode && Array.isArray(example.modes) && example.modes.includes(mode)) score += 2;
  const q = ` ${String(question || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  for (const topic of example.topics) {
    if (q.includes(` ${topic} `) || (topic.includes(' ') && q.includes(topic))) score += topic.includes(' ') ? 3 : 2;
  }
  return score;
}

/**
 * Pick 0–2 examples for a request.
 *
 * @param {{ question?: string, view?: string, mode?: string, chartIntent?: string, max?: number, tokenBudget?: number }} input
 * @returns {Array<typeof DIAGRAM_EXAMPLES[number]>}
 */
export function selectDiagramExamples(input = {}) {
  const max = Math.max(0, Math.min(2, Number.isFinite(input.max) ? input.max : 1));
  if (max === 0) return [];
  const budget = Number.isFinite(input.tokenBudget) ? input.tokenBudget : DIAGRAM_EXAMPLE_TOKEN_BUDGET;
  const ranked = DIAGRAM_EXAMPLES.map((example, index) => ({
    example,
    index,
    score: scoreExample(example, input.question, input.view, input.mode, input.chartIntent),
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
    ...(examples.some((e) => e.fence && e.fence !== 'mermaid') ? ['Any number, name or date inside a reference is made up for the reference. Never reuse one as if it were this conversation\'s.'] : []),
    '',
    body,
  ].join('\n');
}
