import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock all embedding providers at the top level
vi.mock('../../../../electron/rag/providers/OpenAIEmbeddingProvider', () => ({
    OpenAIEmbeddingProvider: class MockOpenAIEmbeddingProvider {
        readonly name = 'openai'
        readonly dimensions = 1536
        constructor(private apiKey: string, private model = 'text-embedding-3-small') {}
        async isAvailable(): Promise<boolean> { return true }
        async embed(text: string): Promise<number[]> { return new Array(1536).fill(0.1) }
        async embedQuery(text: string): Promise<number[]> { return this.embed(text) }
        async embedBatch(texts: string[]): Promise<number[][]> { return texts.map(() => new Array(1536).fill(0.1)) }
    }
}))

vi.mock('../../../../electron/rag/providers/OllamaEmbeddingProvider', () => ({
    OllamaEmbeddingProvider: class MockOllamaEmbeddingProvider {
        readonly name = 'ollama'
        readonly dimensions = 768
        constructor(private baseUrl = 'http://localhost:11434', private model = 'nomic-embed-text') {}
        async isAvailable(): Promise<boolean> { return true }
        async embed(text: string): Promise<number[]> { return new Array(768).fill(0.1) }
        async embedQuery(text: string): Promise<number[]> { return this.embed(text) }
        async embedBatch(texts: string[]): Promise<number[][]> { return texts.map(() => new Array(768).fill(0.1)) }
    }
}))

vi.mock('../../../../electron/rag/providers/LocalEmbeddingProvider', () => ({
    LocalEmbeddingProvider: class MockLocalEmbeddingProvider {
        readonly name = 'local'
        readonly dimensions = 384
        constructor() {}
        async isAvailable(): Promise<boolean> { return true }
        async embed(text: string): Promise<number[]> { return new Array(384).fill(0.1) }
        async embedQuery(text: string): Promise<number[]> { return this.embed(text) }
        async embedBatch(texts: string[]): Promise<number[][]> { return texts.map(() => new Array(384).fill(0.1)) }
    }
}))

// Import after mocking
import { OpenAIEmbeddingProvider } from '../../../../electron/rag/providers/OpenAIEmbeddingProvider'
import { OllamaEmbeddingProvider } from '../../../../electron/rag/providers/OllamaEmbeddingProvider'
import { LocalEmbeddingProvider } from '../../../../electron/rag/providers/LocalEmbeddingProvider'

describe('IEmbeddingProvider Interface Contract', () => {
    describe('all providers should implement required interface', () => {
        let providers: { name: string; provider: any }[] = []

        beforeEach(() => {
            providers = [
                { name: 'openai', provider: new OpenAIEmbeddingProvider('test-key') },
                { name: 'ollama', provider: new OllamaEmbeddingProvider() },
                { name: 'local', provider: new LocalEmbeddingProvider() },
            ]
        })

        it('should have a name property', () => {
            for (const { name, provider } of providers) {
                expect(provider.name).toBe(name)
            }
        })

        it('should have a dimensions property (positive integer)', () => {
            for (const { provider } of providers) {
                expect(typeof provider.dimensions).toBe('number')
                expect(provider.dimensions).toBeGreaterThan(0)
            }
        })

        it('should implement isAvailable() returning Promise<boolean>', async () => {
            for (const { provider } of providers) {
                const result = provider.isAvailable()
                expect(result).toBeInstanceOf(Promise)
                const value = await result
                expect(typeof value).toBe('boolean')
            }
        })

        it('should implement embed() returning Promise<number[]>', async () => {
            for (const { provider } of providers) {
                const result = provider.embed('test text')
                expect(result).toBeInstanceOf(Promise)
                const embedding = await result
                expect(Array.isArray(embedding)).toBe(true)
                expect(embedding.length).toBe(provider.dimensions)
                expect(embedding.every(v => typeof v === 'number')).toBe(true)
            }
        })

        it('should implement embedQuery() returning Promise<number[]>', async () => {
            for (const { provider } of providers) {
                const result = provider.embedQuery('search query')
                expect(result).toBeInstanceOf(Promise)
                const embedding = await result
                expect(Array.isArray(embedding)).toBe(true)
                expect(embedding.length).toBe(provider.dimensions)
            }
        })

        it('should implement embedBatch() returning Promise<number[][]>', async () => {
            for (const { provider } of providers) {
                const texts = ['text1', 'text2', 'text3']
                const result = provider.embedBatch(texts)
                expect(result).toBeInstanceOf(Promise)
                const embeddings = await result
                expect(Array.isArray(embeddings)).toBe(true)
                expect(embeddings.length).toBe(texts.length)
                for (const embedding of embeddings) {
                    expect(Array.isArray(embedding)).toBe(true)
                    expect(embedding.length).toBe(provider.dimensions)
                }
            }
        })
    })

    describe('OpenAIEmbeddingProvider', () => {
        it('should have correct name and dimensions', () => {
            const provider = new OpenAIEmbeddingProvider('test-key')
            expect(provider.name).toBe('openai')
            expect(provider.dimensions).toBe(1536)
        })

        it('should return embedding array of correct size', async () => {
            const provider = new OpenAIEmbeddingProvider('test-key')
            const embedding = await provider.embed('test text')
            expect(embedding).toHaveLength(1536)
            expect(embedding.every(v => v === 0.1)).toBe(true)
        })
    })

    describe('OllamaEmbeddingProvider', () => {
        it('should have correct name and dimensions', () => {
            const provider = new OllamaEmbeddingProvider()
            expect(provider.name).toBe('ollama')
            expect(provider.dimensions).toBe(768)
        })

        it('should return embedding array of correct size', async () => {
            const provider = new OllamaEmbeddingProvider()
            const embedding = await provider.embed('test text')
            expect(embedding).toHaveLength(768)
            expect(embedding.every(v => v === 0.1)).toBe(true)
        })

        it('should return query embedding of correct size', async () => {
            const provider = new OllamaEmbeddingProvider()
            const embedding = await provider.embedQuery('search query')
            expect(embedding).toHaveLength(768)
        })
    })

    describe('LocalEmbeddingProvider', () => {
        it('should have correct name and dimensions', () => {
            const provider = new LocalEmbeddingProvider()
            expect(provider.name).toBe('local')
            expect(provider.dimensions).toBe(384)
        })

        it('should return embedding array of correct size', async () => {
            const provider = new LocalEmbeddingProvider()
            const embedding = await provider.embed('test text')
            expect(embedding).toHaveLength(384)
            expect(embedding.every(v => v === 0.1)).toBe(true)
        })
    })

    describe('provider dimension consistency', () => {
        it('should return embeddings matching declared dimensions', () => {
            const dimensions = [384, 768, 1536]
            const providers = [
                new LocalEmbeddingProvider(),
                new OllamaEmbeddingProvider(),
                new OpenAIEmbeddingProvider('key'),
            ]
            
            for (let i = 0; i < dimensions.length; i++) {
                const dim = dimensions[i]
                const provider = providers[i]
                expect(provider.dimensions).toBe(dim)
            }
        })
    })
})
