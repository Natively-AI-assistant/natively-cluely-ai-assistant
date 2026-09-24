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
  // The planted phrase only: a bare "four" matched "four phases" / "four steps"
  // in answers that denied knowing the team size.
  teamSize: { re: /\b(four|4)\s+engineers\b|\bteam of (four|4)\b|\b(four|4)[- ]person\b/i, label: 'user said: team of four engineers (min 5)' },
  deploy: { re: /nomad/i, label: 'interviewer said: they deploy with Nomad, not Kubernetes (min 12)' },
  // Whose "our": the interviewer's twelve-person team, not the candidate's four
  // (three live mock interviews answered the candidate's team, 2026-09-24).
  ourTeam: { re: /\btwelve\b|\b12\b/i, label: "interviewer said: a twelve-person platform team (min 1); asked as 'did I say… our team'" },
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
  { fact: 'ourTeam', text: 'Quick check before we go on, how many people did I say are on our platform team?' },
];

/** Constraints the interviewer SETS early in a system-design round, then
 *  questions that need them without pointing back ("how would you design the
 *  retry policy?", never "given what I said…"). Values are unguessable so an
 *  answer can only carry them if the meeting reached the prompt. Measured
 *  2026-09-24 in the live mock interview: "retries for up to twenty four
 *  hours", said 2.5 minutes earlier, was in neither the speech window nor the
 *  evidence, and the retry-policy answer capped retries at "a few minutes". */
export const CONSTRAINT_FACTS = {
  retry: { re: /\b36\b|thirty[- ]six/i, label: 'retries continue for up to thirty-six hours (min 4)' },
  key: { re: /warehouse/i, label: 'ordering must hold per warehouse ID (min 4)' },
  peak: { re: /4,?200|forty[- ]two hundred|\b14\b|fourteen/i, label: 'peak 4,200 events/s (→ 14 consumers at 300/s) (min 4)' },
  retention: { re: /\b45\b|forty[- ]five|1\.35|1,?350/i, label: 'keep events 45 days at 30 million a day (min 4)' },
};

export function buildConstraintTranscript(nowMs) {
  const at = (min) => Math.round(nowMs - (30 - min) * 60 * 1000);
  const segs = [
    { speaker: I, text: "Let's do a design round. We run webhook delivery for a logistics platform: about thirty million events a day, at-least-once delivery, retries continue for up to thirty-six hours before we give up, and ordering must hold per warehouse ID.", timestamp: at(3.5) },
    { speaker: ME, text: 'Got it. What does peak look like compared to the average?', timestamp: at(4) },
    { speaker: I, text: 'Peak is about four thousand two hundred events a second, and we have to keep every event for forty-five days for audits.', timestamp: at(4.3) },
    { speaker: ME, text: 'Okay, that is plenty to start from.', timestamp: at(4.6) },
  ];
  let min = 5;
  for (let round = 0; round < 3; round++) {
    for (const [speaker, text] of INTERVIEW_FILLER) {
      segs.push({ speaker, text, timestamp: at(min) });
      min += 24 / (INTERVIEW_FILLER.length * 3);
    }
  }
  return segs.sort((a, b) => a.timestamp - b.timestamp);
}

/** Asked NOW by the interviewer, answered by what-to-answer. `control` probes
 *  need no meeting context: they must not hedge or drag the design numbers in. */
export const CONSTRAINT_PROBES = [
  { fact: 'retry', text: 'How would you design the retry policy?' },
  { control: true, text: 'What is MVCC?' },
  { fact: 'key', text: 'How would you key the Kafka topic for this?' },
  { fact: 'peak', text: 'If one consumer handles three hundred events a second, how many consumers do we need at peak?' },
  { control: true, text: 'How does consistent hashing work?' },
  { fact: 'retention', text: 'How much storage should we plan for the event archive at one kilobyte per event?' },
];
export const CONSTRAINT_LEAK_RE = /warehouse|thirty[- ]six|\b36\b|4,?200|forty[- ]five days|\b45 days/i;

/** A ONE-HOUR SESSION holding every kind of content the overlay keeps, planted
 *  early, then enough turns that the conversation ring (MAX_HISTORY_TURNS = 40)
 *  rolls past them, then a follow-up about each through typed chat and
 *  what-to-answer (2026-09-24). Speech is backdated across the hour; the live
 *  turns run now, in order. */
export function buildSessionHourTranscript(nowMs) {
  const at = (min) => Math.round(nowMs - (60 - min) * 60 * 1000);
  const segs = [
    { speaker: I, text: 'Quick thing about the team before we start: our on-call rotation has eleven engineers, and the pager SLA is seven minutes.', timestamp: at(1) },
    { speaker: ME, text: 'Got it. At my last job I cut our CI build time from forty minutes down to six by sharding the test suite across runners.', timestamp: at(2) },
  ];
  let min = 3;
  for (let round = 0; round < 7; round++) {
    for (const [speaker, text] of INTERVIEW_FILLER) {
      segs.push({ speaker, text, timestamp: at(min) });
      min += 55 / (INTERVIEW_FILLER.length * 7);
    }
  }
  return segs.sort((a, b) => a.timestamp - b.timestamp);
}

/** Lines drawn onto the screenshot (unguessable, so only the image can carry them). */
export const SESSION_SCREEN_LINES = [
  'CI  Build #4471  FAILED',
  'reconcileLedgerV3() raised ERR-7Q41',
  'balance drift 0.0031 on shard kestrel-09',
  'at ledger/sync.go:88',
];

/** Render SESSION_SCREEN_LINES to a PNG (Pillow). Returns the path. */
export async function renderSessionScreenshot(file) {
  const { execFileSync } = await import('node:child_process');
  const py = [
    'from PIL import Image, ImageDraw, ImageFont',
    'import sys, json',
    'lines = json.loads(sys.argv[2])',
    'img = Image.new("RGB", (1280, 420), (24, 26, 33))',
    'd = ImageDraw.Draw(img)',
    'f = ImageFont.load_default(size=34)',
    'd.rectangle([0, 0, 1280, 56], fill=(180, 40, 40))',
    'for i, line in enumerate(lines):',
    '    d.text((40, 14 + i * 90 if i else 12), line, font=f, fill=(255, 255, 255) if i == 0 else (230, 230, 210))',
    'img.save(sys.argv[1])',
  ].join('\n');
  execFileSync('python3', ['-c', py, file, JSON.stringify(SESSION_SCREEN_LINES)]);
  return file;
}

/** Planted at the start of the live part, in order. */
export const SESSION_PLANTS = [
  { id: 'typed-fact', surface: 'typed', text: 'Quick note for later: the recruiter told me the offer band tops out at 212k base.' },
  { id: 'screen', surface: 'typed-image', text: "What's the error on my screen?" },
  { id: 'manual-answer', surface: 'typed', text: 'Give me a one-line way to explain backpressure.' },
  { id: 'wta-answer', surface: 'wta', interviewer: 'How would you design a URL shortener for our marketing team?' },
  { id: 'chain', surface: 'typed', text: 'Which algorithm would you use to find the top ten most frequent search terms in a day of logs?' },
];

/** Unrelated turns that push the plants out of the 40-turn ring. */
export const SESSION_FILLER = [
  'What is the difference between a process and a thread?', 'How does a B-tree index speed up a query?',
  'What is MVCC?', 'Explain the CAP theorem in simple terms.', 'What is consistent hashing?',
  'What is a write-ahead log?', 'How does TCP differ from UDP?', 'What is a race condition?',
  'How does garbage collection work in Go?', 'What is the N+1 query problem?', 'What is eventual consistency?',
  'How do database transactions stay isolated?', 'What is a load balancer health check?', 'What is sharding?',
  'How does a CDN work?', 'What is a mutex?', 'What is a deadlock?', 'What is DNS caching?',
  'What does idempotent mean for an API?', 'What is a message queue for?', 'How does OAuth work?',
  'What is the difference between REST and gRPC?', 'What is a bloom filter?', 'What is a circuit breaker?',
  'What is optimistic locking?', 'What is a hash map collision?', 'What is tail latency?',
  'How do you find a memory leak?', 'What is blue-green deployment?', 'What is a feature flag?',
  'What is a materialized view?', 'What is two-phase commit?', 'How does Raft elect a leader?',
  'What is a vector clock?', 'What is a heap data structure?', 'What is dynamic programming?',
  'What is a trie?', 'How does quicksort work?', 'What is Big O notation?', 'What is a closure?',
  'What is dependency injection?', 'What is a race detector?', 'What is back-of-the-envelope estimation?',
  'What is a connection pool?',
];

/** Follow-ups at the end. `re` checks a planted fact; `from` compares with a planted ANSWER. */
export const SESSION_PROBES = [
  { id: 'interviewer-speech', surface: 'typed', text: 'What did the interviewer say the pager SLA is?', re: /\bseven\b|\b7\b/i },
  { id: 'interviewee-speech', surface: 'wta', interviewer: 'Remind me, how much did you cut the build time at your last job?', re: /(six|\b6\b)/i, also: /forty|\b40\b/i },
  { id: 'typed-fact', surface: 'typed', text: 'What did I tell you the offer band tops out at?', re: /212/ },
  { id: 'screen', surface: 'typed', text: 'What was the error code on the screenshot I showed you earlier?', re: /7Q41/i },
  { id: 'screen-wta', surface: 'wta', interviewer: 'Which function failed in the build you had up on your screen earlier?', re: /reconcileLedgerV3/i },
  { id: 'manual-answer', surface: 'typed', text: 'What one-liner did you give me for backpressure earlier?', from: 'manual-answer' },
  { id: 'wta-answer', surface: 'wta', interviewer: 'Going back to the URL shortener you described earlier, what did you say you would use for storage?', from: 'wta-answer' },
  { id: 'chain', surface: 'typed', text: 'Why did you pick that approach for the top ten search terms earlier?', from: 'chain' },
];

const STOP_WORDS = new Set('about above after again against their there these those which while would could should where being other every because before between during under until whose within without really still maybe might first second third think thing things using based answer answers question questions going'.split(' '));
/** Distinctive words of a planted answer (≥5 letters, not in either question). */
export function distinctiveWords(answer, ...exclude) {
  const ex = new Set(exclude.join(' ').toLowerCase().match(/[a-z0-9]{5,}/g) ?? []);
  const words = String(answer ?? '').replace(/\[\[GIST\]\].*$/s, '').toLowerCase().match(/[a-z0-9]{5,}/g) ?? [];
  return [...new Set(words)].filter((w) => !STOP_WORDS.has(w) && !ex.has(w));
}

// A DENIAL can quote the fact while rejecting it ("Q-47 isn't something you've
// established"), so "the answer contains the fact" is not recall. Denial wins.
export const denialRe = /(don'?t|do not|can'?t|cannot|couldn'?t)\s+(have|see|find|recall|know|confirm|verify)|isn'?t (in|anywhere|something)|not (in|anywhere in) (the|this|anything|what)|never (came up|mentioned|said|established|named)|didn'?t (say|mention|tell|give|name)|haven'?t (said|told|given|shared|mentioned)|nothing (you'?ve|in (this|the|what)|here)|no (record|mention|information|figure|number) |unverified|not (mentioned|provided|specified|available|established)|wasn'?t (mentioned|shared|stated)/i;

export function score(answer, re) {
  if (!answer) return 'error';
  if (denialRe.test(answer)) return 'denied';
  return re.test(answer) ? 'recalled' : 'wrong';
}

/** The fact regex for a result record, by scenario — used to re-score saved runs. */
export function factRegexFor(scenario, fact) {
  if (scenario === 'interview') return INTERVIEW_FACTS[fact]?.re;
  if (scenario === 'hour') return HOUR_FACTS[fact]?.re;
  if (scenario === 'constraints') return CONSTRAINT_FACTS[fact]?.re;
  return TYPED_CHAT_FACTS[fact]?.re;
}
