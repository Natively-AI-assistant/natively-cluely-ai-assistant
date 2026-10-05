// Frozen sentence set for an independent measurement of resolveDiagramRequest.
// Written BEFORE reading diagramRequest.mjs and before running the function.
// Domain of the fixtures: a telehealth appointment platform.
//
// expect:
//   'nodraw'  -> enabled must be false
//   'draw'    -> enabled must be true
//   'noclaim' -> parentArtifactId must be empty (artifact must not be claimed)
//   'claim'   -> enabled true AND parentArtifactId set; `op` is the operation a listener expects
// ctx: 'none' | 'arch' | 'chart' | 'er' | 'seq' (in focus) | 'bg' (architecture, foreground:false)
// coding: true -> answerType 'coding_question_answer'
// b: true -> I consider my own label borderline.

export const FIXTURES = {
  arch: {
    artifactId: 'design-1.v1',
    artifact: 'mermaid',
    view: 'architecture',
    version: 1,
    foreground: true,
    source: [
      'flowchart LR',
      '  PA[Patient App] --> AG[API Gateway]',
      '  AG --> AS[Appointment Service]',
      '  AG --> VS[Video Session Service]',
      '  AS --> SD[(Scheduling Database)]',
      '  AS --> RQ[[Reminder Queue]]',
      '  VS --> MR[Media Relay Cluster]',
      '  AS --> PG[Pharmacy Gateway]',
    ].join('\n'),
  },
  er: {
    artifactId: 'design-2.v1',
    artifact: 'mermaid',
    view: 'er',
    version: 1,
    foreground: true,
    source: [
      'erDiagram',
      '  PATIENT ||--o{ APPOINTMENT : books',
      '  CLINICIAN ||--o{ APPOINTMENT : attends',
      '  APPOINTMENT ||--o| PRESCRIPTION : results_in',
      '  PATIENT ||--o{ INSURANCE_POLICY : holds',
      '  PATIENT {',
      '    int id PK',
      '    string full_name',
      '    date date_of_birth',
      '  }',
      '  CLINICIAN {',
      '    int id PK',
      '    string full_name',
      '    string specialty',
      '  }',
      '  APPOINTMENT {',
      '    int id PK',
      '    int patient_id FK',
      '    int clinician_id FK',
      '    datetime starts_at',
      '    string status',
      '  }',
      '  PRESCRIPTION {',
      '    int id PK',
      '    int appointment_id FK',
      '    string drug_name',
      '    string dosage',
      '  }',
      '  INSURANCE_POLICY {',
      '    int id PK',
      '    int patient_id FK',
      '    string provider',
      '    string policy_number',
      '  }',
    ].join('\n'),
  },
  seq: {
    artifactId: 'design-3.v1',
    artifact: 'mermaid',
    view: 'sequence',
    version: 1,
    foreground: true,
    source: [
      'sequenceDiagram',
      '  participant PA as Patient App',
      '  participant AG as API Gateway',
      '  participant AS as Appointment Service',
      '  participant SD as Scheduling Database',
      '  PA->>AG: POST /appointments',
      '  AG->>AS: createAppointment(slot)',
      '  AS->>SD: lock slot row',
      '  SD-->>AS: slot locked',
      '  AS->>SD: insert appointment',
      '  SD-->>AS: appointment id',
      '  AS-->>AG: 201 Created',
      '  AG-->>PA: booking confirmed',
    ].join('\n'),
  },
  chart: {
    artifactId: 'design-4.v1',
    artifact: 'chart',
    view: 'chart',
    version: 1,
    foreground: true,
    source: JSON.stringify({
      v: 1,
      type: 'line',
      title: 'Monthly consultations forecast',
      compute: { kind: 'compound_growth', baseline: 12500, ratePercent: 4, period: 'month', periods: 24 },
    }),
  },
};
FIXTURES.bg = { ...FIXTURES.arch, foreground: false };

const R = [];
const add = (list, ctx, expect, defaults = {}) => (q, mode, extra = {}) =>
  R.push({ list, ctx, expect, q, mode: mode || defaults.mode || 'general', ...defaults.extra, ...extra });

// ───────────────────────── 1. No artifact — must NOT draw ─────────────────────────
{
  const n = add('1', 'none', 'nodraw');
  n('We need to draw the line somewhere on discounting.', 'sales');
  n('The chart she showed last week was really confusing.', 'team-meet');
  n('I drew a blank when he asked about the renewal date.', 'sales');
  n("He's a real architect of that deal, honestly.", 'sales');
  n("That's off the charts, congratulations to the whole team.", 'team-meet');
  n("Let's table that discussion until Thursday.", 'team-meet');
  n('The candidate drew on her experience at a hospital network.', 'recruiting');
  n('My last manager used to map out every sprint on a whiteboard.', 'looking-for-work');
  n('I already sent the org chart to HR yesterday.', 'team-meet');
  n('Can you hear me okay, the connection is a bit sketchy.', 'general');
  n('What time does the flow cytometry lab open tomorrow?', 'lecture');
  n('The diagram in the textbook is on page forty two.', 'lecture');
  n('She plotted against him for years in that novel.', 'seminar');
  n("I'm drawing a salary of ninety thousand right now.", 'looking-for-work');
  n("Our customers love the dashboard, it's the graphs they complain about.", 'sales');
  n('Thanks for calling, how can I help you today?', 'call-center');
  n('The outline of the agreement was fine with legal.', 'sales');
  n('Did Priya finish the wireframes before she went on leave?', 'team-meet');
  n('Design a logo for the spring campaign.', 'general');
  n('We should design a better onboarding process for new hires.', 'team-meet');
  n('Design the landing page so the pricing is above the fold.', 'general');
  n('It was a pie in the sky idea from the start.', 'general');
  n('Who drew the short straw for on-call this weekend?', 'team-meet');
  n('The timeline slipped because procurement was slow.', 'team-meet');
  n('I think the model they showed us was mostly smoke and mirrors.', 'sales');
  n('Picture this, you close the quarter two weeks early.', 'sales');
  n('My graph theory professor was terrifying.', 'technical-interview');
  n('Tell me about a time you disagreed with your manager.', 'recruiting');
  n("What's your notice period?", 'recruiting');
  n('The flight got in late so I missed the first chart review.', 'general');
  n('Could you repeat the last four digits of your card?', 'call-center');
  n('He sketched it on a napkin back in 2019 and that became the product.', 'general');
  n("Let's not go down that path, the tree of dependencies is a nightmare.", 'team-meet', { b: true });
  n('Design a pitch for the investor meeting next week.', 'general');
  n('Is the table in the corner conference room booked?', 'team-meet');
  n('What is a binary search tree used for?', 'technical-interview', { b: true });
  n('In the previous lecture we saw a diagram of the Krebs cycle.', 'lecture');
  n('Our pipeline is looking healthy for Q4.', 'sales');
  n('I mapped out my whole career plan and then got laid off.', 'looking-for-work');
  n('The big picture here is that churn is down.', 'team-meet');
  n('Your account shows two charges on the fourteenth.', 'call-center');
  n('Okay, sounds good, talk soon.', 'general');
  n('They charted a new course after the merger.', 'general');
  n('How many years of experience do you have with Kubernetes?', 'recruiting');
  n("I'd like to schedule a follow-up for next Tuesday.", 'sales');
  n('Can you send me the invoice again?', 'call-center');
  n('Does the diagram you emailed include the new warehouse?', 'custom');
  n('The graph on slide six is wrong, by the way.', 'team-meet');
  n('It might help to have a diagram at some point.', 'team-meet', { b: true });
  n('Somebody should really draw this up before the board meeting.', 'team-meet', { b: true });
}

// ───────────────────────── 2. No artifact — MUST draw ─────────────────────────
{
  const y = add('2', 'none', 'draw');
  y('Draw the login flow for a mobile banking app.', 'general');
  y('Can you sketch the architecture of a hospital paging system?', 'technical-interview');
  y('Design a rate limiter for a public API.', 'technical-interview');
  y('Design Dropbox.', 'technical-interview');
  y('Timeline of the Apollo program', 'lecture');
  y("I'd like a bar chart of headcount by department: engineering 42, sales 18, support 11.", 'team-meet');
  y('Would you mind putting together a comparison table of the three vendors?', 'sales');
  y("Let's map out the customer onboarding journey as a flowchart.", 'sales');
  y('Show me an ER diagram for a library lending system.', 'general');
  y('Give me a sequence diagram of how the OAuth authorization code flow works.', 'technical-interview');
  y('Plot revenue growing at five percent a month from twenty thousand over a year.', 'sales');
  y('Could you visualize the hiring funnel from applied to offer?', 'recruiting');
  y('Please diagram the escalation path for a billing dispute.', 'call-center');
  y('Mind map of the causes of the First World War', 'lecture');
  y('Class diagram for a parking garage system', 'technical-interview');
  y('Make me a Gantt chart for the six week migration plan.', 'team-meet');
  y('Can we get a state diagram for the ticket lifecycle?', 'call-center');
  y('Draw a DFA that accepts binary strings ending in 01.', 'lecture');
  y('Illustrate how a TCP handshake works with a diagram.', 'lecture');
  y('I need a pie chart showing market share: us 30, Acme 45, others 25.', 'sales');
  y('Design a real-time chat system like Slack.', 'technical-interview');
  y('Sketch out the data model for a gym membership app.', 'general');
  y('Lay out the deployment pipeline as a diagram.', 'team-meet');
  y('Could I see a flowchart of the refund process?', 'call-center');
  y('Org chart for a twelve person startup', 'general');
  y('Walk me through the architecture with a diagram.', 'technical-interview', { b: true });
  y('Design a distributed job scheduler.', 'technical-interview');
  y('Chart the break-even point if fixed costs are 50k and margin is 20 dollars a unit.', 'sales');
  y("Let's draw up the dependency graph for the release.", 'team-meet');
  y('Can you show the photosynthesis process as a diagram?', 'lecture');
  y('Architecture diagram for a multi-tenant SaaS billing platform', 'general');
  y('I want a line graph of weekly signups: 120, 150, 170, 210.', 'team-meet');
  y('Draw me a decision tree for whether to escalate a ticket.', 'call-center');
  y('Could you put that in a table comparing Postgres and DynamoDB?', 'technical-interview');
  y("Design Twitter's news feed.", 'technical-interview');
  y('Give me a diagram of the interview process stages.', 'recruiting');
  y('Visualise the trade-offs between monolith and microservices in a table.', 'technical-interview');
  y('Would you draw the entity relationships for a hotel booking database?', 'general');
  y('Sketch a quick block diagram of how the sensor data gets to the dashboard.', 'custom');
  y('Design a key-value store.', 'technical-interview');
  y('Show me a chart of compound interest on ten thousand at seven percent for ten years.', 'general');
  y('Flowchart of the mitosis phases', 'seminar');
  y("Let's see a swimlane of who does what in the handoff from sales to success.", 'sales', { b: true });
  y('Design an API gateway for our internal services.', 'custom');
  y('How about a diagram showing how the cache sits in front of the database?', 'general', { b: true });
}

// ───────────────────────── 3. Architecture in focus — unrelated ─────────────────────────
{
  const u = add('3', 'arch', 'noclaim');
  u('Can everyone see my screen okay?', 'team-meet', { b: true });
  u("Let's take a five minute break and come back.", 'team-meet');
  u('Add me to the calendar invite for Friday, please.', 'team-meet');
  u("Remove Jordan from the thread, he's moved teams.", 'team-meet');
  u("What's your salary expectation for this role?", 'technical-interview');
  u("I'll be out next week, my sister is getting married.", 'team-meet');
  u('The customer service at that airline was terrible.', 'general');
  u('There was a huge queue at the coffee place this morning.', 'general');
  u('Do you have any questions for me about the team?', 'technical-interview');
  u('How long have you been at your current company?', 'technical-interview');
  u('Why did you leave your last job?', 'technical-interview');
  u("Where's the nearest pharmacy to the office?", 'general');
  u("Make it quick, I've got another call at three.", 'team-meet');
  u('Can you move the standup to ten thirty?', 'team-meet');
  u("What happens if Sam doesn't get his visa in time?", 'team-meet');
  u('Sorry, my dog is barking, give me one second.', 'technical-interview');
  u("Tell me about a project you're proud of.", 'technical-interview');
  u('We should split the bill for the team dinner.', 'team-meet');
  u('Is the budget approved for the second contractor?', 'team-meet');
  u('I think we lost Maria, her video froze.', 'team-meet');
  u('Change of plans, the client wants the demo on Monday.', 'team-meet');
  u('How would you handle a disagreement with a product manager?', 'technical-interview');
  u('Could you send me the job description after this?', 'looking-for-work');
  u("Let's connect on LinkedIn afterwards.", 'looking-for-work');
  u("Who's taking notes today?", 'team-meet');
  u('Scale of one to ten, how confident are you in the estimate?', 'team-meet');
  u("What's the bottleneck in the hiring process right now?", 'team-meet');
  u('My appointment with the dentist got moved again.', 'general');
  u('Can you replace the batteries in the conference room clicker?', 'team-meet');
  u('I have to drop off in ten minutes.', 'team-meet');
  u('Good question, let me think about that for a second.', 'technical-interview');
  u("What's the weather like in Toronto this week?", 'general');
  u('Does the role include equity?', 'looking-for-work');
  u('Put Dana between me and Alex in the seating plan.', 'general');
  u('Why do we need a second interview round?', 'recruiting');
  u('The database team is hiring, by the way.', 'team-meet');
  u('What if we pushed the offer deadline to Friday?', 'recruiting');
  u("Okay, let's move on to the behavioural questions.", 'technical-interview');
  u('Add a reminder for me to email finance.', 'team-meet', { b: true });
  u('How many people are on the platform team?', 'technical-interview');
  u('Is lunch being delivered or are we going out?', 'team-meet');
  u('Thanks, that was a really clear walkthrough.', 'technical-interview');
  u("Remove the last item from the agenda, we're out of time.", 'team-meet');
  u("What's the difference between a staff and a principal engineer here?", 'technical-interview');
}

// ───────────────────────── 4. Architecture in focus — follow-ups ─────────────────────────
{
  const f = add('4', 'arch', 'claim', { mode: 'technical-interview' });
  f('Add a cache in front of the scheduling database.', '', { op: 'update' });
  f('Put a load balancer before the API gateway.', '', { op: 'update' });
  f('Remove the reminder queue.', '', { op: 'update' });
  f('Replace the media relay cluster with a managed WebRTC service.', '', { op: 'update' });
  f('Can you add a read replica for the scheduling database?', '', { op: 'update' });
  f("Let's split the appointment service into booking and availability.", 'team-meet', { op: 'update' });
  f('Rename the pharmacy gateway to e-prescribing gateway.', '', { op: 'update' });
  f('Connect the video session service to the reminder queue.', '', { op: 'update' });
  f('Add an audit log store that the appointment service writes to.', '', { op: 'update' });
  f("Drop the pharmacy gateway, we don't need it for the MVP.", 'team-meet', { op: 'update' });
  f('Make the API gateway talk to an auth service first.', '', { op: 'update' });
  f("I'd like a CDN in front of the patient app.", '', { op: 'update' });
  f('Add rate limiting at the gateway.', '', { op: 'update' });
  f('Could you put a message broker between the appointment service and the video session service?', '', { op: 'update' });
  f('Swap the scheduling database for DynamoDB.', '', { op: 'update' });
  f('Now add a clinician app next to the patient app.', 'general', { op: 'update' });
  f("Let's add monitoring to it.", 'team-meet', { op: 'update' });
  f('Get rid of the queue and call the SMS provider directly.', '', { op: 'update' });
  f('Make the database multi-region.', '', { op: 'update' });
  f('Why do we need the reminder queue?', '', { op: 'explain' });
  f("Where's the bottleneck in this design?", '', { op: 'explain' });
  f('What happens if the scheduling database goes down?', '', { op: 'explain' });
  f('How does the video session service find a relay?', '', { op: 'explain' });
  f('What does the API gateway do here?', 'general', { op: 'explain' });
  f('Is the media relay cluster a single point of failure?', '', { op: 'explain' });
  f('Walk me through what happens when a patient books a slot.', '', { op: 'explain', b: true });
  f('Why is the appointment service talking directly to the database?', '', { op: 'explain' });
  f('Which component would fall over first under load?', '', { op: 'explain' });
  f('How would this scale to ten million patients?', '', { op: 'explain', b: true });
  f('Explain the role of the pharmacy gateway.', '', { op: 'explain' });
  f("What's the reminder queue for?", 'team-meet', { op: 'explain' });
  f('Can you explain why the gateway sits in front of both services?', '', { op: 'explain' });
  f('How does the data flow from the patient app to the database?', '', { op: 'explain' });
  f('What if the queue backs up?', '', { op: 'explain' });
  f('Does the patient app talk to the video service directly?', '', { op: 'explain' });
  f('Show me the sequence diagram for booking an appointment.', '', { op: 'create' });
  f('Can you give me the data model for this?', '', { op: 'create' });
  f('Now draw the ER diagram for it.', '', { op: 'create' });
  f('Show this as a sequence diagram.', '', { op: 'create' });
  f("Let's see the deployment view of this architecture.", 'team-meet', { op: 'create', b: true });
  f('Give me a table of the components and their responsibilities.', '', { op: 'create' });
  f('Draw the failure path when the pharmacy gateway times out as a sequence.', '', { op: 'create' });
  f('Can I see the database schema for the scheduling database?', '', { op: 'create' });
}

// ───────────────────────── 5. Chart in focus ─────────────────────────
{
  const u = add('5a', 'chart', 'noclaim');
  u('My number is 415 555 0132 if we get cut off.', 'sales');
  u("We're at 221 Baker Street, third floor.", 'general');
  u('The contract is for 36 months at 4,000 dollars a month.', 'sales');
  u('I can do Tuesday the 14th at 3 pm.', 'sales');
  u("She's been with us for 18 months.", 'team-meet');
  u('Our churn was 3 percent last quarter.', 'sales');
  u('The invoice came to 12,500 dollars.', 'call-center');
  u('Give me five minutes, I need to grab a charger.', 'team-meet');
  u("Make it 3 o'clock instead, I have a conflict.", 'team-meet');
  u('There are 24 people on the call.', 'team-meet');
  u('We raised a 12 million dollar series A in March.', 'sales');
  u('Call me back on extension 4402.', 'call-center');
  u("What's 15 percent of 80?", 'general', { b: true });
  u('The flight is 6 hours and lands at 9:40.', 'general');
  u('He scored 92 on the assessment.', 'recruiting');
  u('Can you do 20 percent off if we sign this week?', 'sales');
  u('Our office is at 1600 Pine Avenue, suite 300.', 'sales');
  u('The order number is 7 7 4 1 9 0.', 'call-center');
  u("I'm two weeks into the role.", 'looking-for-work');
  u('We need three more engineers by January.', 'team-meet');
  u('Twenty four hours is the SLA for a reply.', 'call-center');
  u('Change the meeting to the 9th, please.', 'team-meet');
  u('Bump my salary ask to 140k.', 'looking-for-work', { b: true });
  u("It's a 10 minute walk from the station.", 'general');
  u('The policy number ends in 0 4 8.', 'call-center');
  u('Over 18 months we hired forty people.', 'team-meet');

  const f = add('5b', 'chart', 'claim', { mode: 'sales' });
  f('Make it 5 percent instead.', '', { op: 'update' });
  f('What if growth is six percent a month?', '', { op: 'update', opB: true });
  f('Extend it to thirty six months.', '', { op: 'update' });
  f('Start from fifteen thousand instead of twelve and a half.', '', { op: 'update' });
  f('Show it over three years.', 'team-meet', { op: 'update' });
  f('Change the rate to two point five percent.', '', { op: 'update' });
  f('Where does it cross twenty thousand?', '', { op: 'explain' });
  f("What's the value at month twelve?", 'general', { op: 'explain' });
  f('Why does the curve get steeper toward the end?', 'general', { op: 'explain' });
  f('Can you make this a bar chart instead?', '', { op: 'update', opB: true });
  f('Do it quarterly instead of monthly.', 'team-meet', { op: 'update' });
  f('Drop the rate to three percent.', '', { op: 'update' });
  f('What does it look like at 2%?', '', { op: 'update', opB: true });
  f('Run it for twelve months only.', '', { op: 'update' });
  f('How long until it doubles?', 'general', { op: 'explain' });
  f('Set the baseline to 20,000.', '', { op: 'update' });
  f('Add a second line at seven percent for the optimistic case.', '', { op: 'update' });
  f('Explain how you got the final number.', 'team-meet', { op: 'explain' });
  f('Now with eight percent.', '', { op: 'update', b: true });
  f('Shorten the horizon to a year and a half.', '', { op: 'update' });
  f("What's the total growth over the whole period?", '', { op: 'explain' });
  f('Put this in a table month by month.', 'team-meet', { op: 'create' });
  f('Bump it up to four and a half percent.', '', { op: 'update' });
  f('Rename the chart to patient visits forecast.', 'general', { op: 'update' });
}

// ───────────────────────── 6. ER diagram in focus ─────────────────────────
{
  const u = add('6a', 'er', 'noclaim');
  u("What's your relationship with the hiring manager like?", 'recruiting');
  u('Add Sarah to the patient advisory panel invite.', 'team-meet');
  u("I have a doctor's appointment at four so I'll drop early.", 'team-meet');
  u("The key takeaway from yesterday was that we're behind.", 'team-meet');
  u('Many of our clinicians are complaining about the login.', 'team-meet');
  u('Does your insurance policy cover dental?', 'general', { b: true });
  u("Let's table this until Monday.", 'team-meet');
  u('Remove me from the on-call rotation for December.', 'team-meet');
  u('Why did the last DBA quit?', 'team-meet');
  u("Who's got the primary on-call this week?", 'team-meet');
  u('How many patients did the pilot clinic see in June?', 'team-meet', { b: true });
  u('Can you link me the doc after the call?', 'team-meet');
  u('Too many people have edit access to the wiki.', 'team-meet');
  u('My prescription ran out so I need to step away to call the pharmacy.', 'general');
  u('Is this being recorded?', 'technical-interview');
  u("What's the status of the hiring req?", 'recruiting');
  u('Rename the Slack channel to something shorter.', 'team-meet');
  u("I'll join the two of you after lunch.", 'team-meet');
  u('We should drop the Thursday sync.', 'team-meet');
  u('How do you feel about relocating?', 'technical-interview');
  u('Foreign nationals need a different contract template.', 'recruiting');
  u('Could you index the meeting notes somewhere searchable?', 'team-meet', { b: true });

  const f = add('6b', 'er', 'claim', { mode: 'technical-interview' });
  f('Add a pharmacy entity that prescriptions are sent to.', '', { op: 'update' });
  f('Why is insurance policy separate from patient?', '', { op: 'explain' });
  f('Add an email column to patient.', '', { op: 'update' });
  f('Make appointment to prescription one to many.', '', { op: 'update' });
  f("What's the foreign key on prescription?", '', { op: 'explain' });
  f('Remove the insurance policy table.', '', { op: 'update' });
  f('Can a clinician have many appointments?', '', { op: 'explain' });
  f('Add a clinic entity and link clinicians to it.', 'general', { op: 'update' });
  f('Rename full name to display name on clinician.', '', { op: 'update' });
  f('How would you index the appointment table?', '', { op: 'explain' });
  f('Why does appointment have both patient id and clinician id?', '', { op: 'explain' });
  f('Add a created at timestamp to every table.', 'team-meet', { op: 'update' });
  f('Show me the SQL for these tables.', '', { op: 'create', b: true });
  f('Is this normalized?', '', { op: 'explain' });
  f('Split dosage into amount and unit.', '', { op: 'update' });
  f('Where would you store the visit notes?', '', { op: 'explain', opB: true });
  f('Add a many to many between patient and clinician for care teams.', '', { op: 'update' });
  f('Draw the architecture that would sit on top of this schema.', '', { op: 'create' });
  f("What's the cardinality between patient and insurance policy?", 'general', { op: 'explain' });
  f('Drop the status field from appointment.', '', { op: 'update' });
  f("Let's add a billing invoice entity tied to the appointment.", 'team-meet', { op: 'update' });
  f('Explain the relationship between appointment and prescription.', '', { op: 'explain' });
}

// ───────────────────────── 7. Sequence diagram in focus ─────────────────────────
{
  const u = add('7a', 'seq', 'noclaim');
  u("What's the sequence of interviews after this one?", 'looking-for-work');
  u('Did you get my message about the offsite?', 'team-meet');
  u("I'll call you back after lunch.", 'sales');
  u('Please respond to the recruiter by Friday.', 'looking-for-work');
  u("Who's the next participant in the round robin?", 'team-meet', { b: true });
  u('Wait, before we go on, is everyone back from the break?', 'team-meet');
  u('The request for more headcount got denied.', 'team-meet');
  u('My app keeps crashing on the train, sorry.', 'general');
  u('Can you step me through your resume?', 'recruiting');
  u('Add a step to the onboarding checklist for badge pickup.', 'team-meet', { b: true });
  u('What happens if the candidate declines?', 'recruiting');
  u('Send the offer letter before the end of the day.', 'recruiting');
  u('The patient in room four has been waiting an hour.', 'general');
  u('Timeout, can we go back to the salary question?', 'looking-for-work');
  u("We'll retry the vendor call tomorrow.", 'team-meet');
  u('Why is the wifi so slow in this building?', 'general');
  u('Is there an order to who speaks in the panel?', 'seminar');
  u("Let's lock the date for the launch party.", 'team-meet');
  u('He returned my call after two days.', 'sales');
  u('How do I book the big conference room?', 'team-meet');
  u('First we do intros, then the coding round, then lunch.', 'technical-interview');
  u('Could you confirm your date of birth for me?', 'call-center');

  const f = add('7b', 'seq', 'claim', { mode: 'technical-interview' });
  f('Add a step where the appointment service checks the availability cache first.', '', { op: 'update' });
  f('What happens if the slot is already locked?', '', { op: 'explain' });
  f('Why does the appointment service lock the row before inserting?', '', { op: 'explain' });
  f('Add the reminder queue as a fifth participant.', '', { op: 'update' });
  f('Show the failure case where the database times out.', '', { op: 'update', opB: true });
  f('Remove the lock slot message.', '', { op: 'update' });
  f('Insert an auth check between the gateway and the appointment service.', '', { op: 'update' });
  f('What does the gateway return if the insert fails?', '', { op: 'explain' });
  f('Rename booking confirmed to reservation confirmed.', 'general', { op: 'update' });
  f('Can you add a retry loop around the insert?', '', { op: 'update' });
  f('Is the lock released after the insert?', '', { op: 'explain' });
  f('Turn this into a flowchart.', 'general', { op: 'create' });
  f('Show me the architecture behind this sequence.', '', { op: 'create' });
  f('Explain the third message.', '', { op: 'explain' });
  f('Make the call from the gateway to the appointment service asynchronous.', '', { op: 'update' });
  f('Where could a race condition happen here?', '', { op: 'explain' });
  f('Add a payment service that gets called after the insert.', 'team-meet', { op: 'update' });
  f('Who initiates the request?', '', { op: 'explain' });
  f('Swap the order of the lock and the insert.', '', { op: 'update' });
  f('Add an alt branch for when the slot is taken.', '', { op: 'update' });
  f('How long does the lock get held for?', '', { op: 'explain' });
  f("Put a note over the scheduling database saying it's the source of truth.", '', { op: 'update' });
}

// ───────────────────────── 8. Background architecture ─────────────────────────
{
  const u = add('8a', 'bg', 'noclaim', { mode: 'technical-interview' });
  u('Add a cache.', '');
  u("What's the difference between SQL and NoSQL databases?", '');
  u('How does a message queue work in general?', '');
  u("Let's move on to the behavioural part.", '');
  u('Why do people use Redis?', '');
  u('Tell me about your last project.', '');
  u('What is an API gateway?', '', { b: true });
  u('Add a new hire to the team channel.', 'team-meet');
  u('Is a load balancer the same as a reverse proxy?', '');
  u('Can you explain what sharding is?', '');
  u('Remove a meeting from my calendar.', 'team-meet');
  u('How do you usually handle database migrations?', '');
  u('What are the trade-offs of microservices?', '');
  u('Which services are you most comfortable with on AWS?', '');
  u('When did you last work with video streaming?', '');
  u('Make it shorter next time, the intro ran long.', 'team-meet');
  u("Where's the bottleneck in our hiring?", 'team-meet');
  u("Add queues to the list of topics for Thursday's study group.", 'general');
  u('How would you design a cache eviction policy?', '', { b: true });
  u('What happens when a database runs out of connections?', '');
  u('We use a queue for that at my current job.', '');
  u('Why is it slow?', 'general');
  u('Can we scale the team to ten by Q2?', 'team-meet');

  const f = add('8b', 'bg', 'claim', { mode: 'technical-interview' });
  f('Go back to the diagram and add a cache.', '', { op: 'update' });
  f('In the architecture, why is there a reminder queue?', '', { op: 'explain' });
  f('Add a replica to the scheduling database.', '', { op: 'update' });
  f('What does the media relay cluster do again?', '', { op: 'explain' });
  f('On the diagram, remove the pharmacy gateway.', '', { op: 'update' });
  f("Back to the architecture — where's the bottleneck?", '', { op: 'explain' });
  f('Can you update the architecture to include an auth service?', '', { op: 'update' });
  f('Why does the video session service need the gateway?', '', { op: 'explain' });
  f('Put a load balancer in front of the API gateway.', '', { op: 'update' });
  f('In that design, add a cache in front of the database.', '', { op: 'update' });
  f("Let's revisit the system diagram and split the appointment service.", 'team-meet', { op: 'update' });
  f('The reminder queue should feed an SMS worker, add that.', '', { op: 'update' });
  f('About the architecture from before, what happens if the database fails?', '', { op: 'explain' });
  f('Rename the patient app to patient portal.', 'general', { op: 'update' });
  f('In the diagram, connect the appointment service to the pharmacy gateway.', '', { op: 'update' });
  f('Is the scheduling database a single point of failure?', '', { op: 'explain' });
  f('Add monitoring to the architecture.', 'team-meet', { op: 'update' });
  f('Show the architecture again but as a sequence for booking.', '', { op: 'create' });
  f('Going back to the design we drew, drop the queue.', '', { op: 'update' });
  f('How does the pharmacy gateway get called?', '', { op: 'explain' });
  f('The diagram is missing a CDN, add one.', '', { op: 'update' });
  f('Scale out the media relay cluster to three regions.', '', { op: 'update' });
}

// ───────────────────────── 9. Coding route, architecture in focus ─────────────────────────
{
  const u = add('9a', 'arch', 'noclaim', { mode: 'technical-interview', extra: { coding: true } });
  u('Write a function to reverse a linked list.', '');
  u('How would you implement an LRU cache in Python?', '');
  u("What's the time complexity of quicksort?", '');
  u('Implement a queue using two stacks.', '');
  u('Write a SQL query to find the second highest salary.', '');
  u('Can you debounce this function in JavaScript?', '');
  u('Fix the off-by-one error in this loop.', '');
  u('Add a null check to the function.', '');
  u('Remove the duplicate elements from a sorted array.', '');
  u('How do I merge two sorted lists?', '');
  u('Write a rate limiter class using a token bucket.', '');
  u('What does this regex do?', '');
  u('Add a retry decorator in Python.', '');
  u('Replace the for loop with a list comprehension.', '');
  u('Why is my recursion hitting a stack overflow?', '');
  u('Implement binary search iteratively.', '');
  u('Can you write unit tests for the parser?', '');
  u('Rename the variable to something more descriptive.', '');
  u('How do you detect a cycle in a linked list?', '');
  u('Write a thread-safe singleton in Java.', '');
  u('Add a method to the class that returns the max.', '');
  u("What's the difference between a mutex and a semaphore?", '');
  u('Implement a trie with insert and search.', '');
  u('Make it run in O(n) instead of O(n squared).', '');
  u('Write the database connection pool in Go.', '', { b: true });
  u('Split the string on commas and trim each part.', '');

  const f = add('9b', 'arch', 'claim', { mode: 'technical-interview', extra: { coding: true, op: 'update' } });
  f('Add a cache in front of the scheduling database.', '');
  f('Remove the reminder queue from the design.', '');
  f('Put a load balancer in front of the API gateway.', '');
  f('Replace the media relay cluster with a third-party SFU.', '');
  f('Split the appointment service into two services.', '');
  f('Connect the video session service to the scheduling database.', '');
  f('Rename the pharmacy gateway to prescription gateway.', '');
  f('Add a dead letter queue behind the reminder queue.', '');
  f('Move the patient app behind a CDN.', '');
  f('Add a read replica to the scheduling database.', '');
  f('Drop the video session service and call the media relay cluster directly from the gateway.', '');
  f('Insert an auth service between the API gateway and the appointment service.', '');
  f('Make the appointment service publish to the reminder queue asynchronously.', '');
  f('Add a second pharmacy gateway for failover.', '');
  f('Swap the scheduling database for a Postgres cluster.', '');
}

// ───────────────────────── 10. Unasked visuals ─────────────────────────
{
  const y = add('10a', 'none', 'draw');
  y('Walk me through the steps to get from a signed contract to go-live.', 'sales');
  y('Compare the Starter, Growth and Enterprise plans on price, seats and support.', 'sales');
  y('Where are we losing people in the funnel between demo and close?', 'sales');
  y('When do we break even if we spend 40k on the campaign and each deal is worth 5k?', 'sales');
  y("What's blocking what on the release right now?", 'team-meet');
  y('Lay out the stages of the rollout from canary to full.', 'team-meet');
  y('Give me the order of dependencies between the API, the mobile build and the data migration.', 'team-meet');
  y("What are the steps to reset a customer's two-factor device?", 'call-center');
  y('Walk me through the escalation stages for a chargeback.', 'call-center');
  y('Lay out the stages of our interview process from screen to offer.', 'recruiting');
  y('Compare the three finalists on experience, system design and communication.', 'recruiting', { b: true });
  y('Where in the pipeline are candidates dropping out?', 'recruiting');
  y('Compare Postgres, MySQL and SQLite across concurrency, setup and scale.', 'general');
  y('What are the steps to file a provisional patent?', 'general', { b: true });
  y('Map the buying process: who signs off at each stage, from champion to procurement.', 'sales');
  y('Which tasks depend on which for the Q3 launch?', 'team-meet');
  y('How does our pricing stack up against Acme and Globex on the three tiers?', 'sales', { b: true });
  y('Take me through the stages a refund goes through before it hits the card.', 'call-center');
  y('Break the project into phases with what comes before what.', 'team-meet');
  y('Outline the stages of a clinical trial.', 'general', { b: true });
  y('At what volume does the annual plan beat the monthly one?', 'sales', { b: true });
  y('What are the steps from accepted offer to day one?', 'recruiting');
  y('Compare option A, option B and option C on cost, risk and time.', 'team-meet');
  y('Which stage of the funnel has the biggest drop-off: lead, MQL, SQL or closed?', 'sales');

  const n = add('10b', 'none', 'nodraw');
  n("What's the price of the Growth plan?", 'sales');
  n('Who owns the rollout plan?', 'team-meet');
  n('Why is the release late?', 'team-meet');
  n("What's our break-even number again?", 'sales');
  n('Which stage is the candidate in?', 'recruiting');
  n("What's the refund policy?", 'call-center');
  n('The funnel looked better last quarter.', 'sales');
  n('The migration is blocked, right?', 'team-meet');
  n('Walk me through the steps of glycolysis.', 'lecture');
  n('Compare mitosis and meiosis across phases, outcomes and purpose.', 'lecture');
  n("What are the stages of Kohlberg's moral development?", 'seminar');
  n('Lay out the steps of the scientific method.', 'seminar', { b: true });
  n('How many seats are on the Enterprise plan?', 'sales');
  n("Who's interviewing the finalist tomorrow?", 'recruiting');
  n('Is the escalation team open on weekends?', 'call-center');
  n("When's the next step due?", 'team-meet');
  n("What's the first step?", 'general');
  n('Did the comparison deck go out to the client?', 'sales');
  n('The dependency on legal is annoying.', 'team-meet');
  n('How long does our process usually take?', 'recruiting');
  n('Which step did the customer get stuck on?', 'call-center');
  n('What blocks what in the regulation of the citric acid cycle?', 'seminar');
  n('Why is Postgres better than MySQL?', 'general');
  n('What stage is the Acme deal at?', 'sales');
  n("Who's blocked today?", 'team-meet');
}

// ───────────────────────── 11. Speech-to-text style ─────────────────────────
{
  const s = (ctx, expect, q, mode, extra = {}) => R.push({ list: '11', ctx, expect, q, mode, ...extra });
  // no artifact, must draw
  s('none', 'draw', 'um can you like draw the the login flow for me', 'general');
  s('none', 'draw', 'so yeah could you uh sketch out the architecture for a a food bank inventory system', 'technical-interview');
  s('none', 'draw', 'okay so design um design a rate limiter', 'technical-interview');
  s('none', 'draw', 'id like a a bar chart of of tickets by team support twelve billing nine onboarding four', 'team-meet');
  s('none', 'draw', 'timeline of uh the the roman empire', 'lecture');
  s('none', 'draw', 'lets lets map out the escalation flow as a diagram yeah', 'call-center');
  s('none', 'draw', 'can you can you show me an er diagram for like a library system', 'general');
  s('none', 'draw', 'would you mind um putting that in a table comparing the two vendors', 'sales');
  // no artifact, must not draw
  s('none', 'nodraw', 'yeah we we gotta draw the line somewhere you know', 'sales');
  s('none', 'nodraw', 'uh the chart she showed was was kinda confusing honestly', 'team-meet');
  s('none', 'nodraw', 'so i i drew a blank on that one sorry', 'looking-for-work');
  s('none', 'nodraw', 'lets table that um until until thursday', 'team-meet');
  s('none', 'nodraw', 'hes like the architect of the whole deal right', 'sales');
  s('none', 'nodraw', 'whats your uh whats your notice period', 'recruiting');
  s('none', 'nodraw', 'i dont know i think the the diagram in the book was wrong', 'lecture');
  s('none', 'nodraw', 'mm hmm yeah okay sounds good', 'general');
  // architecture in focus, follow-ups
  s('arch', 'claim', 'um add a a cache in front of the the scheduling database', 'technical-interview', { op: 'update' });
  s('arch', 'claim', 'wait why do we why do we need the reminder queue', 'technical-interview', { op: 'explain' });
  s('arch', 'claim', 'so wheres the bottleneck here', 'technical-interview', { op: 'explain' });
  s('arch', 'claim', 'okay now uh remove the the pharmacy gateway', 'technical-interview', { op: 'update' });
  s('arch', 'claim', 'what happens if um the database goes down', 'technical-interview', { op: 'explain' });
  s('arch', 'claim', 'can you can you show me the sequence for for booking', 'technical-interview', { op: 'create' });
  s('arch', 'claim', 'lets uh lets put a load balancer in front of the gateway', 'team-meet', { op: 'update' });
  s('arch', 'claim', 'and and whats the media relay cluster doing exactly', 'technical-interview', { op: 'explain' });
  // architecture in focus, unrelated
  s('arch', 'noclaim', 'sorry um my my dog is barking one sec', 'technical-interview');
  s('arch', 'noclaim', 'so uh whats your salary expectation', 'technical-interview');
  s('arch', 'noclaim', 'can you um add me to the the invite for friday', 'team-meet');
  s('arch', 'noclaim', 'yeah lets lets take five and come back', 'team-meet');
  s('arch', 'noclaim', 'why did you why did you leave your last job', 'technical-interview');
  s('arch', 'noclaim', 'uh make it quick ive got a hard stop at three', 'team-meet');
  // chart in focus, follow-ups
  s('chart', 'claim', 'um make it make it five percent', 'sales', { op: 'update' });
  s('chart', 'claim', 'what if its uh six percent a month', 'sales', { op: 'update', opB: true });
  s('chart', 'claim', 'okay extend it to to thirty six months', 'sales', { op: 'update' });
  s('chart', 'claim', 'so where does it cross like twenty thousand', 'sales', { op: 'explain' });
  s('chart', 'claim', 'start from uh fifteen thousand instead', 'sales', { op: 'update' });
  // chart in focus, unrelated
  s('chart', 'noclaim', 'my number is uh four one five five five five oh one three two', 'sales');
  s('chart', 'noclaim', 'uh make it three oclock instead i i have a conflict', 'team-meet');
  s('chart', 'noclaim', 'so the contract is is thirty six months at four thousand a month', 'sales');
  s('chart', 'noclaim', 'were at um two twenty one baker street third floor', 'general');
  // ER in focus
  s('er', 'claim', 'add a um an email column to to patient', 'technical-interview', { op: 'update' });
  s('er', 'claim', 'why is why is insurance policy its own table', 'technical-interview', { op: 'explain' });
  s('er', 'noclaim', 'i have a a doctors appointment at four so ill drop early', 'team-meet');
  // sequence in focus
  s('seq', 'claim', 'what happens if the the slot is already locked', 'technical-interview', { op: 'explain' });
  s('seq', 'claim', 'uh add a step where it it checks the cache first', 'technical-interview', { op: 'update' });
  s('seq', 'noclaim', 'did you did you get my message about the offsite', 'team-meet');
  // background architecture
  s('bg', 'claim', 'um going back to the diagram can you add a cache', 'technical-interview', { op: 'update' });
  s('bg', 'noclaim', 'so uh whats the difference between sql and nosql', 'technical-interview');
  s('bg', 'claim', 'the the scheduling database is that a single point of failure', 'technical-interview', { op: 'explain' });
  // coding route, architecture in focus
  s('arch', 'noclaim', 'uh write a function to to reverse a linked list', 'technical-interview', { coding: true });
  s('arch', 'claim', 'okay um add a read replica to the scheduling database', 'technical-interview', { coding: true, op: 'update' });
  // unasked
  s('none', 'draw', 'so um walk me through the the steps from signed contract to go live', 'sales');
  s('none', 'nodraw', 'uh whats the price of the growth plan again', 'sales');
  s('none', 'draw', 'whats whats blocking what on the release', 'team-meet');
  s('none', 'nodraw', 'walk me through the uh the steps of glycolysis', 'lecture');
}

export const ROWS = R.map((r, i) => ({ id: i + 1, ...r }));
