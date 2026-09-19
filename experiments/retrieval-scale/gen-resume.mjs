#!/usr/bin/env node
// A REALISTIC résumé at a target size, with exact ground truth — for measuring how
// much of it the structuring LLM keeps. Plain text, as a PDF extracts.
//   node experiments/retrieval-scale/gen-resume.mjs   → out/realistic_resume_<size>.txt + out/realistic_truth.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out'); fs.mkdirSync(OUT, { recursive: true });
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const COMPANIES = ['Northgate Freight', 'Pellucid Health', 'Varro Analytics', 'Oakhaven Mutual', 'Brightwater Energy', 'Sablefin Logistics', 'Corbel Systems', 'Tessellate Labs', 'Marlowe & Finch', 'Halcyon Rail', 'Quillon Robotics', 'Asterfield Bank', 'Drumlin Media', 'Kestrel Aero', 'Wrenhaven Foods'];
const TITLES = ['Software Engineer', 'Senior Software Engineer', 'Staff Engineer', 'Engineering Lead', 'Backend Engineer', 'Platform Engineer', 'Site Reliability Engineer'];
const VERBS = ['Rebuilt', 'Designed', 'Migrated', 'Hardened', 'Automated', 'Consolidated', 'Instrumented', 'Refactored', 'Sharded', 'Led'];
const OBJECTS = ['the ingestion pipeline', 'the billing reconciler', 'the search indexer', 'the notification fan-out', 'the identity service', 'the feature-flag platform', 'the audit trail', 'the report scheduler', 'the mobile sync layer', 'the partner API gateway'];
const METRICS = ['p99 latency', 'error rate', 'deploy frequency', 'build time', 'storage cost', 'on-call pages', 'mean time to recovery', 'cache hit ratio'];
const OUTCOMES = ['which unblocked two downstream teams', 'removing a recurring source of pages', 'with zero customer-facing downtime', 'ahead of the compliance deadline', 'after a three-week shadow-traffic trial', 'while mentoring two junior engineers'];
const SKILLS = { Languages: ['Go', 'Rust', 'Kotlin', 'TypeScript', 'Python', 'SQL'], Frameworks: ['gRPC', 'React', 'Spring Boot', 'FastAPI'], Cloud: ['AWS', 'GCP', 'Terraform', 'Kubernetes'], Databases: ['PostgreSQL', 'Redis', 'ClickHouse', 'Cassandra'], Tools: ['Kafka', 'Flink', 'Envoy', 'Temporal', 'Grafana', 'Datadog'] };
// roles / projects per target size (a role with 6 bullets ≈ 450 tokens as plain text)
const SIZES = { '2k': { roles: 5, projects: 3 }, '5k': { roles: 14, projects: 6 }, '15k': { roles: 45, projects: 12 }, '30k': { roles: 92, projects: 20 } };
const truth = {};
for (const [label, cfg] of Object.entries(SIZES)) {
  const r = rng(0x5eed ^ cfg.roles); const pick = (a) => a[Math.floor(r() * a.length)];
  // Realistic, DISTINCT names: the first version used "Candidate 2K Adeyemi" and the structuring LLM
  // (reasonably) returned "2K Adeyemi", so the driver's exact-name poll never matched.
  const name = { '2k': 'Amara Okafor', '5k': 'Bruno Carvalho', '15k': 'Chidi Ezenwa', '30k': 'Dalia Haddad' }[label];
  const L = [name, 'Staff Software Engineer', `${name.split(' ')[0].toLowerCase()}@example.test · Lisbon, Portugal`, '', 'Summary', '', 'Backend and reliability engineer with experience across logistics, fintech and energy.', '', 'Experience', ''];
  let bullets = 0; let year = 2025;
  for (let i = 0; i < cfg.roles; i++) {
    const end = year; year -= 1 + Math.floor(r() * 2);
    L.push(`${pick(TITLES)} — ${COMPANIES[i % COMPANIES.length]}${i >= COMPANIES.length ? ` (${['EMEA', 'APAC', 'Americas', 'Platform', 'Labs'][Math.floor(i / COMPANIES.length) % 5]} division)` : ''}`, `${year} – ${end}`, '');
    for (let b = 0; b < 6; b++) { bullets++; L.push(`- ${pick(VERBS)} ${pick(OBJECTS)} for the ${['payments', 'search', 'identity', 'logistics', 'analytics'][b % 5]} group, improving ${pick(METRICS)} by ${11 + Math.floor(r() * 60)}% ${pick(OUTCOMES)}; coordinated the rollout across ${2 + Math.floor(r() * 5)} services and documented the runbook.`); }
    L.push('');
  }
  L.push('Projects', '');
  for (let i = 0; i < cfg.projects; i++) L.push(`Project ${['Alder', 'Basalt', 'Cinder', 'Dovetail', 'Ember', 'Fathom', 'Gantry', 'Harrier', 'Isthmus', 'Jetty'][i % 10]}-${i + 1}`, `An open-source ${pick(['rate limiter', 'schema migrator', 'load generator', 'log shipper'])} written in ${pick(SKILLS.Languages)}; ${100 + Math.floor(r() * 900)} stars, used by ${2 + Math.floor(r() * 9)} teams.`, '');
  L.push('Skills', '');
  let skillCount = 0; for (const [k, v] of Object.entries(SKILLS)) { L.push(`${k}: ${v.join(', ')}`); skillCount += v.length; }
  L.push('', 'Education', '', 'M.Sc. Computer Science — University of Tartu, 2012', 'B.Sc. Computer Engineering — University of Lagos, 2010', '', 'Certifications', '', 'Certified Kubernetes Security Specialist (CKS), 2023', 'AWS Certified Solutions Architect – Professional, 2022', 'HashiCorp Certified: Terraform Associate, 2021', '');
  const text = L.join('\n');
  fs.writeFileSync(path.join(OUT, `realistic_resume_${label}.txt`), text);
  truth[label] = { name, chars: text.length, approxTokens: Math.round(text.length / 4), experience: cfg.roles, bullets, projects: cfg.projects, skills: skillCount, education: 2, certifications: 3 };
  console.log(label, JSON.stringify(truth[label]));
}
fs.writeFileSync(path.join(OUT, 'realistic_truth.json'), JSON.stringify(truth, null, 1));
