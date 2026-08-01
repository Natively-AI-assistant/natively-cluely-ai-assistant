import type { IndexedChunk } from './types';
import { tokenize, vectorize } from './projectIndexer';
import { HybridRetriever } from './retriever';

const documents = [
  ['architecture.md', '系统架构采用事件驱动管线，WebSocket 负责手机与服务端之间的实时数据流。'],
  ['retrieval.md', 'The hybrid retrieval pipeline combines lexical ranking with vector similarity and reranks project evidence.'],
  ['security.md', '安全设计使用一次性 pairing secret、短有效期和哈希 session token，原始音频默认不保存。'],
  ['metrics.md', 'Evaluation results: Recall@3 was 0.92 and median retrieval latency was 38 ms in the fixture test.'],
  ['mixed.md', 'QuestionDetector 会合并 follow-up constraints，并通过 generationId 防止 duplicate answer generation.'],
];
const chunks: IndexedChunk[] = documents.map(([file, content], index) => { const tokens = tokenize(`${file} ${content}`); return { id: String(index), sourceType: 'project', path: file, title: file, lineStart: 1, lineEnd: 1, excerpt: content, content, status: 'IMPLEMENTED', score: 0, fileHash: String(index), indexedAt: 'fixture', tokens, vector: vectorize(tokens) }; });
const cases = [
  ['系统的实时数据流架构是什么？', 'architecture.md'], ['How is the real-time architecture connected?', 'architecture.md'],
  ['混合检索怎样排序 project evidence？', 'retrieval.md'], ['How does hybrid retrieval rank evidence?', 'retrieval.md'],
  ['How are pairing secrets and raw audio protected?', 'security.md'], ['检索的 Recall 和延迟指标是多少？', 'metrics.md'],
  ['中途追加 constraint 时怎样避免 duplicate answer？', 'mixed.md'], ['项目使用了 Kubernetes 吗？', null],
] as Array<[string, string | null]>;
const retriever = new HybridRetriever(chunks); let reciprocal = 0; let hit1 = 0; let hit3 = 0; let hit5 = 0; let pathCorrect = 0; let lineValid = 0; let noEvidenceFalsePositive = 0; const details: any[] = [];
for (const [query, expected] of cases) { const result = retriever.searchMultilingual(query, 5); const rank = expected ? result.findIndex(item => item.path === expected) + 1 : 0; details.push({ query, expected, rank, top: result[0]?.path || null }); if (expected) { if (rank === 1) hit1++; if (rank > 0 && rank <= 3) hit3++; if (rank > 0 && rank <= 5) hit5++; if (rank) reciprocal += 1 / rank; if (result[0]?.path === expected) pathCorrect++; if (result.every(item => (item.lineStart || 0) >= 1 && (item.lineEnd || 0) >= (item.lineStart || 0))) lineValid++; } else if (result.length > 0) noEvidenceFalsePositive++; }
const relevant = cases.filter(item => item[1]).length; console.log(JSON.stringify({ status: 'SUCCESS', cases: cases.length, RecallAt1: hit1 / relevant, RecallAt3: hit3 / relevant, RecallAt5: hit5 / relevant, MRR: reciprocal / relevant, noEvidenceFalsePositive, evidencePathAccuracy: pathCorrect / relevant, lineNumberValidity: lineValid / relevant, details }, null, 2));
