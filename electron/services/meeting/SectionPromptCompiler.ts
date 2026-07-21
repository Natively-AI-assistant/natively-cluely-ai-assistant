// SectionPromptCompiler.ts
// Meta-prompting: turns an under-specified note-section definition (title + description +
// meeting mode) into a precise, self-contained, anti-hallucination EXTRACTION INSTRUCTION
// that the chunk extractor later uses to fill that section faithfully from a transcript.
//
// Compiled once when a user adds/edits a section or creates a custom mode (fire-and-forget,
// never blocks the UI), cached in mode_note_sections.compiled_prompt. Empty/failed → the
// extractor falls back to title+description.
//
// Routed through generateStructured so the output is validated and repaired; a deterministic
// template is the guaranteed fallback so a section ALWAYS has a usable instruction.
//
// Privacy: sends only the section title/description/mode (user config) — never transcript or
// note content.

import type { LLMHelper } from '../../LLMHelper';
import { generateStructured } from './generateStructured';

export interface CompileSectionParams {
  sectionTitle: string;
  sectionDescription: string;
  meetingMode?: string;
}

const EMPTY_SENTINEL = 'Not discussed.';

// The meta-prompt that writes the per-section extraction instruction. Derived from the
// Phase-16b prompting research (Anthropic grounding-by-quotation + permission-to-be-empty +
// no-inference + self-check). The compiler WRITES an instruction; it does not extract.
function buildMetaPrompt(params: CompileSectionParams): { systemPrompt: string; jsonShapeHint: string } {
  const systemPrompt = `You are a prompt compiler. Turn an under-specified meeting-notes section definition into a single, precise, self-contained EXTRACTION INSTRUCTION that another model will later run against a raw meeting transcript chunk to fill THIS ONE section.

You are NOT extracting anything now. You are WRITING the instruction.

SECTION DEFINITION:
- Title: ${params.sectionTitle}
- Description: ${params.sectionDescription || '(none provided)'}
- Meeting mode: ${params.meetingMode || 'general'}

Interpret the definition:
1. SCOPE — read the title's noun and the description's verbs to infer the concrete, observable signals to capture. Name them explicitly; do not merely restate the title. Resolve ambiguity using the meeting mode as domain context.
2. ANTI-SCOPE — state what to EXCLUDE: statements by other speakers when the section is speaker-specific, the model's own inferences, generic commentary, and anything off-topic.
3. FORMAT — choose a compact shape implied by the definition: discrete one-sentence bullets for lists; a short paragraph for summaries; an item-with-owner list for next-steps. State item-count range and length concretely.
4. ABSENCE — when the subject was not discussed, the section must output exactly "${EMPTY_SENTINEL}".

When unsure how broad the scope is, choose the NARROWEST defensible reading and rely on the empty-if-absent rule. Never widen scope by guessing.

The instruction you emit MUST, by construction:
- Start with one line stating exactly what to extract for this section.
- Say: "Use ONLY the transcript provided. Do not use outside knowledge, assumptions, or typical-meeting patterns."
- Forbid inference/embellishment and forbid attributing a statement to a speaker unless the transcript clearly shows it; forbid inventing names, numbers, dates, or fields.
- Specify the output format (and speaker attribution rule if relevant).
- Include the explicit empty-output contract using the exact sentinel "${EMPTY_SENTINEL}".
- Be self-contained (it will be used with no other context).

Never instruct fabrication, estimation, or filling gaps with assumptions. Keep the instruction under 120 words.`;

  const jsonShapeHint = `{
  "instruction": "the finished, self-contained extraction instruction for this section"
}`;

  return { systemPrompt, jsonShapeHint };
}

// Deterministic fallback instruction — always valid, used when the LLM is unavailable,
// scope-denied, or returns nothing usable.
export function deterministicSectionInstruction(params: CompileSectionParams): string {
  const desc = params.sectionDescription?.trim();
  return [
    `Extract content for the section "${params.sectionTitle}"${desc ? `: ${desc}` : '.'}`,
    `Use ONLY the transcript provided. Do not use outside knowledge or assumptions, and do not infer or attribute statements to a speaker unless the transcript clearly shows it. Do not invent names, numbers, or dates.`,
    `Output concise one-sentence bullet points, each traceable to the transcript. If this was not discussed, output exactly: ${EMPTY_SENTINEL}`,
  ].join(' ');
}

function isUsableInstruction(text: string): boolean {
  if (!text || text.trim().length < 40) return false;
  // Guardrail: a usable compiled instruction must carry the empty-if-absent contract and a
  // source-only/no-outside-knowledge clause; otherwise reject and fall back.
  const hasEmpty = text.includes(EMPTY_SENTINEL) || /empty|not discussed|nothing/i.test(text);
  const hasSourceOnly = /only the transcript|only use the transcript|do not use outside|no outside knowledge/i.test(text);
  return hasEmpty && hasSourceOnly;
}

export class SectionPromptCompiler {
  constructor(private readonly llmHelper: LLMHelper) {}

  async compile(params: CompileSectionParams): Promise<{ instruction: string; compiled: boolean }> {
    const fallback = deterministicSectionInstruction(params);
    if (!params.sectionTitle?.trim()) return { instruction: fallback, compiled: false };

    const { systemPrompt, jsonShapeHint } = buildMetaPrompt(params);
    try {
      const result = await generateStructured<{ instruction: string }>({
        schemaName: 'SectionExtractionInstruction',
        systemPrompt,
        jsonShapeHint,
        userContent: `Compile the extraction instruction for section "${params.sectionTitle}".`,
        llmHelper: this.llmHelper,
        validate: (raw) => {
          const text = (raw && typeof raw === 'object') ? String((raw as any).instruction || '').trim() : '';
          if (!isUsableInstruction(text)) return { ok: false, errors: ['instruction missing required guardrail clauses'], repaired: false };
          return { ok: true, data: { instruction: text.slice(0, 1200) }, errors: [], repaired: false };
        },
      });
      if (result.ok && result.data && isUsableInstruction(result.data.instruction)) {
        return { instruction: result.data.instruction, compiled: true };
      }
    } catch (e) {
      console.warn('[SectionPromptCompiler] compile failed (non-fatal):', (e as Error)?.message);
    }
    return { instruction: fallback, compiled: false };
  }
}
