// electron/services/screen/technicalMode.ts
//
// "Is this a coding session?" — one predicate, shared by every place that has to
// keep a screenshot of code legible:
//   • ScreenUnderstandingService picks the sharper `technical` image preset, and
//   • the adaptive image-quality downgrade (llm/performance/wiring.ts) must never
//     shrink a screenshot in such a session ("Code is never shrunk").
// Two copies of this list would drift the first time a template is added.

const TECHNICAL_TEMPLATE_MARKERS = ['technical-interview', 'coding', 'debug', 'code-review'];

export function isTechnicalModeTemplate(modeTemplateType?: string | null): boolean {
  if (!modeTemplateType) return false;
  const t = modeTemplateType.toLowerCase();
  return TECHNICAL_TEMPLATE_MARKERS.some((m) => t.includes(m));
}
