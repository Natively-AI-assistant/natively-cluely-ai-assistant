// Independent measurement set J for resolveDiagramRequest.
// Written BEFORE the function was run or read. Do not edit after FREEZE.txt exists.
//
// Fixture domain: a regional ferry operator (booking, fares, boarding).
// Chart kind: compound-growth forecast.
// List 6: ER diagram. List 7: a sequence diagram and a Gantt chart.

const ARCH_SOURCE = [
  'flowchart LR',
  '  web[Passenger Web App] --> gw[Booking API Gateway]',
  '  kiosk[Port Kiosk Terminal] --> gw',
  '  gw --> fare[Fare Rules Engine]',
  '  gw --> rq[Reservation Queue]',
  '  rq --> seat[Seat Allocation Service]',
  '  seat --> db[(Sailings Database)]',
  '  seat --> scan[Boarding Gate Scanner]',
].join('\n');

const CHART_SOURCE = JSON.stringify({
  v: 1,
  type: 'line',
  title: 'Monthly foot passengers forecast',
  compute: { kind: 'compound_growth', baseline: 62000, ratePercent: 4, period: 'month', periods: 12 },
});

const ER_SOURCE = [
  'erDiagram',
  '  PASSENGER ||--o{ BOOKING : makes',
  '  BOOKING ||--|{ TICKET : contains',
  '  SAILING ||--o{ BOOKING : carries',
  '  VESSEL ||--o{ SAILING : operates',
  '  PORT ||--o{ SAILING : departs_from',
  '  PASSENGER {',
  '    int passenger_id PK',
  '    string full_name',
  '    string email',
  '  }',
  '  BOOKING {',
  '    int booking_id PK',
  '    int passenger_id FK',
  '    int sailing_id FK',
  '    date booked_on',
  '    string status',
  '  }',
  '  TICKET {',
  '    int ticket_id PK',
  '    int booking_id FK',
  '    string fare_class',
  '  }',
  '  SAILING {',
  '    int sailing_id PK',
  '    int vessel_id FK',
  '    int port_id FK',
  '    datetime departs_at',
  '  }',
  '  VESSEL {',
  '    int vessel_id PK',
  '    string name',
  '    int capacity',
  '  }',
  '  PORT {',
  '    int port_id PK',
  '    string name',
  '  }',
].join('\n');

const SEQ_SOURCE = [
  'sequenceDiagram',
  '  participant P as Passenger',
  '  participant K as Port Kiosk',
  '  participant B as Booking API',
  '  participant Pay as Payment Provider',
  '  participant M as Email Service',
  '  P->>K: Select sailing',
  '  K->>B: Request fare quote',
  '  B-->>K: Fare quote',
  '  P->>K: Pay by card',
  '  K->>Pay: Authorise payment',
  '  Pay-->>K: Authorisation approved',
  '  K->>B: Confirm booking',
  '  B->>M: Send e-ticket',
  '  M-->>P: E-ticket email',
].join('\n');

const GANTT_SOURCE = [
  'gantt',
  '  title Summer timetable launch',
  '  dateFormat YYYY-MM-DD',
  '  section Planning',
  '  Route survey :a1, 2027-01-11, 14d',
  '  Crew rostering :a2, after a1, 10d',
  '  section Build',
  '  Timetable data entry :b1, after a2, 7d',
  '  Fare table update :b2, after a2, 5d',
  '  section Launch',
  '  Staff briefing :c1, after b1, 3d',
  '  Public announcement :c2, after c1, 2d',
].join('\n');

export const FIXTURES = {
  archFg: { artifactId: 'design-1.v1', artifact: 'mermaid', view: 'architecture', version: 1, foreground: true, source: ARCH_SOURCE },
  archBg: { artifactId: 'design-2.v1', artifact: 'mermaid', view: 'architecture', version: 1, foreground: false, source: ARCH_SOURCE },
  chartFg: { artifactId: 'design-3.v1', artifact: 'chart', view: 'chart', version: 1, foreground: true, source: CHART_SOURCE },
  chartBg: { artifactId: 'design-4.v1', artifact: 'chart', view: 'chart', version: 1, foreground: false, source: CHART_SOURCE },
  erFg: { artifactId: 'design-5.v1', artifact: 'mermaid', view: 'er', version: 1, foreground: true, source: ER_SOURCE },
  seqFg: { artifactId: 'design-6.v1', artifact: 'mermaid', view: 'sequence', version: 1, foreground: true, source: SEQ_SOURCE },
  ganttFg: { artifactId: 'design-7.v1', artifact: 'mermaid', view: 'gantt', version: 1, foreground: true, source: GANTT_SOURCE },
};

const rows = [];
const counters = {};
// op may list acceptable alternatives separated by '|'.
function r(list, q, mode, ctx, expect, extra = {}) {
  counters[list] = (counters[list] || 0) + 1;
  const id = `L${list}-${String(counters[list]).padStart(2, '0')}`;
  rows.push({ id, list, q, mode, ctx, expect, ...extra });
}
const B = { borderline: true };

// ───────────────────────── List 1: no artifact, must NOT draw ─────────────────────────
r('1', "We charted a new course for the partnership after that call.", 'sales', 'none', 'nodraw');
r('1', "She really drew a blank when I asked about the renewal date.", 'sales', 'none', 'nodraw');
r('1', "Let's not draw this out any longer than we have to.", 'team-meet', 'none', 'nodraw');
r('1', "The graph on slide four was confusing, to be honest.", 'team-meet', 'none', 'nodraw');
r('1', "I mapped out my whole weekend already and now it's gone.", 'general', 'none', 'nodraw');
r('1', "He's off the charts on the coding assessment.", 'recruiting', 'none', 'nodraw');
r('1', "That's a different kettle of fish from the flowchart he sent last week.", 'general', 'none', 'nodraw');
r('1', "The customer says the chart in their invoice email is blank.", 'call-center', 'none', 'nodraw');
r('1', "Could you file a bug report about the broken architecture diagram in the wiki?", 'team-meet', 'none', 'nodraw');
r('1', "I need a one-paragraph summary of the pie chart Priya shared.", 'team-meet', 'none', 'nodraw');
r('1', "We'd like a bar chart in the board pack this quarter.", 'sales', 'none', 'nodraw');
r('1', "Put the org chart into the onboarding handbook, would you?", 'recruiting', 'none', 'nodraw');
r('1', "The swim lanes at the leisure centre are closed until Thursday.", 'general', 'none', 'nodraw');
r('1', "I usually take the slow swim lane on Tuesday mornings.", 'general', 'none', 'nodraw');
r('1', "The trees outside the office got cut back over the weekend.", 'team-meet', 'none', 'nodraw');
r('1', "Store the categories as a tree so lookups stay fast.", 'technical-interview', 'none', 'nodraw', { coding: true });
r('1', "We keep the comments as a tree in the database.", 'team-meet', 'none', 'nodraw');
r('1', "Who drew the short straw for the on-call rota this week?", 'team-meet', 'none', 'nodraw');
r('1', "My previous manager drew up the plan before I joined.", 'looking-for-work', 'none', 'nodraw');
r('1', "Tell me about a time you had to design a process for onboarding new hires.", 'recruiting', 'none', 'nodraw');
r('1', "Design a landing page for the spring campaign.", 'general', 'none', 'nodraw');
r('1', "We need to design a logo before the launch.", 'team-meet', 'none', 'nodraw');
r('1', "Can you design a pitch for the Henderson account?", 'sales', 'none', 'nodraw');
r('1', "Let's table that discussion until Monday.", 'team-meet', 'none', 'nodraw');
r('1', "The timeline is tight but I think we can make it.", 'team-meet', 'none', 'nodraw');
r('1', "Is the roadmap still on track for the end of the quarter?", 'team-meet', 'none', 'nodraw');
r('1', "What's the difference between a histogram and a bar chart?", 'lecture', 'none', 'nodraw');
r('1', "She diagrammed sentences for fun as a kid, apparently.", 'general', 'none', 'nodraw');
r('1', "Our state of the union meeting moved to Friday.", 'team-meet', 'none', 'nodraw');
r('1', "The flow of the conversation was a bit off today.", 'sales', 'none', 'nodraw');
r('1', "He plotted against his own team lead, if you believe the gossip.", 'general', 'none', 'nodraw');
r('1', "I want to illustrate my point with a quick story.", 'seminar', 'none', 'nodraw');
r('1', "Please write a short email about the Gantt chart delays.", 'team-meet', 'none', 'nodraw');
r('1', "The diagram of the heart in chapter three is on the exam.", 'lecture', 'none', 'nodraw');
r('1', "Can you remind me what the Venn diagram on the handout was showing?", 'seminar', 'none', 'nodraw', B);
r('1', "How do you design a fair interview loop for junior candidates?", 'recruiting', 'none', 'nodraw');
r('1', "Draw your own conclusions, but I think the vendor is stalling.", 'sales', 'none', 'nodraw');
r('1', "Sorry, I lost the thread, which chart are we talking about?", 'team-meet', 'none', 'nodraw');
r('1', "Back to the drawing board on pricing, then.", 'sales', 'none', 'nodraw');
r('1', "There's a real pecking order in that team, a proper hierarchy.", 'general', 'none', 'nodraw');
r('1', "We built the permissions as a hierarchy last year.", 'technical-interview', 'none', 'nodraw');
r('1', "Implement a function that prints a binary tree level by level.", 'technical-interview', 'none', 'nodraw', { coding: true });
r('1', "Can you outline the main risks in two sentences?", 'custom', 'none', 'nodraw');
r('1', "Give me the big picture on the Acme renewal.", 'sales', 'none', 'nodraw');
r('1', "Is there a diagram of this somewhere in Confluence?", 'team-meet', 'none', 'nodraw');
r('1', "We are discussing about the chart since morning only.", 'team-meet', 'none', 'nodraw');
r('1', "Yesterday itself I have drawn the diagram and sent to the client.", 'call-center', 'none', 'nodraw');
r('1', "In my last role I designed the billing system more or less on my own.", 'looking-for-work', 'none', 'nodraw');
r('1', "The interviewer sketched something on the whiteboard and I just froze.", 'looking-for-work', 'none', 'nodraw');
r('1', "Build the menu as a tree and cache it per user.", 'technical-interview', 'none', 'nodraw', { coding: true });
r('1', "Honestly the decision tree they use in support is out of date.", 'call-center', 'none', 'nodraw');
r('1', "A reply to the email about the flowchart would be nice at some point.", 'custom', 'none', 'nodraw');

// ───────────────────────── List 2: no artifact, MUST draw ─────────────────────────
r('2', "Draw the check-in flow for foot passengers.", 'general', 'none', 'draw');
r('2', "Can you sketch the architecture for a multi-tenant billing service?", 'technical-interview', 'none', 'draw');
r('2', "I'd like a sequence diagram of the password reset handshake.", 'team-meet', 'none', 'draw');
r('2', "We need a diagram of how the nightly reconciliation job talks to the ledger.", 'team-meet', 'none', 'draw');
r('2', "Would you mind putting together an ER diagram for a hotel reservation system?", 'technical-interview', 'none', 'draw');
r('2', "Let's map out the stages of the hiring pipeline.", 'recruiting', 'none', 'draw');
r('2', "It would be good to see the quarterly churn as a bar chart.", 'sales', 'none', 'draw');
r('2', "Timeline of the Apollo programme.", 'lecture', 'none', 'draw');
r('2', "Design a rate limiter for a public API.", 'technical-interview', 'none', 'draw');
r('2', "Design WhatsApp.", 'technical-interview', 'none', 'draw');
r('2', "Show me a state diagram for a support ticket's lifecycle.", 'call-center', 'none', 'draw');
r('2', "Please visualise the escalation path as a flowchart.", 'call-center', 'none', 'draw');
r('2', "Could you give me a mind map of the causes of the First World War?", 'lecture', 'none', 'draw');
r('2', "Plot 5% monthly growth from 20,000 users over a year.", 'sales', 'none', 'draw');
r('2', "Lay out the steps of the refund process.", 'call-center', 'none', 'draw');
r('2', "Map the steps of our deployment pipeline.", 'team-meet', 'none', 'draw');
r('2', "Gantt chart for the three-phase warehouse migration, please.", 'team-meet', 'none', 'draw');
r('2', "Class diagram for a chess game.", 'technical-interview', 'none', 'draw');
r('2', "Can we get a pie chart of the support tickets by category: billing 40, login 35, delivery 25?", 'call-center', 'none', 'draw');
r('2', "Show the approval process as swimlanes for sales, legal and finance.", 'sales', 'none', 'draw', { layout: 'lanes' });
r('2', "Draw a swimlane diagram of the incident response with on-call, comms and the incident commander.", 'team-meet', 'none', 'draw', { layout: 'lanes' });
r('2', "Could you put the candidate journey in swim lanes: recruiter, hiring manager, candidate?", 'recruiting', 'none', 'draw', { layout: 'lanes' });
r('2', "Show the folder structure as a tree.", 'general', 'none', 'draw', { layout: 'tree' });
r('2', "Show me the hierarchy of the product categories.", 'team-meet', 'none', 'draw', { layout: 'tree' });
r('2', "Display the taxonomy of vertebrates as a tree.", 'lecture', 'none', 'draw', { layout: 'tree' });
r('2', "Sketch the menu structure as a tree, please.", 'custom', 'none', 'draw', { layout: 'tree' });
r('2', "Draw a decision tree for whether to escalate a billing complaint.", 'call-center', 'none', 'draw');
r('2', "I want an org chart for a twelve-person startup.", 'general', 'none', 'draw');
r('2', "Compare Postgres, MongoDB and DynamoDB in a table.", 'technical-interview', 'none', 'draw');
r('2', "Diagram the OAuth authorisation code flow for me.", 'seminar', 'none', 'draw');
r('2', "Give us a flowchart for handling a chargeback dispute.", 'call-center', 'none', 'draw');
r('2', "Let's see a break-even chart: fixed costs 30,000, price 25, unit cost 10.", 'sales', 'none', 'draw');
r('2', "Would it be possible to have a diagram showing how DNS resolution works?", 'lecture', 'none', 'draw');
r('2', "Can you make a drawing of how is working the load balancer?", 'technical-interview', 'none', 'draw');
r('2', "Kindly make one diagram for the payment flow.", 'team-meet', 'none', 'draw');
r('2', "Architecture of a real-time chat service.", 'technical-interview', 'none', 'draw');
r('2', "ER diagram for a university course registration system.", 'technical-interview', 'none', 'draw');
r('2', "It would be nice to see the support workload as a pie chart.", 'call-center', 'none', 'draw');
r('2', "I need a flowchart that shows what happens when a card payment fails.", 'general', 'none', 'draw');
r('2', "Draw me a DFA that accepts binary strings ending in 01.", 'lecture', 'none', 'draw');
r('2', "Sketch a timeline of my roles from 2019 to 2024.", 'looking-for-work', 'none', 'draw');
r('2', "How about a quick diagram of the caching layers?", 'team-meet', 'none', 'draw', B);
r('2', "Explain how a CDN works, with a diagram.", 'lecture', 'none', 'draw');
r('2', "Design a system that ingests telemetry from a million smart meters.", 'technical-interview', 'none', 'draw');
r('2', "Design Dropbox.", 'technical-interview', 'none', 'draw');
r('2', "I would be grateful if you could produce a diagram of the data flows between the three regional offices.", 'custom', 'none', 'draw');
r('2', "Gimme a quick flowchart for password resets.", 'call-center', 'none', 'draw');
r('2', "Draw the class diagram for the parser you just wrote.", 'technical-interview', 'none', 'draw', { coding: true, borderline: true });
r('2', "Can you chart the colour preferences from the survey: blue 48, green 31, grey 21?", 'general', 'none', 'draw');
r('2', "We need a sequence diagram of what happens between the browser, the auth server and the API.", 'technical-interview', 'none', 'draw');

// ───────────────────────── List 3: architecture in focus, unrelated ─────────────────────────
r('3', "Can someone book the big meeting room for Thursday?", 'team-meet', 'archFg', 'noclaim');
r('3', "My flight leaves from gate 22, so I need to drop off at four.", 'team-meet', 'archFg', 'noclaim');
r('3', "There was a massive queue at the canteen again.", 'team-meet', 'archFg', 'noclaim');
r('3', "Add a line to the meeting notes about the budget freeze.", 'team-meet', 'archFg', 'noclaim');
r('3', "Remove Tomasz from the invite list for Friday.", 'team-meet', 'archFg', 'noclaim');
r('3', "Set up a call with procurement about the kiosk hardware.", 'team-meet', 'archFg', 'noclaim');
r('3', "Add two more seats to the Figma licence.", 'team-meet', 'archFg', 'noclaim');
r('3', "The engine light came on in my car this morning.", 'general', 'archFg', 'noclaim');
r('3', "Change the stand-up to half nine from next week.", 'team-meet', 'archFg', 'noclaim');
r('3', "Did the port authority reply to our email?", 'team-meet', 'archFg', 'noclaim');
r('3', "Update the rules of engagement doc for contractors.", 'team-meet', 'archFg', 'noclaim');
r('3', "I'll be on leave from the 14th, so Maya is covering.", 'team-meet', 'archFg', 'noclaim');
r('3', "Rename the Slack channel to something less embarrassing.", 'team-meet', 'archFg', 'noclaim');
r('3', "Let's move the retro to Wednesday.", 'team-meet', 'archFg', 'noclaim');
r('3', "Add an item to the release checklist for the accessibility audit.", 'team-meet', 'archFg', 'noclaim');
r('3', "Remove the background music from the demo video.", 'sales', 'archFg', 'noclaim');
r('3', "What's for lunch, is the sandwich place still open?", 'general', 'archFg', 'noclaim');
r('3', "The scanner on the third floor is out of toner again.", 'team-meet', 'archFg', 'noclaim');
r('3', "How much is the fare from here to the airport?", 'general', 'archFg', 'noclaim');
r('3', "Can you make the font bigger on the slides?", 'sales', 'archFg', 'noclaim');
r('3', "We need to scale the support team to twenty people by June.", 'team-meet', 'archFg', 'noclaim');
r('3', "How would this team scale to three offices?", 'recruiting', 'archFg', 'noclaim');
r('3', "Who's taking notes today?", 'team-meet', 'archFg', 'noclaim');
r('3', "Add Priyanka to the reservation for dinner tonight.", 'general', 'archFg', 'noclaim');
r('3', "The terminal on my laptop keeps freezing after the OS update.", 'technical-interview', 'archFg', 'noclaim');
r('3', "I think the database course I took last year was better than this one.", 'technical-interview', 'archFg', 'noclaim');
r('3', "Why do we need another all-hands this month?", 'team-meet', 'archFg', 'noclaim');
r('3', "Where's the bottleneck in the hiring process?", 'recruiting', 'archFg', 'noclaim');
r('3', "Send the invoice to the gateway vendor by Friday.", 'team-meet', 'archFg', 'noclaim');
r('3', "Delete the old recordings from the shared drive.", 'team-meet', 'archFg', 'noclaim');
r('3', "Replace the projector bulb before the client visit.", 'sales', 'archFg', 'noclaim');
r('3', "Could you draft a reply to the passenger who complained about the refund?", 'call-center', 'archFg', 'noclaim');
r('3', "Thanks, that's really helpful.", 'technical-interview', 'archFg', 'noclaim');
r('3', "Okay, moving on to the next agenda item.", 'team-meet', 'archFg', 'noclaim');
r('3', "Has legal signed off on the API terms of service yet?", 'team-meet', 'archFg', 'noclaim');
r('3', "Add a cover page to the proposal.", 'sales', 'archFg', 'noclaim');
r('3', "Switch the kickoff from Zoom to Teams.", 'team-meet', 'archFg', 'noclaim');
r('3', "Increase the travel budget by ten percent.", 'team-meet', 'archFg', 'noclaim');
r('3', "Book me a seat on the 7:40 sailing to the island tomorrow.", 'general', 'archFg', 'noclaim');
r('3', "Remove the queue barriers from the lobby before the open day.", 'team-meet', 'archFg', 'noclaim');
r('3', "What time does the kiosk in reception close?", 'general', 'archFg', 'noclaim');
r('3', "Please do the needful and book the room for Thursday.", 'team-meet', 'archFg', 'noclaim');
r('3', "I am having one doubt about the leave policy.", 'team-meet', 'archFg', 'noclaim');
r('3', "Tell me about a time you disagreed with your manager.", 'technical-interview', 'archFg', 'noclaim');

// ───────────────────────── List 4: architecture in focus, real follow-ups ─────────────────────────
r('4', "Add a cache in front of the Sailings Database.", 'technical-interview', 'archFg', 'claim', { op: 'update' });
r('4', "Why do we need the Reservation Queue?", 'technical-interview', 'archFg', 'claim', { op: 'explain' });
r('4', "Where's the single point of failure here?", 'technical-interview', 'archFg', 'claim', { op: 'explain' });
r('4', "Remove the Port Kiosk Terminal.", 'team-meet', 'archFg', 'claim', { op: 'update' });
r('4', "Replace the Reservation Queue with Kafka.", 'technical-interview', 'archFg', 'claim', { op: 'update' });
r('4', "What happens if the Fare Rules Engine goes down?", 'technical-interview', 'archFg', 'claim', { op: 'explain' });
r('4', "How would this scale to two million bookings a day?", 'technical-interview', 'archFg', 'claim', { op: 'update' });
r('4', "Show this as a sequence diagram for a single booking.", 'team-meet', 'archFg', 'claim', { op: 'create' });
r('4', "Can you add a read replica for the database?", 'technical-interview', 'archFg', 'claim', { op: 'update' });
r('4', "Put a load balancer between the web app and the gateway.", 'technical-interview', 'archFg', 'claim', { op: 'update' });
r('4', "Why does it have two front ends?", 'technical-interview', 'archFg', 'claim', { op: 'explain' });
r('4', "Walk me through what the Seat Allocation Service does.", 'team-meet', 'archFg', 'claim', { op: 'explain' });
r('4', "Make it more detailed.", 'general', 'archFg', 'claim', { op: 'refine' });
r('4', "Simplify it a bit.", 'general', 'archFg', 'claim', { op: 'refine|update' });
r('4', "Add rate limiting at the gateway.", 'technical-interview', 'archFg', 'claim', { op: 'update' });
r('4', "Which component talks to the Boarding Gate Scanner?", 'team-meet', 'archFg', 'claim', { op: 'explain' });
r('4', "Split the Seat Allocation Service into two services, one for cars and one for foot passengers.", 'technical-interview', 'archFg', 'claim', { op: 'update' });
r('4', "Is the queue really necessary?", 'technical-interview', 'archFg', 'claim', { op: 'explain' });
r('4', "Could we draw the data model for this as an ER diagram?", 'technical-interview', 'archFg', 'claim', { op: 'create' });
r('4', "Add a monitoring service.", 'team-meet', 'archFg', 'claim', { op: 'update' });
r('4', "Rename the Fare Rules Engine to Pricing Service.", 'team-meet', 'archFg', 'claim', { op: 'update' });
r('4', "What does the arrow from the gateway to the queue mean?", 'general', 'archFg', 'claim', { op: 'explain' });
r('4', "Now add a dead letter queue.", 'technical-interview', 'archFg', 'claim', { op: 'update' });
r('4', "Move the scanner so it talks to the gateway directly.", 'team-meet', 'archFg', 'claim', { op: 'update' });
r('4', "How does a request get from the kiosk to the database?", 'technical-interview', 'archFg', 'claim', { op: 'explain' });
r('4', "Give me the state diagram for a reservation in this design.", 'technical-interview', 'archFg', 'claim', { op: 'create' });
r('4', "Drop the kiosk, we're not doing that in phase one.", 'team-meet', 'archFg', 'claim', { op: 'update' });
r('4', "Let's put a CDN in front of the web app.", 'technical-interview', 'archFg', 'claim', { op: 'update' });
r('4', "Why is the fare engine separate from the gateway?", 'technical-interview', 'archFg', 'claim', { op: 'explain' });
r('4', "Where would you add redundancy?", 'technical-interview', 'archFg', 'claim', { op: 'explain|update' });
r('4', "Can it handle a spike when a sailing gets cancelled?", 'technical-interview', 'archFg', 'claim', { op: 'explain|update' });
r('4', "Add a second database for analytics.", 'team-meet', 'archFg', 'claim', { op: 'update' });
r('4', "Make the queue durable.", 'technical-interview', 'archFg', 'claim', { op: 'update' });
r('4', "What's the weakest part of this design?", 'technical-interview', 'archFg', 'claim', { op: 'explain' });
r('4', "Show the deployment view of this.", 'team-meet', 'archFg', 'claim', { op: 'create', borderline: true });
r('4', "Connect the kiosk to the fare engine as well.", 'team-meet', 'archFg', 'claim', { op: 'update' });
r('4', "Explain the flow from booking to boarding.", 'general', 'archFg', 'claim', { op: 'explain' });
r('4', "I think we should add an auth service before the gateway.", 'technical-interview', 'archFg', 'claim', { op: 'update', borderline: true });
r('4', "Shorten it.", 'general', 'archFg', 'claim', { op: 'refine' });
r('4', "How would it cope with ten times the traffic?", 'technical-interview', 'archFg', 'claim', { op: 'update|explain' });
r('4', "I am having one doubt, why the queue is needed here?", 'technical-interview', 'archFg', 'claim', { op: 'explain' });
r('4', "Please add one cache before the database, no?", 'technical-interview', 'archFg', 'claim', { op: 'update' });
r('4', "Kindly remove the kiosk terminal only.", 'team-meet', 'archFg', 'claim', { op: 'update' });
r('4', "Colour the external systems differently.", 'team-meet', 'archFg', 'claim', { op: 'update|refine', borderline: true });

// ───────────────────────── List 5: chart in focus (compound-growth forecast) ─────────────────────────
// 5a unrelated, with numbers / percentages / money / rates / dates / durations
r('5a', "The invoice came to 4,200 pounds including VAT.", 'sales', 'chartFg', 'noclaim');
r('5a', "We're meeting at 3:30, not 3.", 'team-meet', 'chartFg', 'noclaim');
r('5a', "My train was 45 minutes late this morning.", 'general', 'chartFg', 'noclaim');
r('5a', "They offered a 15% discount if we sign by Friday.", 'sales', 'chartFg', 'noclaim');
r('5a', "The interest rate on my mortgage went up to 5.2%.", 'general', 'chartFg', 'noclaim');
r('5a', "Give Daniel a 3% raise in the next cycle.", 'team-meet', 'chartFg', 'noclaim');
r('5a', "Book the room for 12 people.", 'team-meet', 'chartFg', 'noclaim');
r('5a', "The contract runs for 18 months from the first of March.", 'sales', 'chartFg', 'noclaim');
r('5a', "It took 6 weeks to get the permit.", 'team-meet', 'chartFg', 'noclaim');
r('5a', "Our NPS dropped by 4 points last quarter.", 'sales', 'chartFg', 'noclaim');
r('5a', "Can you set a timer for 10 minutes?", 'general', 'chartFg', 'noclaim');
r('5a', "Change the meeting to 2 pm on the 14th.", 'team-meet', 'chartFg', 'noclaim');
r('5a', "The server costs are about 900 dollars a month.", 'team-meet', 'chartFg', 'noclaim');
r('5a', "She scored 82 out of 100 on the assessment.", 'recruiting', 'chartFg', 'noclaim');
r('5a', "Add 5 more licences to the order.", 'sales', 'chartFg', 'noclaim');
r('5a', "Extend the trial by 14 days for that customer.", 'sales', 'chartFg', 'noclaim');
r('5a', "Cut the agenda down to 20 minutes.", 'team-meet', 'chartFg', 'noclaim');
r('5a', "The exchange rate is about 1.27 today.", 'sales', 'chartFg', 'noclaim');
r('5a', "We had a 2% response rate on the survey.", 'team-meet', 'chartFg', 'noclaim');
r('5a', "Raise the headcount cap to 40.", 'recruiting', 'chartFg', 'noclaim');
r('5a', "Twelve people have confirmed for the offsite.", 'team-meet', 'chartFg', 'noclaim');
r('5a', "Half of the team is out on the 3rd of June.", 'team-meet', 'chartFg', 'noclaim');
r('5a', "What was the churn rate at the last company you worked at?", 'recruiting', 'chartFg', 'noclaim');
r('5a', "The bonus pool is 4% of salary this year.", 'team-meet', 'chartFg', 'noclaim');
r('5a', "Set the thermostat to 21 degrees, it's freezing in here.", 'general', 'chartFg', 'noclaim');
r('5a', "Lower the price of the annual plan to 99.", 'sales', 'chartFg', 'noclaim');
r('5a', "Push the deadline out by two weeks.", 'team-meet', 'chartFg', 'noclaim');
r('5a', "I'm 90% sure legal will object.", 'sales', 'chartFg', 'noclaim');
r('5a', "Refund him 35 euros and close the case.", 'call-center', 'chartFg', 'noclaim');
r('5a', "How many months of runway do we have left?", 'team-meet', 'chartFg', 'noclaim');
r('5a', "Make the deposit 20% instead of 10%.", 'sales', 'chartFg', 'noclaim');
r('5a', "Increase the font size to 14 on the handout.", 'seminar', 'chartFg', 'noclaim');
r('5a', "The supplier put their prices up six percent in January.", 'sales', 'chartFg', 'noclaim');
r('5a', "Her probation ends after three months.", 'recruiting', 'chartFg', 'noclaim');

// 5b real follow-ups
r('5b', "Make it 6%.", 'sales', 'chartFg', 'claim', { op: 'update' });
r('5b', "What if growth is only two percent?", 'sales', 'chartFg', 'claim', { op: 'update' });
r('5b', "Extend it to twenty-four months.", 'sales', 'chartFg', 'claim', { op: 'update' });
r('5b', "Start from 80,000 instead.", 'team-meet', 'chartFg', 'claim', { op: 'update' });
r('5b', "Why does the line curve upwards?", 'general', 'chartFg', 'claim', { op: 'explain' });
r('5b', "What's on the y-axis?", 'general', 'chartFg', 'claim', { op: 'explain' });
r('5b', "Show this chart as a table.", 'sales', 'chartFg', 'claim', { op: 'create', view: 'matrix' });
r('5b', "Can I get these numbers as a table?", 'team-meet', 'chartFg', 'claim', { op: 'create', view: 'matrix' });
r('5b', "Change the rate to four and a half percent.", 'sales', 'chartFg', 'claim', { op: 'update' });
r('5b', "Where does it cross 100,000?", 'sales', 'chartFg', 'claim', { op: 'explain' });
r('5b', "Run it for three years instead of one.", 'team-meet', 'chartFg', 'claim', { op: 'update' });
r('5b', "What would it look like at ten percent a month?", 'sales', 'chartFg', 'claim', { op: 'update' });
r('5b', "Why isn't it a straight line?", 'lecture', 'chartFg', 'claim', { op: 'explain' });
r('5b', "Make the baseline fifty thousand.", 'team-meet', 'chartFg', 'claim', { op: 'update' });
r('5b', "Is the x-axis in months or quarters?", 'general', 'chartFg', 'claim', { op: 'explain' });
r('5b', "Switch it to quarterly.", 'sales', 'chartFg', 'claim', { op: 'update' });
r('5b', "Make it a bar chart instead.", 'sales', 'chartFg', 'claim', { op: 'update|create' });
r('5b', "What's the value at month twelve?", 'team-meet', 'chartFg', 'claim', { op: 'explain' });
r('5b', "Halve the growth rate.", 'sales', 'chartFg', 'claim', { op: 'update' });
r('5b', "Add a second line at 2% for comparison.", 'sales', 'chartFg', 'claim', { op: 'update' });
r('5b', "Table view, please.", 'team-meet', 'chartFg', 'claim', { op: 'create', view: 'matrix', borderline: true });
r('5b', "Why is the final figure so much higher than the starting one?", 'general', 'chartFg', 'claim', { op: 'explain' });
r('5b', "Drop the rate to three.", 'sales', 'chartFg', 'claim', { op: 'update' });
r('5b', "Rename the chart to Foot passenger forecast 2027.", 'team-meet', 'chartFg', 'claim', { op: 'update' });
r('5b', "How steep is the curve in the second half?", 'general', 'chartFg', 'claim', { op: 'explain' });
r('5b', "Show it over eighteen months.", 'sales', 'chartFg', 'claim', { op: 'update' });
r('5b', "And at eight percent?", 'sales', 'chartFg', 'claim', { op: 'update', borderline: true });
r('5b', "Does the chart assume the growth compounds?", 'lecture', 'chartFg', 'claim', { op: 'explain' });
r('5b', "Put it in a table instead of a line.", 'team-meet', 'chartFg', 'claim', { op: 'create', view: 'matrix' });
r('5b', "What does the axis on the left measure?", 'general', 'chartFg', 'claim', { op: 'explain' });
r('5b', "Double the starting number.", 'sales', 'chartFg', 'claim', { op: 'update' });
r('5b', "Use seven point five percent, please.", 'sales', 'chartFg', 'claim', { op: 'update', borderline: true });

// ───────────────────────── List 6: ER diagram in focus ─────────────────────────
// 6a unrelated
r('6a', "Did you get your ticket for the conference yet?", 'team-meet', 'erFg', 'noclaim');
r('6a', "Open a ticket with IT about my VPN.", 'team-meet', 'erFg', 'noclaim');
r('6a', "The port after dinner was a mistake, I think.", 'general', 'erFg', 'noclaim');
r('6a', "Add Rebecca to the booking for the team lunch.", 'team-meet', 'erFg', 'noclaim');
r('6a', "Remove my name from the passenger list for the charter coach.", 'general', 'erFg', 'noclaim');
r('6a', "What's the key takeaway from yesterday's workshop?", 'team-meet', 'erFg', 'noclaim');
r('6a', "Our relationship with that vendor has always been rocky.", 'sales', 'erFg', 'noclaim');
r('6a', "Cancel my booking at the hotel in Leeds.", 'general', 'erFg', 'noclaim');
r('6a', "I've attributed the delay to the customs strike.", 'team-meet', 'erFg', 'noclaim');
r('6a', "Who's the primary contact at the harbour office?", 'sales', 'erFg', 'noclaim');
r('6a', "Add a column to the budget spreadsheet for travel.", 'team-meet', 'erFg', 'noclaim');
r('6a', "Move our table booking to eight o'clock.", 'general', 'erFg', 'noclaim');
r('6a', "Is the sailing club still doing Wednesday evenings?", 'general', 'erFg', 'noclaim');
r('6a', "Foreign exchange fees were higher than expected.", 'sales', 'erFg', 'noclaim');
r('6a', "The entity that owns the building is registered in Jersey.", 'sales', 'erFg', 'noclaim');
r('6a', "Drop the kids at school, then I'll dial in.", 'general', 'erFg', 'noclaim');
r('6a', "Can you email the passenger a copy of the receipt?", 'call-center', 'erFg', 'noclaim');
r('6a', "Most of the staff are on one-to-one coaching this month.", 'recruiting', 'erFg', 'noclaim');
r('6a', "Add a field trip to the calendar for the new starters.", 'recruiting', 'erFg', 'noclaim');
r('6a', "Delete the draft, I'll start over on the proposal.", 'sales', 'erFg', 'noclaim');
r('6a', "Update your status in Slack when you're back.", 'team-meet', 'erFg', 'noclaim');
r('6a', "How many tickets did support close last week?", 'call-center', 'erFg', 'noclaim');
r('6a', "Change the email signature to the new brand colours.", 'team-meet', 'erFg', 'noclaim');
r('6a', "Join us on the call when you're ready.", 'team-meet', 'erFg', 'noclaim');
r('6a', "Rename the shared folder to Harbour Project 2027.", 'team-meet', 'erFg', 'noclaim');
r('6a', "The vessel they chartered for the away day was tiny.", 'general', 'erFg', 'noclaim');
r('6a', "What's your full name as it appears on the passport?", 'call-center', 'erFg', 'noclaim');

// 6b follow-ups
r('6b', "Add a seat_number column to TICKET.", 'technical-interview', 'erFg', 'claim', { op: 'update' });
r('6b', "Why is there a separate TICKET table?", 'technical-interview', 'erFg', 'claim', { op: 'explain' });
r('6b', "What's the relationship between SAILING and VESSEL?", 'technical-interview', 'erFg', 'claim', { op: 'explain' });
r('6b', "Add a PAYMENT entity linked to BOOKING.", 'technical-interview', 'erFg', 'claim', { op: 'update' });
r('6b', "Make the passenger email unique.", 'technical-interview', 'erFg', 'claim', { op: 'update' });
r('6b', "Can a booking have more than one passenger?", 'technical-interview', 'erFg', 'claim', { op: 'explain' });
r('6b', "Remove the PORT entity.", 'team-meet', 'erFg', 'claim', { op: 'update' });
r('6b', "Rename SAILING to DEPARTURE.", 'team-meet', 'erFg', 'claim', { op: 'update' });
r('6b', "Why is passenger_id a foreign key in BOOKING?", 'technical-interview', 'erFg', 'claim', { op: 'explain' });
r('6b', "Should the relationship between passenger and booking be many-to-many?", 'technical-interview', 'erFg', 'claim', { op: 'explain|update' });
r('6b', "Add a vehicle table for cars and link it to booking.", 'team-meet', 'erFg', 'claim', { op: 'update' });
r('6b', "Show this as a class diagram.", 'technical-interview', 'erFg', 'claim', { op: 'create' });
r('6b', "What's the primary key of TICKET?", 'technical-interview', 'erFg', 'claim', { op: 'explain' });
r('6b', "Add created_at and updated_at to every table.", 'technical-interview', 'erFg', 'claim', { op: 'update' });
r('6b', "Split PASSENGER into passenger and account.", 'technical-interview', 'erFg', 'claim', { op: 'update' });
r('6b', "Where would the fare go in this schema?", 'technical-interview', 'erFg', 'claim', { op: 'explain|update' });
r('6b', "Normalise it to third normal form.", 'technical-interview', 'erFg', 'claim', { op: 'update|refine' });
r('6b', "Make it simpler.", 'general', 'erFg', 'claim', { op: 'refine|update' });
r('6b', "Which tables would I need to join to list the passengers on a vessel?", 'technical-interview', 'erFg', 'claim', { op: 'explain' });
r('6b', "Add a cancelled_on date to booking.", 'team-meet', 'erFg', 'claim', { op: 'update' });
r('6b', "Is the cardinality between VESSEL and SAILING right?", 'technical-interview', 'erFg', 'claim', { op: 'explain' });
r('6b', "Draw it in Chen notation.", 'lecture', 'erFg', 'claim', { op: 'create|update' });
r('6b', "Why do we need a sailing and a vessel separately?", 'technical-interview', 'erFg', 'claim', { op: 'explain' });
r('6b', "Add a destination port to SAILING.", 'team-meet', 'erFg', 'claim', { op: 'update' });
r('6b', "What does the crow's foot on the booking side mean?", 'lecture', 'erFg', 'claim', { op: 'explain' });
r('6b', "Drop the status column.", 'team-meet', 'erFg', 'claim', { op: 'update' });
r('6b', "One vessel can have many sailings, yes?", 'technical-interview', 'erFg', 'claim', { op: 'explain', borderline: true });

// ───────────────────────── List 7: sequence diagram and Gantt chart in focus ─────────────────────────
// 7a sequence, unrelated
r('7a-seq', "Did the email from the landlord arrive?", 'general', 'seqFg', 'noclaim');
r('7a-seq', "Pay the caterer before the end of the week.", 'team-meet', 'seqFg', 'noclaim');
r('7a-seq', "Send a message to Dev that we're running late.", 'team-meet', 'seqFg', 'noclaim');
r('7a-seq', "Who's the next participant on the panel?", 'seminar', 'seqFg', 'noclaim');
r('7a-seq', "The payment for the venue bounced, apparently.", 'team-meet', 'seqFg', 'noclaim');
r('7a-seq', "Add a response to the customer's review on Trustpilot.", 'call-center', 'seqFg', 'noclaim');
r('7a-seq', "I'll confirm the booking for the team dinner tonight.", 'team-meet', 'seqFg', 'noclaim');
r('7a-seq', "What's the order of speakers tomorrow?", 'seminar', 'seqFg', 'noclaim');
r('7a-seq', "Remove the step about parking from the visitor instructions.", 'team-meet', 'seqFg', 'noclaim');
r('7a-seq', "Authorise the overtime for the weekend shift.", 'team-meet', 'seqFg', 'noclaim');
r('7a-seq', "Can you call the provider about the broadband outage?", 'call-center', 'seqFg', 'noclaim');
r('7a-seq', "The kiosk in the lobby sells awful coffee.", 'general', 'seqFg', 'noclaim');
r('7a-seq', "After that we went for dinner and then on to the pub.", 'general', 'seqFg', 'noclaim');
r('7a-seq', "Reply to all on that thread, please.", 'team-meet', 'seqFg', 'noclaim');
r('7a-seq', "Add a note to the CRM record after the call.", 'sales', 'seqFg', 'noclaim');
r('7a-seq', "Let's do introductions first, then the demo.", 'sales', 'seqFg', 'noclaim');
r('7a-seq', "My card was declined twice at the petrol station.", 'general', 'seqFg', 'noclaim');
r('7a-seq', "Request a quote from two more suppliers.", 'sales', 'seqFg', 'noclaim');

// 7b sequence, follow-ups
r('7b-seq', "Add a step where the kiosk prints a receipt.", 'technical-interview', 'seqFg', 'claim', { op: 'update' });
r('7b-seq', "What happens if the payment is declined?", 'technical-interview', 'seqFg', 'claim', { op: 'explain|update' });
r('7b-seq', "Why does the kiosk ask the Booking API for a fare first?", 'technical-interview', 'seqFg', 'claim', { op: 'explain' });
r('7b-seq', "Add an alt branch for a declined card.", 'technical-interview', 'seqFg', 'claim', { op: 'update' });
r('7b-seq', "Remove the Email Service.", 'team-meet', 'seqFg', 'claim', { op: 'update' });
r('7b-seq', "Insert a fraud check between the kiosk and the payment provider.", 'technical-interview', 'seqFg', 'claim', { op: 'update' });
r('7b-seq', "Who sends the e-ticket?", 'general', 'seqFg', 'claim', { op: 'explain' });
r('7b-seq', "Make the confirmation asynchronous.", 'technical-interview', 'seqFg', 'claim', { op: 'update' });
r('7b-seq', "Show this as a flowchart instead.", 'team-meet', 'seqFg', 'claim', { op: 'create' });
r('7b-seq', "Add a timeout on the authorisation call.", 'technical-interview', 'seqFg', 'claim', { op: 'update' });
r('7b-seq', "What's the last message in the sequence?", 'general', 'seqFg', 'claim', { op: 'explain' });
r('7b-seq', "Rename Payment Provider to Card Acquirer.", 'team-meet', 'seqFg', 'claim', { op: 'update' });
r('7b-seq', "Why is there no retry on the fare quote?", 'technical-interview', 'seqFg', 'claim', { op: 'explain' });
r('7b-seq', "Add an SMS service next to the email one.", 'team-meet', 'seqFg', 'claim', { op: 'update' });
r('7b-seq', "Make it shorter.", 'general', 'seqFg', 'claim', { op: 'refine' });
r('7b-seq', "Is the fare quote call synchronous?", 'technical-interview', 'seqFg', 'claim', { op: 'explain' });
r('7b-seq', "Swap the order so payment comes before the fare quote.", 'team-meet', 'seqFg', 'claim', { op: 'update' });

// 7a Gantt, unrelated
r('7a-gantt', "I'm on holiday for 10 days from the 11th of January.", 'team-meet', 'ganttFg', 'noclaim');
r('7a-gantt', "The plumber said it would take 3 days.", 'general', 'ganttFg', 'noclaim');
r('7a-gantt', "Move the dentist appointment to after lunch.", 'general', 'ganttFg', 'noclaim');
r('7a-gantt', "Push the board meeting back a week.", 'team-meet', 'ganttFg', 'noclaim');
r('7a-gantt', "Our lease is up in 14 days.", 'team-meet', 'ganttFg', 'noclaim');
r('7a-gantt', "Add a week to the notice period in the contract template.", 'recruiting', 'ganttFg', 'noclaim');
r('7a-gantt', "When does the summer menu start at the café?", 'general', 'ganttFg', 'noclaim');
r('7a-gantt', "The crew on the film set worked sixteen-hour days.", 'general', 'ganttFg', 'noclaim');
r('7a-gantt', "Extend the deadline for expense forms to the 5th.", 'team-meet', 'ganttFg', 'noclaim');
r('7a-gantt', "How long is the probation period for new staff?", 'recruiting', 'ganttFg', 'noclaim');
r('7a-gantt', "Delay the newsletter until after the bank holiday.", 'team-meet', 'ganttFg', 'noclaim');
r('7a-gantt', "The customer survey closes on Friday, so fill it in.", 'team-meet', 'ganttFg', 'noclaim');
r('7a-gantt', "Shorten the stand-up to ten minutes.", 'team-meet', 'ganttFg', 'noclaim');
r('7a-gantt', "Is the briefing room free at two?", 'team-meet', 'ganttFg', 'noclaim');
r('7a-gantt', "My commute is twenty-five minutes longer since the roadworks started.", 'general', 'ganttFg', 'noclaim');
r('7a-gantt', "Start the dishwasher before you leave.", 'general', 'ganttFg', 'noclaim');
r('7a-gantt', "What phase of the moon is it tonight?", 'general', 'ganttFg', 'noclaim');
r('7a-gantt', "Bring the launch party forward to six o'clock.", 'team-meet', 'ganttFg', 'noclaim', B);

// 7b Gantt, follow-ups
r('7b-gantt', "Move the staff briefing a week earlier.", 'team-meet', 'ganttFg', 'claim', { op: 'update' });
r('7b-gantt', "Make crew rostering fifteen days.", 'team-meet', 'ganttFg', 'claim', { op: 'update' });
r('7b-gantt', "What's on the critical path?", 'team-meet', 'ganttFg', 'claim', { op: 'explain' });
r('7b-gantt', "Add a testing phase before launch.", 'team-meet', 'ganttFg', 'claim', { op: 'update' });
r('7b-gantt', "Why does data entry wait for crew rostering?", 'team-meet', 'ganttFg', 'claim', { op: 'explain' });
r('7b-gantt', "Push the public announcement back by three days.", 'team-meet', 'ganttFg', 'claim', { op: 'update' });
r('7b-gantt', "When does the launch section start?", 'team-meet', 'ganttFg', 'claim', { op: 'explain' });
r('7b-gantt', "Can the fare table update run in parallel with the route survey?", 'team-meet', 'ganttFg', 'claim', { op: 'explain|update' });
r('7b-gantt', "Remove the route survey.", 'team-meet', 'ganttFg', 'claim', { op: 'update' });
r('7b-gantt', "Add a milestone for go-live.", 'team-meet', 'ganttFg', 'claim', { op: 'update' });
r('7b-gantt', "Which tasks depend on crew rostering?", 'team-meet', 'ganttFg', 'claim', { op: 'explain' });
r('7b-gantt', "Shorten the route survey to ten days.", 'team-meet', 'ganttFg', 'claim', { op: 'update' });
r('7b-gantt', "How long is the whole plan?", 'general', 'ganttFg', 'claim', { op: 'explain' });
r('7b-gantt', "Show this as a timeline instead.", 'team-meet', 'ganttFg', 'claim', { op: 'create' });
r('7b-gantt', "Rename the Build section to Preparation.", 'team-meet', 'ganttFg', 'claim', { op: 'update' });
r('7b-gantt', "What if rostering slips by a week?", 'team-meet', 'ganttFg', 'claim', { op: 'update|explain' });
r('7b-gantt', "Start everything on the first of February.", 'team-meet', 'ganttFg', 'claim', { op: 'update' });

// ───────────────────────── List 8: background artifact ─────────────────────────
// 8a unrelated (architecture in background)
r('8a', "Add a load balancer.", 'technical-interview', 'archBg', 'noclaim');
r('8a', "What is a message broker, exactly?", 'technical-interview', 'archBg', 'noclaim');
r('8a', "There's a queue for the microwave every lunchtime.", 'team-meet', 'archBg', 'noclaim');
r('8a', "How does a rules engine differ from a workflow engine?", 'technical-interview', 'archBg', 'noclaim');
r('8a', "The gate at the car park is stuck open.", 'team-meet', 'archBg', 'noclaim');
r('8a', "Add a paragraph about pricing.", 'sales', 'archBg', 'noclaim');
r('8a', "Why do we need a staging environment?", 'technical-interview', 'archBg', 'noclaim');
r('8a', "Can we talk about the Q3 hiring plan now?", 'team-meet', 'archBg', 'noclaim');
r('8a', "Remove the duplicate entries.", 'team-meet', 'archBg', 'noclaim');
r('8a', "The database conference is in Lisbon this year.", 'team-meet', 'archBg', 'noclaim');
r('8a', "Make it shorter.", 'general', 'archBg', 'noclaim');
r('8a', "What does a seat licence cost these days?", 'sales', 'archBg', 'noclaim');
r('8a', "Is the terminal at the port open on Sundays?", 'call-center', 'archBg', 'noclaim');
r('8a', "Where's the bottleneck?", 'team-meet', 'archBg', 'noclaim', B);
r('8a', "How do API gateways handle retries in general?", 'technical-interview', 'archBg', 'noclaim');
r('8a', "Let's add a slide on competitors.", 'sales', 'archBg', 'noclaim');
r('8a', "Why is the rota so uneven this month?", 'team-meet', 'archBg', 'noclaim');
r('8a', "The scanner app on my phone is draining the battery.", 'general', 'archBg', 'noclaim');
r('8a', "Add an engineer to the on-call rotation.", 'team-meet', 'archBg', 'noclaim');
r('8a', "The queue outside the passport office went round the block.", 'general', 'archBg', 'noclaim');
// 8a unrelated (chart in background)
r('8a', "Make it 7%.", 'sales', 'chartBg', 'noclaim');
r('8a', "Passenger numbers on my bus route have halved.", 'general', 'chartBg', 'noclaim');
r('8a', "Growth in the team's confidence has been great to see.", 'team-meet', 'chartBg', 'noclaim');
r('8a', "What's a good monthly savings rate for someone in their thirties?", 'general', 'chartBg', 'noclaim');
r('8a', "The forecast says rain all weekend.", 'general', 'chartBg', 'noclaim');
r('8a', "Our rent goes up 4% a year.", 'team-meet', 'chartBg', 'noclaim');
r('8a', "Add 12 months to the warranty.", 'sales', 'chartBg', 'noclaim');
r('8a', "Why is it so high?", 'sales', 'chartBg', 'noclaim', B);
r('8a', "The line at passport control was enormous.", 'general', 'chartBg', 'noclaim');
r('8a', "Raise the minimum order to 50.", 'sales', 'chartBg', 'noclaim');
r('8a', "What's the baseline salary for that band?", 'recruiting', 'chartBg', 'noclaim');
r('8a', "Extend the offer until the end of the month.", 'sales', 'chartBg', 'noclaim');
r('8a', "Is a table booked for the client dinner?", 'sales', 'chartBg', 'noclaim');
r('8a', "How many months until the audit?", 'team-meet', 'chartBg', 'noclaim');
r('8a', "He charted in the top ten twice in the nineties.", 'general', 'chartBg', 'noclaim');
r('8a', "Start from the top of the agenda.", 'team-meet', 'chartBg', 'noclaim');

// 8b named reach (architecture in background)
r('8b', "Going back to the architecture, add a cache in front of the database.", 'technical-interview', 'archBg', 'claim', { op: 'update' });
r('8b', "In the diagram, why is the Reservation Queue before seat allocation?", 'technical-interview', 'archBg', 'claim', { op: 'explain' });
r('8b', "Can you remove the Port Kiosk Terminal?", 'team-meet', 'archBg', 'claim', { op: 'update' });
r('8b', "What does the Fare Rules Engine actually do?", 'team-meet', 'archBg', 'claim', { op: 'explain' });
r('8b', "Update the diagram so the scanner talks to the gateway.", 'team-meet', 'archBg', 'claim', { op: 'update' });
r('8b', "On the architecture diagram, where's the bottleneck?", 'technical-interview', 'archBg', 'claim', { op: 'explain' });
r('8b', "Add retries to the Booking API Gateway.", 'technical-interview', 'archBg', 'claim', { op: 'update' });
r('8b', "Why does the Seat Allocation Service write straight to the Sailings Database?", 'technical-interview', 'archBg', 'claim', { op: 'explain' });
r('8b', "Let's revisit the design: put a CDN in front of the Passenger Web App.", 'technical-interview', 'archBg', 'claim', { op: 'update' });
r('8b', "Show the architecture as a sequence diagram.", 'team-meet', 'archBg', 'claim', { op: 'create' });
r('8b', "In our design, the queue should be durable, so change that.", 'technical-interview', 'archBg', 'claim', { op: 'update' });
r('8b', "Is the Boarding Gate Scanner online or offline in that diagram?", 'team-meet', 'archBg', 'claim', { op: 'explain' });
r('8b', "Make the architecture diagram less detailed.", 'general', 'archBg', 'claim', { op: 'refine|update' });
r('8b', "Replace the Sailings Database with two regional databases.", 'technical-interview', 'archBg', 'claim', { op: 'update' });
r('8b', "The diagram from earlier, how would it scale to five million passengers?", 'technical-interview', 'archBg', 'claim', { op: 'update' });
r('8b', "Remind me why the system design has the Reservation Queue at all.", 'technical-interview', 'archBg', 'claim', { op: 'explain' });
r('8b', "Rename the Seat Allocation Service to Inventory Service.", 'team-meet', 'archBg', 'claim', { op: 'update' });
r('8b', "In the system we drew, the gateway should also do authentication.", 'technical-interview', 'archBg', 'claim', { op: 'update', borderline: true });
// 8b named reach (chart in background)
r('8b', "Back to the chart, make it 6%.", 'sales', 'chartBg', 'claim', { op: 'update' });
r('8b', "On the forecast chart, what's the value at month six?", 'sales', 'chartBg', 'claim', { op: 'explain' });
r('8b', "Turn the chart into a table.", 'team-meet', 'chartBg', 'claim', { op: 'create', view: 'matrix' });
r('8b', "Extend the chart to 24 months.", 'sales', 'chartBg', 'claim', { op: 'update' });
r('8b', "Why does the graph curve up like that?", 'general', 'chartBg', 'claim', { op: 'explain' });
r('8b', "Change the growth rate on the chart to 2.5%.", 'sales', 'chartBg', 'claim', { op: 'update' });
r('8b', "In the passenger forecast, start from 70,000.", 'sales', 'chartBg', 'claim', { op: 'update', borderline: true });
r('8b', "What does the y-axis on that chart show?", 'general', 'chartBg', 'claim', { op: 'explain' });
r('8b', "Can you update the line chart to use quarters?", 'sales', 'chartBg', 'claim', { op: 'update' });
r('8b', "The chart we made earlier, run it for three years.", 'team-meet', 'chartBg', 'claim', { op: 'update' });
r('8b', "Is the chart assuming compounding?", 'lecture', 'chartBg', 'claim', { op: 'explain' });
r('8b', "Redo the graph with a baseline of 50,000.", 'sales', 'chartBg', 'claim', { op: 'update' });

// ───────────────────────── List 9: multi-sentence turns ─────────────────────────
r('9', "Thanks for joining, everyone. Can you draw the handover process between sales and support?", 'team-meet', 'none', 'draw');
r('9', "I was late because of the traffic. The diagram in the deck was fine, by the way.", 'team-meet', 'none', 'nodraw');
r('9', "We lost the Carter deal. Honestly, back to the drawing board. Let's regroup Monday.", 'sales', 'none', 'nodraw');
r('9', "Right, next topic. I'd like a flowchart of the returns approval steps. Then we can break.", 'call-center', 'none', 'draw');
r('9', "She joined in March. She drew up the rota herself. Nobody asked her to.", 'recruiting', 'none', 'nodraw');
r('9', "Okay. Design a job scheduler for batch workloads. Take your time.", 'technical-interview', 'none', 'draw');
r('9', "The chart was wrong last week. Did anyone fix the numbers?", 'team-meet', 'none', 'nodraw');
r('9', "I'm not sure I follow. Could you show the hierarchy of the cost centres?", 'team-meet', 'none', 'draw', { layout: 'tree' });
r('9', "Sorry, my dog is barking. Where were we? Oh yes, sketch the data flow for the import job.", 'team-meet', 'none', 'draw');
r('9', "We need a summary of the chart for the newsletter. Keep it under fifty words.", 'team-meet', 'none', 'nodraw');
r('9', "Good morning. The swim lanes are booked for the school gala. Use the gym instead.", 'general', 'none', 'nodraw');
r('9', "Let me think. Timeline of the merger, from announcement to close.", 'team-meet', 'none', 'draw', B);
r('9', "That was a great session. I learned a lot about sequence diagrams. Thanks again.", 'seminar', 'none', 'nodraw');
r('9', "I have two questions. First, what's your notice period? Second, when can you start?", 'recruiting', 'none', 'nodraw');
r('9', "Hold on. Before we go on, can you put the release process into swimlanes for dev, QA and ops?", 'team-meet', 'none', 'draw', { layout: 'lanes' });
r('9', "Right. Add a search index.", 'technical-interview', 'archFg', 'claim', { op: 'update' });
r('9', "Sounds good. Why do we need the Reservation Queue, though?", 'technical-interview', 'archFg', 'claim', { op: 'explain' });
r('9', "I need to step out at three. Can someone cover the stand-up tomorrow?", 'team-meet', 'archFg', 'noclaim');
r('9', "Thanks. Book the room for the retro. And order lunch for eight.", 'team-meet', 'archFg', 'noclaim');
r('9', "The kiosk vendor called. They want the contract signed by Friday.", 'team-meet', 'archFg', 'noclaim');
r('9', "Hmm. What happens if the Booking API Gateway is down? Does everything stop?", 'technical-interview', 'archFg', 'claim', { op: 'explain' });
r('9', "Great. Now remove the Port Kiosk Terminal. We don't need it for phase one.", 'team-meet', 'archFg', 'claim', { op: 'update' });
r('9', "My flight is from gate 14. I'll dial in from the lounge.", 'team-meet', 'archFg', 'noclaim');
r('9', "Let's take five. Then add the item about budget to the agenda.", 'team-meet', 'archFg', 'noclaim');
r('9', "I like it. How would this scale to five million bookings a month?", 'technical-interview', 'archFg', 'claim', { op: 'update' });
r('9', "Yeah. Okay. Make it more detailed.", 'general', 'archFg', 'claim', { op: 'refine' });
r('9', "The demo went well. Add a thank-you note to the follow-up email.", 'sales', 'archFg', 'noclaim');
r('9', "I've got a hard stop at four. Make it quick.", 'team-meet', 'archFg', 'noclaim');
r('9', "We just lost the projector. Make it bigger.", 'team-meet', 'archFg', 'noclaim', B);
r('9', "Right. Make it eight percent.", 'sales', 'chartFg', 'claim', { op: 'update' });
r('9', "The supplier wants 8% more. Make it 5.", 'sales', 'chartFg', 'noclaim', B);
r('9', "Got it. What's on the x-axis?", 'general', 'chartFg', 'claim', { op: 'explain' });
r('9', "Lunch is at one. The sandwiches cost 6 pounds each.", 'team-meet', 'chartFg', 'noclaim');
r('9', "Fine. Can I see that as a table?", 'sales', 'chartFg', 'claim', { op: 'create', view: 'matrix' });
r('9', "We pay 4% commission to the agents. That's in the contract.", 'sales', 'chartFg', 'noclaim');
r('9', "Nice. Extend it to two years. And start from 70,000.", 'sales', 'chartFg', 'claim', { op: 'update' });
r('9', "Thanks, that's clear. I'll send the invoice for 1,200 tomorrow.", 'sales', 'chartFg', 'noclaim');
r('9', "I've a train at 5:15. Why does the curve get steeper?", 'general', 'chartFg', 'claim', { op: 'explain', borderline: true });
r('9', "Sure. Add a loyalty_points column to PASSENGER.", 'technical-interview', 'erFg', 'claim', { op: 'update' });
r('9', "I booked the tickets for Friday. They were 40 pounds each.", 'general', 'erFg', 'noclaim');
r('9', "Okay, good. Move the staff briefing two days later.", 'team-meet', 'ganttFg', 'claim', { op: 'update' });
r('9', "I'm off next week. Push my one-to-one to the week after.", 'team-meet', 'ganttFg', 'noclaim');
r('9', "Mm-hm. Why does the kiosk call the Booking API twice?", 'technical-interview', 'seqFg', 'claim', { op: 'explain' });
r('9', "The payment for the venue went through. Send them a thank-you.", 'team-meet', 'seqFg', 'noclaim');
r('9', "Let's get back on track. In the architecture diagram, add a cache next to the gateway.", 'technical-interview', 'archBg', 'claim', { op: 'update' });
r('9', "We're over time. Add a line about that to the minutes.", 'team-meet', 'archBg', 'noclaim');

// ───────────────────────── List 10: unasked visuals ─────────────────────────
// 10a structure tasks
r('10a', "Compare our Starter, Team and Enterprise plans on price, seats and support.", 'sales', 'none', 'draw');
r('10a', "Where are we losing people in the funnel between demo and signed contract?", 'sales', 'none', 'draw');
r('10a', "At what volume do we break even if the fixed cost is 40,000 and we make 16 a unit?", 'sales', 'none', 'draw');
r('10a', "Walk me through the stages of the enterprise sales cycle.", 'sales', 'none', 'draw');
r('10a', "What's blocking what on the migration? List the dependencies between the tasks.", 'team-meet', 'none', 'draw');
r('10a', "Break down the steps to roll out single sign-on across the three offices.", 'team-meet', 'none', 'draw');
r('10a', "Give me the stages of the release process from merge to production.", 'team-meet', 'none', 'draw');
r('10a', "What are the steps to reset a customer's router remotely?", 'call-center', 'none', 'draw', B);
r('10a', "Take me through the escalation stages for a billing dispute, tier one to tier three.", 'call-center', 'none', 'draw');
r('10a', "Compare the three finalists, Amara, Jonas and Wei, on experience, salary expectations and notice period.", 'recruiting', 'none', 'draw');
r('10a', "Outline the stages of our interview process for senior engineers.", 'recruiting', 'none', 'draw');
r('10a', "Compare renting, buying and leasing a car on upfront cost, monthly cost and flexibility.", 'general', 'none', 'draw');
r('10a', "What are the steps to register a limited company in the UK?", 'general', 'none', 'draw', B);
r('10a', "Which stage of the pipeline drops the most deals: qualification, demo, proposal or negotiation?", 'sales', 'none', 'draw', B);
r('10a', "Which tasks are blocked by the API contract and which can start now?", 'team-meet', 'none', 'draw', B);
r('10a', "Give me the troubleshooting steps for a card terminal that won't connect, in order.", 'call-center', 'none', 'draw');
r('10a', "How do Salesforce, HubSpot and Pipedrive stack up on pricing, integrations and reporting?", 'sales', 'none', 'draw');
r('10a', "Break the hiring funnel into stages and tell me where candidates are dropping out.", 'recruiting', 'none', 'draw');
r('10a', "Sequence the work for the data centre exit: what has to happen first, second and third.", 'team-meet', 'none', 'draw');
r('10a', "Work out the break-even point for the new tier: 12,000 a month in costs, 49 per seat.", 'sales', 'none', 'draw');
r('10a', "Break down the stages of getting a mortgage, from application to completion.", 'general', 'none', 'draw');
r('10a', "Compare the Basic, Plus and Premium broadband packages on speed, price and contract length.", 'call-center', 'none', 'draw');
r('10a', "Give me the dependencies between design, backend, QA and launch for the portal revamp.", 'team-meet', 'none', 'draw');
r('10a', "Take me through the onboarding steps for a new hire's first week.", 'recruiting', 'none', 'draw');
r('10a', "Compare solar, wind and nuclear on cost, reliability and land use.", 'general', 'none', 'draw');

// 10b lookups and remarks with the same nouns; anything in lecture / seminar
r('10b', "What's the price of the Enterprise plan?", 'sales', 'none', 'nodraw');
r('10b', "Who owns the Henderson account now?", 'sales', 'none', 'nodraw');
r('10b', "The funnel looked healthier last quarter.", 'sales', 'none', 'nodraw');
r('10b', "Did we break even on the conference booth?", 'sales', 'none', 'nodraw');
r('10b', "Why is the migration behind schedule?", 'team-meet', 'none', 'nodraw');
r('10b', "Who's blocked today?", 'team-meet', 'none', 'nodraw');
r('10b', "What's the next step after code review?", 'team-meet', 'none', 'nodraw');
r('10b', "What's the customer's current package?", 'call-center', 'none', 'nodraw');
r('10b', "Which stage is this ticket at?", 'call-center', 'none', 'nodraw');
r('10b', "When is the final-stage interview with Jonas?", 'recruiting', 'none', 'nodraw');
r('10b', "What's Amara's notice period?", 'recruiting', 'none', 'nodraw');
r('10b', "How many steps did you walk today?", 'general', 'none', 'nodraw');
r('10b', "Compare mitosis and meiosis on number of divisions, daughter cells and genetic variation.", 'lecture', 'none', 'nodraw');
r('10b', "What are the stages of the water cycle?", 'lecture', 'none', 'nodraw');
r('10b', "Break down the steps of the scientific method.", 'seminar', 'none', 'nodraw', B);
r('10b', "Compare Keynesian, monetarist and Austrian views on inflation.", 'seminar', 'none', 'nodraw');
r('10b', "Walk me through the stages of the Krebs cycle.", 'lecture', 'none', 'nodraw');
r('10b', "The comparison with HubSpot came up again on the call.", 'sales', 'none', 'nodraw');
r('10b', "We've got too many dependencies on the platform team.", 'team-meet', 'none', 'nodraw');
r('10b', "The escalation took three days, which is unacceptable.", 'call-center', 'none', 'nodraw');
r('10b', "The funnel is fine; it's the offers that aren't landing.", 'recruiting', 'none', 'nodraw');
r('10b', "Is the break-even analysis in the shared drive?", 'sales', 'none', 'nodraw');
r('10b', "How many stages are in the release pipeline?", 'team-meet', 'none', 'nodraw', B);
r('10b', "What's the first step when your wallet gets stolen?", 'general', 'none', 'nodraw', B);
r('10b', "Which plan is the customer on?", 'sales', 'none', 'nodraw');
r('10b', "Where does the hiring funnel lose candidates, according to the case study?", 'lecture', 'none', 'nodraw');
r('10b', "What blocks what in the critical path method?", 'seminar', 'none', 'nodraw');
r('10b', "How long does the reset take?", 'call-center', 'none', 'nodraw');
r('10b', "What's the time complexity of quicksort?", 'technical-interview', 'none', 'nodraw');
r('10b', "Why did you leave your last role?", 'looking-for-work', 'none', 'nodraw');
r('10b', "The steps in the runbook are out of date.", 'team-meet', 'none', 'nodraw');
r('10b', "Has the comparison between the finalists been sent to the hiring manager?", 'recruiting', 'none', 'nodraw');
r('10b', "What stage is the Carter deal in?", 'sales', 'none', 'nodraw');
r('10b', "Who approved the plan?", 'custom', 'none', 'nodraw');
r('10b', "At what price did we break even last year?", 'sales', 'none', 'nodraw', B);

// ───────────────────────── List 11: speech-to-text style ─────────────────────────
r('11', "um so can you like draw the the flow for how a refund gets approved", 'general', 'none', 'draw');
r('11', "yeah so we we charted a course back in january and uh it didnt work out", 'sales', 'none', 'nodraw');
r('11', "i i would like a uh sequence diagram of the login handshake please", 'team-meet', 'none', 'draw');
r('11', "so basically design a a rate limiter no sorry design a job queue for image processing", 'technical-interview', 'none', 'draw');
r('11', "the the swim lanes at the pool were closed so i went for a run instead", 'general', 'none', 'nodraw');
r('11', "can you um show the the folder structure as a tree", 'general', 'none', 'draw', { layout: 'tree' });
r('11', "lets not draw this out okay lets just decide", 'team-meet', 'none', 'nodraw');
r('11', "uh timeline of the the roman empire", 'lecture', 'none', 'draw');
r('11', "she she drew a blank when i asked about pricing you know", 'sales', 'none', 'nodraw');
r('11', "okay so uh put the approvals in swimlanes for um finance legal and procurement", 'team-meet', 'none', 'draw', { layout: 'lanes' });
r('11', "we need a a summary of the the chart for the newsletter", 'team-meet', 'none', 'nodraw');
r('11', "so um whats blocking what on the migration like list the dependencies between the tasks", 'team-meet', 'none', 'draw');
r('11', "could you uh could you sketch an er diagram for a a gym membership system", 'technical-interview', 'none', 'draw');
r('11', "i dont know the graph on on slide four was kinda confusing", 'team-meet', 'none', 'nodraw');
r('11', "store it as a tree so the the lookups are fast right", 'technical-interview', 'none', 'nodraw', { coding: true });
r('11', "wed like a pie chart in in the board deck this time", 'sales', 'none', 'nodraw');
r('11', "id like to see uh the quarterly numbers as a bar chart", 'sales', 'none', 'draw');
r('11', "so compare um the starter and the pro and the enterprise plans on on price and seats", 'sales', 'none', 'draw');
r('11', "whats the the price of the pro plan again", 'sales', 'none', 'nodraw');
r('11', "um add a a cache in front of the the sailings database", 'technical-interview', 'archFg', 'claim', { op: 'update' });
r('11', "so why why do we need the the reservation queue", 'technical-interview', 'archFg', 'claim', { op: 'explain' });
r('11', "uh can someone book the the meeting room for thursday", 'team-meet', 'archFg', 'noclaim');
r('11', "yeah the the queue at the canteen was was huge today", 'team-meet', 'archFg', 'noclaim');
r('11', "okay so how would this um scale to like two million bookings a day", 'technical-interview', 'archFg', 'claim', { op: 'update' });
r('11', "remove the the kiosk terminal we dont need it", 'team-meet', 'archFg', 'claim', { op: 'update' });
r('11', "whats the uh whats the single point of failure here", 'technical-interview', 'archFg', 'claim', { op: 'explain' });
r('11', "add um add jenny to the the invite for friday", 'team-meet', 'archFg', 'noclaim');
r('11', "so we need to scale the the team to like thirty people", 'team-meet', 'archFg', 'noclaim');
r('11', "i mean wheres the the bottleneck in this", 'technical-interview', 'archFg', 'claim', { op: 'explain' });
r('11', "my my flight leaves from gate twelve so", 'team-meet', 'archFg', 'noclaim');
r('11', "um make it make it six percent", 'sales', 'chartFg', 'claim', { op: 'update' });
r('11', "whats whats on the y axis", 'general', 'chartFg', 'claim', { op: 'explain' });
r('11', "can i can i get that as a a table", 'sales', 'chartFg', 'claim', { op: 'create', view: 'matrix' });
r('11', "the the invoice was like four thousand two hundred pounds", 'sales', 'chartFg', 'noclaim');
r('11', "uh extend it to to twenty four months", 'sales', 'chartFg', 'claim', { op: 'update' });
r('11', "they offered us fifteen percent off if if we sign by friday", 'sales', 'chartFg', 'noclaim');
r('11', "why why isnt it a straight line", 'general', 'chartFg', 'claim', { op: 'explain' });
r('11', "add a a seat number column to to ticket", 'technical-interview', 'erFg', 'claim', { op: 'update' });
r('11', "did did you get your ticket for the conference", 'team-meet', 'erFg', 'noclaim');
r('11', "move the the staff briefing a week earlier", 'team-meet', 'ganttFg', 'claim', { op: 'update' });
r('11', "im im on holiday for ten days from the eleventh", 'team-meet', 'ganttFg', 'noclaim');
r('11', "going back to the the architecture um add a cache in front of the database", 'technical-interview', 'archBg', 'claim', { op: 'update' });
r('11', "theres theres a queue for the microwave every day", 'team-meet', 'archBg', 'noclaim');
r('11', "back to the the chart make it uh six percent", 'sales', 'chartBg', 'claim', { op: 'update' });
r('11', "the the forecast says rain all weekend", 'general', 'chartBg', 'noclaim');
r('11', "so why does the the kiosk ask the booking api for a fare first", 'technical-interview', 'seqFg', 'claim', { op: 'explain' });
r('11', "uh pay the caterer before friday okay", 'team-meet', 'seqFg', 'noclaim');

export const ROWS = rows;
