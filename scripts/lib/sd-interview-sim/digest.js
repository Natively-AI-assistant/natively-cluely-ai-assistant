// scripts/lib/sd-interview-sim/digest.js
//
// Review-ready markdown digests for T2 corpus bundles.
// Full raw JSON stays the source of truth for human deep review;
// digests skim overnight runs (truncated prose, full ASCII/mermaid fences).

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_PROSE_LIMIT = 400;
const FULL_IN_JSON = '…[full in json]';

/**
 * Split turn text into prose vs fenced code blocks; keep fences intact,
 * truncate prose segments to `proseLimit` chars.
 * @param {string} text
 * @param {number} [proseLimit]
 */
function truncateTurnText(text, proseLimit = DEFAULT_PROSE_LIMIT) {
  const raw = String(text || '');
  if (!raw) return '';

  const parts = [];
  const fenceRe = /```[\s\S]*?```/g;
  let last = 0;
  let m;
  while ((m = fenceRe.exec(raw)) !== null) {
    if (m.index > last) {
      parts.push({ kind: 'prose', value: raw.slice(last, m.index) });
    }
    parts.push({ kind: 'fence', value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < raw.length) {
    parts.push({ kind: 'prose', value: raw.slice(last) });
  }
  if (parts.length === 0) {
    parts.push({ kind: 'prose', value: raw });
  }

  let proseBudget = proseLimit;
  const out = [];
  for (const part of parts) {
    if (part.kind === 'fence') {
      out.push(part.value);
      continue;
    }
    const v = part.value;
    if (proseBudget <= 0) {
      if (v.trim()) out.push(`\n${FULL_IN_JSON}`);
      proseBudget = 0;
      continue;
    }
    if (v.length <= proseBudget) {
      out.push(v);
      proseBudget -= v.length;
    } else {
      const cut = v.slice(0, proseBudget).replace(/\s+$/, '');
      out.push(`${cut}\n${FULL_IN_JSON}\n`);
      proseBudget = 0;
    }
  }
  // Ensure fence blocks aren't glued to truncation markers.
  return out
    .join('')
    .replace(/(\[full in json\])```/g, '$1\n\n```');
}

/**
 * Best-effort soft tags for overnight triage (not CI oracles).
 * @param {object} bundle
 * @returns {string[]}
 */
function detectReviewTags(bundle) {
  const tags = new Set();
  const turns = Array.isArray(bundle?.turns) ? bundle.turns : [];
  const assistants = turns.filter((t) => t.role === 'assistant');

  if (
    assistants.some((t) => /```(?:text|ascii)\b/i.test(t.text || ''))
  ) {
    tags.add('ascii_hld_present');
  }
  if (
    turns.some(
      (t) =>
        /```mermaid\b/i.test(t.text || '') ||
        (t.attachments || []).some((a) => a.kind === 'mermaid'),
    )
  ) {
    tags.add('mermaid_present');
  }

  const mid = Math.floor(turns.length / 2);
  const lateAssistants = turns
    .slice(mid)
    .filter((t) => t.role === 'assistant');
  if (
    lateAssistants.some((t) =>
      /\*\*Functional Requirements:?\*\*|Requirements Draft:|Here is the current draft of our requirements/i.test(
        t.text || '',
      ),
    )
  ) {
    tags.add('candidate_rewind');
  }

  if (bundle?.provenance?.full_raw === true) {
    tags.add('full_raw');
  }

  // Speakable-SD acceptance (ticket 06): soft regression flags for overnight digests.
  const DSA_HEADING_RE =
    /^[ \t]*#{1,3}[ \t]*(?:\*\*)?[ \t]*(?:Approach|Technique(?:[ \t]*\/[ \t]*Data Structure(?:[ \t]*\/[ \t]*Algorithm Used)?)?|Data Structure|Algorithm Used|Code|Dry Run|Complexity|Interviewer Follow-up Points|Follow-up Points|Follow-ups)(?:\*\*)?[ \t]*(?::|[-–—])?[ \t]*$/im;
  const IMPL_FENCE_RE =
    /```(?:python|javascript|typescript|java|go|sql|cpp|c\+\+|c|rust|ruby|kotlin|swift|php|csharp|cs)\b/i;
  const REPAIR_MARKER_RE =
    /_\(repaired\)_|Missing (?:Code|Dry Run|Complexity) section|## (?:Code|Dry Run|Complexity)\s*\n\s*(?:\(missing\)|_missing_|\.\.\.|…)/i;

  if (assistants.some((t) => DSA_HEADING_RE.test(t.text || ''))) {
    tags.add('dsa_scaffold_bleed');
  }
  if (
    turns.some(
      (t) =>
        String(t.role || '').toLowerCase() === 'interviewer' &&
        IMPL_FENCE_RE.test(t.text || ''),
    )
  ) {
    tags.add('interviewer_impl_fence');
  }
  if (assistants.some((t) => REPAIR_MARKER_RE.test(t.text || ''))) {
    tags.add('dsa_repair_marker');
  }

  return [...tags].sort();
}

/**
 * Compact gate snapshot from last side_channel that has gateStatus.
 * @param {object} bundle
 */
function summarizeGate(bundle) {
  const channels = Array.isArray(bundle?.side_channels)
    ? bundle.side_channels
    : [];
  for (let i = channels.length - 1; i >= 0; i -= 1) {
    const g = channels[i]?.gateStatus;
    if (g && typeof g === 'object') {
      const bits = [];
      if (g.phase != null) bits.push(`phase=${g.phase}`);
      if (g.satisfied != null) bits.push(`satisfied=${g.satisfied}`);
      if (g.ready != null) bits.push(`ready=${g.ready}`);
      if (g.status != null) bits.push(`status=${g.status}`);
      const keys = Object.keys(g).slice(0, 6);
      if (bits.length === 0 && keys.length) {
        return keys.map((k) => `${k}=${JSON.stringify(g[k])}`).join(', ');
      }
      return bits.join(', ') || '(gate present)';
    }
  }
  return null;
}

/**
 * Build review-ready markdown for a finalized (or redacted) bundle.
 * @param {object} bundle
 * @param {{ proseLimit?: number, jsonFilename?: string }} [opts]
 */
function buildDigestMarkdown(bundle, opts = {}) {
  const proseLimit =
    opts.proseLimit != null ? opts.proseLimit : DEFAULT_PROSE_LIMIT;
  const runId = bundle?.run_id || 'unknown';
  const jsonName = opts.jsonFilename || `t2-${runId}.json`;
  const outcome = bundle?.outcome || {};
  const spend = outcome.spend || {};
  const prov = bundle?.provenance || {};
  const turns = Array.isArray(bundle?.turns) ? bundle.turns : [];
  const tags = detectReviewTags(bundle);
  const gate = summarizeGate(bundle);

  const lines = [
    `# SD interview digest — \`${runId}\``,
    '',
    'Skimmable review file. Full speech lives in the paired JSON.',
    '',
    '## Meta',
    '',
    `- **run_id:** \`${runId}\``,
    `- **end_reason:** ${outcome.end_reason ?? '(none)'}`,
    `- **turns:** ${turns.length}`,
    `- **estimated_usd:** ${spend.estimated_usd ?? '(n/a)'}`,
    `- **models:** \`${JSON.stringify(prov.models || {})}\``,
    `- **git_sha:** ${prov.git_sha ?? '(n/a)'}`,
    `- **tier:** ${prov.tier ?? '(n/a)'}`,
    `- **full_raw:** ${prov.full_raw === true ? 'yes' : 'no'}`,
    `- **json:** \`${jsonName}\``,
    `- **tags:** ${tags.length ? tags.map((t) => `\`${t}\``).join(', ') : '(none)'}`,
  ];
  if (gate) {
    lines.push(`- **gate (last):** ${gate}`);
  }
  lines.push('', '## Turns', '');

  turns.forEach((t, i) => {
    const role = String(t.role || 'unknown').toUpperCase();
    const n = t.idx != null ? t.idx + 1 : i + 1;
    lines.push(`### Turn ${n} — ${role}`, '');
    lines.push(truncateTurnText(t.text || '', proseLimit));
    lines.push('');
  });

  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * Write digest beside a corpus JSON path (or under corpusDir by run_id).
 * @param {object} bundle
 * @param {{ corpusDir?: string, jsonPath?: string, proseLimit?: number }} [opts]
 * @returns {{ path: string, markdown: string }}
 */
function writeCorpusDigest(bundle, opts = {}) {
  let digestPath;
  let jsonFilename;
  if (opts.jsonPath) {
    const base = opts.jsonPath.replace(/\.json$/i, '');
    digestPath = `${base}.digest.md`;
    jsonFilename = path.basename(opts.jsonPath);
  } else {
    const dir = opts.corpusDir || process.cwd();
    fs.mkdirSync(dir, { recursive: true });
    const runId = bundle?.run_id || 'unknown';
    jsonFilename = `t2-${runId}.json`;
    digestPath = path.join(dir, `t2-${runId}.digest.md`);
  }

  const markdown = buildDigestMarkdown(bundle, {
    proseLimit: opts.proseLimit,
    jsonFilename,
  });
  fs.writeFileSync(digestPath, markdown, 'utf8');
  return { path: digestPath, markdown };
}

module.exports = {
  DEFAULT_PROSE_LIMIT,
  FULL_IN_JSON,
  truncateTurnText,
  detectReviewTags,
  summarizeGate,
  buildDigestMarkdown,
  writeCorpusDigest,
};
