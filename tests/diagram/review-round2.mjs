// tests/diagram/review-round2.mjs
//
// Sentences written by the SECOND review of the decision rules (2026-10-02),
// after the first rewrite had been fitted to the first review's corpus. None of
// these were seen while those rules were written; each list failed in part
// before the rules were reworked around sentence mood (a visual is asked for
// only by an instruction, a request frame or a bare noun-phrase fragment) and
// evidence-based follow-ups.
//
// Used by src/lib/diagram/__tests__/resolverPrecision.test.mjs.

/** No artifact on the table. None of these asks for a drawing or a design. */
export const NOT_REQUESTS = [
  'I work in product and design systems for a living.',
  'I also design APIs.',
  'We use Figma and design systems heavily.',
  'Can you design the checkout page?',
  'Please design a payment form.',
  'Then design the app icon.',
  "Let's design the elevator pitch.",
  'How would you build a sales pipeline from scratch?',
  'How do you build a talent pipeline?',
  'How should we build the application for the grant?',
  'Normally we just show the customer a bar chart of savings and they sign.',
  'Studies also show that pie charts are misleading.',
  'The numbers now show a decline in the bar chart.',
  'I like the chart you sent yesterday.',
  'Can I get a picture with you after this?',
  'Give me a picture of what your day looks like.',
  "There's an error in the diagram.",
  'I disagree with that diagram.',
  'We are on a tight timeline, can you start Monday?',
  'The org chart for engineering is outdated.',
  'A decision tree for this would be overkill.',
  'Do we have a Gantt chart for this?',
  'Can you pull up the bar chart from last quarter?',
  'Can you draw up the contract by Friday?',
  'Can you illustrate how you handled conflict on your team?',
  'At my last job I documented everything in Mermaid.',
  'Can we view this as a graph problem?',
  "What's the plot of the movie?",
  'Can you add a table of contents?',
  'We want a pie chart in the QBR deck, do you have a template?',
];

/** No artifact on the table. Each of these asks for a drawing, and gets one. */
export const REQUESTS = [
  'Plot y = x^2 from -3 to 3.',
  'Can you plot y = sin(x)?',
  'Graph the function sin(x).',
  'Graph revenue by quarter.',
  'Plot revenue against headcount.',
  'Chart signups by month',
  'Timeline of the French Revolution',
  'Timeline of her career, please.',
  'Gantt chart for the release.',
  'Someone draw the architecture please.',
  'Would you mind drawing the login flow?',
  'Could that be drawn as a state machine?',
  'How about a diagram?',
  'Hey, draw the flow.',
  'First, draw the flow.',
  'Could you kindly draw the flow?',
  '“Draw the login flow”',
  'Show me a Gantt chart for next sprint.',
  'Show the break-even if we start next week.',
  'Design a social network without a graph database.',
  'Design a key-value store with no table scans.',
  'Draw the architecture, no need for a table of components.',
  'Explain the water cycle with a diagram',
  'Design a payment system and draw the request flow',
  'There is no diagram in the doc, so draw the architecture from the doc.',
  'With a diagram please.',
  'Do a diagram.',
  'Pull up a diagram of the request flow.',
  'Lay it out on a timeline.',
];

/** A question about the thing, in a mode where the thing is relevant: nothing is drawn unasked. */
export const ABOUT_NOT_FOR = [
  ['Who owns the rollout plan?', 'team-meet'],
  ['Why is the project schedule slipping?', 'team-meet'],
  ['Who wrote the data model?', 'team-meet'],
  ['Where is the database schema documented?', 'team-meet'],
  ['How has the team changed since you joined?', 'recruiting'],
  ['How has the role changed over the years?', 'recruiting'],
  ['Why is headcount growing by 20% when revenue is flat?', 'sales'],
  ['How long did the recruiting process take?', 'recruiting'],
];

/** …while these still are (the task itself is asked for). */
export const STILL_IMPLIED = [
  ['Where are deals dropping out?', 'sales'],
  ['Who owns what on this project?', 'team-meet'],
  ['Which task blocks which?', 'team-meet'],
  ['How has our revenue changed this year?', 'sales'],
  ['Walk me through troubleshooting the router.', 'call-center'],
  ['When do we break even on this deal?', 'sales'],
];

export const ORDER_SYSTEM = {
  artifactId: 'design-1.v1',
  artifact: 'mermaid',
  view: 'architecture',
  version: 1,
  foreground: true,
  question: 'Design an order system',
  source:
    'flowchart LR\n    client["Client"] --> gateway["API Gateway"]\n    gateway --> orders["Order Service"]\n    orders --> payments["Payment Service"]\n    payments --> stripe["Stripe"]\n    orders --> queue["Notification Queue"]\n    queue --> email["Email Worker"]\n    orders --> db[("Orders DB")]',
};
export const FORECAST_CHART = {
  artifactId: 'design-2.v1',
  artifact: 'chart',
  view: 'chart',
  version: 1,
  foreground: true,
  question: 'Revenue at 5% growth',
  source: JSON.stringify({ v: 1, type: 'line', title: 'Monthly revenue at 5% net growth', x: { label: 'Month' }, y: { label: 'Revenue', unit: 'USD' }, compute: { kind: 'compound_growth', baseline: 10000, ratePercent: 5, period: 'month', periods: 6 } }),
};
export const ORDER_MODEL = {
  artifactId: 'design-3.v1',
  artifact: 'mermaid',
  view: 'er',
  version: 1,
  foreground: true,
  source: 'erDiagram\n    CUSTOMER ||--o{ ORDER : places\n    ORDER ||--|{ LINE_ITEM : contains\n    ORDER ||--o| PAYMENT : paid_by',
};

/** Said with an artifact in focus, and about something else: never a follow-up. */
export const UNRELATED_IN_FOCUS = [
  'Move it to Thursday.',
  'Make it quick.',
  'Add that to the notes.',
  'Try it again.',
  'Mark that as done.',
  'Update that ticket.',
  "Let's drop this for now.",
  'Does that work for everyone?',
  'Is that a problem?',
  'When is the payment due?',
  'Did the email go out?',
  'Is the system down?',
  "What's the figure for Q3?",
  'Add him to the system.',
  'Is this a remote role?',
  'Can you hear me?',
  'Send me the invite for Friday.',
  'That sounds good to me.',
  "Let's take a five minute break.",
  'How was your weekend?',
  'Who is joining the call?',
  'Put it on my calendar.',
  'I will send it over after this.',
  'Can we wrap this up?',
  'Thanks, that helps.',
  'Where do you see yourself as a worker in five years?',
  'What if I told you the salary is 20% higher?',
];

/** Follow-ups on the order system: each is one, with the design as its parent. */
export const ARCHITECTURE_FOLLOW_UPS = [
  ['Walk me through it.', 'explain'],
  ['Explain this to me.', 'explain'],
  ['Tell me more about this.', 'explain'],
  ['I want to add a cache between the gateway and the order service.', 'update'],
  ['What if I add a cache here?', 'update'],
  ['I think it needs a load balancer.', 'update'],
  ["Where's the bottleneck?", 'explain'],
  ['What are the tradeoffs?', 'explain'],
  ['Is there a single point of failure?', 'explain'],
  ['We should also have a CDN.', 'update'],
  ['Get rid of the email worker.', 'update'],
  ['Take out Stripe.', 'update'],
  ['Add auth.', 'update'],
  ['Simplify it.', 'update'],
  ['Clean up the diagram.', 'update'],
  ['Show the failure path.', 'create'],
  ['Zoom in on the payment service.', 'create'],
  ['Add a calendar sync service.', 'update'],
  ['Add a service for meeting reminders.', 'update'],
  ['Add Redis between the gateway and the order service', 'update'],
  ['Why do we need the queue?', 'explain'],
  ['Make this multi-region', 'update'],
  ['Replace Stripe with Adyen', 'update'],
  ['How does this scale to ten million users?', 'update'],
  ['Turn it into a sequence diagram.', 'create'],
  ['Change this to a sequence diagram.', 'create'],
  ['Convert this to Chen notation.', 'create'],
  ['Show that as a sequence diagram.', 'create'],
  ['Draw it again with a cache.', 'update'],
  ['Redraw it with Kafka.', 'update'],
  ['Change the diagram to use two workers', 'update'],
];

/** Follow-ups on the forecast chart. */
export const CHART_FOLLOW_UPS = [
  ['Start from 25,000 instead.', 'update'],
  ['Double the rate.', 'update'],
  ['Halve it.', 'update'],
  ['Go out two years.', 'update'],
  ['And at 8%?', 'update'],
  ['What would revenue look like at 8% monthly growth?', 'update'],
  ['Make it 3%', 'update'],
  ['Make it a bar chart.', 'update'],
  ['Show it as a bar chart.', 'update'],
  ['Switch to a line chart', 'update'],
  ['Where does 10,000 come from?', 'explain'],
  ['Where did the 5% come from?', 'explain'],
  ['Is 5% realistic?', 'explain'],
  ['Show it as a table.', 'create'],
];

/** With the chart in focus: a number or a duration that has nothing to do with it. */
export const NOT_ABOUT_THE_CHART = [
  'The contract is for 12 months.',
  'We ship in two weeks.',
  'Net 30 days payment terms.',
  'We need 20% more budget.',
  'Does it support SSO?',
  'How does that work with our existing CRM?',
];

/** Follow-ups on the data model. */
export const MODEL_FOLLOW_UPS = [
  ['Drop the table.', 'update'],
  ['Drop the table for payments.', 'update'],
  ['Add a status column to the order table', 'update'],
  ['Make the payment optional', 'update'],
];

/** The router calls the turn coding; the order system is in focus. */
export const CODING_WITH_A_DESIGN = [
  ['Now handle the edge case where the order is empty.', false],
  ['Merge two sorted arrays', false],
  ['Why did you use a hash map here?', false],
  ['Replace Stripe with Adyen', true],
];

/** The router calls the turn a system design; a design is on the table. Only a fresh ask restarts it. */
export const ROUTE_SAYS_DESIGN = [
  ['What about consistency?', true, 'explain'],
  ['How would you shard it?', false, 'explain'],
  ['What about the mobile clients?', true, 'explain'],
  ['Design a parking lot', true, 'create'],
];
