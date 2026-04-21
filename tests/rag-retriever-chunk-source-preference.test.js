const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const rootDir = process.cwd();
const compiledRetrieverPath = path.join(rootDir, 'dist-electron/electron/rag/RAGRetriever.js');

test('RAGRetriever prefers final chunks when final embeddings exist', async () => {
    delete require.cache[require.resolve(compiledRetrieverPath)];
    const { RAGRetriever } = require(compiledRetrieverPath);

    let searchOptions;
    const vectorStore = {
        hasEmbeddings(meetingId, source) {
            assert.equal(meetingId, 'meeting-final');
            assert.equal(source, 'final');
            return true;
        },
        async searchSimilar(_embedding, options) {
            searchOptions = options;
            return [];
        },
    };

    const embeddingPipeline = {
        async getEmbeddingForQuery() {
            return [0.1, 0.2, 0.3];
        },
        getActiveProviderName() {
            return undefined;
        },
    };

    const retriever = new RAGRetriever(vectorStore, embeddingPipeline);
    await retriever.retrieve('what was decided?', { meetingId: 'meeting-final' });

    assert.equal(searchOptions.chunkSource, 'final');
});

test('RAGRetriever falls back to live chunks when no final embeddings exist', async () => {
    delete require.cache[require.resolve(compiledRetrieverPath)];
    const { RAGRetriever } = require(compiledRetrieverPath);

    let searchOptions;
    const vectorStore = {
        hasEmbeddings(meetingId, source) {
            assert.equal(meetingId, 'meeting-live');
            assert.equal(source, 'final');
            return false;
        },
        async searchSimilar(_embedding, options) {
            searchOptions = options;
            return [];
        },
    };

    const embeddingPipeline = {
        async getEmbeddingForQuery() {
            return [0.2, 0.3, 0.4];
        },
        getActiveProviderName() {
            return undefined;
        },
    };

    const retriever = new RAGRetriever(vectorStore, embeddingPipeline);
    await retriever.retrieve('what was said?', { meetingId: 'meeting-live' });

    assert.equal(searchOptions.chunkSource, 'live');
});
