// E23: a derived experience statement is evidence only when the résumé's own text supports the pairing it states.
//
// The rule (ITERATIONS-ER.md, E23) is in pairingProblem / rejectedEntries below, written to be ported to
// electron/context-intelligence/retrieval/profile-derived-support.ts unchanged. The replay arm applies it to the
// recorded answer prompt: the entries are read back from the "Experience: <title> at <company>" sections, the résumé
// text from the "Document (whole)" block of the same prompt, and when any entry is rejected every derived experience
// block of that résumé is removed (per-entry sections, the complete-history line, the per-role cards).

const PAGE_MARK = /^(?:\[\s*page\s*\d+\s*\]|-{2,}\s*\d+\s*of\s*\d+\s*-{2,}|page\s*\d+(?:\s*of\s*\d+)?)$/i;
const CORP_ABBR = /\b(?:inc|ltd|llc|llp|co|corp|plc|gmbh|pvt|pte|bv|ag|oy|ab|sa|srl|kk|s\.a|s\.l|s\.r\.l)\.$/i;
const wordCount = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean).length;
const norm = (s) => String(s ?? '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const stripLead = (l) => l.replace(/^(?:[•·▪◦*\-–—]|\d+[.)])\s+/, '');

export const MAX_COMPANY_WORDS = 10;
export const MAX_TITLE_WORDS = 12;
/** A company named at most this many text lines BELOW the title line still belongs to it ("Title\nCompany | dates"). */
export const COMPANY_BELOW_TITLE_MAX_LINES = 2;
/** Another entry's company "stands alone" on a line when it makes up at least this share of the line. */
export const STANDALONE_SHARE = 0.6;

/** A reason the entry cannot be what the résumé says, or null. Shape first, then position in the résumé text. */
export function pairingProblem(entry, others, lines) {
  const title = String(entry.role ?? '').trim(), company = String(entry.company ?? '').trim();
  if (company) {
    if (PAGE_MARK.test(company)) return 'company_is_page_marker';
    if (wordCount(company) > MAX_COMPANY_WORDS) return 'company_too_long';
    if (/\.$/.test(company) && !CORP_ABBR.test(company)) return 'company_ends_a_sentence';
  }
  if (title && wordCount(title) > MAX_TITLE_WORDS) return 'title_too_long';
  if (!title || !company || !lines) return null;
  const t = norm(title), c = norm(company);
  const titleLines = [], companyLines = [];
  lines.forEach((l, i) => { if (stripLead(l).startsWith(t)) titleLines.push(i); if (l.includes(c)) companyLines.push(i); });
  if (!titleLines.length || !companyLines.length) return null;   // cannot be checked: nothing shows it is wrong
  const otherNames = [...new Set(others.map((o) => norm(o.company)).filter((n) => n && n !== c))];
  const standalone = (i) => otherNames.some((n) => lines[i].includes(n) && n.length >= STANDALONE_SHARE * lines[i].length);
  for (const r of titleLines) {
    for (const k of companyLines) {
      if (k > r + COMPANY_BELOW_TITLE_MAX_LINES) continue;
      let crossed = false;
      for (let j = k + 1; j < r; j++) if (standalone(j)) { crossed = true; break; }
      if (!crossed) return null;
    }
  }
  return 'pairing_not_in_the_text';
}

/** The résumé's text as lines the rule counts: page markers and empty lines are not lines. */
export function textLines(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) return null;
  return rawText.split('\n').map(norm).filter((l) => l && !PAGE_MARK.test(l));
}

export function rejectedEntries(entries, rawText) {
  const lines = textLines(rawText);
  const shapeOk = entries.filter((e) => !pairingProblem(e, [], null));
  return entries.map((e) => ({ entry: e, problem: pairingProblem(e, shapeOk.filter((o) => o !== e), lines) })).filter((x) => x.problem);
}

// ---------------------------------------------------------------- the replay arm
const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const BLOCK = /<evidence\b([^>]*)>([\s\S]*?)<\/evidence>\n?\n?/g;
const attr = (tag, name) => unescape((tag.match(new RegExp(`\\b${name}="([^"]*)"`)) ?? [])[1] ?? '');

export function analyse(user) {
  const blocks = [...user.matchAll(BLOCK)].map((m) => ({ full: m[0], tag: m[1], body: m[2], type: attr(m[1], 'source_type'), section: attr(m[1], 'section'), source: attr(m[1], 'source_id') }));
  const out = [];
  for (const source of new Set(blocks.filter((b) => b.type === 'RESUME').map((b) => b.source))) {
    const mine = blocks.filter((b) => b.type === 'RESUME' && b.source === source);
    const whole = mine.find((b) => b.section === 'Document (whole)');
    const derived = mine.filter((b) => b.section.startsWith('Experience: ') || b.section === 'Complete employment history' || /Key contributions from the resume:/.test(b.body));
    const entries = mine.filter((b) => b.section.startsWith('Experience: ')).map((b) => {
      const head = b.section.slice('Experience: '.length); const i = head.indexOf(' at ');
      return i < 0 ? { role: head, company: '' } : { role: head.slice(0, i), company: head.slice(i + 4) };
    });
    // the complete-history line lists every entry, also those whose own section was not retrieved on this turn
    const index = mine.find((b) => b.section === 'Complete employment history');
    if (index) {
      const list = unescape(index.body).replace(/^[\s\S]*?résumé:\s*/, '').replace(/\.\s*No other employment is listed\.\s*$/, '');
      for (const part of list.split('; ')) {
        const head = part.replace(/\s*\((?:\d{4}(?:-\d{2})?)(?:\s+to\s+(?:\d{4}(?:-\d{2})?|present))?\)\s*$/i, '').trim(); if (!head) continue;
        const i = head.indexOf(' at '); const e = i < 0 ? { role: head, company: '' } : { role: head.slice(0, i), company: head.slice(i + 4) };
        if (!entries.some((x) => x.role === e.role && x.company === e.company)) entries.push(e);
      }
    }
    const rejected = whole ? rejectedEntries(entries, unescape(whole.body)) : rejectedEntries(entries, null);
    out.push({ source, hasWhole: !!whole, entries, rejected, derived });
  }
  return out;
}

export function transform({ system, user }) {
  let u = user;
  for (const r of analyse(user)) if (r.rejected.length) for (const b of r.derived) u = u.replace(b.full, '');
  return { system, user: u };
}
