// scripts/validate-role-insight-live.mjs
//
// Runs the REAL Role Insight pipeline against the REAL Gemini provider.
//
// Every one of the 165 automated tests uses a stub LLM, so until this script
// existed, extraction-prompt quality on messy real-world JD text — and whether
// the assessor actually returns citable evidence ids under a live model — was
// unmeasured. This is the gate before wiring Role Insight into the live
// interview answer path: an unvalidated analysis must not feed live answers.
//
// It asserts, per JD, the same invariants the quality gates demand:
//   1. a sane number of requirements extracted, boilerplate excluded
//   2. anchored offsets exactly match the source text
//   3. every proven/transferable assessment cites evidence ids that exist
//   4. every transferable has both a transfer explanation and a limitation
//   5. the model never originates confirmed_gap / requirement_not_met
//   6. the validator's violation count (downgrades) is reported
//
// Run with:
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/validate-role-insight-live.mjs
//
// Uses GEMINI_API_KEY from .env. Model matches the app's extraction tier
// (gemini-3.1-flash-lite) so results reflect what production would do.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist-electron/premium/electron/knowledge/roleInsight');
const load = (n) => import(pathToFileURL(path.join(DIST, `${n}.js`)).href);

const { RoleInsightDatabase } = await load('RoleInsightDatabase');
const { RoleInsightEngine } = await load('RoleInsightEngine');
const fx = await import(pathToFileURL(
    path.join(ROOT, 'premium/electron/knowledge/__tests__/roleInsight/fixtures.mjs')).href);

// ── Provider ──────────────────────────────────────────────────────────────────

const env = Object.fromEntries(
    fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')
        .filter(l => l.includes('=') && !l.trim().startsWith('#'))
        .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
const KEY = env.GEMINI_API_KEY;
if (!KEY) { console.error('No GEMINI_API_KEY in .env — cannot validate.'); process.exit(2); }

const GEN_MODEL = 'gemini-3.1-flash-lite';
const EMB_MODEL = 'gemini-embedding-2';

async function geminiGenerate(contents) {
    const text = (Array.isArray(contents) ? contents : [contents])
        .map(c => (typeof c === 'string' ? c : c?.text ?? '')).join('\n\n');
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEN_MODEL}:generateContent?key=${KEY}`,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text }] }],
                generationConfig: { temperature: 0.1, thinkingConfig: { thinkingBudget: 0 } },
            }),
        },
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    const out = json?.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
    if (!out) throw new Error('Gemini returned an empty candidate');
    return out;
}

let embedOk = true;
async function geminiEmbed(text) {
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${EMB_MODEL}:embedContent?key=${KEY}`,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                content: { parts: [{ text: text.slice(0, 8000) }] },
                outputDimensionality: 768,
            }),
        },
    );
    if (!res.ok) { embedOk = false; throw new Error(`embed ${res.status}`); }
    const json = await res.json();
    const v = json?.embedding?.values;
    if (!Array.isArray(v)) { embedOk = false; throw new Error('no embedding values'); }
    return v;
}

// ── Messy real-world-shaped JDs ───────────────────────────────────────────────
// Deliberately NOT the clean test fixtures: scraped-page nav debris, HTML
// entities, EEO/benefits boilerplate, duplicated asks, a non-engineering role.

const JD_SCRAPED_SWE = `Home | Careers | Engineering | Sign in
Share this job  Save  Print

Staff Software Engineer, Platform Infrastructure
San Francisco, CA (Hybrid &ndash; Tuesdays &amp; Thursdays onsite) | Full-time

Who we are
Vantage Systems powers checkout for 40,000 merchants. We move fast, we own outcomes, and we celebrate diverse perspectives. We offer competitive salary, meaningful equity, 401(k) match, unlimited PTO, and comprehensive health, dental &amp; vision insurance.

The role
You'll lead design of the services that keep checkout at four nines. You will partner with product and SRE, mentor senior engineers, and own reliability end to end.

What you'll do
- Architect and operate highly available payment services processing $2B+ annually
- Drive incident response maturity: on-call, runbooks, and blameless postmortems
- Lead migration of legacy services onto Kubernetes
- Mentor and grow a team of 6 senior engineers
- Partner with compliance on PCI-DSS audits

What we're looking for
- 8+ years building backend systems in Go, Java, or similar
- Deep, hands-on Kubernetes experience running production workloads at scale
- Experience operating PostgreSQL under heavy write load
- A track record of leading incident response for customer-facing systems
- Experience with Kubernetes in a regulated environment is essential
- Must be authorized to work in the United States; we are unable to sponsor visas for this role at this time

Nice to have
- Terraform or other infrastructure-as-code experience
- PCI-DSS or SOC 2 audit exposure
- Kafka or another event streaming platform

Vantage is an equal opportunity employer and considers all applicants without regard to race, color, religion, sex, national origin, disability, or veteran status. Reasonable accommodations available upon request. E-Verify participant.

Apply now  |  Refer a friend  |  Back to all jobs`;

const JD_SALES = `Enterprise Account Executive — North America
Remote (US) · Sales · Meridian Data

About Meridian
Meridian Data is the trusted analytics layer for 900+ enterprises. Our values: customer obsession, radical candor, bias for action.

The opportunity
Own a named-account territory of Fortune 1000 prospects and carry a $1.4M ARR quota. Full-cycle: outbound prospecting through negotiation and close, partnering with SEs and CS.

Responsibilities
- Build and maintain 4x pipeline coverage in Salesforce
- Run value-based discovery and multi-threaded enterprise sales cycles of 6-9 months
- Negotiate six- and seven-figure contracts with procurement and legal
- Forecast weekly with 90%+ accuracy

Required qualifications
- 6+ years of enterprise SaaS sales experience
- Consistent track record of exceeding a $1M+ quota
- Experience selling data or analytics products to technical buyers
- Excellent written and verbal communication skills
- MEDDICC or similar qualification methodology required
- Willingness to travel up to 30%

Preferred
- Existing relationships with Fortune 1000 data leaders
- Experience with usage-based pricing models

We offer OTE of $300k, uncapped commissions, equity, 401(k), and full medical coverage. Meridian is proud to be an equal opportunity workplace.`;

// ── Harness (mirrors integration-test wiring, real provider swapped in) ──────

function makeNodes(resume, embeddings) {
    const nodes = [];
    let id = 1;
    for (const exp of resume.experience ?? []) {
        for (const bullet of exp.bullets ?? []) {
            nodes.push({
                id: id++, document_id: 1, source_type: 'resume', category: 'experience',
                title: exp.role, organization: exp.company, start_date: exp.start_date,
                end_date: exp.end_date, duration_months: 24, text_content: bullet,
                tags: [], embedding: embeddings?.get(bullet) ?? undefined,
                embedding_space: embeddings ? 'gemini-embedding-2:768' : undefined,
            });
        }
    }
    return nodes;
}

async function runOne(name, resume, jdText, useEmbeddings) {
    const db = new RoleInsightDatabase(new Database(':memory:'));
    db.initializeSchema();

    let embeddings = null;
    if (useEmbeddings && embedOk) {
        embeddings = new Map();
        for (const exp of resume.experience ?? []) {
            for (const b of exp.bullets ?? []) {
                try { embeddings.set(b, await geminiEmbed(b)); } catch { embeddings = null; break; }
            }
            if (!embeddings) break;
        }
    }

    const nodes = makeNodes(resume, embeddings);
    const engine = new RoleInsightEngine({
        db,
        getResumeDoc: () => ({
            id: 1, type: 'resume', source_uri: '/tmp/r.pdf',
            structured_data: resume, raw_text: 'raw', created_at: new Date().toISOString(),
        }),
        getJdDoc: () => ({
            id: 2, type: 'job_description', source_uri: '/tmp/jd.txt',
            structured_data: fx.structuredJd(), raw_text: jdText,
            created_at: new Date().toISOString(),
        }),
        getNodes: () => nodes,
        generateContentFn: geminiGenerate,
        embedFn: embeddings ? geminiEmbed : null,
        getSearchProvider: () => null,
    });

    const t0 = Date.now();
    const report = await engine.run({ skipExternalVerification: true });
    const ms = Date.now() - t0;

    // ── Invariants ────────────────────────────────────────────────────────────
    const problems = [];
    const reqs = report.requirements;
    const evidenceIds = new Set(report.evidence.map(e => e.id));

    const extractTrace = report.analysis.stageTrace.find(s => s.stage === 'extract_requirements');
    const mode = /mode=llm/.test(extractTrace?.detail ?? '') ? 'llm' : 'heuristic';
    if (mode !== 'llm') problems.push(`extraction fell back to heuristic (${extractTrace?.detail})`);
    if (reqs.length < 6) problems.push(`only ${reqs.length} requirements extracted`);
    if (reqs.length > 30) problems.push(`${reqs.length} requirements — over-extraction`);

    const blob = reqs.map(r => (r.originalText + ' ' + r.normalizedText).toLowerCase()).join(' | ');
    for (const bad of ['equal opportunity', '401', 'unlimited pto', 'dental', 'apply now', 'refer a friend', 'radical candor']) {
        if (blob.includes(bad)) problems.push(`boilerplate leaked: "${bad}"`);
    }

    let anchored = 0, unanchored = 0;
    for (const r of reqs) {
        if (r.sourceCharStart === null) { unanchored++; continue; }
        anchored++;
        if (jdText.slice(r.sourceCharStart, r.sourceCharEnd) !== r.originalText) {
            problems.push(`offset mismatch for "${r.originalText.slice(0, 40)}"`);
        }
    }

    let positives = 0, downgradesVisible = 0;
    for (const a of report.assessments) {
        if (a.status === 'confirmed_gap') problems.push(`model originated confirmed_gap on ${a.requirementId}`);
        if (a.status === 'requirement_not_met' && !reqs.find(r => r.id === a.requirementId)?.hardGate) {
            problems.push(`requirement_not_met on non-gate ${a.requirementId}`);
        }
        if (a.status === 'proven' || a.status === 'transferable') {
            positives++;
            if (a.evidenceIds.length === 0) problems.push(`${a.status} with no citation on ${a.requirementId}`);
            for (const id of a.evidenceIds) {
                if (!evidenceIds.has(id)) problems.push(`unstored citation ${id}`);
            }
            if (a.status === 'transferable') {
                if (!(a.transferExplanation ?? '').trim()) problems.push(`transferable without transfer explanation: ${a.requirementId}`);
                if (!(a.limitations ?? []).length) problems.push(`transferable without limitation: ${a.requirementId}`);
            }
        }
        if (a.originalStatus && a.originalStatus !== a.status) downgradesVisible++;
    }

    const validateTrace = report.analysis.stageTrace.find(s => s.stage === 'validate_conclusions');
    const byStatus = {};
    for (const a of report.assessments) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;

    console.log(`\n━━ ${name} ━━`);
    console.log(`  ${ms}ms · extraction=${mode} · embeddings=${embeddings ? 'live' : 'off'}`);
    console.log(`  requirements: ${reqs.length} (${anchored} anchored, ${unanchored} unanchored)`);
    console.log(`  statuses: ${JSON.stringify(byStatus)}`);
    console.log(`  positives cited: ${positives} · validator: ${validateTrace?.detail} · downgrades visible: ${downgradesVisible}`);
    console.log(`  analysis status: ${report.analysis.status} · alignment: ${report.analysis.roleAlignment}`);
    if (problems.length) {
        console.log(`  ✖ PROBLEMS (${problems.length}):`);
        for (const p of problems) console.log(`     - ${p}`);
    } else {
        console.log('  ✔ all invariants hold');
    }
    return problems.length;
}

// ── Run ───────────────────────────────────────────────────────────────────────

let failures = 0;
failures += await runOne('Scraped SWE JD + engineering résumé (with live embeddings)', fx.SWE_RESUME, JD_SCRAPED_SWE, true);
failures += await runOne('Scraped SWE JD + career-switcher résumé', fx.SWITCHER_RESUME, JD_SCRAPED_SWE, false);
failures += await runOne('Enterprise sales JD + sales résumé', fx.SALES_RESUME, JD_SALES, false);

console.log(`\n${failures === 0 ? '✔ VALIDATION PASSED' : `✖ VALIDATION FOUND ${failures} PROBLEM(S)`}`);
process.exit(failures === 0 ? 0 : 1);
