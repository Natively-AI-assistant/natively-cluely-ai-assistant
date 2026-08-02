import fs from 'fs';
import path from 'path';
import type { DefenceSettings, Evidence, FastHint, IndexManifest, StructuredAnswer } from './types';
import type { DefenceConfig } from './config';
import { detectLanguage } from './questionDetector';
import { classifyQuestion, HybridRetriever } from './retriever';
import { LlmProvider, SearchProvider } from './providers';

const NO_EVIDENCE_ZH = '当前项目资料中没有足够证据支持这一回答。';
const NO_EVIDENCE_EN = 'The current project materials do not contain enough evidence to support this answer.';

function keywords(question: string): string[] {
  return [...new Set(question.match(/[A-Za-z][\w.+#-]{2,}|[\u3400-\u9fff]{2,6}/g) || [])].slice(0, 8);
}

function fallbackAnswer(question: string, evidence: Evidence[], language: 'zh' | 'en' | 'mixed', settings: DefenceSettings, projectId = ''): Partial<StructuredAnswer> {
  if (!evidence.length) return {
    spokenAnswer: language === 'en' ? NO_EVIDENCE_EN : NO_EVIDENCE_ZH, noEvidence: true,
    missingInformation: language === 'en' ? ['Relevant implementation, documentation, or test evidence'] : ['相关实现、文档或测试证据'],
    followUps: [],
  };
  const count = settings.answerDepth === 'brief' ? 1 : settings.answerDepth === 'deep' ? 4 : 2;
  const facts = evidence.slice(0, count).map(item => item.excerpt.replace(/\s+/g, ' ').slice(0, settings.answerDepth === 'brief' ? 180 : 340));
  if (projectId === 'cba-import-candidate-ranking') {
    const spokenAnswer = language === 'en'
      ? `This project uses public multi-league player-season data for Top-K CBA import-candidate ranking and scouting-shortlist decision support; it does not make a deterministic signing prediction. The cited project evidence states: ${facts.join(' ')}`
      : `这个项目使用多联盟公开 player-season 数据，对潜在 CBA 外援候选人进行 Top-K 排序，为 scouting shortlist 提供决策支持，并不作确定性签约预测。项目证据显示：${facts.join('；')}`;
    return { spokenAnswer, noEvidence: false, followUps: language === 'en' ? ['Would you like the code path or metric interpretation?'] : ['你希望我展开代码调用链还是指标解释？'] };
  }
  const spokenAnswer = language === 'en'
    ? `The project evidence shows the following: ${facts.join(' ')} These points come directly from the cited project files.`
    : `根据项目证据，可以直接确认：${facts.join('；')}。以上内容来自下方列出的项目文件。`;
  return { spokenAnswer, noEvidence: false, followUps: language === 'en' ? ['What trade-offs does this implementation have?'] : ['这一实现有哪些取舍？'] };
}

function requestedLanguage(settings: DefenceSettings, detected: 'zh' | 'en' | 'mixed'): string {
  if (settings.outputLanguage === 'follow') return detected;
  return settings.outputLanguage;
}

function cbaOutputSafe(value: Partial<StructuredAnswer>): boolean {
  const text = String(value.spokenAnswer || '');
  if (/0\.0667|12\s+(?:positive|positives|正例)/i.test(text)) return false;
  if (/0\.1731/.test(text) && !/prior|subgroup|过往|历史 CBA/i.test(text)) return false;
  if (/(?:guarantees?|definitely predicts?|断言|保证).{0,24}(?:sign|签约|加盟)/i.test(text)) return false;
  const baselineP20 = text.match(/baseline.{0,50}Precision\s*@?\s*20.{0,16}(0?\.\d+)/i)?.[1];
  if (baselineP20 && !['0.0464'].includes(baselineP20)) return false;
  return true;
}

export class AnswerEngine {
  private llm: LlmProvider; private search: SearchProvider;
  private answerCache = new Map<string, { createdAt: number; answer: StructuredAnswer }>();
  private hintCache = new Map<string, { createdAt: number; evidence: Evidence[]; retrievalMs: number }>();
  constructor(private config: DefenceConfig) { this.llm = new LlmProvider(config.llm); this.search = new SearchProvider(config.search); }
  private cacheKey(question: string, settings: DefenceSettings): string {
    const normalized = question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return `${settings.outputLanguage}:${settings.answerDepth}:${normalized}`;
  }
  private findSemanticCache(question: string, settings: DefenceSettings): StructuredAnswer | undefined {
    const now = Date.now(); const target = new Set(this.cacheKey(question, settings).split(/\s+/));
    let best: { score: number; answer: StructuredAnswer } | undefined;
    for (const [key, entry] of this.answerCache) {
      if (now - entry.createdAt > this.config.semanticCacheTtlMs) { this.answerCache.delete(key); continue; }
      const candidate = new Set(key.split(/\s+/)); let overlap = 0;
      for (const token of target) if (candidate.has(token)) overlap++;
      const score = overlap / Math.max(1, target.size + candidate.size - overlap);
      if (score >= .88 && (!best || score > best.score)) best = { score, answer: entry.answer };
    }
    return best ? structuredClone(best.answer) : undefined;
  }
  async prewarm(question: string, manifest: IndexManifest): Promise<void> {
    const key = question.toLowerCase().replace(/\s+/g, ' ').trim();
    if (this.hintCache.has(key)) return;
    const started = performance.now();
    const evidence = new HybridRetriever(manifest.chunks).searchMultilingual(question, this.config.retrievalTopK);
    this.hintCache.set(key, { createdAt: Date.now(), evidence, retrievalMs: Math.round(performance.now() - started) });
  }
  async fastHint(questionId: string, question: string, manifest: IndexManifest): Promise<FastHint> {
    const started = performance.now(); const key = question.toLowerCase().replace(/\s+/g, ' ').trim();
    const cached = this.hintCache.get(key); let evidence: Evidence[]; let retrievalMs: number;
    if (cached && Date.now() - cached.createdAt <= this.config.semanticCacheTtlMs) ({ evidence, retrievalMs } = cached);
    else { const retrievalStarted = performance.now(); evidence = new HybridRetriever(manifest.chunks).searchMultilingual(question, this.config.retrievalTopK); retrievalMs = Math.round(performance.now() - retrievalStarted); this.hintCache.set(key, { createdAt: Date.now(), evidence, retrievalMs }); }
    const structures: Record<string, string[]> = {
      system_architecture: ['先说明目标与边界', '再讲数据流和关键组件', '最后说明取舍与验证'],
      testing_evaluation: ['先定义评价目标', '给出核心指标和结果', '解释限制与改进方向'],
      development_difficulty: ['说明具体难点', '解释解决方案', '给出验证证据'],
      security_privacy: ['说明威胁边界', '列出保护措施', '说明仍存在的风险'],
      technology_choice: ['说明选择标准', '比较备选方案', '解释最终取舍'],
      code_implementation: ['定位入口', '说明核心调用链', '指出异常处理与测试'],
      project_feature: ['一句话结论', '给出项目证据', '说明限制'],
    };
    const category = classifyQuestion(question).category;
    return { questionId, question, keywords: keywords(question), structure: structures[category] || structures.project_feature, evidence: evidence.slice(0, 3), diagnostics: { retrievalMs, fastHintMs: Math.round(performance.now() - started), semanticCacheHit: !!cached } };
  }
  private cbaGroundingRules(): string {
    if (this.config.projectId !== 'cba-import-candidate-ranking') return '';
    try {
      const document = JSON.parse(fs.readFileSync(path.join(this.config.indexPath, 'verified_project_facts.json'), 'utf8'));
      const verified = (Array.isArray(document.facts) ? document.facts : []).filter((fact: any) => fact.status === 'VERIFIED').map((fact: any) => ({ claimId: fact.claimId, value: fact.value }));
      return `Project positioning: Top-K scouting shortlist decision support, never a deterministic signing prediction. Use only these VERIFIED facts for numeric claims: ${JSON.stringify(verified)}. Never use historical 0.0667 or the conflicting Dashboard 12-positive claim. Precision@20=0.1731 is prior-subgroup-only.`;
    } catch { return 'Project positioning: Top-K scouting shortlist decision support, never a deterministic signing prediction. Do not state unverified metrics.'; }
  }
  async answer(question: string, manifest: IndexManifest, settings: DefenceSettings): Promise<StructuredAnswer> {
    const fullStarted = performance.now(); const cached = this.findSemanticCache(question, settings);
    if (cached) {
      cached.question = question;
      cached.diagnostics = { ...(cached.diagnostics || { retrievalMs: 0, candidateCount: 0, evidenceCount: 0, schemaValid: true }), semanticCacheHit: true, fullAnswerMs: Math.round(performance.now() - fullStarted) };
      return cached;
    }
    const retrievalStarted = performance.now();
    const detected = detectLanguage(question); const classification = classifyQuestion(question);
    const retrievalQuestion = this.config.projectId === 'cba-import-candidate-ranking' && /predict|what exactly|到底|预测|签约|一定会/i.test(question)
      ? `${question} README.md Top-K ranking scouting shortlist decision support not deterministic signing prediction`
      : question;
    let evidence = new HybridRetriever(manifest.chunks).searchMultilingual(retrievalQuestion, this.config.retrievalTopK);
    if (this.config.projectId === 'cba-import-candidate-ranking' && /predict|what exactly|到底|预测|签约|一定会/i.test(question)) {
      const overview = manifest.chunks.find(chunk => chunk.path === 'README.md');
      if (overview) evidence = [overview, ...evidence.filter(item => item.path !== overview.path || item.lineStart !== overview.lineStart)].slice(0, this.config.retrievalTopK);
    }
    const allowExternal = settings.searchMode === 'on' || (settings.searchMode === 'auto' && classification.needsCurrentExternalInfo && !classification.projectInternal && evidence.length === 0);
    let externalSources: Evidence[] = [];
    if (allowExternal && this.search.available()) externalSources = await this.search.search(question).catch((): Evidence[] => []);
    const retrievalMs = Math.round(performance.now() - retrievalStarted);
    const output = requestedLanguage(settings, detected);
    let generated = fallbackAnswer(question, evidence, detected, settings, this.config.projectId);
    let llmFirstResponseMs: number | undefined; let llmTotalMs: number | undefined; let llmStatus: number | undefined; let llmRetries: number | undefined; let llmRequestId: string | undefined; let schemaValid = true;
    if (this.llm.available()) {
      try {
        const result = await this.llm.answerWithMetrics(question, evidence, externalSources, output, settings.answerDepth, this.cbaGroundingRules());
        generated = result.value; llmFirstResponseMs = result.timing.dnsConnectMs; llmTotalMs = result.timing.totalMs; llmStatus = result.timing.status; llmRetries = result.timing.retries; llmRequestId = result.timing.requestId;
        if (this.config.projectId === 'cba-import-candidate-ranking' && !cbaOutputSafe(generated)) { generated = fallbackAnswer(question, evidence, detected, settings, this.config.projectId); schemaValid = false; }
      } catch { schemaValid = false; /* deterministic grounded fallback keeps local retrieval usable */ }
    }
    const noEvidence = evidence.length === 0 && (classification.projectInternal || externalSources.length === 0);
    if (noEvidence) generated = { ...generated, spokenAnswer: detected === 'en' ? NO_EVIDENCE_EN : NO_EVIDENCE_ZH, noEvidence: true };
    const answer: StructuredAnswer = {
      question, language: detected, questionExplanation: generated.questionExplanation,
      keywords: Array.isArray(generated.keywords) ? generated.keywords.slice(0, 10) : keywords(question),
      spokenAnswer: String(generated.spokenAnswer || (detected === 'en' ? NO_EVIDENCE_EN : NO_EVIDENCE_ZH)),
      alternateLanguageAnswer: generated.alternateLanguageAnswer,
      followUps: Array.isArray(generated.followUps) ? generated.followUps.slice(0, 5) : [],
      evidence, externalSources, noEvidence: noEvidence || generated.noEvidence === true,
      missingInformation: generated.missingInformation,
      searchedSourceTypes: ['source code', 'project documentation', 'test evidence', ...(allowExternal ? ['external sources'] : [])],
      provider: this.llm.available() ? this.config.llm.provider : 'local-grounded-fallback',
      diagnostics: { retrievalMs, candidateCount: evidence.length, evidenceCount: evidence.length, llmFirstResponseMs, llmTotalMs, llmStatus, llmRetries, llmRequestId, schemaValid, semanticCacheHit: false, fullAnswerMs: Math.round(performance.now() - fullStarted) },
    };
    this.answerCache.set(this.cacheKey(question, settings), { createdAt: Date.now(), answer: structuredClone(answer) });
    return answer;
  }
}
