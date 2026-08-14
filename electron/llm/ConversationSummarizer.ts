// electron/llm/ConversationSummarizer.ts
// Electron-side conversation compression for hour-long meetings.
// Fires every N turns: oldest N turns → structured TurnSummary → replaces N raw messages.
// The AI receives the summary as a readable block, not the full transcript.
// This is the tier-2 layer — raw recent turns stay raw (tier 1).

export interface TurnSummary {
  turnsCovered: string;        // "1-20"
  keyDecisions: string[];     // decisions made
  importantFacts: string[];   // facts, positions, commitments introduced
  sentimentTone: string;      // overall tone: "collaborative", "tense", "informative"
  topicsDiscussed: string[];   // topics covered
  actionItems: string[];       // [who] to [what] by [when] — for team modes
  questionsAsked: string[];    // key questions that were asked but may not have been fully answered
  summaryText: string;         // freeform 2-3 sentence narrative for generic modes
}

/**
 * Compress N oldest turns into a structured TurnSummary.
 * Returns the summary block plus the remaining un-summarized turns.
 *
 * @param turns - All transcript turns (oldest first)
 * @param compressCount - How many oldest turns to compress (default 20)
 * @returns { compressed: TurnSummary, remaining: TranscriptTurn[] }
 */
export function compressConversation<T extends { text: string; speaker?: string; timestamp?: number }>(
  turns: T[],
  compressCount: number = 20
): { compressed: TurnSummary; remaining: T[] } {
  const toCompress = turns.slice(0, compressCount);
  const remaining = turns.slice(compressCount);

  if (toCompress.length === 0) {
    return {
      compressed: { turnsCovered: '0', keyDecisions: [], importantFacts: [], sentimentTone: 'unknown', topicsDiscussed: [], actionItems: [], questionsAsked: [], summaryText: 'No prior turns.' },
      remaining,
    };
  }

  const firstTurn = toCompress[0];
  const lastTurn = toCompress[toCompress.length - 1];

  // Extract decisions: lines with "decided", "agreed", "will", "should", "must", "going to"
  const decisionPatterns = /(?:decided|agreed|will|should|must|going to|we're (?:going to|doing)|let's (?:go with|do|use)|final decision|commit to)/i;
  const decisions = toCompress
    .filter(t => decisionPatterns.test(t.text))
    .map(t => t.text.slice(0, 120));

  // Extract facts: statements of fact, numbers, specific claims
  const factPatterns = /(?:it('s| is) a |the (?:number|total|average|cost|price|size|scale) of|we have|there are|i('ve| have) been|we built|we launched|was (?:built|launched|deployed))/i;
  const facts = toCompress
    .filter(t => factPatterns.test(t.text))
    .map(t => t.text.slice(0, 120));

  // Extract topics: noun phrases that appear multiple times or are capitalized
  const topicWords: Record<string, number> = {};
  for (const t of toCompress) {
    const words = t.text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
    for (const w of words) {
      if (w.length > 3) topicWords[w] = (topicWords[w] || 0) + 1;
    }
  }
  const topics = Object.entries(topicWords)
    .filter(([, count]) => count >= 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);

  // Extract questions
  const questionPattern = /\?(?:\s*$|\s+[A-Z])/;
  const questions = toCompress
    .filter(t => questionPattern.test(t.text))
    .map(t => t.text.slice(0, 150));

  // Sentiment: simple heuristic based on tone words
  const toneWords = {
    positive: /\b(great|excellent|good|love|perfect|awesome|amazing|fantastic)\b/i,
    negative: /\b(bad|wrong|broken|failed|issue|problem|blocker|concern|risk)\b/i,
    tense: /\b(disagree|conflict|pushback|hesitate|reluctant|worried|concerned)\b/i,
    collaborative: /\b(agree|let('s| us)|sounds good|sounds great|perfect|on the same|consensus)\b/i,
    informative: /\b(explained|described|showed|demonstrated|shared|presented|walked through)\b/i,
  };
  const toneCounts: Record<string, number> = { positive: 0, negative: 0, tense: 0, collaborative: 0, informative: 0 };
  for (const t of toCompress) {
    for (const [tone, re] of Object.entries(toneWords)) {
      if (re.test(t.text)) toneCounts[tone]++;
    }
  }
  const dominantTone = Object.entries(toneCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'neutral';

  // Freeform narrative for generic modes
  const totalText = toCompress.map(t => t.text).join(' ');
  const summaryText = summarizeNarrative(toCompress.map(t => t.text));

  return {
    compressed: {
      turnsCovered: `1-${toCompress.length}`,
      keyDecisions: [...new Set(decisions)].slice(0, 6),
      importantFacts: [...new Set(facts)].slice(0, 8),
      sentimentTone: dominantTone,
      topicsDiscussed: topics,
      actionItems: extractActionItems(toCompress),
      questionsAsked: [...new Set(questions)].slice(0, 5),
      summaryText,
    },
    remaining,
  };
}

function summarizeNarrative(turnTexts: string[]): string {
  if (turnTexts.length === 0) return 'No prior conversation.';
  // Take the first and last meaningful sentences to anchor the summary
  const first = turnTexts[0]?.slice(0, 200) || '';
  const last = turnTexts[turnTexts.length - 1]?.slice(0, 200) || '';
  const mid = turnTexts.slice(1, -1);
  const topicCount = new Set(turnTexts.map(t => t.match(/\b\w+\b/g)?.[0]).filter(Boolean)).size;
  const tone = topicCount > 10 ? 'comprehensive' : topicCount > 5 ? 'focused' : 'brief';
  return `${tone.charAt(0).toUpperCase() + tone.slice(1)} discussion covering ${topicCount} topics. Started with: ${first.slice(0, 100)}… Ended with: ${last.slice(0, 100)}…`;
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function extractActionItems<T extends { text: string; speaker?: string }>(turns: T[]): string[] {
  const patterns = [
    /\b(\w+(?:\s+\w+){0,3})\s+(?:to|will|should|must)\s+(.+?)(?:\s+(?:by|before|after)\s+(.+?))?[.!?]?$/im,
    /📋\s*(.+)/,
    /ACTION:\s*(.+)/,
  ];
  const items: string[] = [];
  for (const t of turns) {
    for (const p of patterns) {
      const m = t.text.match(p);
      if (m) items.push(m[1] || m[0]);
    }
  }
  return [...new Set(items)].slice(0, 5);
}

/**
 * Format a TurnSummary as an XML block for injection into the AI prompt.
 * This replaces the raw compressed turns — the AI reads this instead.
 */
export function formatSummaryAsBlock(summary: TurnSummary): string {
  const lines = ['<conversation_history_summary>'];
  lines.push(`  <turns>${escapeXmlText(summary.turnsCovered)}</turns>`);
  lines.push(`  <tone>${escapeXmlText(summary.sentimentTone)}</tone>`);
  lines.push(`  <topics>${escapeXmlText(summary.topicsDiscussed.join(', '))}</topics>`);

  if (summary.keyDecisions.length > 0) {
    lines.push('  <decisions>');
    for (const d of summary.keyDecisions) lines.push(`    <decision>${escapeXmlText(d)}</decision>`);
    lines.push('  </decisions>');
  }

  if (summary.importantFacts.length > 0) {
    lines.push('  <key_facts>');
    for (const f of summary.importantFacts) lines.push(`    <fact>${escapeXmlText(f)}</fact>`);
    lines.push('  </key_facts>');
  }

  if (summary.actionItems.length > 0) {
    lines.push('  <action_items>');
    for (const a of summary.actionItems) lines.push(`    <item>${escapeXmlText(a)}</item>`);
    lines.push('  </action_items>');
  }

  if (summary.questionsAsked.length > 0) {
    lines.push('  <open_questions>');
    for (const q of summary.questionsAsked) lines.push(`    <question>${escapeXmlText(q)}</question>`);
    lines.push('  </open_questions>');
  }

  lines.push(`  <narrative>${escapeXmlText(summary.summaryText)}</narrative>`);
  lines.push('</conversation_history_summary>');
  return lines.join('\n');
}