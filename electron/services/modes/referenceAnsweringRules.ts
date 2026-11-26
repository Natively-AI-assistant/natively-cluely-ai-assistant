// The user's own answering rules, found inside a reference file they uploaded (autopilot 2026-11-27).
//
// People put "tips I wrote for myself", "phrases to avoid" and "my answer shape" in the same prep file as their
// stories and saved answers. Retrieval
// picks chunks by the question, so those rules reached a prompt only when the question happened to match them: with a
// prep-notes file loaded, judged answers used "honestly" (on the user's own avoid list) and broke the user's written
// length rule. This pulls the rule SECTIONS out by their headings, deterministically (no model call, no extra cost),
// so the composer can carry them on every turn of that mode as wording guidance.
//
// Headings only, never prose, and a hard character cap: a file whose sections are not headed as rules gives ''.
// Pure string work: no platform branches, same on macOS and Windows.

/**
 * A heading that names answering rules. A rule word alone is not enough: package docs and wikis are full of "Code
 * style", "Tips & Tricks" and "Rules" headings, so it needs an answering word too ("Interview tips", "Answer style",
 * "Tips I wrote for myself"), or is one of the unambiguous phrases ("Phrases to avoid", "How I answer").
 */
const RULE_WORD_RE = /\b(?:tips|rules|style|guidelines|do'?s and don'?ts|reminders)\b/i;
// Not "my", "me" or "delivery": "Rules for my team" and "Delivery guidelines" are not about answering.
const ANSWER_WORD_RE = /\b(?:interview(?:s|ing)?|answer(?:s|ing)?|speak(?:ing)?|talking|recruiter|myself)\b/i;
const RULES_PHRASE_RE = /\b(?:phrases?|words?) (?:to |i |i'd )?avoid\b|\bhow i (?:answer|speak|talk|want to (?:answer|sound))\b|\banswer(?:ing)? (?:shape|format|style)\b|\bpacing and delivery\b/i;
export function isAnsweringRulesHeading(heading: string): boolean {
  const h = String(heading ?? '');
  return RULES_PHRASE_RE.test(h) || (RULE_WORD_RE.test(h) && ANSWER_WORD_RE.test(h));
}

export const ANSWERING_RULES_MAX_CHARS = 3600;
/** A subsection that is rules only by its parent's heading and runs longer than this is pasted material, not a rule. */
const INHERITED_SECTION_MAX_CHARS = 1200;

interface Section { level: number; heading: string; body: string[] }

function sectionsOf(content: string): Section[] {
  const out: Section[] = [];
  let cur: Section | null = null;
  let inFence = false;
  for (const line of String(content ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const m = !inFence ? /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (m) {
      cur = { level: m[1].length, heading: m[2].trim(), body: [] };
      out.push(cur);
    } else if (cur) cur.body.push(line);
  }
  return out;
}

/**
 * The rule sections of one file: every section whose own heading, or an enclosing heading, names answering rules.
 * Code blocks are dropped (rules are prose), blank runs collapsed, and the result cut at whole lines to `maxChars`.
 */
export function extractAnsweringRules(content: string, maxChars = ANSWERING_RULES_MAX_CHARS): string {
  const sections = sectionsOf(content);
  const stack: Array<{ level: number; rules: boolean }> = [];
  const picked: string[] = [];
  const topLevel = sections.length ? Math.min(...sections.map((x) => x.level)) : 1;
  const titles = sections.filter((x) => x.level === topLevel).length;
  for (const [i, s] of sections.entries()) {
    while (stack.length && stack[stack.length - 1].level >= s.level) stack.pop();
    const own = isAnsweringRulesHeading(s.heading);
    const inherited = stack.some((x) => x.rules);
    // A file's only top-level heading is its title. "# Interview tips" titles a rules file; "# My interview tips and
    // notes" titles a mixed one, whose own text may be rules but whose other sections are not.
    const isTitle = i === 0 && s.level === topLevel && titles === 1 && /\b(?:notes|prep|docs|and)\b|&|\+/i.test(s.heading);
    const body: string[] = [];
    let fence = false;
    let ruleLine = false;
    for (const l of s.body) {
      if (/^\s*```/.test(l)) { fence = !fence; continue; }
      // A horizontal rule ends the block: what comes after it is not rules (the rest of this section is dropped).
      if (!fence && /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(l)) { ruleLine = true; break; }
      if (fence) continue;
      if (!l.trim() && (!body.length || !body[body.length - 1].trim())) continue;
      body.push(l.trimEnd());
    }
    while (body.length && !body[body.length - 1].trim()) body.pop();
    // Rules pass down only through a section that is itself kept: an empty or long section under a rules heading
    // ("## Saved docs: some-package", a pasted README) is other material, and so is everything under it.
    const keep = (own || inherited) && body.length > 0 && (own || body.join('\n').length <= INHERITED_SECTION_MAX_CHARS);
    // The first such section also ends the run for the sections after it: rules are written as one block, and what
    // follows a pasted document under the same parent is not rules either.
    if (inherited && !own && !keep) for (const x of stack) x.rules = false;
    stack.push({ level: s.level, rules: (own && !isTitle) || (inherited && keep) });
    if (ruleLine) for (const x of stack) x.rules = false;
    if (!keep) continue;
    picked.push(`${s.heading}:\n${body.join('\n')}`);
  }
  let text = '';
  for (const block of picked) {
    const next = text ? `${text}\n\n${block}` : block;
    if (next.length <= maxChars) { text = next; continue; }
    // Room for part of this block: whole lines only.
    for (const line of block.split('\n')) {
      const candidate = text ? `${text}\n${line}` : line;
      if (candidate.length > maxChars) return text;
      text = candidate;
    }
    return text;
  }
  return text;
}
