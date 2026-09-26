// scripts/dump-role-insight-fixture.mjs
//
// Runs the real Role Insight pipeline against the test fixtures and writes the
// resulting report to JSON, so the UI harness renders ACTUAL engine output
// rather than hand-written mock data. If the shapes ever drift, the harness
// breaks — which is the point.
//
// Run with:
//   npm run build:electron
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/dump-role-insight-fixture.mjs

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist-electron/premium/electron/knowledge/roleInsight');
const FIXTURES = path.join(ROOT, 'premium/electron/knowledge/__tests__/roleInsight/fixtures.mjs');

const load = (n) => import(pathToFileURL(path.join(DIST, `${n}.js`)).href);
const { RoleInsightDatabase } = await load('RoleInsightDatabase');
const { RoleInsightEngine } = await load('RoleInsightEngine');
const fx = await import(pathToFileURL(FIXTURES).href);

function stubEmbed(text) {
    const v = new Array(8).fill(0);
    for (const w of String(text).toLowerCase().split(/\W+/)) {
        if (!w) continue;
        let h = 0;
        for (let i = 0; i < w.length; i++) h = (h * 31 + w.charCodeAt(i)) >>> 0;
        v[h % 8] += 1;
    }
    const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map(x => x / n);
}

function makeNodes(resume) {
    const nodes = [];
    let id = 1;
    for (const exp of resume.experience ?? []) {
        for (const bullet of exp.bullets ?? []) {
            nodes.push({
                id: id++, document_id: 1, source_type: 'resume', category: 'experience',
                title: exp.role, organization: exp.company, start_date: exp.start_date,
                end_date: exp.end_date, duration_months: 24, text_content: bullet,
                tags: [], embedding: stubEmbed(bullet), embedding_space: 'stub:test:8',
            });
        }
    }
    for (const p of resume.projects ?? []) {
        nodes.push({
            id: id++, document_id: 1, source_type: 'resume', category: 'project',
            title: p.name, organization: null, start_date: null, end_date: null,
            duration_months: 0, text_content: `${p.name} — ${p.description}`,
            tags: p.technologies ?? [], embedding: stubEmbed(p.description),
            embedding_space: 'stub:test:8',
        });
    }
    return nodes;
}

// A cooperative stub model: quotes the JD verbatim on extraction and cites only
// the evidence ids it was shown on assessment.
function makeLlm() {
    return async (contents) => {
        const text = (Array.isArray(contents) ? contents : [contents])
            .map(c => (typeof c === 'string' ? c : c?.text ?? '')).join('\n');

        if (text.includes('analysing a job description')) {
            const quotes = [
                ['Design and operate highly available backend services handling millions of requests per day', 'core_responsibility', true, false, true],
                ['Own production incident response, including on-call rotation and postmortems', 'core_responsibility', true, false, true],
                ['Mentor engineers across the backend team', 'leadership', false, false, false],
                ['5+ years of professional backend engineering experience', 'experience', true, false, false],
                ['Strong experience with distributed systems', 'technical_skill', true, false, true],
                ['Must have hands-on experience with Kubernetes in production', 'technical_skill', true, false, true],
                ['Proficiency with PostgreSQL or another relational database', 'technical_skill', true, false, false],
                ["Bachelor's degree in Computer Science or equivalent practical experience", 'education', true, false, false],
                ['Must be authorized to work in the United States without sponsorship', 'authorization', true, true, false],
                ['Location: Austin, TX (Hybrid — 3 days onsite)', 'location', true, true, false],
                ['Experience with Go', 'technical_skill', false, false, false],
                ['Familiarity with Terraform', 'technical_skill', false, false, false],
                ['Prior experience in robotics or industrial automation', 'domain', false, false, false],
            ];
            return JSON.stringify(quotes.map(([q, category, mandatory, hard_gate, central]) => ({
                quote: q, additional_quotes: [], normalized: q,
                category, mandatory, hard_gate, central, confidence: 0.9,
            })));
        }

        if (text.includes('assessing how a candidate')) {
            const ids = [...text.matchAll(/^id: (rq_\S+)$/gm)].map(m => m[1]);
            const blocks = text.split(/REQUIREMENT \d+/).slice(1);
            return JSON.stringify(ids.map((id, i) => {
                const evidence = [...(blocks[i] ?? '').matchAll(/\[(ev_\S+?)\]/g)].map(m => m[1]);
                if (evidence.length === 0) {
                    return {
                        id, status: 'needs_evidence', evidence_ids: [],
                        explanation: 'Nothing in the retrieved evidence addresses this requirement.',
                        limitations: [],
                        missing_information: ['Confirm whether you have done this, and describe what you were responsible for.'],
                        confidence: 0.5,
                    };
                }
                return {
                    id, status: 'transferable', evidence_ids: evidence.slice(0, 2),
                    explanation: 'Your recorded work on the Aetherlab session service covers deployment and operation of a live service, which is adjacent to this requirement.',
                    transfer_explanation: 'It transfers because the work involved deploying a service to production infrastructure and keeping live sessions healthy under load.',
                    limitations: ['Does not establish availability targets, redundancy design, or measured request volume.'],
                    missing_information: ['Add the request volume and availability target the service was held to.'],
                    confidence: 0.62,
                };
            }));
        }
        return '[]';
    };
}

const provider = {
    search: async () => ([{
        title: 'Senior Backend Engineer — Acme Robotics Careers',
        link: 'https://acmerobotics.com/careers/senior-backend-engineer',
        snippet: 'Senior Backend Engineer, Austin TX. Join the Acme Robotics platform team building highly available services.',
    }]),
    extractUrl: async () => null,
};

async function build(name, { resume, jdText, provider: p, nodes }) {
    const db = new RoleInsightDatabase(new Database(':memory:'));
    db.initializeSchema();
    const engine = new RoleInsightEngine({
        db,
        getResumeDoc: () => ({
            id: 1, type: 'resume', source_uri: '/Users/you/Documents/jordan-reyes-resume.pdf',
            structured_data: resume, raw_text: 'raw', created_at: '2026-08-03T09:12:00.000Z',
        }),
        getJdDoc: () => ({
            id: 2, type: 'job_description', source_uri: '/Users/you/Documents/acme-backend-jd.txt',
            structured_data: fx.structuredJd(), raw_text: jdText,
            created_at: '2026-08-04T08:40:00.000Z',
        }),
        getNodes: () => nodes ?? makeNodes(resume),
        generateContentFn: makeLlm(),
        embedFn: async (t) => stubEmbed(t),
        getSearchProvider: () => p ?? null,
    });
    const report = await engine.run({ skipExternalVerification: !p });
    console.log(`[fixture] ${name}: ${report.requirements.length} requirements, ` +
        `alignment=${report.analysis.roleAlignment}, confidence=${report.analysis.evidenceConfidence}, ` +
        `gates=${report.analysis.hardGateStatus}, status=${report.analysis.status}`);
    return report;
}

const out = {
    populated: await build('populated', { resume: fx.SWE_RESUME, jdText: fx.SWE_JD, provider }),
    switcher: await build('switcher (many unresolved)', { resume: fx.SWITCHER_RESUME, jdText: fx.SWE_JD }),
    thin: await build('thin résumé (low confidence)', { resume: fx.INCOMPLETE_RESUME, jdText: fx.SWE_JD, nodes: [] }),
};

// A hard-blocker variant: confirm the authorization gate is unmet, exactly as
// the UI would after the user answers.
{
    const db = new RoleInsightDatabase(new Database(':memory:'));
    db.initializeSchema();
    const blocked = JSON.parse(JSON.stringify(out.populated));
    const gate = blocked.requirements.find(r => r.category === 'authorization');
    if (gate) {
        blocked.analysis.hardGateStatus = 'not_met';
        const check = blocked.analysis.hardGates.find(g => g.requirementId === gate.id);
        if (check) { check.state = 'not_met'; check.detail = 'You confirmed you would need visa sponsorship for this role.'; }
        const a = blocked.assessments.find(x => x.requirementId === gate.id);
        if (a) {
            a.status = 'requirement_not_met';
            a.userCorrected = true;
            a.originalStatus = 'needs_evidence';
            a.explanation = 'You confirmed you would need visa sponsorship for this role.';
        }
        blocked.analysis.summary = blocked.analysis.summary
            + ' One or more mandatory conditions are not met and need attention before anything else.';
    }
    out.blocked = blocked;
    console.log('[fixture] blocked (hard requirement not met)');
}

const target = path.join(ROOT, 'scripts/.role-insight-fixture.json');
fs.writeFileSync(target, JSON.stringify(out, null, 2));
console.log(`\nWrote ${target} (${(fs.statSync(target).size / 1024).toFixed(1)} KB)`);
