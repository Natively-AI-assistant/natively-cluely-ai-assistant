// Objective, read-only measurements of an answer. NOTHING here edits, cleans, or
// scores the answer text; every function takes the exact string the product produced.
// The diagnostic flags are plain substring checks, not quality judgements.
import crypto from 'node:crypto';

export const sha256 = (s) => crypto.createHash('sha256').update(s ?? '', 'utf8').digest('hex');

const GIST_RE = /\[\[GIST\]\][\s\S]*$/;
const stripGist = (t) => t.replace(GIST_RE, '');
const stripFences = (t) => t.replace(/```[\s\S]*?(```|$)/g, ' ');
const wordsOf = (t) => (t.trim() ? t.trim().split(/\s+/) : []);

export function sentenceCount(text) {
  const prose = stripFences(text).trim();
  if (!prose) return 0;
  const parts = prose.split(/(?<=[.!?…])["')\]]*\s+|\n{2,}/).map(s => s.trim()).filter(s => /[A-Za-z0-9]/.test(s));
  return parts.length;
}

export const DIAGNOSTIC_PATTERNS = {
  contains_good_interview_answer: ['good interview answer'],
  contains_fill_in_shape: ['fill-in shape', 'fill in shape', 'fill-in:', 'fill in the'],
  contains_follow_up_offer: ["if you'd like", 'if you would like', 'if you tell me', 'if you want me to', 'let me know if', 'want me to', 'would you like me', "i'm happy to", 'i can also'],
  contains_ai_help_offer: ['i can help you', 'i can help with', "i'd be happy to help", 'happy to help'],
  contains_coaching_language: ['you should say', 'you could say', 'you can say', 'you might say', "here's how to answer", 'here is how to answer', 'try saying', 'say something like', 'i would say to them', 'you should tell', 'you could tell them', 'suggested response'],
  contains_chatgpt_preamble: [], // handled by the start-of-answer check below
  contains_context_exposure: ['based on your resume', 'based on your résumé', 'according to your notes', 'according to the notes', 'based on your notes', "i don't have your background", 'do not have your background', 'background loaded', 'reference file', 'the file you uploaded', 'the document you', 'in the uploaded', 'the provided document', 'the provided material', 'attached file'],
};
const PREAMBLE_STARTS = ['sure', 'certainly', 'of course', 'absolutely', 'great question', "here's", 'here is', "here's how", "i'd be happy", 'i would be happy', 'happy to', 'as an ai', 'as a language model', 'okay, here', 'ok, here', 'let me help'];

export function diagnosticFlags(text) {
  const t = stripGist(text);
  const lower = t.toLowerCase();
  const out = {};
  const matched = {};
  for (const [flag, needles] of Object.entries(DIAGNOSTIC_PATTERNS)) {
    const hits = needles.filter(n => lower.includes(n));
    out[flag] = hits.length > 0;
    if (hits.length) matched[flag] = hits;
  }
  const head = lower.replace(/^[\s"'“”*_#>-]+/, '');
  const pre = PREAMBLE_STARTS.filter(p => head.startsWith(p));
  if (pre.length) { out.contains_chatgpt_preamble = true; matched.contains_chatgpt_preamble = pre; }
  return { flags: out, matched };
}

const HEADING_CONCEPTS = {
  approach: /\bapproach\b/i,
  technique: /\btechnique\b/i,
  code: /^\s*(the\s+)?code\b|\bimplementation\b/i,
  dry_run: /dry[\s-]?run/i,
  complexity: /\bcomplexity\b/i,
  interviewer_follow_up_points: /(interviewer\s+)?follow[\s-]?up\s+points?/i,
};

export function structureMetrics(answer) {
  const text = answer ?? '';
  const body = stripGist(text);
  const lines = body.split('\n');
  const inCode = [];
  let fence = false;
  for (const l of lines) { if (/^\s*```/.test(l)) { fence = !fence; inCode.push(true); } else inCode.push(fence); }
  const prose = lines.filter((_, i) => !inCode[i]);
  const headingLines = prose.filter(l => /^\s{0,3}#{1,6}\s+\S/.test(l));
  const boldLabelLines = prose.filter(l => /^\s*\*\*[^*\n]{2,60}\*\*\s*:?\s*$/.test(l));
  const bulletLines = prose.filter(l => /^\s*[-*•]\s+\S/.test(l));
  const numberedLines = prose.filter(l => /^\s*\d+[.)]\s+\S/.test(l));
  const fenceLines = lines.filter(l => /^\s*```/.test(l)).length;
  const headingTexts = [...headingLines, ...boldLabelLines].map(l => l.replace(/^\s*#{1,6}\s+/, '').replace(/\*\*/g, '').replace(/:\s*$/, '').trim());
  const concepts = Object.fromEntries(Object.entries(HEADING_CONCEPTS).map(([k, re]) => [k, headingTexts.some(h => re.test(h))]));
  const trimmed = body.trim();
  const openQ = /^["“]/.test(trimmed), closeQ = /["”]$/.test(trimmed);
  const words = wordsOf(text);
  const wordsNoGist = wordsOf(body);
  const paragraphs = body.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  return {
    word_count: words.length,
    word_count_excl_gist: wordsNoGist.length,
    character_count: text.length,
    sentence_count: sentenceCount(body),
    paragraph_count: paragraphs.length,
    line_count: body.split('\n').filter(l => l.trim()).length,
    estimated_speech_seconds: +(words.length / 150 * 60).toFixed(2),
    estimated_speech_seconds_excl_gist: +(wordsNoGist.length / 150 * 60).toFixed(2),
    has_headings: headingLines.length > 0,
    heading_count: headingLines.length,
    bold_label_line_count: boldLabelLines.length,
    heading_texts: headingTexts,
    heading_concepts: concepts,
    has_bullets: bulletLines.length > 0,
    bullet_count: bulletLines.length,
    has_numbered_list: numberedLines.length > 0,
    numbered_item_count: numberedLines.length,
    has_code_block: fenceLines > 0,
    code_block_count: Math.ceil(fenceLines / 2),
    has_whole_answer_quotes: openQ && closeQ && trimmed.length > 2,
    has_blockquote: prose.some(l => /^\s*>\s+\S/.test(l)),
    has_gist_marker: GIST_RE.test(text),
  };
}

// ---- percentiles: linear interpolation between closest ranks (NumPy default / Excel PERCENTILE.INC / R type 7)
export function percentile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank), hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}
export function describe(values) {
  const v = values.filter(x => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0 };
  const sum = v.reduce((a, b) => a + b, 0);
  return { n: v.length, mean: sum / v.length, min: v[0], p50: percentile(v, 50), median: percentile(v, 50), p90: percentile(v, 90), p95: percentile(v, 95), p99: percentile(v, 99), max: v[v.length - 1] };
}
