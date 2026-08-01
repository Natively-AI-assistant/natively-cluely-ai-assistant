import type { Evidence, IndexedChunk } from './types';
import { tokenize, vectorize } from './projectIndexer';

function cosine(a: Record<string, number>, b: Record<string, number>): number {
  let score = 0; for (const [token, weight] of Object.entries(a)) score += weight * (b[token] || 0); return score;
}

export class HybridRetriever {
  constructor(private chunks: IndexedChunk[]) {}
  search(query: string, limit = 6): Evidence[] {
    const tokens = tokenize(query); const queryVector = vectorize(tokens);
    const terms = new Set(tokens);
    return this.chunks.map(chunk => {
      const matchedTerms = chunk.tokens.reduce((score, token) => score + (terms.has(token) ? 1 : 0), 0);
      const lexical = matchedTerms / Math.max(1, Math.sqrt(chunk.tokens.length));
      const pathBoost = tokens.some(token => chunk.path?.toLowerCase().includes(token)) ? .25 : 0;
      const score = lexical * .65 + cosine(queryVector, chunk.vector) * .35 + pathBoost;
      return { item: { ...chunk, score } as Evidence, matchedTerms, pathBoost };
    }).filter(result => result.item.score >= .08 && (result.matchedTerms >= 2 || result.pathBoost > 0))
      .sort((a, b) => b.item.score - a.item.score).map(result => result.item)
      .filter((item, index, all) => all.findIndex(other => other.path === item.path && other.excerpt === item.excerpt) === index)
      .slice(0, limit);
  }
  searchMultilingual(query: string, limit = 6): Evidence[] {
    const queries = expandRetrievalQueries(query);
    const ranked = queries.flatMap(rewrite => this.search(rewrite, Math.max(limit, 8)).map((item, rank) => ({ item, rrf: 1 / (60 + rank + 1) })));
    const merged = new Map<string, { item: Evidence; score: number }>();
    for (const result of ranked) {
      const key = `${result.item.path}:${result.item.lineStart}:${result.item.lineEnd}`; const current = merged.get(key);
      if (current) current.score += result.rrf; else merged.set(key, { item: result.item, score: result.rrf });
    }
    return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit).map(value => ({ ...value.item, score: value.score }));
  }
}

const BILINGUAL_TERMS: Array<[RegExp, string]> = [
  [/架构|系统设计/i, 'architecture system design'], [/architecture|system design/i, '架构 系统设计'],
  [/检索|召回/i, 'retrieval recall search'], [/retrieval|recall/i, '检索 召回'],
  [/证据|引用/i, 'evidence citation source'], [/evidence|citation/i, '证据 引用'],
  [/测试|指标|准确率/i, 'test metric accuracy evaluation'], [/test|metric|accuracy|evaluation/i, '测试 指标 准确率 评估'],
  [/隐私|安全/i, 'privacy security'], [/privacy|security/i, '隐私 安全'],
  [/pairing|secret|session token|raw audio|protected/i, '配对 一次性 哈希 原始音频 保存 安全'],
  [/数据流|调用链/i, 'data flow call chain pipeline'], [/data flow|call chain|pipeline/i, '数据流 调用链 流程'],
  [/故障|修复|异常/i, 'bug fix failure error handling'], [/bug|fix|failure|error handling/i, '故障 修复 异常处理'],
  [/性能|吞吐量|延迟/i, 'performance throughput latency'], [/performance|throughput|latency/i, '性能 吞吐量 延迟'],
];

export function expandRetrievalQueries(query: string): string[] {
  const additions = BILINGUAL_TERMS.filter(([pattern]) => pattern.test(query)).map(([, terms]) => terms);
  return [...new Set([query, ...additions.map(terms => `${query} ${terms}`)])];
}

export function classifyQuestion(question: string): { category: string; needsCurrentExternalInfo: boolean; projectInternal: boolean } {
  const latest = /(?:最新|当前|最近|today|latest|current|recent|202[5-9]|版本|政策|行业现状|公司信息)/i.test(question);
  const internal = /(?:本项目|这个项目|代码|实现|架构|数据流|调用链|测试|指标|修复|开发|功能|限制|project|code|implementation|architecture|data flow|call chain|test|metric|bug|fix)/i.test(question);
  const categories: Array<[RegExp, string]> = [
    [/架构|architecture|data flow|数据流/i, 'system_architecture'], [/测试|指标|test|metric|quality/i, 'testing_evaluation'],
    [/故障|修复|bug|fix|difficulty|困难/i, 'development_difficulty'], [/安全|隐私|security|privacy/i, 'security_privacy'],
    [/为什么|选型|choose|choice|versus|vs\.?/i, 'technology_choice'], [/代码|函数|类|调用|code|function|class|call/i, 'code_implementation'],
  ];
  return { category: categories.find(([pattern]) => pattern.test(question))?.[1] || 'project_feature', needsCurrentExternalInfo: latest, projectInternal: internal };
}
