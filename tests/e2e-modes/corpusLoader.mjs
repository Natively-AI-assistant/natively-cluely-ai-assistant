// tests/e2e-modes/corpusLoader.mjs
// Loads the Phase-1 corpus + question bank, extracts document text using the
// app's OWN pdf-parse (so ingestion mirrors the real upload path), and provides
// the mode↔document mapping for the Phase-4 matrix.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFParse } from 'pdf-parse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
export const CORPUS_DIR = path.join(REPO, 'test-fixtures/modes-corpus');

const _cache = new Map();

/**
 * Read the real Gemini API key from natively-api/.env WITHOUT printing it, so the
 * Electron app under test uses cloud Gemini embeddings (768d) for reference files
 * — the mission's intended embedding provider — instead of the local MiniLM (384d)
 * fallback. Returns '' if not found. The value is only ever placed into the launch
 * env; it is never logged.
 */
export function loadGeminiKeyFromEnv() {
  return loadGeminiKeysFromEnv()[0] || '';
}

/**
 * Return ALL Gemini keys from natively-api/.env (GEMINI_API_KEY, _2.._6, then
 * GOOGLE_API_KEY) in order, WITHOUT printing them. The matrix picks the first one
 * that passes a live probe so a rate-limited primary key doesn't force the app
 * onto the local fallback. Values are only placed into the launch env, never logged.
 */
export function loadGeminiKeysFromEnv() {
  try {
    const envPath = path.join(REPO, 'natively-api/.env');
    if (!fs.existsSync(envPath)) return [];
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    const names = ['GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'GEMINI_API_KEY_4', 'GEMINI_API_KEY_5', 'GEMINI_API_KEY_6', 'GOOGLE_API_KEY'];
    const keys = [];
    for (const key of names) {
      for (const line of lines) {
        const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`));
        if (m) {
          let v = m[1].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
          if (v && !v.startsWith('#') && !keys.includes(v)) keys.push(v);
        }
      }
    }
    return keys;
  } catch { return []; }
}

/**
 * Probe each Gemini key against the embedding endpoint and return the first that
 * works (200), along with the model it succeeded on. Tries gemini-embedding-2 then
 * gemini-embedding-001. Returns { key, model } or null. Never logs the key value.
 */
export async function pickWorkingGeminiEmbedKey() {
  const keys = loadGeminiKeysFromEnv();
  for (const key of keys) {
    for (const model of ['gemini-embedding-2', 'gemini-embedding-001']) {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ content: { parts: [{ text: 'probe' }] }, outputDimensionality: 768 }),
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) return { key, model };
      } catch { /* try next */ }
    }
  }
  return null;
}

/** Extract text with [Page N] markers, exactly like the app's upload handler. */
export async function extractText(relPath) {
  if (_cache.has(relPath)) return _cache.get(relPath);
  const abs = path.join(CORPUS_DIR, relPath);
  const ext = path.extname(abs).toLowerCase();
  let out = { text: '', pages: 0 };
  if (ext === '.pdf') {
    const buf = fs.readFileSync(abs);
    const parser = new PDFParse({ data: buf });
    const res = await parser.getText();
    let text = '';
    if (res.pages && res.pages.length) {
      res.pages.forEach((p, i) => { text += `[Page ${i + 1}]\n${p.text || ''}\n`; });
    } else {
      text = res.text || '';
    }
    out = { text, pages: res.total || res.pages?.length || 0 };
  } else {
    // txt/md/csv/json → raw text (mirrors the plain-text branch of the upload handler)
    out = { text: fs.readFileSync(abs, 'utf8'), pages: 0 };
  }
  _cache.set(relPath, out);
  return out;
}

export function loadManifest() {
  return JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, 'manifest.json'), 'utf8'));
}

export function loadQuestionBank() {
  const raw = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, 'question-bank.json'), 'utf8'));
  return Array.isArray(raw) ? raw : raw.questions;
}

// The 10 mission modes, keyed by generator brief key, with:
//  - the generated-mode artifact key
//  - whether the mode is document-grounded
//  - which corpus documents to ingest for that mode's session
//  - the question-bank targetModes label used to select questions
export const MODE_PLAN = [
  {
    key: 'backend-eng', label: '1 Senior Backend Engineering Interview', grounded: false,
    documents: [], // non-grounded: answers from general expertise (papers optional context)
  },
  {
    key: 'behavioral-hr', label: '2 Behavioral/HR', grounded: false,
    documents: ['thesis/seminar_real_thesis.pdf'], // Data Analyst JD (see manifest gotcha)
  },
  {
    key: 'thesis-defense', label: '3 Academic Thesis Defense', grounded: true,
    documents: ['thesis/institutional_thesis.pdf'],
  },
  {
    key: 'data-analyst', label: '4 Data Analyst Screening', grounded: true,
    documents: ['datasets/gapminder2007.csv', 'datasets/gdp_worldbank.csv'],
  },
  {
    key: 'sales-discovery', label: '5 Sales Discovery', grounded: false,
    documents: [], // non-grounded: tests discovery technique/format, not doc facts
  },
  {
    key: 'investor-pitch', label: '6 Investor Pitch Q&A', grounded: true,
    documents: ['datasets/gapminder2007.csv', 'slides/cs231n_lecture.pdf'],
  },
  {
    key: 'consulting-case', label: '7 Consulting Case', grounded: false,
    documents: [], // non-grounded: tests case structure/framework, not doc facts
  },
  {
    key: 'legal-compliance', label: '8 Legal/Compliance Q&A', grounded: true,
    documents: ['docs/rfc8259_json.txt', 'thesis/institutional_thesis.pdf'],
  },
  {
    key: 'conference-talk', label: '9 Technical Conference Talk Q&A', grounded: true,
    documents: ['papers/attention_is_all_you_need_1706.03762.pdf', 'papers/bert_1810.04805.pdf', 'papers/resnet_1512.03385.pdf'],
  },
  {
    key: 'support-escalation', label: '10 Customer Support Escalation', grounded: true,
    documents: ['docs/rfc8259_json.txt'], // knowledge-base doc stand-in
  },
];

function planForLabel(modeLabel) {
  return MODE_PLAN.find((p) => p.label === modeLabel);
}

/**
 * Questions valid for a mode = targetModes includes the mode's label AND the
 * question's targetDocuments are a SUBSET of the docs that mode actually ingests.
 *
 * This is the fix for the mapping bug that produced "false refusals": a question
 * whose answer lives in a document the mode never ingested was being asked of that
 * mode, the model CORRECTLY refused, and the scorer penalized it. By requiring
 * targetDocuments ⊆ ingested documents, a doc-specific question only reaches a
 * mode that can actually answer it. Questions with no targetDocuments (expertise /
 * format questions for non-grounded modes) are always allowed for their target
 * mode. no-answer questions still map onto docs the mode HAS (the fact is simply
 * absent from those docs), so they pass the subset test correctly.
 *
 * Pass { strictDocs:false } to disable the subset filter (label-only, legacy).
 */
export function questionsForMode(bank, modeLabel, opts = {}) {
  const strictDocs = opts.strictDocs !== false;
  const plan = planForLabel(modeLabel);
  const ingested = new Set(plan ? plan.documents : []);
  return bank.filter((q) => {
    if (!(q.targetModes || []).includes(modeLabel)) return false;
    if (!strictDocs) return true;
    const targets = q.targetDocuments || [];
    return targets.every((d) => ingested.has(d));
  });
}

/**
 * Audit helper: for every question, report modes it is labelled for but whose
 * ingested docs do NOT cover its targetDocuments (a mapping error). Returns an
 * array of { id, mode, missingDocs }.
 */
export function auditMapping(bank) {
  const problems = [];
  for (const q of bank) {
    for (const label of q.targetModes || []) {
      const plan = planForLabel(label);
      if (!plan) { problems.push({ id: q.id, mode: label, missingDocs: ['<unknown mode label>'] }); continue; }
      const ingested = new Set(plan.documents);
      const missing = (q.targetDocuments || []).filter((d) => !ingested.has(d));
      if (missing.length) problems.push({ id: q.id, mode: label, missingDocs: missing });
    }
  }
  return problems;
}

/** All follow-up questions that depend on a given question id. */
export function followUpsOf(bank, qid) {
  return bank.filter((q) => q.followUpOf === qid);
}
