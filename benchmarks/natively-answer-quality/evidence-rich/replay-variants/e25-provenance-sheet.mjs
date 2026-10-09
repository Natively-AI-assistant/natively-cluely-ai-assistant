// E25: the fix-up pass is shown, for each sentence of the draft, the passages of the material closest to it and the
// document each comes from. The matching is done by a program (words in common, weighted by how rare they are in
// this material); the pass keeps its own instructions and one paragraph is added that says what the sheet is for.
// Nothing is asked of the pass per statement and its output format does not change.
const STOP = new Set('a an and are as at be been but by can could did do does for from had has have he her his i if in into is it its just like may me my no not of on or our she so some than that the their them then there these they this to up us was we were what when which who will with would you your yours about after all also any because before being between both each few more most other over same should such only own very too once here how why where while during out off again further am im ive id ill were weve dont doesnt didnt cant wont isnt arent wasnt thats theres its lets one two get got going make made say said thing things way lot bit'.split(' '));
const stem = (w) => { if (/\d/.test(w)) return w.replace(/,/g, ''); let x = w; if (x.length > 4 && x.endsWith('ies')) x = `${x.slice(0, -3)}y`; else if (x.length > 3 && x.endsWith('s') && !/(ss|us|is)$/.test(x)) x = x.slice(0, -1); if (x.length > 5 && x.endsWith('ing')) x = x.slice(0, -3); else if (x.length > 4 && x.endsWith('ed')) x = x.slice(0, -2); return x; };
const tokens = (t) => (String(t).toLowerCase().replace(/[’']/g, '').match(/[a-z0-9][a-z0-9.,%$-]*[a-z0-9%]|[a-z0-9]/g) ?? []).map((w) => w.replace(/[.,]+$/, '')).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const clean = (s) => s.replace(/\[Page \d+\]/g, ' ').replace(/--\s*\d+\s*of\s*\d+\s*--/g, ' ').replace(/[ \t]+/g, ' ').trim();
const isHeading = (l) => l.length >= 3 && l.length <= 70 && !/[.;:,]$/.test(l) && !/^[•·▪◦*\-–—]/.test(l) && /^[A-Z0-9]/.test(l) && l.split(' ').length <= 9;
export const MAX_PASSAGE = 320, MIN_SCORE = 0.3, PER_SENTENCE = 2, MIN_CONTENT_WORDS = 4;

/** Passages of the material: each evidence block cut at blank lines and at about MAX_PASSAGE characters, with the heading above it. */
export function passagesOf(material) {
  const out = [];
  for (const m of material.matchAll(/<evidence\b([^>]*)>([\s\S]*?)<\/evidence>/g)) {
    const name = unescape((m[1].match(/source_name="([^"]*)"/) ?? [])[1] ?? 'document');
    let heading = ''; let buf = [];
    const flush = () => { const text = clean(buf.join(' ')); if (text.length >= 20) out.push({ source: name, heading, text }); buf = []; };
    for (const raw of unescape(m[2]).split('\n')) {
      const l = clean(raw);
      if (!l) { flush(); continue; }
      if (isHeading(l) && buf.length === 0) { heading = l.replace(/^#+\s*/, ''); buf.push(l); continue; }
      if (buf.join(' ').length + l.length > MAX_PASSAGE) flush();
      buf.push(l);
    }
    flush();
  }
  const conv = material.match(/# Conversation so far[^\n]*\n([\s\S]*?)(?=\n# |\n<evidence|$)/);
  if (conv) for (const l of conv[1].split('\n')) { const t = clean(l); if (t.length >= 20) out.push({ source: 'the conversation', heading: '', text: t }); }
  return out;
}
export function sentencesOf(draft) {
  const body = String(draft).replace(/\[\[GIST\]\][\s\S]*$/, '').replace(/\*\*/g, '');
  return body.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => tokens(s).length >= MIN_CONTENT_WORDS);
}
export function provenanceSheet(material, draft) {
  const passages = passagesOf(material); const sentences = sentencesOf(draft);
  if (!passages.length || !sentences.length) return '';
  const pt = passages.map((p) => new Set(tokens(`${p.heading} ${p.text}`)));
  const df = new Map(); for (const s of pt) for (const t of s) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t) => Math.log(1 + passages.length / (df.get(t) ?? 0.5));
  const lines = ['# Closest passages', 'For each sentence of the draft, the passages of the material above that share the most of its words, found by a program (it can miss). They are for checking the draft only.'];
  sentences.forEach((s, i) => {
    const st = [...new Set(tokens(s))]; const total = st.reduce((n, t) => n + idf(t), 0) || 1;
    const scored = pt.map((set, k) => ({ k, score: st.reduce((n, t) => n + (set.has(t) ? idf(t) : 0), 0) / total })).filter((x) => x.score >= MIN_SCORE).sort((a, b) => b.score - a.score).slice(0, PER_SENTENCE);
    lines.push(`${i + 1}. "${s.length > 260 ? `${s.slice(0, 257)}...` : s}"`);
    if (!scored.length) lines.push('   - no passage of the material shares its terms');
    for (const x of scored) { const p = passages[x.k]; lines.push(`   - [${p.source}${p.heading && !p.text.startsWith(p.heading) ? ` > ${p.heading}` : ''}] ${p.text.length > MAX_PASSAGE ? `${p.text.slice(0, MAX_PASSAGE)}...` : p.text}`); }
  });
  return lines.join('\n');
}
export const ADDED = '\nBetween the material and the draft there is a section "# Closest passages": for each sentence of the draft, the passages of the material nearest to it and the document each is from. Use it in Step 1. List a statement when its nearest passages say it of a different product, plan, tier, person, employer, study, lecture or date than the draft does, when they give a narrower rule, a smaller set or a condition the draft leaves out, or when no passage states it and it is of a listed kind. The match is by words and can miss: what the material supports anywhere is not listed, a figure worked out from stated figures is not listed, and everything in the never-list stays out of the list.';
export function systemPrompt(recorded) { return recorded + ADDED; }
export function message(request, ctx) {
  const mark = '\n\n---\nDRAFT REPLY:';
  const i = request.lastIndexOf(mark); if (i < 0) return request;
  const sheet = provenanceSheet(request.slice(0, i), ctx.draftBody);
  return sheet ? `${request.slice(0, i)}\n\n${sheet}${request.slice(i)}` : request;
}
