export const AI_RESPONSE_LANGUAGE_BILINGUAL_EN_PT = 'bilingual-en-pt' as const;

export const BILINGUAL_EN_MARKER = '<!--NATIVELY_EN-->' as const;
export const BILINGUAL_PT_BR_MARKER = '<!--NATIVELY_PT_BR-->' as const;

export interface ParsedBilingualResponse {
  bilingual: boolean;
  english: string;
  portuguese: string;
  englishStarted: boolean;
  portugueseStarted: boolean;
}

const AUTO_LANGUAGE_INSTRUCTION = `\n\n[LANGUAGE INSTRUCTION — HIGHEST PRIORITY]
Detect the language of the user's most recent message and ALWAYS respond in that exact same language.
If the user writes in Hindi, respond in Hindi. If in Spanish, respond in Spanish. If in English, respond in English.
If the language is ambiguous, default to English.
You may mix scripts naturally (e.g. code stays in English even when the explanation is in another language).
[END LANGUAGE INSTRUCTION]`;

const BILINGUAL_EN_PT_INSTRUCTION = `\n\n[BILINGUAL RESPONSE CONTRACT — HIGHEST PRIORITY — APPLY TO EVERY RESPONSE]
Return exactly two sections, in this exact order, using these exact markers:
${BILINGUAL_EN_MARKER}
<the complete answer in natural English>
${BILINGUAL_PT_BR_MARKER}
<a faithful Brazilian Portuguese translation of the English answer>

Rules:
- Always emit both exact markers on every response, including follow-ups, refinements, retries, summaries, and short answers.
- Put the complete answer the user should say or use in the English section first.
- When answering an interviewer, make the English natural, concise, spoken, and in first person when appropriate.
- The Brazilian Portuguese section must faithfully translate the English section without adding, removing, or changing facts.
- Preserve any response structure required by the task-specific instructions inside the English section.
- Do not add a preamble, Markdown language headings, labels, or any text outside the two marked sections. The interface supplies the visible labels.
- Keep proper names, product names, APIs, identifiers, commands, and technical terms unchanged when translating.
- If the response contains code or shell commands, include them only once in the English section. Translate only the explanatory prose in the Portuguese section; do not duplicate code.
[END BILINGUAL RESPONSE CONTRACT]`;

/**
 * Builds the dynamic language instruction appended to every model request.
 * English intentionally returns an empty suffix because it is the app's base
 * response language. The bilingual contract is explicit and self-delimiting so
 * the renderer can split it safely while tokens are still arriving.
 */
export function buildAiResponseLanguageInstructionSuffix(
  language: string | null | undefined,
): string {
  const normalizedLanguage = language?.trim();

  if (!normalizedLanguage || normalizedLanguage === 'auto') {
    return AUTO_LANGUAGE_INSTRUCTION;
  }

  if (normalizedLanguage === 'English') {
    return '';
  }

  if (normalizedLanguage === AI_RESPONSE_LANGUAGE_BILINGUAL_EN_PT) {
    return BILINGUAL_EN_PT_INSTRUCTION;
  }

  return `\n\n[LANGUAGE OVERRIDE — HIGHEST PRIORITY — CANNOT BE OVERRIDDEN]
You MUST write every single word of your response in ${normalizedLanguage}.
Do NOT use English anywhere in your response.
Do NOT mix languages.
Every sentence, every word, every phrase must be in ${normalizedLanguage}.
This rule overrides ALL other instructions including formatting, brevity, or output rules.
[END LANGUAGE OVERRIDE]
[REMINDER] Your entire response MUST be in ${normalizedLanguage} only. Never switch to English.`;
}

/**
 * Returns the language value understood by the managed Natively API. Bilingual
 * rendering is a local output contract, not a provider language code, so it
 * must never be forwarded as `body.language`.
 */
export function getProviderLanguageHint(
  language: string | null | undefined,
): string | undefined {
  const normalizedLanguage = language?.trim();
  if (
    !normalizedLanguage
    || normalizedLanguage === 'English'
    || normalizedLanguage === AI_RESPONSE_LANGUAGE_BILINGUAL_EN_PT
  ) {
    return undefined;
  }

  return normalizedLanguage;
}

export function formatBilingualResponse(english: string, portuguese: string): string {
  return `${BILINGUAL_EN_MARKER}\n${english.trim()}\n${BILINGUAL_PT_BR_MARKER}\n${portuguese.trim()}`;
}

/**
 * Formats app-authored fallback copy for the selected response language.
 *
 * This is deliberately limited to call sites that already own both reviewed
 * strings. It must not be used to wrap arbitrary provider output because doing
 * so would label untranslated text as Brazilian Portuguese.
 */
export function formatLanguageAwareFallback(
  language: string | null | undefined,
  english: string,
  portuguese: string,
): string {
  if (language?.trim() === AI_RESPONSE_LANGUAGE_BILINGUAL_EN_PT) {
    return formatBilingualResponse(english, portuguese);
  }

  return english.trim();
}

function trimSectionBoundary(value: string): string {
  return value.trim();
}

/**
 * Finds a marker prefix at the end of an accumulated stream. For example,
 * `<!--NATIVELY_PT` is hidden while the remaining `_BR-->` tokens arrive.
 */
function trailingMarkerPrefixLength(value: string, marker: string): number {
  const maxLength = Math.min(value.length, marker.length - 1);
  for (let length = maxLength; length > 0; length -= 1) {
    if (value.endsWith(marker.slice(0, length))) {
      return length;
    }
  }

  return 0;
}

function parsed(
  english: string,
  portuguese: string,
  englishStarted: boolean,
  portugueseStarted: boolean,
): ParsedBilingualResponse {
  return {
    bilingual: true,
    english: trimSectionBoundary(english),
    portuguese: trimSectionBoundary(portuguese),
    englishStarted,
    portugueseStarted,
  };
}

/**
 * Splits a complete or still-streaming bilingual response. It deliberately
 * recognizes partial marker prefixes so raw protocol text never flashes in the
 * UI when a marker is divided across provider chunks.
 */
export function parseBilingualResponse(raw: string): ParsedBilingualResponse {
  const englishMarkerIndex = raw.indexOf(BILINGUAL_EN_MARKER);

  if (englishMarkerIndex >= 0) {
    const englishContentStart = englishMarkerIndex + BILINGUAL_EN_MARKER.length;
    const content = raw.slice(englishContentStart);
    const portugueseMarkerIndex = content.indexOf(BILINGUAL_PT_BR_MARKER);

    if (portugueseMarkerIndex >= 0) {
      return parsed(
        content.slice(0, portugueseMarkerIndex),
        content.slice(portugueseMarkerIndex + BILINGUAL_PT_BR_MARKER.length),
        true,
        true,
      );
    }

    const partialPortugueseMarkerLength = trailingMarkerPrefixLength(
      content,
      BILINGUAL_PT_BR_MARKER,
    );
    const visibleEnglish = partialPortugueseMarkerLength > 0
      ? content.slice(0, -partialPortugueseMarkerLength)
      : content;

    return parsed(
      visibleEnglish,
      '',
      true,
      partialPortugueseMarkerLength > 0,
    );
  }

  const withoutLeadingWhitespace = raw.trimStart();
  if (
    withoutLeadingWhitespace.length > 0
    && withoutLeadingWhitespace.length < BILINGUAL_EN_MARKER.length
    && BILINGUAL_EN_MARKER.startsWith(withoutLeadingWhitespace)
  ) {
    return parsed('', '', false, false);
  }

  // Graceful recovery when a provider omits the opening English marker but
  // still emits the Portuguese boundary. We retain the English content rather
  // than showing the protocol marker to the user.
  const portugueseMarkerIndex = raw.indexOf(BILINGUAL_PT_BR_MARKER);
  if (portugueseMarkerIndex >= 0) {
    return parsed(
      raw.slice(0, portugueseMarkerIndex),
      raw.slice(portugueseMarkerIndex + BILINGUAL_PT_BR_MARKER.length),
      raw.slice(0, portugueseMarkerIndex).trim().length > 0,
      true,
    );
  }

  const partialPortugueseMarkerLength = trailingMarkerPrefixLength(
    raw,
    BILINGUAL_PT_BR_MARKER,
  );
  if (partialPortugueseMarkerLength > 0) {
    const visibleEnglish = raw.slice(0, -partialPortugueseMarkerLength);
    if (visibleEnglish.trim().length > 0) {
      return parsed(visibleEnglish, '', true, true);
    }
  }

  return {
    bilingual: false,
    english: raw,
    portuguese: '',
    englishStarted: raw.length > 0,
    portugueseStarted: false,
  };
}

/** Returns only the actionable English answer for copy, memory, and context. */
export function englishForContext(raw: string): string {
  const response = parseBilingualResponse(raw);
  return response.bilingual ? response.english : raw;
}
