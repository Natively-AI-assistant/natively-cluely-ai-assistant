import { VectorStore, ScoredChunk } from './VectorStore';
import { EmbeddingPipeline } from './EmbeddingPipeline';
import { formatChunkForContext } from './SemanticChunker';

/**
 * Query intent types for biasing retrieval strategy
 * Detected via regex patterns, not LLM
 */
export type QueryIntent =
    | 'decision_recall'   // "What did we decide?"
    | 'speaker_lookup'    // "What did X say?"
    | 'action_items'      // "What are my action items?"
    | 'summary'           // "Summarize..."
    | 'open_question';    // Default fallback

export interface RetrievalOptions {
    meetingId?: string;           // For meeting-scoped queries
    maxTokens?: number;           // Context token budget (default: 1500)
    topK?: number;                // Initial retrieval count (default: 8)
    recencyWeight?: number;       // 0-1, how much to weight recent (default: 0.3)
    intent?: QueryIntent;         // Override detected intent
}

export interface RetrievedContext {
    chunks: ScoredChunk[];
    formattedContext: string;
    totalTokens: number;
    meetingIds: string[];
    intent: QueryIntent;          // Detected query intent for prompt hints
}


/**
 * RAGRetriever - Orchestrates the retrieval pipeline
 * 
 * Flow:
 * 1. Embed user query
 * 2. Retrieve candidate chunks from VectorStore
 * 3. Re-rank by relevance + recency
 * 4. Assemble context within token budget
 */
export class RAGRetriever {
    private vectorStore: VectorStore;
    private embeddingPipeline: EmbeddingPipeline;

    constructor(vectorStore: VectorStore, embeddingPipeline: EmbeddingPipeline) {
        this.vectorStore = vectorStore;
        this.embeddingPipeline = embeddingPipeline;
    }

    /**
     * Retrieve relevant context for a query
     */
    async retrieve(
        query: string,
        options: RetrievalOptions = {}
    ): Promise<RetrievedContext> {
        const {
            meetingId,
            maxTokens = 1500,
            topK = 8,
            recencyWeight = 0.3,
            intent: overrideIntent
        } = options;

        // Detect query intent (can be overridden)
        const intent = overrideIntent || this.detectIntent(query);

        // 1. Embed the query
        let queryEmbedding: number[];
        try {
            queryEmbedding = await this.embeddingPipeline.getEmbeddingForQuery(query);
        } catch (error) {
            console.error('[RAGRetriever] Failed to embed query:', error);
            // Return empty context on embedding failure
            return {
                chunks: [],
                formattedContext: '',
                totalTokens: 0,
                meetingIds: [],
                intent
            };
        }

        const preferredChunkSource = meetingId
            ? (this.vectorStore.hasEmbeddings(meetingId, 'final') ? 'final' : 'live')
            : undefined;

        // 2. Retrieve candidates (over-fetch for reranking)
        const providerName = this.embeddingPipeline.getActiveProviderName();
        let candidates = await this.vectorStore.searchSimilar(queryEmbedding, {
            meetingId,
            limit: topK * 2,
            minSimilarity: 0.25,
            providerName,
            chunkSource: preferredChunkSource
        });

        if (candidates.length === 0) {
            console.log('[RAGRetriever] No similar chunks found');
            return {
                chunks: [],
                formattedContext: '',
                totalTokens: 0,
                meetingIds: [],
                intent
            };
        }

        // 3. Re-rank by relevance + recency
        const now = Date.now();
        candidates = candidates.map(chunk => ({
            ...chunk,
            finalScore: this.computeFinalScore(chunk, now, recencyWeight)
        }));

        candidates.sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));

        // 4. Select top-K within token budget
        const selected: ScoredChunk[] = [];
        let totalTokens = 0;

        for (const chunk of candidates) {
            if (totalTokens + chunk.tokenCount > maxTokens) {
                // Skip if we already have minimum content
                if (selected.length >= topK / 2) break;
                continue;
            }

            selected.push(chunk);
            totalTokens += chunk.tokenCount;

            if (selected.length >= topK) break;
        }

        // 5. Sort selected by timestamp for coherent reading
        selected.sort((a, b) => a.startMs - b.startMs);

        // 6. Format context
        const formattedContext = selected
            .map(chunk => formatChunkForContext(chunk))
            .join('\n\n');

        return {
            chunks: selected,
            formattedContext,
            totalTokens,
            meetingIds: [...new Set(selected.map(c => c.meetingId))],
            intent
        };
    }

    /**
     * Retrieve with summaries for global search
     * Combines chunk search with meeting summary search
     */
    async retrieveGlobal(
        query: string,
        options: RetrievalOptions = {}
    ): Promise<RetrievedContext> {
        const {
            maxTokens = 1500,
            topK = 8,
            recencyWeight = 0.3,
            intent: overrideIntent
        } = options;

        // Detect query intent
        const intent = overrideIntent || this.detectIntent(query);

        // Embed query
        let queryEmbedding: number[];
        try {
            queryEmbedding = await this.embeddingPipeline.getEmbeddingForQuery(query);
        } catch (error) {
            console.error('[RAGRetriever] Failed to embed query:', error);
            return {
                chunks: [],
                formattedContext: '',
                totalTokens: 0,
                meetingIds: [],
                intent
            };
        }

        // Search both chunks and summaries
        const providerName = this.embeddingPipeline.getActiveProviderName();
        const chunkResults = await this.vectorStore.searchSimilar(queryEmbedding, {
            limit: topK * 2,
            minSimilarity: 0.25,
            providerName
        });

        const summaryResults = await this.vectorStore.searchSummaries(queryEmbedding, 5, providerName);

        // Get meeting IDs from top summaries
        const relevantMeetingIds = new Set(summaryResults.map(s => s.meetingId));

        // Boost chunks from meetings with matching summaries
        const boostedChunks = chunkResults.map(chunk => ({
            ...chunk,
            similarity: relevantMeetingIds.has(chunk.meetingId)
                ? chunk.similarity * 1.2  // 20% boost
                : chunk.similarity
        }));

        // Re-rank
        const now = Date.now();
        const ranked = boostedChunks.map(chunk => ({
            ...chunk,
            finalScore: this.computeFinalScore(chunk, now, recencyWeight)
        }));

        ranked.sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));

        // Select within budget
        const selected: ScoredChunk[] = [];
        let totalTokens = 0;

        for (const chunk of ranked) {
            if (totalTokens + chunk.tokenCount > maxTokens) {
                if (selected.length >= topK / 2) break;
                continue;
            }

            selected.push(chunk);
            totalTokens += chunk.tokenCount;

            if (selected.length >= topK) break;
        }

        // Group by meeting for coherent output
        const byMeeting = new Map<string, ScoredChunk[]>();
        for (const chunk of selected) {
            if (!byMeeting.has(chunk.meetingId)) {
                byMeeting.set(chunk.meetingId, []);
            }
            byMeeting.get(chunk.meetingId)!.push(chunk);
        }

        // Format with meeting grouping
        const contextParts: string[] = [];
        for (const [meetingId, chunks] of byMeeting) {
            // Sort chunks within meeting by timestamp
            chunks.sort((a, b) => a.startMs - b.startMs);
            const chunkTexts = chunks.map(c => formatChunkForContext(c)).join('\n');
            contextParts.push(`--- Meeting ${meetingId} ---\n${chunkTexts}`);
        }

        return {
            chunks: selected,
            formattedContext: contextParts.join('\n\n'),
            totalTokens,
            meetingIds: [...byMeeting.keys()],
            intent
        };
    }

    /**
     * Compute final score combining relevance and recency
     */
    private computeFinalScore(
        chunk: ScoredChunk,
        now: number,
        recencyWeight: number
    ): number {
        // Recency: decay over 7 days (half-life)
        const ageMs = now - chunk.startMs;
        const ageHours = ageMs / (1000 * 60 * 60);
        const recencyScore = Math.exp(-ageHours / 168);  // 168 hours = 7 days

        // Combined score
        const relevanceWeight = 1 - recencyWeight;
        return (relevanceWeight * chunk.similarity) + (recencyWeight * recencyScore);
    }

    /**
     * Detect query intent for biasing retrieval strategy
     * Uses regex patterns, not LLM - fast and deterministic
     */
    detectIntent(query: string): QueryIntent {
        const lower = query.toLowerCase();

        // Decision patterns
        if (/\b(decide|decision|agreed|conclusion|settled|determined|resolved)\b/.test(lower) ||
            /what did we (decide|agree|conclude)/.test(lower) ||
            /did we (decide|agree|settle)/.test(lower)) {
            return 'decision_recall';
        }

        // Speaker lookup patterns
        if (/\b(said|mentioned|told|asked|suggested|proposed|pointed out)\b/.test(lower) &&
            /\b(he|she|they|\w+)\s+(said|mentioned|told|asked)/.test(lower)) {
            return 'speaker_lookup';
        }
        if (/what did (\w+|he|she|they) say/.test(lower) ||
            /who said/.test(lower)) {
            return 'speaker_lookup';
        }

        // Action items patterns
        if (/\b(action|task|todo|to-do|follow[- ]?up|next step|assigned|deadline)\b/.test(lower) ||
            /what (are|were) (my|the|our) (action|task|todo)/.test(lower) ||
            /what (do i|should i|need to) do/.test(lower)) {
            return 'action_items';
        }

        // Summary patterns
        if (/\b(summar|overview|recap|highlights?|key points?)\b/.test(lower) ||
            /^(summarize|recap|give me a summary)/.test(lower)) {
            return 'summary';
        }

        return 'open_question';
    }

    /**
     * Detect if query is meeting-scoped or global
     */
    detectScope(query: string, currentMeetingId?: string): 'meeting' | 'global' {
        const lower = query.toLowerCase();

        // Meeting-scoped patterns
        const meetingPatterns = [
            'this meeting',
            'this call',
            'just now',
            'earlier',
            'they said',
            'he said',
            'she said',
            'did they',
            'did he',
            'did she',
            'what did'
        ];

        // Global patterns
        const globalPatterns = [
            'all meetings',
            'any meeting',
            'ever discuss',
            'find',
            'search',
            'when did we',
            'have we ever',
            'last time'
        ];

        // Check patterns
        for (const pattern of meetingPatterns) {
            if (lower.includes(pattern)) return 'meeting';
        }

        for (const pattern of globalPatterns) {
            if (lower.includes(pattern)) return 'global';
        }

        // Default based on context
        return currentMeetingId ? 'meeting' : 'global';
    }
}
