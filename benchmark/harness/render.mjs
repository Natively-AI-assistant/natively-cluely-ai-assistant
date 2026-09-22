// Renders a Natively V3 summary object (the saved detailedSummary) to Markdown in the order
// the app surfaces it: title, overview, Summary (tldr), mode template sections (rendered notes),
// then the structured blocks that drive export / follow-up (actions, decisions, questions,
// risks) and the follow-up draft. Nothing about the producing model is included.
export function renderSummary(s) {
  if (!s || s.schemaVersion !== 3) return '(no summary was produced)'
  const out = []
  out.push(`# ${s.title || 'Untitled'}`)
  if (s.overview) out.push(`## Overview\n${s.overview}`)
  if (s.tldr?.length) out.push(`## Summary\n${s.tldr.map(x => `- ${x}`).join('\n')}`)
  for (const sec of s.sectionsV3 || []) {
    out.push(`## ${sec.title}\n${sec.bullets.map(b => `- ${b.text}`).join('\n')}`)
  }
  const acts = s.actionItemsV3 || []
  out.push(`## Action items (structured)\n${acts.length ? acts.map(a => `- ${a.owner ? `${a.owner}: ` : ''}${a.text}${a.deadline ? ` (deadline: ${a.deadline})` : ''}${a.explicitness === 'inferred' ? ' [inferred]' : ''}`).join('\n') : '- none'}`)
  const dec = s.decisions || []
  out.push(`## Decisions (structured)\n${dec.length ? dec.map(d => `- ${d.text}${d.owner ? ` (owner: ${d.owner})` : ''}`).join('\n') : '- none'}`)
  const q = s.openQuestions || []
  out.push(`## Open questions (structured)\n${q.length ? q.map(x => `- ${x.text} [${x.status}]`).join('\n') : '- none'}`)
  const r = s.risks || []
  out.push(`## Risks (structured)\n${r.length ? r.map(x => `- [${x.severity}] ${x.text}`).join('\n') : '- none'}`)
  const fu = s.followUpDraft
  if (fu) out.push(`## Follow-up draft\n${typeof fu === 'string' ? fu : `${fu.subject ? `Subject: ${fu.subject}\n\n` : ''}${fu.body}`}`)
  return out.join('\n\n')
}
