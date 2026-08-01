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
      const lexical = chunk.tokens.reduce((score, token) => score + (terms.has(token) ? 1 : 0), 0) / Math.max(1, Math.sqrt(chunk.tokens.length));
      const pathBoost = tokens.some(token => chunk.path?.toLowerCase().includes(token)) ? .25 : 0;
      const score = lexical * .65 + cosine(queryVector, chunk.vector) * .35 + pathBoost;
      return { ...chunk, score } as Evidence;
    }).filter(item => item.score >= .08).sort((a, b) => b.score - a.score)
      .filter((item, index, all) => all.findIndex(other => other.path === item.path && other.excerpt === item.excerpt) === index)
      .slice(0, limit);
  }
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
