// Independent measurement F — sentences written BEFORE reading diagramRequest.mjs.
// Fixture domain: greenhouse sensor telemetry (architecture), insurance-claim lifecycle
// (STATE diagram chosen for list 6), office relocation (GANTT chosen for list 7),
// subscriber forecast (compound-growth chart).

const ARCH_SRC = `flowchart LR
  SG[Sensor Gateway] --> IQ[Ingest Queue]
  WF[Weather Feed Adapter] --> IQ
  IQ --> TP[Telemetry Processor]
  TP --> TS[(Time Series Store)]
  TP --> RE[Rules Engine]
  RE --> IC[Irrigation Controller]
  TS --> GD[Grower Dashboard]
  RE --> GD`;

const STATE_SRC = `stateDiagram-v2
  state "Under Review" as UnderReview
  state "Awaiting Documents" as AwaitingDocuments
  state "Paid Out" as PaidOut
  [*] --> Submitted
  Submitted --> UnderReview
  UnderReview --> AwaitingDocuments: more info needed
  AwaitingDocuments --> UnderReview: documents received
  UnderReview --> Approved
  UnderReview --> Rejected
  Rejected --> Appealed
  Appealed --> UnderReview
  Approved --> PaidOut
  PaidOut --> [*]`;

const GANTT_SRC = `gantt
  title Office relocation plan
  dateFormat YYYY-MM-DD
  section Premises
  Lease Signing :a1, 2027-03-01, 7d
  Fit-out Design :a2, after a1, 21d
  section Infrastructure
  Cabling and Network :b1, after a2, 14d
  Furniture Delivery :b2, after a2, 10d
  section Move
  Staff Move Weekend :c1, after b1, 2d
  Old Office Handback :c2, after c1, 14d`;

const CHART_SRC = JSON.stringify({
  v: 1,
  type: 'line',
  title: 'Subscriber forecast',
  compute: { kind: 'compound_growth', baseline: 12500, ratePercent: 4, period: 'month', periods: 12 },
});

const mk = (id, artifact, view, source, foreground) => ({
  artifactId: id, artifact, view, version: 1, foreground, source,
});

export const FIXTURES = {
  arch_fg: mk('design-1.v1', 'mermaid', 'architecture', ARCH_SRC, true),
  arch_bg: mk('design-1.v1', 'mermaid', 'architecture', ARCH_SRC, false),
  chart_fg: mk('design-2.v1', 'chart', 'chart', CHART_SRC, true),
  chart_bg: mk('design-2.v1', 'chart', 'chart', CHART_SRC, false),
  state_fg: mk('design-3.v1', 'mermaid', 'state', STATE_SRC, true),
  state_bg: mk('design-3.v1', 'mermaid', 'state', STATE_SRC, false),
  gantt_fg: mk('design-4.v1', 'mermaid', 'gantt', GANTT_SRC, true),
  gantt_bg: mk('design-4.v1', 'mermaid', 'gantt', GANTT_SRC, false),
};

const rows = [];
const counters = {};
// add(list, q, mode, ctx, expect, extra?)  extra: { op, borderline, coding }
const add = (list, q, mode, ctx, expect, extra = {}) => {
  counters[list] = (counters[list] || 0) + 1;
  rows.push({ id: `L${list}-${String(counters[list]).padStart(2, '0')}`, list, q, mode, ctx, expect, ...extra });
};
const B = { borderline: true };

// ───────────────────────── List 1 — no artifact, must NOT draw
add('1', "We need to draw the line somewhere on scope creep.", 'general', 'none', 'nodraw');
add('1', "I was charting a new course for my career after the layoffs.", 'looking-for-work', 'none', 'nodraw');
add('1', "The chart Priya showed last week was misleading, honestly.", 'team-meet', 'none', 'nodraw');
add('1', "She mapped out her whole career before she turned thirty.", 'recruiting', 'none', 'nodraw');
add('1', "Let's table this until Thursday.", 'team-meet', 'none', 'nodraw');
add('1', "That's off the charts for a first quarter.", 'sales', 'none', 'nodraw');
add('1', "He drew a blank when I asked about the renewal date.", 'sales', 'none', 'nodraw');
add('1', "Our org chart changed three times last year.", 'general', 'none', 'nodraw');
add('1', "I'm not sure the timeline they gave us is realistic.", 'team-meet', 'none', 'nodraw');
add('1', "The customer says the diagram in the manual is wrong.", 'call-center', 'none', 'nodraw');
add('1', "Back at my last job I designed the onboarding process for new hires.", 'looking-for-work', 'none', 'nodraw');
add('1', "Can you design a logo for the spring campaign?", 'general', 'none', 'nodraw');
add('1', "We should design a better interview loop for senior candidates.", 'recruiting', 'none', 'nodraw');
add('1', "What is the difference between a bar chart and a histogram?", 'lecture', 'none', 'nodraw', B);
add('1', "The architecture of the cathedral is mostly Gothic.", 'lecture', 'none', 'nodraw');
add('1', "I pictured it very differently, to be honest.", 'general', 'none', 'nodraw');
add('1', "Did you see the flow of traffic on the M25 this morning?", 'general', 'none', 'nodraw');
add('1', "Please design the landing page hero section in a more playful style.", 'general', 'none', 'nodraw');
add('1', "Their sequence of emails was pretty aggressive.", 'sales', 'none', 'nodraw');
add('1', "He's a real class act, that candidate.", 'recruiting', 'none', 'nodraw');
add('1', "The state of the economy is making buyers nervous.", 'sales', 'none', 'nodraw');
add('1', "Sam drew the short straw and is on call this weekend.", 'team-meet', 'none', 'nodraw');
add('1', "Who is the hiring manager for the data role?", 'recruiting', 'none', 'nodraw');
add('1', "How do I reset the router to factory settings?", 'call-center', 'none', 'nodraw');
add('1', "Write a function that merges two sorted arrays.", 'technical-interview', 'none', 'nodraw', { coding: true });
add('1', "What's the time complexity of a heap insert?", 'technical-interview', 'none', 'nodraw', { coding: true });
add('1', "My previous manager used to sketch things on napkins.", 'looking-for-work', 'none', 'nodraw');
add('1', "We were going to show a pie chart but ran out of time.", 'seminar', 'none', 'nodraw');
add('1', "The graph database vendor wants a call next week.", 'sales', 'none', 'nodraw');
add('1', "I can't visualise ever going back to an office five days a week.", 'general', 'none', 'nodraw');
add('1', "Draw your own conclusions from that.", 'general', 'none', 'nodraw');
add('1', "The picture is getting clearer on pricing.", 'sales', 'none', 'nodraw');
add('1', "Tell me about a time you had to design a pitch for a difficult client.", 'recruiting', 'none', 'nodraw');
add('1', "It was a model answer, really textbook.", 'recruiting', 'none', 'nodraw');
add('1', "Could you outline your salary expectations?", 'recruiting', 'none', 'nodraw');
add('1', "Is the roadmap review still at three?", 'team-meet', 'none', 'nodraw');
add('1', "The lecture slides have a nice diagram of the Krebs cycle on page four.", 'lecture', 'none', 'nodraw');
add('1', "I'd like to schedule a follow-up for next Tuesday.", 'sales', 'none', 'nodraw');
add('1', "Let's go round the table and do introductions.", 'team-meet', 'none', 'nodraw');
add('1', "Does this plan include the premium support tier?", 'call-center', 'none', 'nodraw');

// ───────────────────────── List 2 — no artifact, MUST draw
add('2', "Draw the login flow for the mobile app.", 'general', 'none', 'draw');
add('2', "Can you sketch the architecture for a multi-tenant payroll system?", 'technical-interview', 'none', 'draw');
add('2', "I'd like a sequence diagram of the OAuth handshake.", 'technical-interview', 'none', 'draw');
add('2', "Would you mind putting together a flowchart of the refund approval process?", 'call-center', 'none', 'draw');
add('2', "Let's diagram how a request moves from the browser to the database.", 'team-meet', 'none', 'draw');
add('2', "Timeline of the Apollo programme.", 'lecture', 'none', 'draw');
add('2', "Mind map of the causes of the First World War", 'seminar', 'none', 'draw');
add('2', "Design a distributed rate limiter.", 'technical-interview', 'none', 'draw');
add('2', "Design Dropbox.", 'technical-interview', 'none', 'draw');
add('2', "Show me a bar chart of revenue by region: North 120, South 95, East 143, West 88.", 'sales', 'none', 'draw');
add('2', "Give me an ER diagram for a library with books, members and loans.", 'technical-interview', 'none', 'draw');
add('2', "Could you plot quarterly churn at 5, 4.2, 3.9 and 3.1 percent?", 'sales', 'none', 'draw');
add('2', "Please visualise the hiring pipeline as a funnel.", 'recruiting', 'none', 'draw');
add('2', "Make a Gantt chart for the website migration: audit two weeks, build six weeks, QA two weeks.", 'team-meet', 'none', 'draw');
add('2', "Class diagram for a parking garage system.", 'technical-interview', 'none', 'draw');
add('2', "State machine for a vending machine, please.", 'technical-interview', 'none', 'draw');
add('2', "Can we get a diagram of how the billing service talks to the ledger?", 'team-meet', 'none', 'draw');
add('2', "I want to see a comparison table of the three pricing tiers.", 'sales', 'none', 'draw');
add('2', "Draw me a DFA that accepts binary strings ending in 01.", 'lecture', 'none', 'draw');
add('2', "Illustrate the TCP three-way handshake.", 'lecture', 'none', 'draw');
add('2', "Design a chat system like WhatsApp.", 'technical-interview', 'none', 'draw');
add('2', "Put the three plans in a table with price and seat limits.", 'sales', 'none', 'draw');
add('2', "Sketch out the data model for a hotel reservation system.", 'technical-interview', 'none', 'draw');
add('2', "Chart the growth if we start at 2,000 users and grow 8% a month for a year.", 'general', 'none', 'draw');
add('2', "Kindly make one diagram for explaining the deployment pipeline.", 'team-meet', 'none', 'draw');
add('2', "Can you please to draw the flow how the ticket is escalated?", 'call-center', 'none', 'draw');
add('2', "Let's map out the customer journey from signup to first invoice as a flowchart.", 'sales', 'none', 'draw');
add('2', "Walk me through the system design for a real-time leaderboard.", 'technical-interview', 'none', 'draw', B);
add('2', "Architecture diagram for a multi-region key-value store", 'technical-interview', 'none', 'draw');
add('2', "How about a pie chart of where the support tickets come from — 40% billing, 35% login, 25% other?", 'call-center', 'none', 'draw');
add('2', "Show the org structure as a tree: CEO, then CTO and CFO, then their teams.", 'general', 'none', 'draw');
add('2', "Design Twitter's timeline service.", 'technical-interview', 'none', 'draw');
add('2', "Diagram the lifecycle of a pull request.", 'team-meet', 'none', 'draw');
add('2', "I need a flow diagram showing what happens when a payment fails.", 'general', 'none', 'draw');
add('2', "Could you draw up an entity relationship diagram for a university — students, courses, enrolments?", 'lecture', 'none', 'draw');
add('2', "Design a system that ingests telemetry from a million IoT sensors.", 'technical-interview', 'none', 'draw');
add('2', "Graph y equals x squared from minus three to three.", 'lecture', 'none', 'draw', B);
add('2', "Would it be possible to have the onboarding steps as a diagram?", 'recruiting', 'none', 'draw');
add('2', "Draw a sequence diagram: client calls gateway, gateway calls auth, auth returns a token.", 'technical-interview', 'none', 'draw', { coding: true });
add('2', "Gantt of the Q3 launch plan.", 'team-meet', 'none', 'draw');

// ───────────────────────── List 3 — architecture in focus, unrelated (must NOT be claimed)
add('3', "Add a step to the onboarding checklist for badge pickup.", 'team-meet', 'arch_fg', 'noclaim');
add('3', "The weather is supposed to turn on Friday, so bring a coat.", 'general', 'arch_fg', 'noclaim');
add('3', "There was a massive queue at the coffee place this morning.", 'general', 'arch_fg', 'noclaim');
add('3', "Can you add Maria to the invite for Thursday?", 'team-meet', 'arch_fg', 'noclaim');
add('3', "I need to stop by the store on the way home.", 'general', 'arch_fg', 'noclaim');
add('3', "What are the rules for expensing client dinners?", 'general', 'arch_fg', 'noclaim');
add('3', "Remove the last bullet from the agenda.", 'team-meet', 'arch_fg', 'noclaim');
add('3', "Put a reminder in my calendar to call the landlord.", 'general', 'arch_fg', 'noclaim');
add('3', "Who's presenting at the all-hands next week?", 'team-meet', 'arch_fg', 'noclaim');
add('3', "Let's move the retro to Wednesday.", 'team-meet', 'arch_fg', 'noclaim');
add('3', "Add two more engineers to the hiring plan for next quarter.", 'team-meet', 'arch_fg', 'noclaim');
add('3', "The finance dashboard login expired again, by the way.", 'team-meet', 'arch_fg', 'noclaim');
add('3', "Did anyone feed the office fish?", 'general', 'arch_fg', 'noclaim');
add('3', "Change the meeting title to 'Budget sync'.", 'general', 'arch_fg', 'noclaim');
add('3', "How was your holiday in Portugal?", 'general', 'arch_fg', 'noclaim');
add('3', "What is a message queue, in general terms?", 'technical-interview', 'arch_fg', 'noclaim', B);
add('3', "Rename the Slack channel to greenhouse-pilots.", 'team-meet', 'arch_fg', 'noclaim');
add('3', "Our payment gateway contract renews in March.", 'sales', 'arch_fg', 'noclaim');
add('3', "Add a line to the minutes that legal approved the contract.", 'team-meet', 'arch_fg', 'noclaim');
add('3', "The processor in my laptop is overheating again.", 'general', 'arch_fg', 'noclaim');
add('3', "Insert a slide about pricing before the demo section.", 'sales', 'arch_fg', 'noclaim');
add('3', "Is lunch being delivered or are we going out?", 'general', 'arch_fg', 'noclaim');
add('3', "Send the recap to the client by end of day.", 'sales', 'arch_fg', 'noclaim');
add('3', "Let's add a new column to the budget spreadsheet for travel.", 'team-meet', 'arch_fg', 'noclaim');
add('3', "Remove Daniel from the on-call rota this week.", 'team-meet', 'arch_fg', 'noclaim');
add('3', "How many days of leave do I have left?", 'general', 'arch_fg', 'noclaim');
add('3', "Take the dog off the sofa, sorry, one second.", 'general', 'arch_fg', 'noclaim');
add('3', "Connect me with the recruiter who handled the Lisbon hires.", 'recruiting', 'arch_fg', 'noclaim');
add('3', "The controller on my son's Xbox broke yesterday.", 'general', 'arch_fg', 'noclaim');
add('3', "Write a function that returns the nth Fibonacci number.", 'technical-interview', 'arch_fg', 'noclaim', { coding: true });
add('3', "Delete the draft email I started to the supplier.", 'general', 'arch_fg', 'noclaim');
add('3', "Which series are you watching at the moment?", 'general', 'arch_fg', 'noclaim');
add('3', "Replace the projector bulb before Monday's workshop.", 'team-meet', 'arch_fg', 'noclaim');
add('3', "We split the bill between the two departments.", 'general', 'arch_fg', 'noclaim');
add('3', "Tell me about your experience with stakeholder management.", 'recruiting', 'arch_fg', 'noclaim');
add('3', "Add a section on data retention to the proposal document.", 'sales', 'arch_fg', 'noclaim');
add('3', "Move the standing desk to the other side of the room.", 'general', 'arch_fg', 'noclaim');
add('3', "What time does the support line open on Saturdays?", 'call-center', 'arch_fg', 'noclaim');
add('3', "I think the sensor on the car park barrier is broken.", 'general', 'arch_fg', 'noclaim');
add('3', "Swap the order of the two interviews on Friday.", 'recruiting', 'arch_fg', 'noclaim');

// ───────────────────────── List 4 — architecture in focus, real follow-ups
const U = { op: 'update' }, E = { op: 'explain' }, C = { op: 'create' };
add('4', "Add a cache in front of the Time Series Store.", 'technical-interview', 'arch_fg', 'claim', U);
add('4', "Why do we need the Ingest Queue?", 'technical-interview', 'arch_fg', 'claim', E);
add('4', "Where's the bottleneck in this design?", 'technical-interview', 'arch_fg', 'claim', E);
add('4', "Remove the Weather Feed Adapter.", 'team-meet', 'arch_fg', 'claim', U);
add('4', "Show this as a sequence diagram.", 'technical-interview', 'arch_fg', 'claim', C);
add('4', "What happens if the Telemetry Processor goes down?", 'technical-interview', 'arch_fg', 'claim', E);
add('4', "Put a load balancer before the Sensor Gateway.", 'technical-interview', 'arch_fg', 'claim', U);
add('4', "Rename the Rules Engine to Automation Engine.", 'team-meet', 'arch_fg', 'claim', U);
add('4', "Can you explain how data gets from the sensors to the dashboard?", 'general', 'arch_fg', 'claim', E);
add('4', "Now give me the data model for this.", 'technical-interview', 'arch_fg', 'claim', C);
add('4', "Make the queue Kafka.", 'technical-interview', 'arch_fg', 'claim', U);
add('4', "Split the Telemetry Processor into a validator and an aggregator.", 'technical-interview', 'arch_fg', 'claim', U);
add('4', "How does the Irrigation Controller know when to open a valve?", 'general', 'arch_fg', 'claim', E);
add('4', "Add a dead letter queue.", 'technical-interview', 'arch_fg', 'claim', U);
add('4', "Is the Time Series Store a single point of failure?", 'technical-interview', 'arch_fg', 'claim', E);
add('4', "Connect the Weather Feed Adapter directly to the Rules Engine.", 'team-meet', 'arch_fg', 'claim', U);
add('4', "Draw the deployment view of the same system.", 'technical-interview', 'arch_fg', 'claim', C);
add('4', "What's the arrow between the gateway and the queue for?", 'general', 'arch_fg', 'claim', E);
add('4', "Add authentication at the gateway.", 'technical-interview', 'arch_fg', 'claim', U);
add('4', "Could we replace the queue with a direct call?", 'team-meet', 'arch_fg', 'claim', { op: 'update', borderline: true });
add('4', "Walk me through it step by step.", 'general', 'arch_fg', 'claim', E);
add('4', "How would this scale to ten thousand greenhouses?", 'technical-interview', 'arch_fg', 'claim', E);
add('4', "Add a second region for failover.", 'technical-interview', 'arch_fg', 'claim', U);
add('4', "Get rid of the dashboard and put a mobile app there instead.", 'team-meet', 'arch_fg', 'claim', U);
add('4', "Can I see the class diagram for the Rules Engine?", 'technical-interview', 'arch_fg', 'claim', C);
add('4', "Which component writes to the Time Series Store?", 'general', 'arch_fg', 'claim', E);
add('4', "Label the arrow from the Rules Engine to the Irrigation Controller as 'commands'.", 'team-meet', 'arch_fg', 'claim', U);
add('4', "Why is the Rules Engine separate from the Telemetry Processor?", 'technical-interview', 'arch_fg', 'claim', E);
add('4', "Add monitoring.", 'technical-interview', 'arch_fg', 'claim', U);
add('4', "Make it more detailed.", 'general', 'arch_fg', 'claim', { op: 'update', borderline: true });
add('4', "What does the Sensor Gateway actually do?", 'general', 'arch_fg', 'claim', E);
add('4', "Insert a stream processor between the Ingest Queue and the Time Series Store.", 'technical-interview', 'arch_fg', 'claim', U);
add('4', "Zoom in on the ingestion path and draw just that.", 'technical-interview', 'arch_fg', 'claim', { op: 'create', borderline: true });
add('4', "Does the dashboard read straight from the store?", 'team-meet', 'arch_fg', 'claim', E);
add('4', "Take out the queue, we don't need it for the first version.", 'team-meet', 'arch_fg', 'claim', U);
add('4', "And an ER diagram of what the Time Series Store holds, please.", 'technical-interview', 'arch_fg', 'claim', C);
add('4', "Move the Rules Engine after the store.", 'team-meet', 'arch_fg', 'claim', U);
add('4', "Explain the trade-offs of this architecture.", 'technical-interview', 'arch_fg', 'claim', E);
add('4', "Add a CDN for the Grower Dashboard.", 'technical-interview', 'arch_fg', 'claim', U);
add('4', "What would you change to make it cheaper to run?", 'team-meet', 'arch_fg', 'claim', { op: 'explain', borderline: true });

// ───────────────────────── List 5a — chart in focus, unrelated numbers (must NOT be claimed)
add('5a', "We offered them a 15% discount on the annual plan.", 'sales', 'chart_fg', 'noclaim');
add('5a', "The contract is worth 40,000 pounds over two years.", 'sales', 'chart_fg', 'noclaim');
add('5a', "Headcount is going from 12 to 15 in March.", 'team-meet', 'chart_fg', 'noclaim');
add('5a', "I'll be out for three weeks in August.", 'team-meet', 'chart_fg', 'noclaim');
add('5a', "The invoice was due on the 14th of June.", 'call-center', 'chart_fg', 'noclaim');
add('5a', "It took 45 minutes to get through to an agent.", 'call-center', 'chart_fg', 'noclaim');
add('5a', "Can you give them 10% off if they sign by Friday?", 'sales', 'chart_fg', 'noclaim');
add('5a', "My notice period is six weeks.", 'looking-for-work', 'chart_fg', 'noclaim');
add('5a', "We closed 7 of the 20 deals in the pipeline.", 'sales', 'chart_fg', 'noclaim');
add('5a', "The meeting is moved to half past two.", 'team-meet', 'chart_fg', 'noclaim');
add('5a', "She's asking for 85k plus equity.", 'recruiting', 'chart_fg', 'noclaim');
add('5a', "Their renewal is in 18 months.", 'sales', 'chart_fg', 'noclaim');
add('5a', "Change the dinner booking to eight people.", 'general', 'chart_fg', 'noclaim');
add('5a', "Round two of interviews starts on the 3rd.", 'recruiting', 'chart_fg', 'noclaim');
add('5a', "The refund of $29.99 hasn't arrived after 10 days.", 'call-center', 'chart_fg', 'noclaim');
add('5a', "Let's make it 4 pm instead of 3.", 'team-meet', 'chart_fg', 'noclaim');
add('5a', "We grew the team by two people last month.", 'team-meet', 'chart_fg', 'noclaim');
add('5a', "What's the VAT rate in Germany, is it 19%?", 'general', 'chart_fg', 'noclaim');
add('5a', "Increase the budget for the offsite to 5,000.", 'team-meet', 'chart_fg', 'noclaim');
add('5a', "I've got a dentist appointment at 12, back by 1.", 'general', 'chart_fg', 'noclaim');
add('5a', "Take 20 minutes for lunch and we'll regroup.", 'general', 'chart_fg', 'noclaim');
add('5a', "He has 12 years of experience in logistics.", 'recruiting', 'chart_fg', 'noclaim');

// ───────────────────────── List 5b — chart in focus, follow-ups
add('5b', "Make it 5% instead.", 'sales', 'chart_fg', 'claim', U);
add('5b', "What if we start from 20,000?", 'sales', 'chart_fg', 'claim', U);
add('5b', "Extend it to twenty-four months.", 'general', 'chart_fg', 'claim', U);
add('5b', "Change the growth rate to two and a half percent.", 'sales', 'chart_fg', 'claim', U);
add('5b', "Show it as a bar chart.", 'general', 'chart_fg', 'claim'); // op ambiguous (update vs create) — not scored
add('5b', "Where does it cross 20,000?", 'sales', 'chart_fg', 'claim', E);
add('5b', "Why does the curve get steeper toward the end?", 'general', 'chart_fg', 'claim', E);
add('5b', "Set the baseline to fifteen thousand.", 'team-meet', 'chart_fg', 'claim', U);
add('5b', "Do it quarterly rather than monthly.", 'sales', 'chart_fg', 'claim', U);
add('5b', "What's the value at month twelve?", 'general', 'chart_fg', 'claim', E);
add('5b', "Drop the rate to three.", 'sales', 'chart_fg', 'claim', U);
add('5b', "Run it for a year and a half.", 'team-meet', 'chart_fg', 'claim', U);
add('5b', "Bump that up to six and a half percent.", 'sales', 'chart_fg', 'claim', U);
add('5b', "Add a second line at 2% for the pessimistic case.", 'sales', 'chart_fg', 'claim', U);
add('5b', "How long until it doubles?", 'general', 'chart_fg', 'claim', E);
add('5b', "Use 10k as the starting point.", 'sales', 'chart_fg', 'claim', U);
add('5b', "Can you explain what this forecast assumes?", 'general', 'chart_fg', 'claim', E);
add('5b', "Shorten it to six months.", 'team-meet', 'chart_fg', 'claim', U);
add('5b', "Now the same thing but at one percent a month.", 'sales', 'chart_fg', 'claim', U);
add('5b', "Is that compounding monthly or annually?", 'general', 'chart_fg', 'claim', E);
add('5b', "Halve the growth rate.", 'sales', 'chart_fg', 'claim', U);
add('5b', "Put the numbers in a table as well.", 'team-meet', 'chart_fg', 'claim', C);

// ───────────────────────── List 6a — STATE diagram in focus, unrelated (must NOT be claimed)
add('6a', "My expense claim was rejected again by finance.", 'general', 'state_fg', 'noclaim');
add('6a', "Has the offer been approved by the comp committee yet?", 'recruiting', 'state_fg', 'noclaim');
add('6a', "I submitted my timesheet late, sorry.", 'team-meet', 'state_fg', 'noclaim');
add('6a', "What state is the kitchen in after the party?", 'general', 'state_fg', 'noclaim');
add('6a', "The documents for the visa are still with the embassy.", 'general', 'state_fg', 'noclaim');
add('6a', "Add Tom to the review panel for Thursday.", 'recruiting', 'state_fg', 'noclaim');
add('6a', "We're awaiting a reply from their procurement team.", 'sales', 'state_fg', 'noclaim');
add('6a', "Can you move my one-to-one to Friday?", 'team-meet', 'state_fg', 'noclaim');
add('6a', "She appealed the parking fine and won.", 'general', 'state_fg', 'noclaim');
add('6a', "The transition to the new office went smoothly.", 'general', 'state_fg', 'noclaim');
add('6a', "Remove the paid tier from the comparison slide.", 'sales', 'state_fg', 'noclaim');
add('6a', "Is the performance review cycle starting in April?", 'team-meet', 'state_fg', 'noclaim');
add('6a', "Please add a note to the customer's file that they called twice.", 'call-center', 'state_fg', 'noclaim');
add('6a', "Payment went out on the 3rd, the customer confirmed.", 'call-center', 'state_fg', 'noclaim');
add('6a', "Under the new policy you get 25 days of leave.", 'general', 'state_fg', 'noclaim');
add('6a', "Tell me about a time you were rejected and how you handled it.", 'recruiting', 'state_fg', 'noclaim');
add('6a', "Close the window, it's freezing in here.", 'general', 'state_fg', 'noclaim');
add('6a', "Rename the shared folder to Q4 planning.", 'team-meet', 'state_fg', 'noclaim');
add('6a', "How do you say 'approved' in German?", 'general', 'state_fg', 'noclaim');
add('6a', "The state of Texas has different rules for this.", 'sales', 'state_fg', 'noclaim');

// ───────────────────────── List 6b — STATE diagram in focus, follow-ups
add('6b', "Add a Withdrawn state that you can reach from Submitted.", 'technical-interview', 'state_fg', 'claim', U);
add('6b', "Why can a claim go back from Awaiting Documents to Under Review?", 'general', 'state_fg', 'claim', E);
add('6b', "Remove the Appealed state.", 'team-meet', 'state_fg', 'claim', U);
add('6b', "What triggers the move from Approved to Paid Out?", 'general', 'state_fg', 'claim', E);
add('6b', "Add a transition from Rejected straight to Closed.", 'technical-interview', 'state_fg', 'claim', U);
add('6b', "Can a claim go from Submitted directly to Approved?", 'call-center', 'state_fg', 'claim', E);
add('6b', "Rename Paid Out to Settled.", 'team-meet', 'state_fg', 'claim', U);
add('6b', "Show this as a flowchart instead.", 'general', 'state_fg', 'claim', C);
add('6b', "Which states are terminal?", 'technical-interview', 'state_fg', 'claim', E);
add('6b', "Add a timeout on Awaiting Documents that goes to Rejected after thirty days.", 'technical-interview', 'state_fg', 'claim', U);
add('6b', "Explain the appeal loop.", 'general', 'state_fg', 'claim', E);
add('6b', "Split Under Review into Initial Review and Senior Review.", 'team-meet', 'state_fg', 'claim', U);
add('6b', "What happens after Rejected?", 'call-center', 'state_fg', 'claim', E);
add('6b', "Label the arrow into Approved with 'adjuster signs off'.", 'team-meet', 'state_fg', 'claim', U);
add('6b', "Make a sequence diagram of the same process with the adjuster and the customer.", 'technical-interview', 'state_fg', 'claim', C);
add('6b', "Is there any way to get stuck in this state machine?", 'technical-interview', 'state_fg', 'claim', E);
add('6b', "Add a Fraud Check state between Under Review and Approved.", 'team-meet', 'state_fg', 'claim', U);
add('6b', "Take out the transition back to Under Review.", 'general', 'state_fg', 'claim', U);
add('6b', "How many states are there in total?", 'general', 'state_fg', 'claim', E);
add('6b', "Give me the class diagram that would implement this.", 'technical-interview', 'state_fg', 'claim', C);

// ───────────────────────── List 7a — GANTT in focus, unrelated dates/schedules (must NOT be claimed)
add('7a', "My dentist appointment is on the 12th, so I'll be late.", 'general', 'gantt_fg', 'noclaim');
add('7a', "The quarterly report is due at the end of March.", 'team-meet', 'gantt_fg', 'noclaim');
add('7a', "Can we push the standup to 10:30 tomorrow?", 'team-meet', 'gantt_fg', 'noclaim');
add('7a', "School holidays start two weeks earlier this year.", 'general', 'gantt_fg', 'noclaim');
add('7a', "The candidate can start on the 1st of September.", 'recruiting', 'gantt_fg', 'noclaim');
add('7a', "Delivery of my new laptop slipped by a week.", 'general', 'gantt_fg', 'noclaim');
add('7a', "Move the client dinner to the following Thursday.", 'sales', 'gantt_fg', 'noclaim');
add('7a', "How long is the warranty on this model?", 'call-center', 'gantt_fg', 'noclaim');
add('7a', "The engineer can come out between 8 and 12 on Monday.", 'call-center', 'gantt_fg', 'noclaim');
add('7a', "I'm on leave the week of the 20th.", 'team-meet', 'gantt_fg', 'noclaim');
add('7a', "Extend the trial by fourteen days for this account.", 'sales', 'gantt_fg', 'noclaim');
add('7a', "When does the conference start, is it the weekend of the 5th?", 'general', 'gantt_fg', 'noclaim');
add('7a', "Add the bank holiday to the team calendar.", 'team-meet', 'gantt_fg', 'noclaim');
add('7a', "The lease on my flat is up in June.", 'general', 'gantt_fg', 'noclaim');
add('7a', "We signed the contract with the supplier yesterday.", 'sales', 'gantt_fg', 'noclaim');
add('7a', "Book the design review for next Wednesday afternoon.", 'team-meet', 'gantt_fg', 'noclaim');
add('7a', "It took three months to hire the last designer.", 'recruiting', 'gantt_fg', 'noclaim');
add('7a', "Shorten the intro call to fifteen minutes.", 'sales', 'gantt_fg', 'noclaim');
add('7a', "What's the deadline for the grant application?", 'seminar', 'gantt_fg', 'noclaim');
add('7a', "The network was down for two hours on Tuesday.", 'call-center', 'gantt_fg', 'noclaim');

// ───────────────────────── List 7b — GANTT in focus, follow-ups
add('7b', "Push Furniture Delivery back by a week.", 'team-meet', 'gantt_fg', 'claim', U);
add('7b', "Add a task for IT equipment testing after Cabling and Network.", 'team-meet', 'gantt_fg', 'claim', U);
add('7b', "Why does Fit-out Design have to finish before cabling starts?", 'team-meet', 'gantt_fg', 'claim', E);
add('7b', "What's on the critical path?", 'team-meet', 'gantt_fg', 'claim', E);
add('7b', "Make the Staff Move Weekend a milestone.", 'team-meet', 'gantt_fg', 'claim', U);
add('7b', "Extend Fit-out Design to four weeks.", 'team-meet', 'gantt_fg', 'claim', U);
add('7b', "Remove Old Office Handback.", 'general', 'gantt_fg', 'claim', U);
add('7b', "Which tasks overlap in May?", 'general', 'gantt_fg', 'claim', E);
add('7b', "Start the whole plan two weeks earlier.", 'team-meet', 'gantt_fg', 'claim', U);
add('7b', "Show it as a timeline instead.", 'general', 'gantt_fg', 'claim', C);
add('7b', "What happens to the end date if cabling slips by three days?", 'team-meet', 'gantt_fg', 'claim', E);
add('7b', "Add a section for communications with staff.", 'team-meet', 'gantt_fg', 'claim', U);
add('7b', "Rename Lease Signing to Lease Execution.", 'general', 'gantt_fg', 'claim', U);
add('7b', "How long is the whole project?", 'general', 'gantt_fg', 'claim', E);
add('7b', "Shorten cabling to a week and a half.", 'team-meet', 'gantt_fg', 'claim', U);
add('7b', "Mark Lease Signing as done.", 'team-meet', 'gantt_fg', 'claim', U);
add('7b', "When does furniture delivery start in this plan?", 'general', 'gantt_fg', 'claim', E);
add('7b', "Put a two-day buffer before the move weekend.", 'team-meet', 'gantt_fg', 'claim', U);
add('7b', "Can you turn this into a table of tasks with start and end dates?", 'general', 'gantt_fg', 'claim', C);
add('7b', "Is there any slack between the fit-out and the cabling?", 'team-meet', 'gantt_fg', 'claim', E);

// ───────────────────────── List 8a — background artifact, unrelated (must NOT be claimed)
add('8a', "Add a cache.", 'technical-interview', 'arch_bg', 'noclaim');
add('8a', "What is an API gateway?", 'technical-interview', 'arch_bg', 'noclaim');
add('8a', "How does a message queue guarantee ordering?", 'technical-interview', 'arch_bg', 'noclaim');
add('8a', "Let's add a new hire to the platform team.", 'team-meet', 'arch_bg', 'noclaim');
add('8a', "Make it 10% for the early-bird customers.", 'sales', 'chart_bg', 'noclaim');
add('8a', "Remove the second paragraph.", 'general', 'arch_bg', 'noclaim');
add('8a', "Why do we need another meeting about this?", 'team-meet', 'arch_bg', 'noclaim');
add('8a', "Honestly the bottleneck is always legal sign-off.", 'sales', 'arch_bg', 'noclaim');
add('8a', "Push it back a week.", 'team-meet', 'gantt_bg', 'noclaim');
add('8a', "What's a dashboard you've built that you're proud of?", 'recruiting', 'arch_bg', 'noclaim');
add('8a', "Tell me the difference between a queue and a stack.", 'technical-interview', 'arch_bg', 'noclaim', { coding: true });
add('8a', "Add a step for manager approval to the leave request form.", 'team-meet', 'arch_bg', 'noclaim');
add('8a', "The rules changed last year for contractors.", 'general', 'arch_bg', 'noclaim');
add('8a', "How many months of runway do we have?", 'team-meet', 'chart_bg', 'noclaim');
add('8a', "Double the catering order for Friday.", 'general', 'chart_bg', 'noclaim');
add('8a', "Can you explain what a time series is?", 'lecture', 'arch_bg', 'noclaim');
add('8a', "Rename the file before you send it.", 'general', 'arch_bg', 'noclaim');
add('8a', "When does the lease on the company cars run out?", 'team-meet', 'gantt_bg', 'noclaim');
add('8a', "Who's handling the furniture for the new starter?", 'team-meet', 'gantt_bg', 'noclaim');
add('8a', "What's the growth plan for the Berlin office?", 'team-meet', 'chart_bg', 'noclaim');
add('8a', "Scale it down, that font is huge.", 'general', 'arch_bg', 'noclaim');
add('8a', "Why is that?", 'general', 'arch_bg', 'noclaim');

// ───────────────────────── List 8b — background artifact, named reach (MUST be claimed)
add('8b', "Go back to the diagram and add a cache.", 'technical-interview', 'arch_bg', 'claim', U);
add('8b', "In the architecture, why is there a queue?", 'technical-interview', 'arch_bg', 'claim', E);
add('8b', "What does the Telemetry Processor do again?", 'general', 'arch_bg', 'claim', E);
add('8b', "Remove the Weather Feed Adapter from the design.", 'team-meet', 'arch_bg', 'claim', U);
add('8b', "On the chart, change the rate to 6%.", 'sales', 'chart_bg', 'claim', U);
add('8b', "Back to the forecast chart — what's month six?", 'sales', 'chart_bg', 'claim', E);
add('8b', "Add a replica next to the Time Series Store.", 'technical-interview', 'arch_bg', 'claim', U);
add('8b', "In the Gantt chart, move Furniture Delivery a week later.", 'team-meet', 'gantt_bg', 'claim', U);
add('8b', "Can you update the diagram so the dashboard reads from a cache?", 'team-meet', 'arch_bg', 'claim', U);
add('8b', "Returning to the architecture: is the Rules Engine stateless?", 'technical-interview', 'arch_bg', 'claim', E);
add('8b', "In that design, the queue should be partitioned by greenhouse.", 'technical-interview', 'arch_bg', 'claim', { op: 'update', borderline: true });
add('8b', "Show the architecture as a sequence diagram.", 'technical-interview', 'arch_bg', 'claim', C);
add('8b', "How does the Irrigation Controller get its commands?", 'general', 'arch_bg', 'claim', E);
add('8b', "On the diagram, rename the gateway to Edge Gateway.", 'team-meet', 'arch_bg', 'claim', U);
add('8b', "On the Gantt, extend Fit-out Design by a week.", 'team-meet', 'gantt_bg', 'claim', U);
add('8b', "Why does the Staff Move Weekend come after Furniture Delivery?", 'team-meet', 'gantt_bg', 'claim', E);
add('8b', "Let's revisit the system diagram — where would it fall over first?", 'technical-interview', 'arch_bg', 'claim', E);
add('8b', "The diagram is missing a backup for the store; add one.", 'team-meet', 'arch_bg', 'claim', U);
add('8b', "In the chart, start from 15,000 instead.", 'sales', 'chart_bg', 'claim', U);
add('8b', "Put an auth service in front of the Sensor Gateway.", 'technical-interview', 'arch_bg', 'claim', U);
add('8b', "In the state diagram, add a Cancelled state.", 'technical-interview', 'state_bg', 'claim', U);
add('8b', "Explain the architecture once more for the people who just joined.", 'team-meet', 'arch_bg', 'claim', E);

// ───────────────────────── List 9 — multi-sentence turns
add('9', "Morning all, hope you had a good weekend. Can you draw the signup flow for the new app?", 'general', 'none', 'draw');
add('9', "Thanks for joining, I know it's late over there. Show me a bar chart of seats sold per quarter: 40, 55, 71, 90.", 'sales', 'none', 'draw');
add('9', "Draw the release process as a flowchart. Oh, and somebody left their mug in the kitchen.", 'team-meet', 'none', 'draw');
add('9', "The chart in last month's deck was wrong. What time is the client arriving?", 'general', 'none', 'nodraw');
add('9', "We looked at the diagram yesterday and it was fine. Who's taking notes today?", 'team-meet', 'none', 'nodraw');
add('9', "He had a timeline on his CV that didn't add up. Did you call his references?", 'recruiting', 'none', 'nodraw');
add('9', "Okay, that makes sense. Add a cache in front of the Time Series Store.", 'technical-interview', 'arch_fg', 'claim', U);
add('9', "Nice. By the way, did you book the room for Friday?", 'general', 'arch_fg', 'noclaim');
add('9', "Sorry, my dog is barking. Why do we need the Ingest Queue at all?", 'technical-interview', 'arch_fg', 'claim', E);
add('9', "Remove the Weather Feed Adapter. I never liked that vendor anyway.", 'team-meet', 'arch_fg', 'claim', U);
add('9', "The diagram looks good to me. Can someone add Priya to the invite for the review?", 'team-meet', 'arch_fg', 'noclaim');
add('9', "I spoke to finance this morning. Make it 5% instead of 4.", 'sales', 'chart_fg', 'claim', U);
add('9', "That forecast is optimistic. Anyway, we gave Acme 20% off for three years.", 'sales', 'chart_fg', 'noclaim');
add('9', "Great. What's for lunch, and is it at 12 or 1?", 'team-meet', 'chart_fg', 'noclaim');
add('9', "Hold on, let me share my screen. Okay. What does it look like over twenty-four months?", 'general', 'chart_fg', 'claim', U);
add('9', "Right. Add a Withdrawn state after Submitted. Then we can break for coffee.", 'general', 'state_fg', 'claim', U);
add('9', "The customer called again about her claim. Can you check when her payment went out?", 'call-center', 'state_fg', 'noclaim');
add('9', "I talked to the landlord yesterday. Push Old Office Handback out by two weeks.", 'team-meet', 'gantt_fg', 'claim', U);
add('9', "That plan is tight. My holiday starts on the 14th, just so you know.", 'team-meet', 'gantt_fg', 'noclaim');
add('9', "So that covers the causes. Now, timeline of the main events from 1789 to 1799, please.", 'lecture', 'none', 'draw');
add('9', "Thanks for the intro. Design a system for collecting metrics from thousands of servers. Take your time.", 'technical-interview', 'none', 'draw');
add('9', "Good. Now write a function that checks whether a string is a palindrome. No need to draw anything.", 'technical-interview', 'none', 'nodraw', { coding: true });
add('9', "I'm not a visual person. Just tell me in words how DNS works.", 'general', 'none', 'nodraw');
add('9', "Their CFO loves charts. What's our list price for the enterprise tier?", 'sales', 'none', 'nodraw');
add('9', "The customer has rebooted twice. Can you give me a flowchart of the troubleshooting steps for no signal?", 'call-center', 'none', 'draw');
add('9', "We've moved on from that. What's the status of the hiring req?", 'team-meet', 'arch_bg', 'noclaim');
add('9', "Before we wrap up, one more thing. On the diagram, add a cache next to the dashboard.", 'technical-interview', 'arch_bg', 'claim', U);
add('9', "Hmm, interesting. Show this as a sequence diagram. I think that'd be clearer.", 'technical-interview', 'arch_fg', 'claim', C);
add('9', "Let's draw a line under that topic. What's next on the agenda?", 'general', 'none', 'nodraw');
add('9', "I'd like to see an org chart of the new platform group. Also, has anyone seen my charger?", 'team-meet', 'none', 'draw');
add('9', "Okay I see it. How long until it doubles? Roughly is fine.", 'sales', 'chart_fg', 'claim', E);
add('9', "That's a solid design. Moving on, tell me about a conflict you had with a teammate.", 'recruiting', 'arch_fg', 'noclaim');
add('9', "As Foucault argued, power is diffuse. Could you give me a mind map of his key concepts?", 'seminar', 'none', 'draw');
add('9', "I once drew the architecture for a bank's payment system. What salary range should I ask for?", 'looking-for-work', 'none', 'nodraw');
add('9', "Good question. Which states are terminal here? I think there are two.", 'technical-interview', 'state_fg', 'claim', E);
add('9', "Looks fine. Is there any slack before the move weekend? I'm worried about the cabling.", 'team-meet', 'gantt_fg', 'claim', E);
add('9', "It's raining again. Typical. Compare React, Vue and Svelte in a table.", 'general', 'none', 'draw');
add('9', "Can you add a line to the minutes about the budget? The architecture can wait.", 'team-meet', 'arch_fg', 'noclaim', B);
add('9', "The Gantt chart Tom made is out of date. Could you make a new Gantt for the migration: plan one week, build four weeks, test two weeks?", 'team-meet', 'none', 'draw');
add('9', "Drop the rate to three. Actually, also, can you email me the deck afterwards?", 'sales', 'chart_fg', 'claim', U);
add('9', "Sorry I'm late, traffic was awful. Where were we? Right — plot monthly revenue of 10, 12, 15 and 19 thousand as a line chart.", 'sales', 'none', 'draw');
add('9', "I need to step out for five minutes. Carry on without me.", 'general', 'arch_fg', 'noclaim');

// ───────────────────────── List 10a — unasked, structure to lay out (should draw: enabled === true)
add('10a', "Compare our Starter, Team and Enterprise plans across price, seats and support.", 'sales', 'none', 'draw');
add('10a', "Where are we losing people in the funnel between demo and signed contract?", 'sales', 'none', 'draw');
add('10a', "What's blocking what on the migration right now?", 'team-meet', 'none', 'draw');
add('10a', "Walk me through the steps to escalate a billing dispute.", 'call-center', 'none', 'draw');
add('10a', "Lay out the stages of our interview process from application to offer.", 'recruiting', 'none', 'draw');
add('10a', "At what point do we break even if the tool costs 2,000 a month and saves 150 per seat?", 'sales', 'none', 'draw');
add('10a', "Break down the dependencies between the API work, the mobile release and the data migration.", 'team-meet', 'none', 'draw');
add('10a', "What are the steps to set up a limited company in the UK?", 'general', 'none', 'draw', B);
add('10a', "What's the procedure when a customer reports a lost card, step by step?", 'call-center', 'none', 'draw');
add('10a', "Where do candidates drop off between the phone screen and the on-site?", 'recruiting', 'none', 'draw');
add('10a', "How do we stack up against Competitor A and Competitor B on security, price and onboarding time?", 'sales', 'none', 'draw');
add('10a', "Who's waiting on whom for the launch — design, legal, and engineering?", 'team-meet', 'none', 'draw', B);
add('10a', "Take me through the stages a warranty claim goes through.", 'call-center', 'none', 'draw');
add('10a', "Give me the break-even on a 30k implementation fee against 4k monthly savings.", 'sales', 'none', 'draw');
add('10a', "Outline the phases of the rollout and what has to finish before each one starts.", 'team-meet', 'none', 'draw');
add('10a', "Compare the three finalists on experience, salary expectations and notice period.", 'recruiting', 'none', 'draw');
add('10a', "Compare renting versus buying across upfront cost, monthly cost and flexibility.", 'general', 'none', 'draw', B);
add('10a', "Map the stages of their procurement process and who signs off at each.", 'sales', 'none', 'draw');
add('10a', "List the steps in our release process in order.", 'team-meet', 'none', 'draw', B);
add('10a', "What are the stages of the refund process from request to payout?", 'call-center', 'none', 'draw');

// ───────────────────────── List 10b — lookups/remarks with the same nouns; lecture/seminar (must NOT draw)
add('10b', "What's the price of the Enterprise plan?", 'sales', 'none', 'nodraw');
add('10b', "Who owns the funnel report?", 'sales', 'none', 'nodraw');
add('10b', "Why is the migration late?", 'team-meet', 'none', 'nodraw');
add('10b', "What's the escalation phone number?", 'call-center', 'none', 'nodraw');
add('10b', "Who is the interviewer for the final stage?", 'recruiting', 'none', 'nodraw');
add('10b', "Did we break even last quarter?", 'sales', 'none', 'nodraw');
add('10b', "The dependencies are a nightmare on this project.", 'team-meet', 'none', 'nodraw');
add('10b', "Compare mitosis and meiosis across phases, outcomes and purpose.", 'lecture', 'none', 'nodraw');
add('10b', "What are the stages of Kübler-Ross's model of grief?", 'seminar', 'none', 'nodraw');
add('10b', "Walk me through the steps of the Krebs cycle.", 'lecture', 'none', 'nodraw');
add('10b', "Is the customer on step three or step four?", 'call-center', 'none', 'nodraw');
add('10b', "How many candidates are in the pipeline?", 'recruiting', 'none', 'nodraw');
add('10b', "The comparison they sent over was biased.", 'sales', 'none', 'nodraw');
add('10b', "When is the rollout?", 'team-meet', 'none', 'nodraw');
add('10b', "What's the first step?", 'general', 'none', 'nodraw');
add('10b', "Lay out the stages of the French Revolution in order.", 'seminar', 'none', 'nodraw');
add('10b', "Who signed off the discount?", 'sales', 'none', 'nodraw');
add('10b', "Has the warranty claim been paid?", 'call-center', 'none', 'nodraw');
add('10b', "Who is blocked today?", 'team-meet', 'none', 'nodraw');
add('10b', "What stage is Anna at?", 'recruiting', 'none', 'nodraw');
add('10b', "Where does the sales funnel lose the most people, in the textbook example?", 'lecture', 'none', 'nodraw');
add('10b', "Our break-even slipped again, apparently.", 'sales', 'none', 'nodraw');

// ───────────────────────── List 11 — speech-to-text style
add('11', "um so can you like draw the the login flow for me", 'general', 'none', 'draw');
add('11', "okay so uh design a design a system for uh file sync like dropbox", 'technical-interview', 'none', 'draw');
add('11', "yeah so we we need to draw the line on discounts i think", 'sales', 'none', 'nodraw');
add('11', "so the chart that um raj showed was it was pretty confusing honestly", 'team-meet', 'none', 'nodraw');
add('11', "uh add a add a cache in front of the the time series store", 'technical-interview', 'arch_fg', 'claim', U);
add('11', "so why do we why do we need the ingest queue again", 'technical-interview', 'arch_fg', 'claim', E);
add('11', "sorry um can someone add maria to the the invite for thursday", 'general', 'arch_fg', 'noclaim');
add('11', "theres a huge queue at the canteen so ill be like five minutes late", 'general', 'arch_fg', 'noclaim');
add('11', "um make it make it five percent instead", 'sales', 'chart_fg', 'claim', U);
add('11', "so we gave them uh fifteen percent off and thats it thats the deal", 'sales', 'chart_fg', 'noclaim');
add('11', "what if its uh two and a half percent", 'sales', 'chart_fg', 'claim', U);
add('11', "run it for for like a year and a half", 'general', 'chart_fg', 'claim', U);
add('11', "can you add a a withdrawn state um after submitted", 'general', 'state_fg', 'claim', U);
add('11', "my my expense claim got rejected again its so annoying", 'general', 'state_fg', 'noclaim');
add('11', "push uh push furniture delivery back by by a week", 'team-meet', 'gantt_fg', 'claim', U);
add('11', "im im off on the twentieth so dont book anything", 'team-meet', 'gantt_fg', 'noclaim');
add('11', "so on the diagram uh add a cache next to the dashboard", 'technical-interview', 'arch_bg', 'claim', U);
add('11', "whats an api gateway like in general", 'technical-interview', 'arch_bg', 'noclaim');
add('11', "timeline of of the apollo programme please", 'lecture', 'none', 'draw');
add('11', "show me show me a bar chart of revenue by region north one twenty south ninety five east one forty", 'sales', 'none', 'draw');
add('11', "the customer says uh the diagram in the manual doesnt match", 'call-center', 'none', 'nodraw');
add('11', "can you um outline your your salary expectations", 'recruiting', 'none', 'nodraw');
add('11', "i would like uh i would like a flowchart of how refunds get approved", 'general', 'none', 'draw');
add('11', "lets lets diagram how the request goes from the browser to to the database", 'technical-interview', 'none', 'draw');
add('11', "so where are we where are we losing people in the funnel between uh demo and contract", 'sales', 'none', 'draw');
add('11', "whats the whats the price of the enterprise plan again", 'sales', 'none', 'nodraw');
add('11', "wheres the uh wheres the bottleneck in this", 'technical-interview', 'arch_fg', 'claim', E);
add('11', "remove the the weather feed adapter i dont i dont think we need it", 'team-meet', 'arch_fg', 'claim', U);
add('11', "what what triggers the move from approved to paid out", 'general', 'state_fg', 'claim', E);
add('11', "whats on the critical path here", 'team-meet', 'gantt_fg', 'claim', E);
add('11', "lets table this till thursday yeah", 'team-meet', 'none', 'nodraw');
add('11', "um write a function that that reverses a linked list", 'technical-interview', 'none', 'nodraw', { coding: true });
add('11', "the meetings at at half two not three", 'team-meet', 'chart_fg', 'noclaim');
add('11', "show this as a as a sequence diagram maybe", 'technical-interview', 'arch_fg', 'claim', C);
add('11', "would you mind uh putting together a a mind map of the the project risks", 'general', 'none', 'draw');
add('11', "going back to the architecture um why is there a a queue", 'technical-interview', 'arch_bg', 'claim', E);
add('11', "at my last job i i designed the the whole onboarding process", 'looking-for-work', 'none', 'nodraw');
add('11', "extend it to to twenty four months", 'general', 'chart_fg', 'claim', U);
add('11', "the lease on my flat is is up in june", 'general', 'gantt_bg', 'noclaim');
add('11', "design uh design instagram", 'technical-interview', 'none', 'draw');
add('11', "so um he he mapped out the whole theory in in chapter two", 'seminar', 'none', 'nodraw');
add('11', "can a claim go straight from from submitted to approved", 'call-center', 'state_fg', 'claim', E);
add('11', "could you could you draw up a table of the three plans price and and data allowance", 'call-center', 'none', 'draw');
add('11', "add a step to the to the onboarding checklist for uh badge pickup", 'team-meet', 'arch_fg', 'noclaim');

export const ROWS = rows;
