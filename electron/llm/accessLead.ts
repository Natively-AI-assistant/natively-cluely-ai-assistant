// ACCESS LEAD (2026-09-30): a spoken reply that OPENS by reporting the
// speaker's own notes or records — "I don't have the Monday notes in front of
// me, so I can't confirm that freeze." — before the question that actually
// moves the conversation ("Can we check what we agreed before we treat the
// screens as locked?").
//
// The external judge scored these Team Meet replies 8.0–8.3 ("mainly explains
// why it cannot answer", "awkward personal disclaimer"), and in a chain the
// next reply copied the phrase from the user's own prior line. Two prompt
// wordings (with and without quoting the phrase) moved it 18 → 12 and 23 → 21
// of 120 replayed samples: the model's default opening outweighs the rule.
// The sentence carries nothing the listener needs once the reply goes on to
// ask or propose the check, so it is removed — the same shape as the no-story
// bridge in planningPreamble.ts.
//
// Narrow on purpose (each exclusion is a measured false positive on the fix5
// dev answers):
//   • only a sentence about notes, records or "in front of me" — "I can't
//     confirm a credit yet" (Call Center) is policy, not access;
//   • never when that sentence carries the reply's own commitment ("…, so I'll
//     confirm who the role reports to with the hiring manager") — DREC-031/032;
//   • only when what remains asks or proposes a check, and is a real sentence;
//   • spoken replies in Team Meet and Recruiting only; a typed answer may
//     legitimately explain its limits (DTEAM-014).

export const ACCESS_LEAD_MODES: ReadonlySet<string> = new Set(['team-meet', 'recruiting']);

const LEAD_RE = /^\s*((?:I (?:don'?t|do not) have|I haven'?t got|I can'?t (?:confirm|see|say)|I'?m not able to confirm|I don'?t see)\b[^.?!\n]{0,160}[.!](?:\s+|$))/;
const ACCESS_MARKER_RE = /\b(?:in front of me|(?:my|the|our|last week'?s|monday'?s|meeting) notes|a record|the record|on hand|to hand|from memory)\b/i;
const OWN_COMMITMENT_RE = /\b(?:I'?ll|I will|let me|I'?d (?:check|confirm))\b/i;
const MOVES_ON_RE = /\?|\b(?:let me|let'?s|can we|could we|I'?ll|I will|what I can|what I'?d)\b/i;

export interface AccessLeadResult { text: string; stripped: boolean }

export function stripAccessLead(answer: string, modeId: string | null | undefined): AccessLeadResult {
  const t = String(answer ?? '');
  const keep: AccessLeadResult = { text: t, stripped: false };
  if (!ACCESS_LEAD_MODES.has(String(modeId ?? ''))) return keep;
  const m = t.match(LEAD_RE);
  if (!m) return keep;
  const lead = m[1];
  if (!ACCESS_MARKER_RE.test(lead) || OWN_COMMITMENT_RE.test(lead)) return keep;
  const rest = t.slice(m[0].length);
  const body = rest.replace(/\n*\s*\[\[GIST\]\][\s\S]*$/, '');
  if (body.trim().split(/\s+/).filter(Boolean).length < 6 || !MOVES_ON_RE.test(body)) return keep;
  const out = rest.replace(/^\s*(?:So|But|And),?\s+/i, '');
  return { text: out.charAt(0).toUpperCase() + out.slice(1), stripped: true };
}
