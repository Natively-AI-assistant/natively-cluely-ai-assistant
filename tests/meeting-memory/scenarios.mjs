// tests/meeting-memory/scenarios.mjs
//
// Fixed scripts for the live meeting-memory harness (live-memory-harness.mjs).
// Kept separate and deterministic so a post-fix run is comparable, turn for
// turn, with the baseline it is measured against.
//
// Every planted fact is unguessable (codenames, odd figures, rare names) so a
// correct recall can only come from memory, and none of them ever appears in
// the injected meeting transcript — otherwise transcript retrieval would mask
// a conversation-history loss.

/** Typed-chat recall. Each fact is probed exactly once, at a chosen distance
 *  (turns between plant and probe), so one run yields a recall-vs-distance
 *  curve without a probe answer re-planting a fact another probe asks about. */
export const TYPED_CHAT_FACTS = {
  codename: { re: /velvet[\s-]?kestrel/i, label: 'project codename VELVET-KESTREL' },
  budget: { re: /83[,.\s]?700/, label: 'budget ceiling $83,700' },
  signer: { re: /odalys/i, label: 'signer Odalys Brennan-Achebe' },
  site: { re: /\bq[\s-]?47\b/i, label: 'pilot site bay Q-47' },
  golive: { re: /(14(th)?\s+(of\s+)?nov)|(nov\w*\s+14)/i, label: 'go-live 14 November (placed past char 280)' },
};

const LONG_PREAMBLE = 'Okay so a bit more background before the next part of the call, because I think it matters for how '
  + 'we frame the rollout plan: they have been burned twice by vendors who promised a smooth migration and then missed '
  + 'every milestone, their ops lead is skeptical of anything that sounds like a big-bang cutover, and they care a lot '
  + 'about seeing a phased plan with clear owners.';

export const TYPED_CHAT_SCRIPT = [
  { kind: 'plant', fact: 'codename', text: "Quick context for this call: the client's internal project codename is VELVET-KESTREL. Can you give me a friendly opening line to start the call?" },
  { kind: 'plant', fact: 'budget', text: 'Also, their budget ceiling for this quarter is $83,700. How should I position our premium tier given that?' },
  { kind: 'filler', text: 'What are three good discovery questions to ask a new client early in a call?' },
  { kind: 'plant', fact: 'signer', text: 'The person who signs off on the deal is Odalys Brennan-Achebe. What should I send her right after this call?' },
  { kind: 'plant', fact: 'site', text: 'They want the pilot to run at warehouse bay Q-47 first. What risks should I flag for a warehouse pilot?' },
  { kind: 'filler', text: "Give me a one-line way to handle 'we need to think about it'." },
  { kind: 'probe', fact: 'site', text: 'Which warehouse bay did I say the pilot will run at?' },
  { kind: 'plant', fact: 'golive', text: `${LONG_PREAMBLE} Their hard go-live deadline is 14 November. How should I present a phased rollout that respects that?` },
  { kind: 'filler', text: 'How do I politely steer the conversation back on topic when it drifts?' },
  { kind: 'probe', fact: 'signer', text: 'Remind me, who signs off on the deal?' },
  { kind: 'probe', fact: 'budget', text: 'What budget ceiling did I tell you they have this quarter?' },
  { kind: 'probe', fact: 'golive', text: 'What is their hard go-live deadline?' },
  { kind: 'probe', fact: 'codename', text: "What was the client's internal project codename I mentioned at the start?" },
];

/** An hour of overlay chat: facts told early, ~25 ordinary asks, then recall.
 *  The 13-turn script above fits inside a 10-turn ring once the ring stops
 *  resetting; this one does not, which is the "remember 1 hour back" case. */
const LONG_FILLERS = [
  'What is a good way to open the pricing part of the conversation?',
  'How do I ask about their current tooling without sounding salesy?',
  'Give me a short way to summarize what we heard so far.',
  "How should I respond if they say a competitor is cheaper?",
  'What is a good question to uncover their timeline?',
  'How do I handle it if two stakeholders disagree on the call?',
  'Suggest a crisp way to describe our onboarding process.',
  'What should I say if they ask about data security?',
  "How do I politely move past a topic we can't solve today?",
  'Give me a one-liner to transition to the demo.',
  'What are two good questions about their success metrics?',
  "How do I respond to 'send me some information'?",
  'What is a good way to check who else should be involved?',
  'Give me a quick way to recap action items.',
  'How do I ask for a follow-up meeting without being pushy?',
  'What should I avoid saying in a first discovery call?',
  'How do I respond if they ask about integration effort?',
  'Suggest a way to acknowledge their bad vendor experience.',
  'How do I close the call on a positive note?',
  'What is a good subject line for the recap email?',
  'How do I respond if they ask for a case study?',
  'Give me a short way to explain our support model.',
  'What is a good way to confirm next steps with dates?',
  'How do I handle a question I do not know the answer to?',
];

export const TYPED_LONG_SCRIPT = [
  { kind: 'plant', fact: 'codename', text: TYPED_CHAT_SCRIPT[0].text },
  { kind: 'plant', fact: 'budget', text: TYPED_CHAT_SCRIPT[1].text },
  { kind: 'plant', fact: 'signer', text: TYPED_CHAT_SCRIPT[3].text },
  ...LONG_FILLERS.slice(0, 12).map((text) => ({ kind: 'filler', text })),
  { kind: 'plant', fact: 'site', text: TYPED_CHAT_SCRIPT[4].text },
  ...LONG_FILLERS.slice(12).map((text) => ({ kind: 'filler', text })),
  { kind: 'probe', fact: 'site', text: TYPED_CHAT_SCRIPT[6].text },
  { kind: 'probe', fact: 'signer', text: TYPED_CHAT_SCRIPT[9].text },
  { kind: 'probe', fact: 'budget', text: TYPED_CHAT_SCRIPT[10].text },
  { kind: 'probe', fact: 'codename', text: TYPED_CHAT_SCRIPT[12].text },
];

/** Neutral meeting chatter injected between typed turns so the meeting is
 *  live (transcript flowing, JIT indexing running) — the condition a user is in.
 *  None of it mentions any planted fact. */
export const CHATTER = [
  ['Speaker', "Sorry, can everyone hear me okay? I think my mic was muted for a second."],
  ['Speaker', "Yeah we can hear you. Let's give it one more minute for people to join."],
  ['Speaker', 'While we wait, did anyone see the notes from last week, or should I share them again?'],
  ['Speaker', 'I can share my screen in a sec, just closing a couple of tabs.'],
  ['Speaker', 'Okay, so the main thing on our side is understanding how your team works day to day.'],
  ['Speaker', "Right, and we'd like to hear more about how the onboarding usually goes for teams like ours."],
  ['Speaker', "Makes sense. Typically it's a couple of weeks of setup and then a check-in call."],
  ['Speaker', 'Got it. And who on your side usually runs those check-ins?'],
  ['Speaker', 'Usually our customer success lead, sometimes with a solutions engineer.'],
  ['Speaker', "Cool. We had a bad experience with support response times before, so that's on our mind."],
  ['Speaker', "Totally fair. Let's make sure we cover support hours before we wrap up."],
  ['Speaker', "Also, quick note, I have a hard stop at the top of the hour, so let's keep moving."],
  ['Speaker', 'Sure. Can you walk us through what reporting looks like on your end?'],
  ['Speaker', "We mostly live in spreadsheets right now, honestly, and it's getting painful."],
  ['Speaker', 'Yeah, that comes up a lot. Dashboards are usually the first thing teams ask about.'],
  ['Speaker', 'Does it integrate with the tools we already use, or is that extra work?'],
  ['Speaker', 'Most of the common ones are covered, but I want to double-check your stack.'],
  ['Speaker', "Okay. I'll send over a list after the call so you can check."],
  ['Speaker', 'Perfect, that would be helpful. Anything else on security we should know?'],
  ['Speaker', 'We have a standard questionnaire we can fill in for your security team.'],
];

/** One hour of meeting, backdated. Facts sit at minutes 2, 20 and 45. */
export const HOUR_FACTS = {
  launch: { minute: 2, re: /ninth\s+of\s+march|march\s+(9|ninth)|9(th)?\s+(of\s+)?march/i, label: 'launch date: the ninth of March (minute 2)',
    line: ["Priya", "Okay, decision time on the launch: we're locking the public launch for the ninth of March, no more slipping."],
    question: 'What launch date did we lock in at the start of the meeting?' },
  owner: { minute: 20, re: /wierzbicki|tomasz/i, label: 'vendor contract owner: Tomasz Wierzbicki (minute 20)',
    line: ['Daniel', "For the vendor contract, Tomasz Wierzbicki is going to own it end to end, he'll run point with legal."],
    question: 'Who did we say is owning the vendor contract?' },
  site: { minute: 45, re: /maasvlakte/i, label: 'pilot site: Rotterdam Maasvlakte warehouse (minute 45)',
    line: ['Priya', "And the pilot will run out of the Rotterdam Maasvlakte warehouse, they've already cleared a bay for us."],
    question: 'Where is the pilot going to run?' },
};

const HOUR_TOPICS = [
  'the hiring plan for the platform team', 'the Q3 roadmap review', 'the bug triage backlog', 'the pricing page redesign',
  'the customer advisory board', 'on-call rotation changes', 'the analytics migration', 'the partner integrations',
  'the design system cleanup', 'the support ticket trends', 'the mobile release train', 'the documentation overhaul',
];
const HOUR_TEMPLATES = [
  (t) => `Moving on to ${t}, I think we're mostly on track but there are a couple of open questions.`,
  (t) => `For ${t}, can someone give a quick status update before we go deeper?`,
  (t) => `I looked at ${t} yesterday and honestly it needs another pass before we share it wider.`,
  (t) => `On ${t}, the main blocker is still getting time from the right people.`,
  (t) => `Let's not boil the ocean on ${t}, we can pick the top two items and park the rest.`,
  (t) => `I'll take an action item to follow up on ${t} and circle back next week.`,
  (t) => `Does anyone have concerns about ${t} that we haven't talked about yet?`,
  (t) => `We discussed ${t} last time too, so let's make sure we actually close it out today.`,
];
const SPEAKERS = ['Priya', 'Daniel', 'Marcus', 'Aisha', 'Leo'];

/** ~900 segments over 60 minutes (one every 4 s), facts spliced in at their minute. */
export function buildHourTranscript(nowMs, segments = 900) {
  const start = nowMs - 60 * 60 * 1000;
  const step = (60 * 60 * 1000) / segments;
  const out = [];
  const factAt = new Map(Object.values(HOUR_FACTS).map((f) => [Math.round((f.minute * 60 * 1000) / step), f]));
  for (let i = 0; i < segments; i++) {
    const ts = Math.round(start + i * step);
    const fact = factAt.get(i);
    if (fact) { out.push({ speaker: fact.line[0], text: fact.line[1], timestamp: ts }); continue; }
    const topic = HOUR_TOPICS[Math.floor(i / 75) % HOUR_TOPICS.length];
    const tpl = HOUR_TEMPLATES[(i * 7) % HOUR_TEMPLATES.length];
    out.push({ speaker: SPEAKERS[i % SPEAKERS.length], text: tpl(topic), timestamp: ts });
  }
  return out;
}

/** What-to-answer follow-up after a real wall-clock gap (> the 90 s speech window). */
export const WTA_FOLLOWUP = {
  first: ['Interviewer', 'So, to start with a design question: how would you design a rate limiter for a public API? Walk me through the approach you would pick.'],
  second: ['Interviewer', 'Going back to the rate limiter you described a couple of minutes ago: which algorithm did you pick, and why that one over the alternatives?'],
  algorithms: /token[\s-]?bucket|leaky[\s-]?bucket|sliding[\s-]?window|fixed[\s-]?window|sliding[\s-]?log|gcra/gi,
  gapSeconds: 110,
};

/** A LIVE INTERVIEW: both channels, as STT delivers them — the user's mic
 *  ('user' → ME) and the interviewer on system audio ('interviewer').
 *  Details are said OUT LOUD 10-25 minutes before the interviewer's follow-up
 *  that silently depends on them; nothing is typed. Answered by what-to-answer
 *  with NO typed question, i.e. the Cmd+Enter flow resolving from transcript. */
export const INTERVIEW_FACTS = {
  stack: { re: /elixir/i, label: "interviewer's stack: Elixir services on one Postgres primary (min 1)" },
  latency: { re: /900|140\s*(ms|milli)/i, label: 'user said: p99 900 ms → 140 ms via gRPC at Brightline Freight (min 3)' },
  teamSize: { re: /\bfour\b|\b4\b/i, label: 'user said: team of four engineers (min 5)' },
  deploy: { re: /nomad/i, label: 'interviewer said: they deploy with Nomad, not Kubernetes (min 12)' },
};

const I = 'interviewer';
const ME = 'user';
const INTERVIEW_FILLER = [
  [I, 'Okay, let me switch gears a bit. How do you usually approach code review on your team?'],
  [ME, 'I try to keep reviews small, I ask for context in the description, and I focus on correctness first and style last.'],
  [I, 'Makes sense. What does your testing strategy usually look like for backend services?'],
  [ME, 'Mostly unit tests around the domain logic, a thinner layer of integration tests against real dependencies, and a few end to end smoke tests.'],
  [I, 'And how do you think about on-call? Have you been on a rotation before?'],
  [ME, 'Yes, weekly rotations. I care a lot about runbooks and about fixing the noisy alerts first.'],
  [I, 'Cool. Tell me about a time you disagreed with a technical decision.'],
  [ME, 'We once picked a message queue I thought was overkill. I wrote up the tradeoffs, we ran a small spike, and we ended up going with the simpler option.'],
  [I, 'Nice, that is a good example. How do you mentor junior engineers?'],
  [ME, 'Pairing a lot early on, giving them well scoped tickets, and doing a short weekly one on one to unblock them.'],
  [I, 'How do you decide when to pay down tech debt versus ship features?'],
  [ME, 'I try to tie debt to a concrete cost, like incidents or slow delivery, and then bundle it with feature work in the same area.'],
  [I, 'What is your experience with observability tooling?'],
  [ME, 'Mostly Prometheus and Grafana, plus structured logging, and tracing on the critical paths.'],
  [I, 'Alright. And how do you like to collaborate with product managers?'],
  [ME, 'Early and often. I like being in the room when the problem is framed, not just when the ticket is written.'],
];

export function buildInterviewTranscript(nowMs) {
  const at = (min) => Math.round(nowMs - (30 - min) * 60 * 1000);
  const segs = [
    { speaker: I, text: "Thanks for joining. Quick context on us: we're a twelve-person platform team, the core services are written in Elixir, and our biggest pain right now is write load on a single Postgres primary.", timestamp: at(1) },
    { speaker: ME, text: 'Great, thanks. So at my last company, Brightline Freight, I led the migration of our shipment-tracking API from REST to gRPC, and that took our p99 latency from about 900 milliseconds down to 140.', timestamp: at(3) },
    { speaker: I, text: 'Nice. And how big was the team on that?', timestamp: at(4.5) },
    { speaker: ME, text: 'It was four engineers, and I owned the rollout plan and the load testing.', timestamp: at(5) },
    { speaker: I, text: "One more thing about us, we deploy with Nomad, not Kubernetes, so keep that in mind for anything infra related.", timestamp: at(12) },
  ];
  // Ordinary interview talk fills the rest, spread from minute 6 to minute 28.
  let min = 6;
  for (let round = 0; round < 3; round++) {
    for (const [speaker, text] of INTERVIEW_FILLER) {
      if (Math.abs(min - 12) < 0.3) min += 0.4;
      segs.push({ speaker, text, timestamp: at(min) });
      min += 22 / (INTERVIEW_FILLER.length * 3);
    }
  }
  return segs.sort((a, b) => a.timestamp - b.timestamp);
}

/** The interviewer's follow-ups, asked NOW. Each depends on something said
 *  earlier and none restates it. Ordered so an earlier probe's answer is
 *  unlikely to contain a later probe's fact. */
export const INTERVIEW_PROBES = [
  { fact: 'stack', text: "Given what I told you about our setup, how would you tackle our write-load problem?" },
  { fact: 'latency', text: 'Going back to that latency project you mentioned earlier, how did you actually measure the improvement?' },
  { fact: 'deploy', text: 'And how would your rollout approach change given how we deploy?' },
  { fact: 'teamSize', text: 'How did you split the work across the team on that migration?' },
];
