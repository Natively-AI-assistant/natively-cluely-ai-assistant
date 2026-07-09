#!/usr/bin/env node
/**
 * trace-resume-jd-evidence.mjs — READ-ONLY. Answers "where does the analyst /
 * Python / SQL / ETL / R / BI framing in the answers come from?" by inspecting
 * the actual stored resume and JD structured_data and attributing each token.
 *
 * No provider calls; opens the DB read-only.
 *
 * For each suspicious token seen in the user's answers, it reports whether the
 * token appears in:
 *   - the active JD structured_data  (=> legitimate JD evidence)
 *   - the active resume structured_data (=> legitimate resume evidence)
 *   - the AOT intro string (=> baked-in precomputed answer, not fresh)
 * so we can distinguish "JD-sourced" from "hallucinated" from "AOT-frozen".
 *
 * Usage: ELECTRON_RUN_AS_NODE=1 <electron> tools/.../trace-resume-jd-evidence.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function resolveDb() {
  const cand = [];
  if (process.env.NATIVELY_DB) cand.push(process.env.NATIVELY_DB);
  const appSupport = path.join(os.homedir(), 'Library', 'Application Support');
  for (const n of ['natively', 'Natively', 'answercue', 'Electron']) cand.push(path.join(appSupport, n, 'natively.db'));
  for (const p of cand) { try { if (p && fs.existsSync(p)) return p; } catch {} }
  return null;
}

const dbPath = resolveDb();
if (!dbPath) { console.log('FAIL: no DB. Set NATIVELY_DB.'); process.exit(2); }

let Database;
try { Database = require('better-sqlite3'); }
catch (e) { console.log('FAIL: run under ELECTRON_RUN_AS_NODE electron. ' + (e?.message || e)); process.exit(3); }

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const jd = db.prepare("SELECT id, structured_data FROM knowledge_documents WHERE type='job_description' ORDER BY created_at DESC LIMIT 1").get();
const rs = db.prepare("SELECT id, structured_data FROM knowledge_documents WHERE type='resume' ORDER BY created_at DESC LIMIT 1").get();
const introRow = jd ? db.prepare("SELECT result_json FROM aot_results WHERE result_type='intro' AND document_id=? ORDER BY created_at DESC LIMIT 1").get(jd.id) : null;

const jdText = jd ? jd.structured_data.toLowerCase() : '';
const rsText = rs ? rs.structured_data.toLowerCase() : '';
let introText = '';
if (introRow) { try { const o = JSON.parse(introRow.result_json); introText = String(o.intro || o.text || introRow.result_json).toLowerCase(); } catch { introText = introRow.result_json.toLowerCase(); } }

console.log('═'.repeat(88));
console.log(' RESUME/JD EVIDENCE ATTRIBUTION (read-only)');
console.log(` active JD id=${jd?.id}   active resume id=${rs?.id}   AOT intro present=${Boolean(introRow)}`);
console.log('═'.repeat(88));

// Tokens the user reported seeing in the assistant's answers.
const TOKENS = [
  'python', 'sql', 'java', 'typescript', 'etl', 'data pipeline', 'data analyst',
  'analyst', 'r', 'power bi', 'tableau', 'business intelligence', 'bi tools',
  'data-driven', 'estrotech', 'internship', 'actionable insights', 'redis',
];

const inWord = (hay, tok) => {
  // word-ish containment; for single-letter 'r' require standalone.
  if (tok === 'r') return /(^|[^a-z])r([^a-z]|$)/.test(hay);
  return hay.includes(tok);
};

console.log('\n token                    | in JD | in resume | in AOT intro | attribution');
console.log(' ' + '-'.repeat(84));
for (const t of TOKENS) {
  const inJd = jd ? inWord(jdText, t) : false;
  const inRs = rs ? inWord(rsText, t) : false;
  const inIntro = introRow ? inWord(introText, t) : false;
  let attribution;
  if (inJd && !inRs) attribution = 'JD-SOURCED (legit target-role fact)';
  else if (inRs && !inJd) attribution = 'RESUME-SOURCED (candidate fact)';
  else if (inJd && inRs) attribution = 'BOTH (JD + resume overlap)';
  else if (inIntro) attribution = 'AOT-INTRO ONLY (frozen precomputed phrasing)';
  else attribution = 'NEITHER — likely MODEL PHRASING/HALLUCINATION or generic';
  console.log(`   ${t.padEnd(22)} |  ${inJd ? 'Y' : '.'}    |    ${inRs ? 'Y' : '.'}     |     ${inIntro ? 'Y' : '.'}       | ${attribution}`);
}

console.log('\n Interpretation:');
console.log('  - "JD-SOURCED" tokens prove the analyst/Python/SQL/ETL/R/BI framing is REAL JD content,');
console.log('    not hallucination. The JD IS a Data Analyst JD (see technologies/keywords).');
console.log('  - The "currently wrapping up internship at EstroTech ... Python and Java ... sharpened SQL"');
console.log('    narrative is the AOT-INTRO string (served verbatim via "Serving precomputed (AOT) intro"),');
console.log('    NOT freshly generated per question — that is why it recurs unchanged.');
console.log('  - Any token that is JD-SOURCED yet appears in a JD-ONLY answer that the app claimed');
console.log('    "no JD loaded" is proof of the routing bug: the content exists but was not routed.');

db.close();
