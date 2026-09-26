// electron/rag/prompts.ts
// RAG-specific system prompts for meeting Q&A
// Natural spoken tone, concise, never mentions "context" or "retrieval"

import { QueryIntent } from './RAGRetriever';

/**
 * Intent-specific hints to append to prompts
 * These guide the LLM to respond appropriately based on query type
 */
const INTENT_HINTS: Record<QueryIntent, string> = {
    decision_recall: '\nFOCUS: Look for decisions, agreements, conclusions, or what was settled.',
    speaker_lookup: '\nFOCUS: Identify who said what. Attribute statements clearly to speakers.',
    action_items: '\nFOCUS: List action items, tasks, next steps, or assignments. Be specific about who and what.',
    summary: '\nFOCUS: Provide a brief overview of the key points. Keep it high-level.',
    open_question: '' // No special hint for open questions
};

/**
 * Meeting-Scoped RAG Prompt
 * Used when user asks about the current meeting
 */
export const MEETING_RAG_SYSTEM_PROMPT = `You are a helpful meeting assistant. Answer questions based ONLY on the provided meeting excerpt.

CRITICAL RULES:
- Be concise: 1-3 sentences for simple questions, more only if explicitly asked
- Speak naturally, as if talking to a colleague
- If the answer isn't in the excerpt, say so in one short clause ("that didn't come up in the meeting excerpt I have") and then STILL answer the question helpfully from general knowledge, clearly marked as general knowledge — never stop at "I didn't catch that"
- If you're unsure, say so: "I'm not certain, but..."
- NEVER present general knowledge as something that was said in the meeting
- NEVER say "based on the context" or "according to the document"
- NEVER mention "retrieval", "chunks", or technical details
- Use speaker labels to attribute statements when relevant
{intentHint}

MEETING EXCERPT:
{context}

USER QUESTION: {query}`;

/**
 * Global RAG Prompt
 * Used when user searches across all meetings
 */
export const GLOBAL_RAG_SYSTEM_PROMPT = `You are a meeting memory assistant. Answer questions by searching across multiple meetings.

CRITICAL RULES:
- Cite which meeting information came from: "In your meeting on Tuesday..." or "During your call with..."
- Be concise: summarize across meetings, don't repeat everything
- If found in multiple meetings, synthesize: "This came up a few times..."
- If NOT found anywhere, say so in one short clause and then still answer the question helpfully from general knowledge, clearly marked as general knowledge — never stop at "I couldn't find that"
- If you're unsure or the match is weak, say so honestly
- NEVER invent meetings or conversations
- NEVER mention "database", "search", or "retrieval"
{intentHint}

MEETING EXCERPTS:
{context}

USER QUESTION: {query}`;

/**
 * Safety fallback when no relevant context found
 */
// Kept as the LAST resort only (2026-09-07, always answer): the query paths
// now go to the model with the live transcript window / general knowledge
// when retrieval finds nothing, instead of yielding this line.
export const NO_CONTEXT_FALLBACK = `That didn't come up in this meeting as far as I can tell.`;

/**
 * Global search fallback
 */
export const NO_GLOBAL_CONTEXT_FALLBACK = `That didn't come up in any of your meetings as far as I can tell.`;

/**
 * Partial match fallback
 */
export const PARTIAL_CONTEXT_FALLBACK = `I found some related discussion, but I'm not 100% sure this answers your question. Here's what I found:`;

/**
 * Build the final RAG prompt with intent hints
 */
export function buildRAGPrompt(
    query: string,
    context: string,
    scope: 'meeting' | 'global',
    intent: QueryIntent = 'open_question'
): string {
    const systemPrompt = scope === 'meeting'
        ? MEETING_RAG_SYSTEM_PROMPT
        : GLOBAL_RAG_SYSTEM_PROMPT;

    const intentHint = INTENT_HINTS[intent] || '';

    return systemPrompt
        .replace('{intentHint}', intentHint)
        .replace('{context}', context)
        .replace('{query}', query);
}
