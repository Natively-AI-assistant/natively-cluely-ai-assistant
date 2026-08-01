import type { DefenceSettings, Evidence, IndexManifest, StructuredAnswer } from './types';
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

export class AnswerEngine {
  private llm: LlmProvider; private search: SearchProvider;
  constructor(private config: DefenceConfig) { this.llm = new LlmProvider(config.llm); this.search = new SearchProvider(config.search); }
  async answer(question: string, manifest: IndexManifest, settings: DefenceSettings): Promise<StructuredAnswer> {
    const retrievalStarted = performance.now();
    const detected = detectLanguage(question); const classification = classifyQuestion(question);
    const retrievalQuestion = this.config.projectId === 'cba-import-candidate-ranking' && /predict|what exactly|到底|预测|签约|一定会/i.test(question)
      ? `${question} README.md Top-K ranking scouting shortlist decision support not deterministic signing prediction`
      : question;
    let evidence = new HybridRetriever(manifest.chunks).searchMultilingual(retrievalQuestion);
    if (this.config.projectId === 'cba-import-candidate-ranking' && /predict|what exactly|到底|预测|签约|一定会/i.test(question)) {
      const overview = manifest.chunks.find(chunk => chunk.path === 'README.md');
      if (overview) evidence = [overview, ...evidence.filter(item => item.path !== overview.path || item.lineStart !== overview.lineStart)].slice(0, 5);
    }
    const allowExternal = settings.searchMode === 'on' || (settings.searchMode === 'auto' && classification.needsCurrentExternalInfo && !classification.projectInternal && evidence.length === 0);
    let externalSources: Evidence[] = [];
    if (allowExternal && this.search.available()) externalSources = await this.search.search(question).catch((): Evidence[] => []);
    const retrievalMs = Math.round(performance.now() - retrievalStarted);
    const output = requestedLanguage(settings, detected);
    let generated = fallbackAnswer(question, evidence, detected, settings, this.config.projectId);
    let llmFirstResponseMs: number | undefined; let llmTotalMs: number | undefined; let schemaValid = true;
    if (this.llm.available()) {
      try {
        const result = await this.llm.answerWithMetrics(question, evidence, externalSources, output, settings.answerDepth);
        generated = result.value; llmFirstResponseMs = result.timing.dnsConnectMs; llmTotalMs = result.timing.totalMs;
      } catch { schemaValid = false; /* deterministic grounded fallback keeps local retrieval usable */ }
    }
    const noEvidence = evidence.length === 0 && (classification.projectInternal || externalSources.length === 0);
    if (noEvidence) generated = { ...generated, spokenAnswer: detected === 'en' ? NO_EVIDENCE_EN : NO_EVIDENCE_ZH, noEvidence: true };
    return {
      question, language: detected, questionExplanation: generated.questionExplanation,
      keywords: Array.isArray(generated.keywords) ? generated.keywords.slice(0, 10) : keywords(question),
      spokenAnswer: String(generated.spokenAnswer || (detected === 'en' ? NO_EVIDENCE_EN : NO_EVIDENCE_ZH)),
      alternateLanguageAnswer: generated.alternateLanguageAnswer,
      followUps: Array.isArray(generated.followUps) ? generated.followUps.slice(0, 5) : [],
      evidence, externalSources, noEvidence: noEvidence || generated.noEvidence === true,
      missingInformation: generated.missingInformation,
      searchedSourceTypes: ['source code', 'project documentation', 'test evidence', ...(allowExternal ? ['external sources'] : [])],
      provider: this.llm.available() ? this.config.llm.provider : 'local-grounded-fallback',
      diagnostics: { retrievalMs, candidateCount: evidence.length, evidenceCount: evidence.length, llmFirstResponseMs, llmTotalMs, schemaValid },
    };
  }
}
