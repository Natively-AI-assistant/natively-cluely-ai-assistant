#!/usr/bin/env node
/**
 * trace-jd-storage.mjs — READ-ONLY inspector for the Natively knowledge DB.
 *
 * PHASE 2 of the JD/Resume JIT investigation. This script:
 *   - Opens <userData>/natively.db in READONLY mode (never writes).
 *   - Makes NO provider/LLM calls.
 *   - Prints the state of resume/JD documents, AOT artifacts, OKF profile packs,
 *     and derived staleness signals.
 *
 * It answers, from ground truth on disk:
 *   1. Is a JD actually stored?           (knowledge_documents WHERE type='job_description')
 *   2. Is it the "active" one?            (latest by created_at — that is what the app reads)
 *   3. Is the raw JD text stored?         (schema has NO raw-text column — proven here)
 *   4. Is the structured JD stored?       (structured_data JSON keys + counts)
 *   5. Are AOT artifacts tied to it?      (aot_results.document_id == active JD id?)
 *   6. Is anything stale?                 (AOT rows whose document_id != active JD id)
 *
 * Usage:
 *   node tools/jd-resume-jit-investigation/trace-jd-storage.mjs
 *   NATIVELY_DB=/path/to/natively.db node tools/.../trace-jd-storage.mjs
 *
 * Requires better-sqlite3 (already a project dependency).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// DB discovery (read-only). We try, in order: $NATIVELY_DB, the macOS userData
// productName dir, then a few known-sibling app dirs.
// ---------------------------------------------------------------------------
function candidateDbPaths() {
  const out = [];
  if (process.env.NATIVELY_DB) out.push(process.env.NATIVELY_DB);
  const appSupport = path.join(os.homedir(), 'Library', 'Application Support');
  for (const name of ['natively', 'Natively', 'answercue', 'Electron']) {
    out.push(path.join(appSupport, name, 'natively.db'));
  }
  // Linux / other
  out.push(path.join(os.homedir(), '.config', 'natively', 'natively.db'));
  return out;
}

function resolveDb() {
  for (const p of candidateDbPaths()) {
    try { if (p && fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  return null;
}

function hashOf(s) {
  // Local content hash for staleness comparison ONLY (the app stores none).
  const crypto = require('node:crypto');
  return crypto.createHash('sha256').update(s || '').digest('hex').slice(0, 16);
}

function safeParse(json) {
  try { return JSON.parse(json); } catch { return null; }
}

function tableExists(db, name) {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(name);
  return !!row;
}

function line(char = '─', n = 74) { return char.repeat(n); }
function h1(t) { console.log('\n' + line('═') + '\n ' + t + '\n' + line('═')); }
function h2(t) { console.log('\n' + line() + '\n ' + t + '\n' + line()); }
function kv(k, v) { console.log(`   ${String(k).padEnd(28)}: ${v}`); }

function main() {
  const dbPath = resolveDb();
  h1('JD / RESUME STORAGE TRACE (read-only)');
  if (!dbPath) {
    console.log('FAIL: could not locate natively.db. Set NATIVELY_DB=/abs/path.');
    console.log('Searched:');
    for (const p of candidateDbPaths()) console.log('   - ' + p);
    process.exit(2);
  }
  kv('DB path', dbPath);
  const stat = fs.statSync(dbPath);
  kv('DB size', `${(stat.size / 1024).toFixed(1)} KiB`);
  kv('DB mtime', stat.mtime.toISOString());

  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (e) {
    console.log('FAIL: better-sqlite3 not loadable from node. Run under the app toolchain:');
    console.log('   ELECTRON_RUN_AS_NODE=1 <electron> tools/.../trace-jd-storage.mjs');
    console.log('   (native ABI mismatch is expected under bare node for some installs)');
    console.log('Error: ' + (e?.message || e));
    process.exit(3);
  }

  // READONLY — this process cannot mutate the DB even if it tried.
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  // -------------------------------------------------------------------------
  // Schema proof: the knowledge_documents table has NO raw-text column.
  // -------------------------------------------------------------------------
  h2('SCHEMA — knowledge_documents columns');
  if (!tableExists(db, 'knowledge_documents')) {
    console.log('   UNKNOWN: knowledge_documents table absent. Knowledge feature never initialized on this DB.');
  } else {
    const cols = db.prepare("PRAGMA table_info('knowledge_documents')").all();
    for (const c of cols) console.log(`   - ${c.name} (${c.type})`);
    const hasRaw = cols.some(c => /raw|full_?text|content_text|document_text/i.test(c.name));
    kv('raw-text column present?', hasRaw ? 'YES' : 'NO  (structured_data JSON + source_uri file path only)');
  }

  if (!tableExists(db, 'knowledge_documents')) { db.close(); return; }

  // -------------------------------------------------------------------------
  // 1. RESUME documents
  // -------------------------------------------------------------------------
  const docsOfType = (t) => db.prepare(
    'SELECT id, type, source_uri, structured_data, created_at FROM knowledge_documents WHERE type = ? ORDER BY created_at DESC'
  ).all(t);

  function reportDoc(row, kind) {
    const sd = safeParse(row.structured_data);
    const sdKeys = sd ? Object.keys(sd) : [];
    kv('id', row.id);
    kv('type', row.type);
    kv('source_uri (file path)', row.source_uri);
    kv('created_at', row.created_at);
    kv('structured_data chars', (row.structured_data || '').length);
    kv('structured_data hash', hashOf(row.structured_data));
    kv('structured_data keys', sdKeys.join(', ') || '(none / unparseable)');
    if (kind === 'resume' && sd) {
      kv('  experience count', Array.isArray(sd.experiences) ? sd.experiences.length
        : Array.isArray(sd.experience) ? sd.experience.length : 'UNKNOWN');
      kv('  project count', Array.isArray(sd.projects) ? sd.projects.length : 'UNKNOWN');
      kv('  skills count', Array.isArray(sd.skills) ? sd.skills.length
        : (sd.skills && typeof sd.skills === 'object') ? Object.keys(sd.skills).length : 'UNKNOWN');
      kv('  name field', sd.name || sd.full_name || '(absent)');
    }
    if (kind === 'jd' && sd) {
      kv('  title', sd.title ?? '(absent)');
      kv('  company', sd.company ?? '(absent)');
      kv('  level', sd.level ?? '(absent)');
      kv('  requirements count', Array.isArray(sd.requirements) ? sd.requirements.length : 'UNKNOWN');
      kv('  responsibilities count', Array.isArray(sd.responsibilities) ? sd.responsibilities.length : 'UNKNOWN');
      kv('  technologies count', Array.isArray(sd.technologies) ? sd.technologies.length : 'UNKNOWN');
      kv('  nice_to_haves count', Array.isArray(sd.nice_to_haves) ? sd.nice_to_haves.length : 'UNKNOWN');
      kv('  keywords count', Array.isArray(sd.keywords) ? sd.keywords.length : 'UNKNOWN');
      kv('  compensation_hint (salary)', sd.compensation_hint ?? '(absent — no salary field)');
      kv('  relocation field?', ('relocation' in (sd || {})) ? sd.relocation : 'ABSENT (schema has none)');
      kv('  _extraction_mode', sd._extraction_mode ?? '(absent)');
      kv('  _schema_version', sd._schema_version ?? '(absent)');
    }
  }

  h2('RESUME DOCUMENTS');
  const resumes = docsOfType('resume');
  kv('resume row count', resumes.length);
  if (resumes.length === 0) console.log('   (no resume stored)');
  resumes.forEach((r, i) => { console.log(`\n   -- resume[${i}] ${i === 0 ? '(ACTIVE — latest created_at)' : '(stale/older)'} --`); reportDoc(r, 'resume'); });

  h2('JD DOCUMENTS');
  const jds = docsOfType('job_description');
  kv('JD row count', jds.length);
  if (jds.length === 0) console.log('   (no JD stored)');
  jds.forEach((r, i) => { console.log(`\n   -- jd[${i}] ${i === 0 ? '(ACTIVE — latest created_at)' : '(stale/older)'} --`); reportDoc(r, 'jd'); });

  const activeJd = jds[0] || null;
  const activeResume = resumes[0] || null;

  // -------------------------------------------------------------------------
  // 3. AOT artifacts and staleness relative to the ACTIVE JD id.
  // -------------------------------------------------------------------------
  h2('AOT ARTIFACTS (aot_results)');
  if (!tableExists(db, 'aot_results')) {
    console.log('   UNKNOWN: aot_results table absent.');
  } else {
    const aot = db.prepare('SELECT id, document_id, result_type, LENGTH(result_json) AS len, created_at FROM aot_results ORDER BY document_id, result_type').all();
    kv('aot row count', aot.length);
    for (const a of aot) {
      const stale = activeJd ? (a.document_id !== activeJd.id) : true;
      console.log(`   - type=${String(a.result_type).padEnd(20)} doc_id=${a.document_id} len=${a.len} created=${a.created_at} ${stale ? '  <-- STALE (not active JD id ' + (activeJd ? activeJd.id : 'none') + ')' : '  [tied to active JD]'}`);
    }
    if (activeJd) {
      const introRow = aot.find(a => a.document_id === activeJd.id && a.result_type === 'intro');
      kv('AOT intro for active JD?', introRow ? `YES (len=${introRow.len}) — this is the "Serving precomputed (AOT) intro" source` : 'no');
    }
  }

  // -------------------------------------------------------------------------
  // context_nodes for the active JD (what retrieval can see)
  // -------------------------------------------------------------------------
  h2('CONTEXT NODES (chunked/embedded retrieval units)');
  if (tableExists(db, 'context_nodes')) {
    const bySource = db.prepare('SELECT source_type, COUNT(*) AS n FROM context_nodes GROUP BY source_type').all();
    for (const b of bySource) kv(`nodes source_type=${b.source_type}`, b.n);
    if (activeJd) {
      const jdNodes = db.prepare('SELECT COUNT(*) AS n FROM context_nodes WHERE document_id = ?').get(activeJd.id);
      kv(`nodes tied to ACTIVE JD id=${activeJd.id}`, jdNodes.n);
      const sample = db.prepare('SELECT category, title, SUBSTR(text_content,1,80) AS snippet FROM context_nodes WHERE document_id = ? LIMIT 8').all(activeJd.id);
      for (const s of sample) console.log(`     · [${s.category}] ${s.title} :: ${s.snippet}`);
      // Does JD text mention the analyst framing seen in the answers?
      const analyst = db.prepare("SELECT COUNT(*) AS n FROM context_nodes WHERE document_id = ? AND (LOWER(text_content) LIKE '%analyst%' OR LOWER(text_content) LIKE '%etl%' OR LOWER(text_content) LIKE '%data pipeline%' OR LOWER(text_content) LIKE '% r %' OR LOWER(text_content) LIKE '%power bi%' OR LOWER(text_content) LIKE '%tableau%')").get(activeJd.id);
      kv('active-JD nodes matching analyst/ETL/BI terms', analyst.n + (analyst.n === 0 ? '  (=> analyst framing is NOT from the JD)' : ''));
    }
  } else {
    console.log('   UNKNOWN: context_nodes table absent.');
  }

  // -------------------------------------------------------------------------
  // OKF profile packs (secondary mirror), if present.
  // -------------------------------------------------------------------------
  h2('OKF PROFILE PACKS (secondary mirror)');
  const packTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%pack%' OR name LIKE '%okf%' OR name LIKE '%knowledge_source%')").all();
  if (packTables.length === 0) {
    console.log('   (no pack/okf tables found by name heuristic — see ProfilePackBuilder / KnowledgePackStore for actual table names)');
  } else {
    for (const t of packTables) {
      try {
        const n = db.prepare(`SELECT COUNT(*) AS n FROM ${t.name}`).get();
        kv(`table ${t.name}`, `${n.n} rows`);
      } catch { kv(`table ${t.name}`, 'unreadable'); }
    }
  }

  // -------------------------------------------------------------------------
  // INVARIANT VERDICTS
  // -------------------------------------------------------------------------
  h1('INVARIANT VERDICTS (Phase 12 — storage subset)');
  const verdict = (name, pass, evidence) => console.log(`   [${pass === true ? 'PASS' : pass === false ? 'FAIL' : 'UNKNOWN'}] ${name}\n          ${evidence}`);

  verdict('I3 active JD raw text available',
    false,
    'Schema has NO raw-text column. Only structured_data JSON + source_uri (a file path that may no longer exist). Raw JD text is transient in memory during ingest only.');

  verdict('I4 active JD structured data available',
    activeJd ? Boolean(safeParse(activeJd.structured_data)) : false,
    activeJd ? `active JD id=${activeJd.id}, structured_data hash=${hashOf(activeJd.structured_data)}` : 'no JD stored');

  if (activeJd) {
    const sd = safeParse(activeJd.structured_data) || {};
    const reqN = Array.isArray(sd.requirements) ? sd.requirements.length : 0;
    const respN = Array.isArray(sd.responsibilities) ? sd.responsibilities.length : 0;
    verdict('JD structured content is non-degenerate',
      (reqN + respN) > 0,
      `requirements=${reqN} responsibilities=${respN} title=${JSON.stringify(sd.title)} _extraction_mode=${sd._extraction_mode}`);
    verdict('JD has a salary field',
      typeof sd.compensation_hint === 'string' && sd.compensation_hint.length > 0,
      `compensation_hint=${JSON.stringify(sd.compensation_hint)} (the ONLY salary-ish field; "salary"/"relocation" are not in schema)`);
  }

  verdict('I2 old JDs deactivated on re-upload',
    jds.length <= 1 ? true : 'UNKNOWN',
    `${jds.length} JD row(s). Ingest deletes-before-insert, so >1 row means either concurrent ingest or a path that skipped delete.`);

  if (tableExists(db, 'aot_results') && activeJd) {
    const staleAot = db.prepare('SELECT COUNT(*) AS n FROM aot_results WHERE document_id != ?').get(activeJd.id);
    verdict('I6 AOT artifacts tied to active JD (no orphans)',
      staleAot.n === 0,
      `${staleAot.n} aot_results row(s) point at a NON-active document_id. CASCADE should have removed them on re-upload.`);
  }

  console.log('\nNEXT STEP: run trace-jd-question-flow.mjs to see whether this stored JD actually reaches the final prompt for JD-only questions.');
  db.close();
}

main();
