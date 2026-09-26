// scripts/profile-jd-loop.js
//
// Phase 12/13 orchestrator (real-app source-switch repair, 2026-07-14):
// consumes a profile/JD benchmark `run-*.json` report and emits a
// structured failure-cluster analysis so the next code change is targeted
// at a real, generic root cause — not at a single symptom.
//
// INPUT:  debug-artifacts/profile-jd-benchmark/run-<ts>.json
//         (schema produced by scripts/e2e-profile-jd-real-path.js — see
//         that file for the per-row shape and category list).
//
// OUTPUT: debug-artifacts/profile-jd-benchmark/loop-<ts>.json
//         { runAt, sourceReport, totals, byCategory, clusters[], nextActions[] }
// AND: a human-readable summary printed to stdout, sorted by cluster size
//      (largest first — that's the highest-yield fix).
//
// NO LLM CALLS. Pure offline analysis of an existing report. Run this
// every time you have a fresh run-*.json (locally after a real-backend run,
// or in CI after a nightly run) to drive the next iteration of the loop.
//
// The cluster taxonomy below was chosen to surface the kinds of generic
// bugs the code-reviewer found in earlier phases:
//   wiring   — the failure is the call site itself (wrong surface tag,
//              missing IPC, dead code path), not a knowledge/model issue.
//   refusal  — the model produced a canned refusal ("I'm not sure", etc.)
//              when it had the evidence. Generic fix: improve the source-
//              authority contract or the prompt construction.
//   empty    — model produced no answer at all (timeout, transport,
//              guard). Generic fix: change retry / streaming / error
//              handling, NOT the answer path.
//   drift    — the answer is present but contains a forbidden token
//              (TalentScope, the greeting refusal, a doc-grounded
//              hardcoded artifact, etc.). Generic fix: tighten a leak
//              guard, not the answer path.
//   miss     — the answer is present but missing one or more required
//              regex matches (the model didn't extract the right fact).
//              Generic fix: improve retrieval or evidence-quality for
//              that family of question.
//   unknown  — anything that doesn't classify above. Listed for completeness
//              so the loop operator can inspect it manually.
//
// Run:
//   node scripts/profile-jd-loop.js [path/to/run-<ts>.json]
// (defaults to the most recent run-*.json in debug-artifacts/profile-jd-benchmark/)

'use strict';

const path = require('node:path');
const fs = require('node:fs');

const repoRoot = path.resolve(__dirname, '..');
const BENCH_DIR = path.join(repoRoot, 'debug-artifacts', 'profile-jd-benchmark');

function pickLatestReport(argPath) {
    if (argPath && fs.existsSync(argPath)) return path.resolve(argPath);
    if (!fs.existsSync(BENCH_DIR)) return null;
    const candidates = fs.readdirSync(BENCH_DIR)
        .filter((f) => f.startsWith('run-') && f.endsWith('.json'))
        .map((f) => path.join(BENCH_DIR, f));
    if (candidates.length === 0) return null;
    // Newest first by filename (run-<ISO timestamp>.json).
    candidates.sort().reverse();
    return candidates[0];
}

function classifyProb(prob) {
    if (!prob) return 'unknown';
    if (prob === 'EMPTY' || prob === 'CANNED:...') return prob === 'EMPTY' ? 'empty' : 'refusal';
    if (prob.startsWith('MISS:')) return 'miss';
    if (prob.startsWith('FORBID:')) return 'drift';
    if (prob.startsWith('CANNED:')) return 'refusal';
    if (prob.startsWith('GLOBAL:')) return 'drift'; // reserved for future
    return 'unknown';
}

function suggestNextActions(cluster) {
    // Map a cluster to the smallest set of generic, root-cause-directed
    // next actions. NOT specific code changes — those need real reading
    // of the source. The point of these actions is to direct the
    // operator's attention to the right layer.
    const out = [];
    if (cluster.kind === 'wiring') {
        out.push(`inspect ${cluster.signature.slice(0, 80)} — likely a surface tag, IPC, or persistence-path bug`);
        out.push('verify the call site reaches LLMHelper.streamChat with the active mode set');
        out.push('re-run the unit tests for the affected module');
    } else if (cluster.kind === 'empty') {
        out.push('check timeout/error logs in debug-artifacts/profile-jd-benchmark/');
        out.push('if many rows are empty simultaneously, suspect transport (DNS, TLS, rate-limit) not the answer path');
        out.push('if scattered across rows, suspect a per-question guard or a stale surface');
    } else if (cluster.kind === 'refusal') {
        out.push('audit the persistent source-contract authority (ModesManager.getOrMigrateSourceContract) for this mode');
        out.push('re-run scripts/e2e-profile-jd-real-path.js with NATIVELY_INTERNAL=1 to surface diagnostics');
        out.push('cross-check: did the migration fix from Phase 1/2 make this mode reference_files_primary, not reference_files_only?');
    } else if (cluster.kind === 'drift') {
        out.push('extract the first forbidden token and grep the codebase for it');
        out.push('check the doc-grounded prompt + greeting guards (validateAgainstSourceContract) for that token class');
        out.push('if the drift is a JSDoc comment or test string, the fix is in the gating layer, not the answer path');
    } else if (cluster.kind === 'miss') {
        out.push('inspect the actual retrieved context block for this question (add debug log in ipcHandlers.ts)');
        out.push('check whether the PDF ingestion preserved the fact (compare raw vs indexed chunks)');
        out.push('if multiple miss failures share a noun ("seven years", "Cincinnati"), the chunking/ToC-exclusion may be hiding the right page');
    } else {
        out.push('inspect manually — no generic fix template matches this cluster shape');
    }
    return out;
}

function clusterRows(rows) {
    const clusters = new Map(); // key = `${cat}|${firstProbKind}` → cluster obj
    for (const r of rows) {
        if (r.pass) continue;
        const probs = r.probs || [];
        // Each row may have several probs; attribute it to its first
        // non-empty prob's kind (the most informative failure signal —
        // empty answers dominate when transport is broken, miss dominates
        // when the model just doesn't see the right chunk).
        let kind = 'unknown';
        let primaryProb = null;
        for (const p of probs) {
            const k = classifyProb(p);
            if (k !== 'unknown') { kind = k; primaryProb = p; break; }
        }
        // If only 'unknown' probs, fall back to the first raw prob.
        if (primaryProb === null && probs.length > 0) primaryProb = probs[0];

        const key = `${r.cat || 'unknown'}::${kind}`;
        if (!clusters.has(key)) {
            clusters.set(key, {
                key, category: r.cat || 'unknown', kind,
                size: 0,
                signature: primaryProb || '(no probs)',
                exampleQuestion: r.q,
                exampleProbs: Array.from(new Set(probs)),
                serverModels: new Set(),
                totalLatencyMs: 0,
            });
        }
        const c = clusters.get(key);
        c.size += 1;
        if (primaryProb && primaryProb !== c.signature) {
            // Promote the first non-trivial signature only if we don't have one yet.
            if (c.signature === '(no probs)' || c.signature.startsWith('CANNED:')) c.signature = primaryProb;
        }
        if (r.serverModel) c.serverModels.add(r.serverModel);
        c.totalLatencyMs += (r.latencyMs || 0);
    }
    return Array.from(clusters.values()).sort((a, b) => b.size - a.size);
}

function main() {
    const inputPath = pickLatestReport(process.argv[2]);
    if (!inputPath) {
        console.error('[loop] no input report found.');
        console.error('[loop] run scripts/e2e-profile-jd-real-path.js first (it produces run-<ts>.json), then rerun.');
        process.exit(1);
    }

    const report = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    const rows = report.rows || [];
    const clusters = clusterRows(rows);

    // Per-category totals — same shape the harness prints, but reported here
    // so the loop operator can see at a glance which categories regressed
    // and which are clean.
    const byCategory = report.byCategory || {};
    const totalQuestions = report.totalQuestions || rows.length;
    const totalPass = report.totalPass || 0;
    const totalFail = report.totalFail || (totalQuestions - totalPass);

    // Annotate clusters with next actions.
    for (const c of clusters) c.nextActions = suggestNextActions(c);
    for (const c of clusters) c.serverModels = Array.from(c.serverModels);

    const out = {
        runAt: new Date().toISOString(),
        sourceReport: inputPath,
        totals: { totalQuestions, totalPass, totalFail },
        byCategory,
        clusters,
    };
    const outPath = path.join(BENCH_DIR, `loop-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

    // ── Human-readable stdout summary ─────────────────────────────────────
    console.log(`[loop] source = ${inputPath}`);
    console.log(`[loop] totals = ${totalPass}/${totalQuestions} pass (${totalFail} fail)`);
    if (clusters.length === 0) {
        console.log('[loop] no failures — nothing to cluster. All gates satisfied.');
        console.log(`[loop] report → ${outPath}`);
        return;
    }

    console.log('');
    console.log('[loop] failure clusters (largest first):');
    console.log('');
    for (const c of clusters) {
        console.log(`  ── ${c.key}  (size=${c.size}) ──`);
        console.log(`     signature : ${c.signature}`);
        console.log(`     example   : ${c.exampleQuestion.slice(0, 90)}${c.exampleQuestion.length > 90 ? '…' : ''}`);
        console.log(`     probs     : ${c.exampleProbs.join(' | ')}`);
        console.log(`     models    : ${c.serverModels.length ? c.serverModels.join(', ') : '(none)'}`);
        console.log(`     avg ms    : ${Math.round(c.totalLatencyMs / c.size)}`);
        console.log(`     actions   :`);
        for (const a of c.nextActions) console.log(`        - ${a}`);
        console.log('');
    }

    console.log('[loop] by-category summary:');
    for (const cat of Object.keys(byCategory)) {
        const { pass, fail } = byCategory[cat];
        console.log(`     ${cat.padEnd(18)} ${pass}/${pass + fail}`);
    }
    console.log(`[loop] report → ${outPath}`);
}

main();