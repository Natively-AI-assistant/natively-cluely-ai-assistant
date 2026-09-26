#!/usr/bin/env node
// Deterministic fixture generator for the retrieval-scale campaign.
//
// Emits a fake résumé, a fake job description and a fake reference handbook at
// ~5k / 15k / 30k / 70k tokens each. The SAME needle facts are planted in every
// size at the same relative depths; only the surrounding distractor filler
// grows. That keeps "found at 5k, lost at 70k" attributable to corpus size and
// nothing else.
//
// Usage: node experiments/retrieval-scale/gen-fixtures.mjs [outDir]
// Output: <outDir>/<kind>_<size>.md + <outDir>/questions.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.argv[2] || path.join(HERE, 'out'));
const SIZES = { '5k': 5_000, '15k': 15_000, '30k': 30_000, '70k': 70_000 };
const CHARS_PER_TOKEN = 4;

// --- seeded PRNG (mulberry32) so every run is byte-identical ----------------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

// --- word banks --------------------------------------------------------------
const CODENAMES = ['Alder', 'Basalt', 'Cinder', 'Dovetail', 'Ember', 'Fathom', 'Gantry', 'Harrier', 'Isthmus', 'Jetty', 'Keystone', 'Lantern', 'Meridian', 'Nimbus', 'Osprey', 'Pylon', 'Quarry', 'Rampart', 'Sextant', 'Tundra', 'Umbra', 'Vellum', 'Wicket', 'Yarrow', 'Zephyr', 'Anvil', 'Bramble', 'Corvid', 'Drift', 'Eyrie', 'Flint', 'Gossamer', 'Hollow', 'Ingot', 'Kiln', 'Lodestar', 'Mantle', 'Nettle', 'Onyx', 'Pumice'];
const COMPANIES = ['Northgate Freight', 'Pellucid Health', 'Varro Analytics', 'Oakhaven Mutual', 'Brightwater Energy', 'Sablefin Logistics', 'Corbel Systems', 'Tessellate Labs', 'Marlowe & Finch', 'Halcyon Rail'];
const STACKS = ['Go', 'Rust', 'Kotlin', 'TypeScript', 'Python', 'Scala', 'PostgreSQL', 'Kafka', 'Redis', 'gRPC', 'Terraform', 'Kubernetes', 'ClickHouse', 'Flink', 'Envoy', 'Cassandra', 'Elasticsearch', 'GraphQL', 'Temporal', 'Pulsar'];
const METRICS = ['p99 latency', 'p95 latency', 'error rate', 'deploy frequency', 'build time', 'cold-start time', 'throughput', 'storage cost', 'on-call pages per week', 'mean time to recovery', 'cache hit ratio', 'queue depth'];
const VERBS = ['Rebuilt', 'Designed', 'Migrated', 'Hardened', 'Automated', 'Consolidated', 'Instrumented', 'Refactored', 'Sharded', 'Containerised', 'Benchmarked', 'Decommissioned'];
const IMPERATIVES = ['Rebuild', 'Design', 'Migrate', 'Harden', 'Automate', 'Consolidate', 'Instrument', 'Refactor', 'Shard', 'Containerise', 'Benchmark', 'Decommission'];
const OBJECTS = ['the ingestion pipeline', 'the billing reconciler', 'the search indexer', 'the notification fan-out', 'the identity service', 'the feature-flag platform', 'the audit trail', 'the report scheduler', 'the mobile sync layer', 'the partner API gateway', 'the fraud-scoring service', 'the data-lake compactor'];
const OUTCOMES = ['which unblocked two downstream teams', 'removing a recurring source of pages', 'with zero customer-facing downtime', 'ahead of the compliance deadline', 'and documented the rollout for other squads', 'after a three-week shadow-traffic trial', 'while keeping the legacy path as a fallback', 'and handed ownership to the platform group'];
const FIRST = ['Anneke', 'Bashir', 'Catalina', 'Dmitri', 'Esperanza', 'Farrukh', 'Greta', 'Hamid', 'Ilse', 'Joaquim', 'Kalinda', 'Leopold', 'Mireille', 'Nkechi', 'Otto', 'Priya', 'Quentin', 'Rosalind', 'Stellan', 'Tamsin'];
const LAST = ['Abernathy', 'Brandvold', 'Castellanos', 'Drummond', 'Eklund', 'Fairweather', 'Galloway', 'Hyltoft', 'Iwasaki', 'Jablonski', 'Kovalenko', 'Lindqvist', 'Mbeki', 'Novak', 'Okafor', 'Pettersson', 'Quigley', 'Rasmussen', 'Szabo', 'Thackeray'];
const SERVICES = ['Atlas', 'Beacon', 'Conduit', 'Dynamo', 'Echo', 'Foundry', 'Gatekeeper', 'Herald', 'Imprint', 'Junction', 'Kite', 'Ledgerline', 'Mosaic', 'Nexus', 'Orchard', 'Prism', 'Relay', 'Sentinel', 'Tributary', 'Uplink', 'Vault', 'Waypoint'];
const TEAMS = ['Growth Platform', 'Risk Engineering', 'Developer Experience', 'Data Foundations', 'Payments Edge', 'Trust & Safety', 'Core Identity', 'Observability', 'Partner Integrations', 'Mobile Runtime'];

const person = (r) => `${pick(r, FIRST)} ${pick(r, LAST)}`;
const pct = (r) => `${int(r, 11, 78)}%`;

// --- filler section builders -------------------------------------------------
// Every builder deliberately reuses the SAME sub-headings across entities
// (Overview / Metrics / Incidents …). Real handbooks and long résumés do this,
// and it is the known hard case: near-duplicate heading text across sections.

function resumeSection(r, i) {
  const code = `${pick(r, CODENAMES)}-${100 + i}`;
  const company = pick(r, COMPANIES);
  const y = int(r, 2009, 2024);
  const lines = [`### Project ${code} — ${company} (${y}–${y + int(r, 1, 2)})`, '', `**Stack:** ${[pick(r, STACKS), pick(r, STACKS), pick(r, STACKS)].join(', ')}`, '', '**Highlights**', ''];
  for (let b = 0, n = int(r, 4, 7); b < n; b++) {
    lines.push(`- ${pick(r, VERBS)} ${pick(r, OBJECTS)}, improving ${pick(r, METRICS)} by ${pct(r)} ${pick(r, OUTCOMES)}.`);
  }
  const n = int(r, 3, 9), boss = person(r);
  const teamLine = `Worked with ${n} engineers under ${boss}; partnered with the ${pick(r, TEAMS)} group.`;
  lines.push('', '**Team**', '', teamLine, '');
  const facts = [
    { must: [code, teamLine], q: [`Who did you work under on Project ${code}?`, `Who was your boss when you were doing the ${code} work at ${company}?`], gold: [boss.split(' ')[1]] },
    { must: [code, teamLine], q: [`How many engineers did you work with on Project ${code}?`, `How big was the ${code} crew?`], gold: [String(n)] },
  ];
  return { text: lines.join('\n'), facts };
}

function jdSection(r, i) {
  const team = `${pick(r, TEAMS)} (${pick(r, CODENAMES)} pod ${i})`;
  const lead = person(r), heads = int(r, 4, 12);
  const overview = `The pod owns ${pick(r, OBJECTS)} and ${pick(r, OBJECTS)}. It is led by ${lead} and currently has ${heads} engineers.`;
  const lines = [`### Team profile: ${team}`, '', '**Overview**', '', overview, '', '**What you would do here**', ''];
  for (let b = 0, n = int(r, 4, 6); b < n; b++) {
    lines.push(`- ${pick(r, IMPERATIVES)} ${pick(r, OBJECTS)} using ${pick(r, STACKS)} and ${pick(r, STACKS)}, with a target of moving ${pick(r, METRICS)} by ${pct(r)}.`);
  }
  lines.push('', '**Nice to have**', '', `Familiarity with ${pick(r, STACKS)}, ${pick(r, STACKS)} and ${pick(r, STACKS)}; prior exposure to ${pick(r, OBJECTS)}.`, '');
  const podName = team.match(/\((.*)\)/)[1];
  const facts = [
    { must: [podName, overview], q: [`Who leads the ${podName}?`, `Which person is in charge of ${podName}?`], gold: [lead.split(' ')[1]] },
    { must: [podName, overview], q: [`How many engineers are in the ${podName}?`, `What is the headcount of ${podName}?`], gold: [String(heads)] },
  ];
  return { text: lines.join('\n'), facts };
}

function refSection(r, i) {
  const svc = `${pick(r, SERVICES)}-${pick(r, ['api', 'worker', 'store', 'gateway', 'sync'])}-${i}`;
  const key = svc.replace(/-/g, '.');
  const contact = person(r), avail = `99.${int(r, 1, 95)}%`, timeout = int(r, 200, 9000), inc = `INC-${int(r, 1000, 3999)}-${i}`, fixer = person(r);
  const overview = `${svc} is owned by ${pick(r, TEAMS)}. Primary contact is ${contact}. It backs ${pick(r, OBJECTS)}.`;
  const availLine = `- Availability target: ${avail}`;
  const timeoutLine = `${key}.timeout_ms = ${timeout}`;
  const incLine = `- ${inc}: ${pick(r, METRICS)} regression after a ${pick(r, STACKS)} upgrade; resolved in ${int(r, 12, 240)} minutes by ${fixer}.`;
  const lines = [`### Service: ${svc}`, '', '**Overview**', '', overview, '', '**SLOs**', '', availLine, `- ${pick(r, METRICS)} budget: ${int(r, 20, 900)} ms`, '', '**Configuration**', '', '```', `${key}.pool.max_connections = ${int(r, 8, 256)}`, `${key}.retry.max_attempts = ${int(r, 2, 9)}`, timeoutLine, '```', '', '**Incidents**', '', incLine, '', '**Runbook**', '', `1. Check the ${pick(r, SERVICES)} dashboard.`, `2. If ${pick(r, METRICS)} is degraded, scale the ${pick(r, STACKS)} tier by ${int(r, 2, 6)} replicas.`, `3. Escalate to ${person(r)} after ${int(r, 15, 60)} minutes.`, ''];
  const facts = [
    { must: [svc, overview], q: [`Who is the primary contact for ${svc}?`, `Who do I talk to about ${svc}?`], gold: [contact.split(' ')[1]] },
    { must: [svc, availLine], q: [`What is the availability target for ${svc}?`, `How much uptime is ${svc} supposed to have?`], gold: [avail.replace('.', '\\.').replace('%', '')] },
    { must: [timeoutLine], q: [`What is ${key}.timeout_ms set to?`, `What timeout is configured for ${svc}?`], gold: [String(timeout)] },
    { must: [incLine], q: [`Who resolved ${inc}?`, `Which engineer fixed incident ${inc}?`], gold: [fixer.split(' ')[1]] },
  ];
  return { text: lines.join('\n'), facts };
}

// --- needles -------------------------------------------------------------------
// depth: 0..1 position in the document. gold: every entry must appear in a
// correct answer (case-insensitive; entries are regex sources).
// q: [lexical phrasing, paraphrase with little token overlap, STT-ish phrasing].

const NEEDLES = {
  resume: [
    { id: 'r01', depth: 0.04, type: 'numeric', block: '### Project Tallgrass — Oakhaven Mutual (2020–2022)\n\n**Highlights**\n\n- Cut p99 checkout latency on the Tallgrass payments gateway from 840 ms to 210 ms by replacing synchronous ledger writes with an outbox.\n', q: ['What did you cut p99 checkout latency to on the Tallgrass payments gateway?', 'How fast was the tail of the payments gateway after your work at Oakhaven?', 'so the tallgrass thing um what was the the latency you got it down to'], gold: ['210'] },
    { id: 'r02', depth: 0.15, type: 'numeric', block: '### Project Kestrel — Halcyon Rail (2018–2019)\n\n**Team**\n\nLed the Kestrel migration with a team of 14 engineers split between Lisbon and Nairobi.\n', q: ['How many engineers were on your team for the Kestrel migration?', 'How big was the group you ran when you moved Halcyon Rail off the old system?', 'kestrel migration how many people did you lead'], gold: ['14|fourteen'] },
    { id: 'r03', depth: 0.27, type: 'date', block: '### Career milestones\n\n- Promoted to Staff Engineer at Oakhaven Mutual in March 2021 after the ledger re-platforming.\n', q: ['When were you promoted to Staff Engineer?', 'At what point did you reach the staff level?', 'when did you get staff'], gold: ['march', '2021'] },
    { id: 'r04', depth: 0.38, type: 'tech', block: '### Project Juniper — Sablefin Logistics (2016–2017)\n\n**Highlights**\n\n- Replaced RabbitMQ with NATS JetStream for dispatch events in Juniper, removing the broker failover gap.\n', q: ['What did you replace RabbitMQ with in Juniper?', 'Which messaging system did you move dispatch events onto at Sablefin?', 'juniper what did you swap rabbit m q for'], gold: ['nats|jetstream'] },
    { id: 'r05', depth: 0.5, type: 'entity', block: '### Awards\n\n- Halvorsen Prize for Distributed Systems, 2019, for the paper on quorum leases.\n', q: ['Which prize did you win in 2019?', 'Have you received any recognition for your distributed systems research?', 'what award did you get for the quorum leases paper'], gold: ['halvorsen'] },
    { id: 'r06', depth: 0.6, type: 'education', block: '### Education\n\nM.Sc. Computer Science, University of Tartu, 2012. Thesis: "Causal consistency in geo-replicated ledgers". GPA 4.7 / 5.\n', q: ['What was your M.Sc. thesis about at the University of Tartu?', 'What did you research for your master\'s degree?', 'your masters thesis what was the topic'], gold: ['causal consistency'] },
    { id: 'r07', depth: 0.7, type: 'id', block: '### Certifications\n\n- Certified Kubernetes Security Specialist, licence CKS-2207-88431, valid through 2027.\n', q: ['What is your Certified Kubernetes Security Specialist licence number?', 'Can you give me the credential id for your k8s security cert?', 'c k s licence number'], gold: ['CKS-2207-88431'] },
    { id: 'r08', depth: 0.8, type: 'paraphrase', block: '### Outside work\n\nTeaches weekend robotics to teenagers at Makerspace Alfama and organises its yearly line-follower tournament.\n', q: ['What do you teach at Makerspace Alfama?', 'Do you do any community or volunteer work?', 'anything you do outside of work with kids or teaching'], gold: ['robotics'] },
    { id: 'r09', depth: 0.9, type: 'numeric', block: '### Project Saltmarsh — Varro Analytics (2014–2015)\n\n**Highlights**\n\n- Reduced annual cloud spend by $2.3M by moving batch ETL in Saltmarsh onto spot fleets with checkpointed jobs.\n', q: ['How much annual cloud spend did you save on Saltmarsh?', 'What was the dollar impact of shifting the batch jobs to preemptible capacity?', 'saltmarsh the cost savings how much was it'], gold: ['2\\.3'] },
    { id: 'r10', depth: 0.97, type: 'id', block: '### Patents\n\n- US 11,482,907 — "Adaptive rate limiting with tenant-aware token buckets" (sole inventor).\n', q: ['What is the number of your patent on adaptive rate limiting?', 'Do you hold any intellectual property, and what is it for?', 'your patent what is it about'], gold: ['11,?482,?907|adaptive rate limiting'] },
  ],
  jd: [
    { id: 'j01', depth: 0.05, type: 'numeric', block: '### Compensation\n\nBase salary range for this role is $214,000–$262,000, reviewed every January.\n', q: ['What is the base salary range for this role?', 'How much does the position pay?', 'whats the pay band for this job'], gold: ['214', '262'] },
    { id: 'j02', depth: 0.16, type: 'numeric', block: '### Equity\n\nNew-hire equity grants for this level are between 0.04% and 0.09% of fully diluted shares, vesting over four years with a one-year cliff.\n', q: ['What is the equity grant range for this level?', 'How much ownership of the company comes with the offer?', 'equity how much do they give'], gold: ['0\\.04', '0\\.09'] },
    { id: 'j03', depth: 0.28, type: 'numeric', block: '### On-call\n\nEngineers on Settlement Core carry the pager one week in every seven, with a paid day off after each rotation.\n', q: ['How often are Settlement Core engineers on call?', 'What is the pager burden like on this team?', 'on call rotation how frequent'], gold: ['seven|7'] },
    { id: 'j04', depth: 0.4, type: 'requirement', block: '### Minimum qualifications\n\n- 9+ years building distributed backend systems, at least 3 of them operating a ledger or payments system in production.\n', q: ['How many years of experience does the role require?', 'How senior do I need to be to qualify?', 'years of experience needed'], gold: ['9|nine'] },
    { id: 'j05', depth: 0.5, type: 'tech', block: '### Must-have technical experience\n\n- Production experience with FoundationDB, including operating a cluster through a major version upgrade.\n', q: ['Which database does the role require production experience with?', 'Is there a specific storage technology I must already know?', 'what database do they want experience in'], gold: ['foundationdb'] },
    { id: 'j06', depth: 0.6, type: 'entity', block: '### Location and working pattern\n\nHybrid: two days per week in the Rotterdam office (Tuesdays and Thursdays), remainder remote within the EU.\n', q: ['How many days per week are required in the Rotterdam office?', 'Can I work from home and how often must I come in?', 'is it remote or do i have to go in'], gold: ['two|2', 'rotterdam'] },
    { id: 'j07', depth: 0.7, type: 'entity', block: '### Reporting line\n\nThis role reports to Dagny Verhoeven, Director of Ledger Infrastructure.\n', q: ['Who does this role report to?', 'Who would be my manager?', 'who is the hiring manager'], gold: ['dagny|verhoeven'] },
    { id: 'j08', depth: 0.8, type: 'numeric', block: '### Interview process\n\nFive stages: recruiter screen, hiring-manager call, systems design, a 90-minute incident-simulation round, and a values conversation.\n', q: ['How long is the incident-simulation round in the interview process?', 'What does the hiring loop look like?', 'how many interview rounds are there'], gold: ['90|five|5'] },
    { id: 'j09', depth: 0.9, type: 'entity', block: '### Immigration\n\nWe sponsor Dutch highly-skilled-migrant visas and cover relocation up to €12,000.\n', q: ['How much relocation does the company cover?', 'Will they help me move countries and pay for it?', 'do they sponsor visas'], gold: ['12,?000|highly.skilled|sponsor'] },
    { id: 'j10', depth: 0.97, type: 'numeric', block: '### The team\n\nSettlement Core is a team of 11 that owns the double-entry ledger and the nightly reconciliation against 23 banking partners.\n', q: ['How many banking partners does Settlement Core reconcile against?', 'How large is the group I would be joining?', 'settlement core team size'], gold: ['23|11'] },
  ],
  reference: [
    { id: 'f01', depth: 0.05, type: 'config', block: '### Service: ledger-compactor\n\n**Configuration**\n\n```\nledger.compaction.window_minutes = 45\nledger.compaction.max_segments = 12\n```\n', q: ['What is ledger.compaction.window_minutes set to?', 'How long is the compaction window for the ledger?', 'ledger compaction window minutes what is the value'], gold: ['45'] },
    { id: 'f02', depth: 0.16, type: 'numeric', block: '### Service: quasar-ingest-api\n\n**SLOs**\n\n- Availability target for the Quasar ingest API: 99.97%\n', q: ['What is the availability target for the Quasar ingest API?', 'How reliable is Quasar ingestion supposed to be?', 'quasar ingest s l o'], gold: ['99\\.97'] },
    { id: 'f03', depth: 0.27, type: 'entity', block: '### Escalation policy: Quasar\n\nIf a Quasar page is unacknowledged for 12 minutes, page the Tier-2 lead, Oluwaseun Adeyemi-Clarke.\n', q: ['Who is the Tier-2 lead to page for Quasar?', 'Who gets called if nobody picks up a Quasar alert?', 'quasar escalation who do we page'], gold: ['oluwaseun|adeyemi'] },
    { id: 'f04', depth: 0.38, type: 'cause', block: '### Postmortem: INC-4471\n\n**Root cause**\n\nAn expired intermediate certificate on the mTLS mesh caused INC-4471; rotation alerts were routed to a decommissioned channel.\n', q: ['What was the root cause of INC-4471?', 'Why did the forty-four seventy-one outage happen?', 'i n c 4471 what caused it'], gold: ['certificate|cert'] },
    { id: 'f05', depth: 0.5, type: 'numeric', block: '### Data retention\n\nAudit logs are retained for 400 days; application debug logs for 21 days.\n', q: ['How long are audit logs retained?', 'For what period do we keep the compliance trail?', 'audit log retention'], gold: ['400'] },
    { id: 'f06', depth: 0.6, type: 'numeric', block: '### Rate limits: public API\n\nBurst limit is 1,800 requests per 10 seconds per tenant; sustained limit is 6,000 per minute.\n', q: ['What is the burst limit per tenant on the public API?', 'How hard can a single customer hammer the API before throttling?', 'public a p i burst limit'], gold: ['1,?800'] },
    { id: 'f07', depth: 0.7, type: 'table', block: '### Pricing tiers\n\n| Plan | Price | Minimum |\n| --- | --- | --- |\n| Team | $14 per seat | 5 seats |\n| Business | $24 per seat | 25 seats |\n| Enterprise Plus | $38 per seat | 250 seats |\n', q: ['What is the per-seat price of Enterprise Plus?', 'How much does the top plan cost for each user?', 'enterprise plus price'], gold: ['38'] },
    { id: 'f08', depth: 0.8, type: 'procedure', block: '### Runbook: regional failover\n\n5. Freeze deploys in the failing region.\n6. Drain the write queue before promoting the replica.\n7. Flip the traffic weight to the standby.\n', q: ['What is step 6 of the regional failover runbook?', 'Before promoting the replica during a failover, what must happen first?', 'failover runbook step six'], gold: ['drain'] },
    { id: 'f09', depth: 0.9, type: 'date', block: '### Deprecations\n\nv2 webhooks are sunset on 2027-02-15; v3 signatures become mandatory the same day.\n', q: ['When are v2 webhooks sunset?', 'What is the shutdown date for the old webhook version?', 'v two webhooks when do they go away'], gold: ['2027-02-15|feb\\w* 15|15 feb'] },
    { id: 'f10', depth: 0.97, type: 'paraphrase', block: '### Expenses\n\nEmployees may expense up to €85 per month for home internet.\n', q: ['How much can employees expense per month for home internet?', 'What can I claim for my wifi bill when working from the house?', 'home internet expense limit'], gold: ['85'] },
  ],
};

const ABSENT = {
  resume: ['What was your GPA in your undergraduate degree at MIT?', 'How many people did you manage at Google?'],
  jd: ['What is the signing bonus?', 'Does the role require a security clearance?'],
  reference: ['What is the SLO for the Pegasus billing API?', 'What is the retention period for video recordings?'],
};

const HEADERS = {
  resume: '# Maya Okonkwo-Reyes\n\nStaff Software Engineer — distributed systems, payments, reliability\n\nmaya.okonkwo.reyes@example.test · Lisbon, Portugal\n\n## Summary\n\nSixteen years building and operating high-volume backend systems across logistics, fintech and energy.\n\n## Experience\n',
  jd: '# Job description — Principal Engineer, Settlement Core\n\nCompany: Helix Meridian B.V.\n\nRole: Principal Engineer\n\n## About the role\n\nHelix Meridian runs clearing and settlement for European marketplaces. This document describes the role, the teams you would work with, and how we hire.\n',
  reference: '# Orbital Platform Engineering Handbook\n\nInternal reference for service owners: SLOs, configuration, escalation, runbooks, postmortems and policy.\n',
};
const BUILDERS = { resume: resumeSection, jd: jdSection, reference: refSection };

const SIBLINGS_PER_DOC = 12;

function build(kind, targetTokens) {
  const r = rng(0xc0ffee ^ kind.length);
  const target = targetTokens * CHARS_PER_TOKEN;
  const needles = NEEDLES[kind];
  const needleChars = needles.reduce((n, x) => n + x.block.length + 2, 0);
  const sections = [];
  let chars = HEADERS[kind].length + needleChars;
  for (let i = 0; chars < target; i++) {
    const s = BUILDERS[kind](r, i);
    sections.push(s);
    chars += s.text.length + 1;
  }
  // Sibling facts: questions about the FILLER itself. Every one has dozens to
  // hundreds of same-shaped siblings, so difficulty grows with document size.
  const sr = rng(0xbeef ^ targetTokens);
  const siblings = [];
  for (let k = 0; k < SIBLINGS_PER_DOC; k++) {
    const sec = sections[Math.min(sections.length - 1, Math.floor(((k + 0.5) / SIBLINGS_PER_DOC) * sections.length))];
    siblings.push(sec.facts[Math.floor(sr() * sec.facts.length)]);
  }
  // Plant each needle at its relative depth, counted in filler sections.
  const out = sections.map((s) => s.text);
  const placed = [...needles].sort((a, b) => b.depth - a.depth);
  for (const n of placed) out.splice(Math.round(n.depth * sections.length), 0, n.block);
  return { text: HEADERS[kind] + '\n' + out.join('\n'), siblings };
}

fs.mkdirSync(OUT, { recursive: true });
const questions = [];
for (const kind of Object.keys(NEEDLES)) {
  for (const [label, tokens] of Object.entries(SIZES)) {
    const { text, siblings } = build(kind, tokens);
    const file = `${kind}_${label}.md`;
    fs.writeFileSync(path.join(OUT, file), text);
    for (const n of NEEDLES[kind]) {
      const at = text.indexOf(n.block);
      if (at < 0) throw new Error(`needle ${n.id} missing from ${file}`);
      n.q.forEach((q, v) => questions.push({ id: `${n.id}.${label}.${['lex', 'para', 'stt'][v]}`, needle: n.id, kind, size: label, file, variant: ['lex', 'para', 'stt'][v], type: n.type, depth: +(at / text.length).toFixed(3), question: q, gold: n.gold, must: [n.block.trim().split('\n').sort((a, b) => b.length - a.length)[0]] }));
    }
    siblings.forEach((f, k) => {
      for (const m of f.must) if (!text.includes(m)) throw new Error(`sibling fact missing from ${file}: ${m}`);
      f.q.forEach((q, v) => questions.push({ id: `s${String(k).padStart(2, '0')}.${kind}.${label}.${['lex', 'para'][v]}`, needle: `s${k}`, kind, size: label, file, variant: ['lex', 'para'][v], type: 'sibling', depth: +(text.indexOf(f.must[f.must.length - 1]) / text.length).toFixed(3), question: q, gold: f.gold, must: f.must }));
    });
    ABSENT[kind].forEach((q, v) => questions.push({ id: `${kind}.absent${v}.${label}`, kind, size: label, file, variant: 'absent', type: 'absent', question: q, gold: [] }));
    console.log(`${file}\t${text.length} chars\t~${Math.round(text.length / CHARS_PER_TOKEN)} tokens`);
  }
}
fs.writeFileSync(path.join(OUT, 'questions.json'), JSON.stringify(questions, null, 1));
console.log(`questions.json\t${questions.length} questions`);
