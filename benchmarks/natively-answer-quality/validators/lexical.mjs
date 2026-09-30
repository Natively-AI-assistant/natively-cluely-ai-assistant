// Lexical detectors for the phrasing classes named in the 2026-09-30 review. These are objective string
// facts (did the answer SAY this), not quality judgments; the external judge decides what they cost.
//   epistemic — the copilot's retrieval state in words ("I don't have X in front of me", "not in the brief")
//   coaching  — describing what to say/do instead of saying it ("I'd start with…", "Ask them…", "You could say…")
//   meta      — narrating the moment ("The candidate is asking…", "The brief says…")
// Spoken (hotkey) surfaces only for coaching/meta: a typed private request may legitimately ask for advice.
const SPOKEN = (item) => item?.surface === 'hotkey' || item?.speaker === 'other';
export const PATTERNS = {
  epistemic: /\b(?:I don'?t have (?:the|that|those|a|any|it|my|specifics|details|exact|numbers?|figures?|a record)\b|in front of me|not (?:documented|in (?:the|your|my) (?:profile|resume|résumé|notes|brief|material|file|docs?|record))|(?:the|my|our) (?:notes|brief|material|document|file|sheet|profile|records?) (?:doesn'?t|don'?t|does not|do not) (?:say|state|cover|mention|specify|show)|I can'?t (?:confirm|see|pull)|I don'?t have a (?:specific|second|particular|good) (?:story|example)|nothing (?:here|in (?:the|my) notes) (?:says|states|covers))/i,
  coaching: /(?:^|\n|[.!?]\s+)(?:I'?d start (?:with|by)|I'?d (?:frame|open with|lead with|position)\b|I'?d say (?:something like|that)|You (?:could|can|should|might|may want to) (?:say|mention|ask|tell|frame|lead|open|answer|respond)|Ask (?:them|him|her|the candidate)\b|Tell (?:them|him|her|the candidate)\b|Focus on\b|Make sure (?:to|you)\b|Lead with\b|Something like:|Try:|Say:|(?:So )?[Aa]sk:|Push (?:on|for|them|him|her)\b|Probe (?:on|for|them|him|her)\b|Then (?:stay quiet|pause|let them)|Follow up with:|The interviewer (?:can'?t|should|needs|wants)|The recruiter (?:can'?t|should|needs|wants))/i,
  source_exposure: /\b(?:the|my|your) (?:résumé|resume|cv|profile|brief|notes|document|doc) (?:shows|says|lists|states|mentions|has|notes)\b|\baccording to (?:the|my|your)\b/i,
  meta: /\b(?:The (?:candidate|interviewer|prospect|customer|caller|user|speaker|student|examiner|recruiter) (?:is asking|asks|wants to know|is wondering|is checking|is pushing|seems)|The (?:brief|notes|sheet|doc(?:ument)?|policy) (?:says|states|covers|doesn'?t|does not|shows)|They'?re asking|They want to know|the question is)\b/i,
};
export function lexicalDetectors(answer, item) {
  const a = String(answer ?? '').replace(/\[\[GIST\]\][\s\S]*$/, '');
  const spoken = SPOKEN(item);
  const hit = (k) => { const m = a.match(PATTERNS[k]); return m ? m[0].trim().slice(0, 60) : null; };
  return { epistemic: hit('epistemic'), source_exposure: spoken ? hit('source_exposure') : null, coaching: spoken ? hit('coaching') : null, meta: spoken ? hit('meta') : null };
}
