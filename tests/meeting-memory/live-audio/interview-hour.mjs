// tests/meeting-memory/live-audio/interview-hour.mjs
//
// A one-hour technical interview, spoken for real: the interviewer through the
// system-audio channel, the candidate (the user) through the microphone channel.
// Planted details sit at known minutes; probes ask for them 10-55 minutes later
// by the three routes a user has: What-to-answer on the interviewer's follow-up,
// a typed question, and the live index's own semantic search.
//
// Section targets are in MINUTES of estimated elapsed time; filler exchanges are
// appended until each section reaches its target, so the whole run is ~60 min
// of real audio. Filler never uses a planted detail's keywords.

export const FACTS = {
  stack: { re: /elixir/i, what: 'interviewer: core services in Elixir (min ~1)' },
  deploy: { re: /nomad/i, what: 'interviewer: they deploy on Nomad, not Kubernetes (min ~1)' },
  teamSizeThem: { re: /\b(fourteen|14)\b/i, what: 'interviewer: fourteen-person platform team (min ~1)' },
  primary: { re: /postgres|primary/i, what: 'interviewer: write load on one Postgres primary (min ~2)' },
  latency: { re: /(900|nine hundred)[\s\S]{0,80}(140|one hundred (and )?forty)|(140|one hundred (and )?forty)[\s\S]{0,80}(900|nine hundred)/i, what: 'user: p99 900 ms → 140 ms (min ~5)' },
  weeks: { re: /\b(eleven|11)\s+weeks?\b/i, what: 'user: migration took eleven weeks (min ~5)' },
  teamSize: { re: /\b(four|4)\s+engineers\b|\bteam of (four|4)\b|\b(four|4) of us\b/i, what: 'user: four engineers (min ~6)' },
  corvex: { re: /(2\.3|two point three)\s*million/i, what: 'user: Corvex fraud engine 2.3M txns/day (min ~9)' },
  finalRound: { re: /friday/i, also: /cto/i, what: 'typed by user: final round with the CTO on Friday 2pm (min ~10)' },
  incident: { re: /2291|twenty[- ]two ninety[- ]one/i, also: /\b(47|forty[- ]seven)\b/i, what: 'user: INC-2291, 47 min outage (min ~29)' },
  mireille: { re: /mireille/i, what: 'user: disagreed with Mireille, Kafka vs SQS (min ~27)' },
  manager: { re: /priyanka/i, also: /march\s*(3|third|3rd)/i, what: 'interviewer: report to Priyanka Oduya, start March 3 (min ~46)' },
  band: { re: /(185|one eighty[- ]five)[\s\S]{0,40}(210|two ten)/i, what: 'interviewer: band 185-210 (min ~47)' },
};

const say = (who, text) => ({ kind: 'say', who, text });
const I = (text) => say('interviewer', text);
const U = (text) => say('user', text);
const wta = (id, expect, note) => ({ kind: 'wta', id, expect, note });
const typed = (id, text, expect) => ({ kind: 'typed', id, text, expect });
const index = (id, query, expect) => ({ kind: 'index', id, query, expect });
const plantTyped = (id, text) => ({ kind: 'typed', id, text, plant: true });
const act = (name, arg) => ({ kind: 'act', name, arg });

// ── filler bank (no planted keywords) ────────────────────────────────────────
const TOPICS = [
  ['code review', ['keep pull requests small', 'ask for context in the description', 'review correctness before style', 'pair on the tricky parts instead of long comment threads']],
  ['testing', ['unit tests around the domain logic', 'a thin layer of integration tests against real dependencies', 'a few end to end smoke tests', 'contract tests between services']],
  ['on-call', ['weekly rotations with a clear handoff', 'runbooks for every page', 'fixing noisy alerts first', 'a blameless review after every major incident']],
  ['observability', ['structured logs with request identifiers', 'dashboards per service', 'alerts on symptoms rather than causes', 'sampling traces for the slow paths']],
  ['mentoring', ['pairing early on', 'well scoped starter tickets', 'short weekly one on ones', 'letting people own a small project end to end']],
  ['technical debt', ['tying debt to a concrete cost', 'bundling cleanup with feature work in the same area', 'keeping a visible list', 'saying no to rewrites without a clear payoff']],
  ['estimation', ['breaking work into pieces under three days', 'calling out unknowns early', 'reestimating when scope changes', 'tracking how far off we were']],
  ['API design', ['versioning from day one', 'consistent error shapes', 'idempotency keys for writes', 'documenting examples, not just fields']],
  ['caching', ['caching close to the read path', 'explicit expiry instead of guessing', 'protecting the origin from stampedes', 'measuring hit rates before adding layers']],
  ['continuous delivery', ['small frequent deploys', 'feature flags for risky changes', 'automatic rollback on error spikes', 'keeping the pipeline under ten minutes']],
  ['documentation', ['short decision records', 'a runbook next to every alert', 'keeping docs in the repository', 'deleting docs that are wrong']],
  ['working with product', ['being in the room when the problem is framed', 'sharing tradeoffs early', 'agreeing on success metrics up front', 'shipping a thin slice first']],
  ['security', ['least privilege by default', 'secrets in a managed vault', 'dependency scanning in the pipeline', 'threat modelling new endpoints']],
  ['performance work', ['profiling before optimizing', 'fixing the top offender first', 'load testing with realistic traffic', 'watching tail latency rather than averages']],
  ['data migrations', ['dual writes behind a flag', 'backfills in small batches', 'verifying counts before cutover', 'keeping a rollback path']],
  ['hiring', ['structured interviews with clear rubrics', 'realistic work samples', 'fast feedback to candidates', 'calibrating interviewers regularly']],
  ['remote collaboration', ['writing things down', 'overlapping core hours', 'recorded demos', 'clear owners for every decision']],
];
const Q_TPL = [
  (t) => `How do you usually approach ${t}?`,
  (t) => `What does good ${t} look like on a team you would want to join?`,
  (t) => `Can you give me an example of how you handled ${t} before?`,
  (t) => `What is a mistake you have seen teams make with ${t}?`,
];
const A_TPL = [
  (t, a, b) => `For ${t}, I care most about ${a}. The other thing that helps a lot is ${b}, because it keeps the team moving without surprises.`,
  (t, a, b) => `Honestly, the biggest lever is ${a}. I also push for ${b}. When we skipped those, we paid for it later in rework and late nights.`,
  (t, a, b) => `On my last team we got a lot better at ${t} by focusing on ${a}, and then ${b}. It took a few months, but the difference was obvious.`,
  (t, a, b) => `I have seen it go wrong when people ignore ${a}. So I try to set that up first, and then ${b} follows much more naturally.`,
];
let fillerSeq = 0;
function filler() {
  const [t, points] = TOPICS[fillerSeq % TOPICS.length];
  const q = Q_TPL[Math.floor(fillerSeq / TOPICS.length) % Q_TPL.length](t);
  const a = A_TPL[(fillerSeq * 3) % A_TPL.length](t, points[fillerSeq % 4], points[(fillerSeq + 2) % 4]);
  fillerSeq++;
  return [I(q), U(a)];
}

// ── timing model ─────────────────────────────────────────────────────────────
export const WPM = 170;
export const TURN_GAP_S = 1.2;
const ACTION_S = { wta: 8, typed: 8, index: 2, act: 1 };
export function estSeconds(step) {
  if (step.kind === 'say') return step.text.split(/\s+/).length / (WPM / 60) + TURN_GAP_S;
  return ACTION_S[step.kind] ?? 0;
}

// ── the sections ─────────────────────────────────────────────────────────────
const SECTIONS = [
  { untilMin: 3, steps: [
    I("Hi, thanks for joining. I'm Ruth, I lead platform engineering at Harborline Logistics."),
    U('Hi Ruth, great to meet you, and thanks for having me.'),
    I("Quick context on us. We're a fourteen person platform team, our core services are written in Elixir, and we deploy everything with Nomad rather than Kubernetes."),
    U('Got it, thanks, that is helpful.'),
    I('Our biggest pain right now is write load on a single Postgres primary during the evening dispatch peak.'),
    U('That makes sense, that is a classic bottleneck.'),
  ] },
  { untilMin: 12, steps: [
    I("Let's start with your background. Tell me about a project you're proud of."),
    wta('W1-project', /\S/, 'sanity: an answer for an open question'),
    U('At Brightline Freight I led the migration of our shipment tracking API from REST to gRPC. It took eleven weeks, and our p99 latency went from about nine hundred milliseconds down to one hundred forty.'),
    I('Nice. How big was the team on that?'),
    U('It was four engineers. I owned the rollout plan and the load testing.'),
    I('And what did you use to measure the improvement?'),
    U('Dashboards in Grafana fed by Prometheus, plus tracing on the critical paths.'),
    I('And before Brightline?'),
    U('Before that I was at Corvex Payments, building a fraud rules engine that scored about two point three million transactions a day.'),
    plantTyped('P1-typed-fact', 'Note for later: the recruiter told me my final round is with the CTO on Friday at 2pm.'),
  ] },
  { untilMin: 25, steps: [
    I("Let's do a design question. How would you design a rate limiter for our public tracking API?"),
    wta('W2-design', /token bucket|sliding window|leaky bucket|fixed window|redis/i, 'sanity: a design answer'),
    U('I would use a token bucket per API key, stored in Redis with a Lua script so the check and the decrement are atomic.'),
    { kind: 'pad' },
    typed('T1-latency', 'What p99 latency numbers did I give earlier in this call?', 'latency'),
    index('X1-teamsize', 'how big was the team on the migration', 'teamSize'),
  ] },
  { untilMin: 35, steps: [
    I('Tell me about a time you disagreed with a teammate.'),
    wta('W3-conflict', /\S/, 'sanity: a behavioural answer'),
    U('My teammate Mireille wanted Kafka for a new event pipeline, and I argued a managed queue was enough for our volume. We ran a two week spike, and we went with the simpler option.'),
    I('Tell me about an outage you handled.'),
    U('Incident twenty two ninety one. We were down for forty seven minutes because a certificate on an internal load balancer had expired. I led the fix, and afterwards we added expiry alerts for every certificate.'),
    act('fail-embeds', 3),
  ] },
  { untilMin: 45, steps: [
    { kind: 'pad' },
    typed('T2-incident', 'What was the incident number I mentioned, and how long was the outage?', 'incident'),
    index('X2-incident', 'how long was the outage and what caused it', 'incident'),
  ] },
  { untilMin: 53, steps: [
    I("Let me tell you a bit about the role. You'd report to Priyanka Oduya, our director of platform, and the start date we're targeting is March third."),
    U('That sounds great.'),
    I("The base band for this level is one eighty five to two ten, and we're in the office Tuesday through Thursday."),
    U('Thanks, that is clear.'),
    { kind: 'pad' },
    I('Given what I told you about our setup at the start, how would you tackle our write load problem?'),
    wta('W4-setup', 'primary', 'what-to-answer: interviewer setup from minute ~1'),
    I('Going back to that latency project you mentioned early on, what would you do differently now?'),
    wta('W5-latency', /grpc|brightline|latency|p99/i, 'what-to-answer: the user\'s project from minute ~5'),
    I('And how would your rollout approach change given how we deploy?'),
    wta('W6-deploy', 'deploy', 'what-to-answer: Nomad from minute ~1'),
  ] },
  { untilMin: 60, steps: [
    { kind: 'pad' },
    I('Before we wrap up, remind me how big your team was on the gRPC migration?'),
    wta('W7-teamsize', 'teamSize', 'what-to-answer: four engineers from minute ~6'),
    typed('T3-manager', 'Who will I report to, and what start date did they mention?', 'manager'),
    typed('T4-final-round', 'When is my final round, and with whom?', 'finalRound'),
    typed('T5-their-setup', 'What deploy system do they use, and how big is their platform team?', 'deploy'),
    typed('T6-corvex', 'How many transactions a day did I say the Corvex fraud engine handled?', 'corvex'),
    index('X3-corvex', 'fraud engine transactions per day', 'corvex'),
    index('X4-deploy', 'how do they deploy their services', 'deploy'),
    I('Great, that is everything from my side. Thanks for your time today.'),
    U('Thank you, Ruth, I really enjoyed the conversation.'),
  ] },
];

/** Expand sections into the final step list. Each section is padded with
 *  filler up to its target minute, AT its `pad` slot when it has one (so the
 *  filler separates a planted detail from the probe that asks for it), else at
 *  the end. */
export function buildHour() {
  const steps = [];
  let t = 0;
  for (const sec of SECTIONS) {
    const own = sec.steps.filter((x) => x.kind !== 'pad').reduce((acc, x) => acc + estSeconds(x), 0);
    const need = sec.untilMin * 60 - t - own;
    const pad = [];
    let padT = 0;
    while (padT < need - 20) { for (const f of filler()) { pad.push(f); padT += estSeconds(f); } }
    const hasSlot = sec.steps.some((x) => x.kind === 'pad');
    for (const x of sec.steps) {
      if (x.kind === 'pad') { steps.push(...pad); t += padT; continue; }
      steps.push(x); t += estSeconds(x);
    }
    if (!hasSlot) { steps.push(...pad); t += padT; }
    steps.push({ kind: 'mark', minute: sec.untilMin, estMin: +(t / 60).toFixed(1) });
  }
  return { steps, estMinutes: +(t / 60).toFixed(1) };
}
