// electron/services/knowledge/OkfPromptFormatter.ts
//
// OKF Phase 3 — formats a RetrievalEvidencePack's cards into the prompt
// block shape from the migration plan: cards first (curated, source-
// attributed), then raw chunks (verbatim, win on conflict). Pure string
// formatting — no model calls.

import type { ScoredCard } from './OkfRetriever';

export function formatCardsForPrompt(cards: ScoredCard[]): string {
  if (cards.length === 0) return '';
  return cards.map(({ card }, i) => {
    const pages = card.sourcePages.join(', ');
    const sections = card.sourceSections.join(', ');
    const quote = card.sourceQuotes[0];
    const lines = [
      `### [${i + 1}] ${card.title} (${card.type})`,
      `Source: pages ${pages}${sections ? `, ${sections}` : ''}`,
      `Confidence: ${card.confidence}`,
      '',
      card.body,
    ];
    if (quote?.text) {
      lines.push('', `Direct quote (page ${quote.page}): "${quote.text}"`);
    }
    return lines.join('\n');
  }).join('\n---\n');
}

/**
 * Builds the full "## STRUCTURED KNOWLEDGE CARDS..." + "## RAW RETRIEVED
 * EXCERPTS..." prompt section per the migration plan's prompt shape. Returns
 * '' when there is no evidence at all (caller falls back to the existing
 * chunk-only buildDocumentGroundedUserContent shape).
 */
export function buildOkfEvidenceBlock(params: { cardsBlock: string; rawChunkText: string }): string {
  const { cardsBlock, rawChunkText } = params;
  const parts: string[] = [];
  if (cardsBlock) {
    parts.push('## STRUCTURED KNOWLEDGE CARDS FROM UPLOADED DOCUMENT');
    parts.push('These are source-grounded summaries generated from the uploaded document. Each card cites its source pages.');
    parts.push('');
    parts.push(cardsBlock);
  }
  if (rawChunkText) {
    if (parts.length > 0) parts.push('');
    parts.push('## RAW RETRIEVED EXCERPTS FROM UPLOADED DOCUMENT');
    parts.push('These are the original retrieved text excerpts. If a card and an excerpt conflict, the excerpt (verbatim original text) wins.');
    parts.push('');
    parts.push(rawChunkText);
  }
  return parts.join('\n');
}
