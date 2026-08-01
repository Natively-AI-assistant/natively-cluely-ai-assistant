import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { loadDefenceConfig } from './config';
import { detectLanguage } from './questionDetector';
import { LlmProvider, ProviderError, SttProvider } from './providers';
import { HybridRetriever } from './retriever';
import type { Evidence, IndexManifest } from './types';

const PROJECT_ID = 'cba-import-candidate-ranking';
const FIXTURE_ENV = { zh: 'CBA_STT_ZH_FIXTURE', en: 'CBA_STT_EN_FIXTURE', mixed: 'CBA_STT_MIXED_FIXTURE' } as const;
const MIME: Record<string, string> = { '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.webm': 'audio/webm', '.ogg': 'audio/ogg' };
const QUESTIONS = [
  '这个项目是在预测某位球员一定会加盟 CBA 吗？',
  'Why did you formulate this as a Top-K ranking problem?',
  'Precision@20 看起来不高，为什么 shortlist 仍然有价值？',
];

function sha256(value: string): string { return crypto.createHash('sha256').update(value).digest('hex'); }
function configured(value: string): boolean { return !!value && !/^(?:your_|example|changeme|placeholder)/i.test(value); }
function fixture(language: keyof typeof FIXTURE_ENV): string | undefined {
  const explicit = process.env[FIXTURE_ENV[language]]; if (explicit && fs.existsSync(explicit)) return path.resolve(explicit);
  const directory = path.resolve('real-audio-fixtures'); if (!fs.existsSync(directory)) return undefined;
  return fs.readdirSync(directory).find(name => new RegExp(`(?:^|[-_])${language}(?:[-_.]|$)`, 'i').test(name) && MIME[path.extname(name).toLowerCase()]) ? path.join(directory, fs.readdirSync(directory).find(name => new RegExp(`(?:^|[-_])${language}(?:[-_.]|$)`, 'i').test(name) && MIME[path.extname(name).toLowerCase()])!) : undefined;
}
function safeError(error: unknown): Record<string, unknown> { const item = error instanceof ProviderError ? error : new ProviderError('PROVIDER_INTERNAL_ERROR', 'Live provider smoke failed.'); return { ok: false, errorCode: item.code, httpStatus: item.status, retries: item.retries }; }
function grounding(facts: any[]): string { return `CBA project positioning is Top-K scouting shortlist decision support, never deterministic signing prediction. Numeric claims may use only these VERIFIED facts: ${JSON.stringify(facts.filter(fact => fact.status === 'VERIFIED').map(fact => ({ claimId: fact.claimId, value: fact.value })))}. Never use 0.0667 or the conflicting Dashboard 12-positive claim. 0.1731 is prior-subgroup-only.`; }
function queryFor(question: string): string {
  if (/一定会|predict/i.test(question)) return `${question} README.md Top-K scouting shortlist decision support not deterministic signing`;
  if (/Precision/i.test(question)) return `${question} dissertation_final_experiment_summary Precision@20 Lift@20 common CBA source league pool`;
  return `${question} README.md Top-K ranking research problem shortlist`;
}

async function main(): Promise<void> {
  const config = loadDefenceConfig(); const dataRoot = path.resolve('.defence-data/projects', PROJECT_ID); const outputDir = path.resolve('provider-smoke-output');
  const report: any = { schemaVersion: 1, reportType: 'CBA_LIVE_PROVIDER_SMOKE', generatedAt: new Date().toISOString(), status: 'RUNNING', projectId: PROJECT_ID, searchDisabled: config.search.provider === 'none', storeAudio: config.storeAudio, retrievalTopK: config.retrievalTopK, stt: [], llm: [] };
  const sttConfigured = configured(config.stt.apiKey) && config.stt.provider !== 'none';
  const llmConfigured = configured(config.llm.apiKey) && config.llm.provider !== 'none';
  report.configuration = { sttConfigured, llmConfigured };

  if (!sttConfigured) {
    report.liveStt = 'BLOCKED_MISSING_CONFIG';
  } else {
    const fixtures = Object.fromEntries((Object.keys(FIXTURE_ENV) as Array<keyof typeof FIXTURE_ENV>).map(language => [language, fixture(language)]));
    const missingFixtures = Object.entries(fixtures).filter(([, value]) => !value).map(([language]) => language);
    if (missingFixtures.length) {
      report.liveStt = 'BLOCKED_MISSING_AUDIO_FIXTURE'; report.missingFixtures = missingFixtures;
    } else {
      const stt = new SttProvider(config.stt); const technicalTerms = new Set<string>();
      for (const language of Object.keys(fixtures) as Array<keyof typeof FIXTURE_ENV>) {
        const file = fixtures[language]!; const bytes = fs.readFileSync(file); const mimeType = MIME[path.extname(file).toLowerCase()];
        try { const result = await stt.transcribeWithMetrics(bytes, mimeType); const detected = detectLanguage(result.value); const languagePreserved = language !== 'zh' || detected !== 'en'; for (const term of ['CBA','Top-K','player-season','learning-to-rank','Precision at 20','RAG']) if (result.value.toLowerCase().includes(term.toLowerCase())) technicalTerms.add(term); report.stt.push({ languageFixture: language, ok: true, transcriptNonEmpty: !!result.value, detectedLanguage: detected, languagePreserved, characterCount: result.value.length, mimeType, totalMs: result.timing.totalMs, firstResponseMs: result.timing.dnsConnectMs, httpStatus: result.timing.status, retries: result.timing.retries, requestId: result.timing.requestId }); }
        catch (error) { report.stt.push({ languageFixture: language, ...safeError(error) }); }
        finally { bytes.fill(0); }
      }
      report.technicalTermsPreserved = [...technicalTerms];
      report.liveStt = report.stt.every((item: any) => item.ok && item.transcriptNonEmpty && item.languagePreserved) ? 'SUCCESS' : report.stt.find((item: any) => item.errorCode)?.errorCode || 'INVALID_RESPONSE';
    }
  }

  if (!llmConfigured) {
    report.liveLlm = 'BLOCKED_MISSING_CONFIG';
  } else if (config.projectId !== PROJECT_ID || !fs.existsSync(path.join(dataRoot, 'manifest.json'))) {
    report.liveLlm = 'BLOCKED_CBA_PROJECT_NOT_ACTIVE'; report.activeProjectId = config.projectId;
  } else {
    const manifest: IndexManifest = JSON.parse(fs.readFileSync(path.join(dataRoot, 'manifest.json'), 'utf8')); const factsPath = path.join(dataRoot, 'verified_project_facts.json'); const factsText = fs.readFileSync(factsPath, 'utf8'); const facts = JSON.parse(factsText).facts || []; const factsHash = sha256(factsText); const llm = new LlmProvider(config.llm); const retriever = new HybridRetriever(manifest.chunks);
    for (const question of QUESTIONS) {
      const chainStarted = performance.now(); const retrievalStarted = performance.now(); let evidence = retriever.searchMultilingual(queryFor(question), config.retrievalTopK); if (/一定会|predict/i.test(question)) { const readme = manifest.chunks.find(chunk => chunk.path === 'README.md'); if (readme) evidence = [readme, ...evidence.filter(item => item.path !== readme.path || item.lineStart !== readme.lineStart)].slice(0, config.retrievalTopK); } const retrievalMs = Math.round(performance.now() - retrievalStarted);
      try {
        const questionLanguage = detectLanguage(question); const result = await llm.answerWithMetrics(question, evidence, [], questionLanguage, 'standard', grounding(facts)); const answer = String(result.value.spokenAnswer || ''); const answerLanguage = detectLanguage(answer); const personaLanguageCorrect = questionLanguage === 'en' ? answerLanguage !== 'zh' : answerLanguage !== 'en'; const evidencePathsValid = evidence.every(item => !!item.path && fs.existsSync(path.join(config.projectSourcePath, item.path!)));
        const forbiddenAbsent = !/0\.0667|12\s+(?:positive|positives|正例)/i.test(answer); const positioningCorrect = /Top-K|shortlist|排序/i.test(answer) && !/(?:guarantees?|definitely predicts?|断言|保证).{0,24}(?:sign|签约|加盟)/i.test(answer); const priorScoped = !/0\.1731/.test(answer) || /prior|subgroup|过往|历史 CBA/i.test(answer);
        report.llm.push({ questionLanguage, answerLanguage, personaLanguageCorrect, ok: true, schemaValid: typeof result.value.spokenAnswer === 'string' && typeof result.value.noEvidence === 'boolean', evidenceSufficient: evidence.length >= 3, evidenceCount: evidence.length, evidencePathsValid, forbiddenFactsAbsent: forbiddenAbsent, priorSubgroupScoped: priorScoped, positioningCorrect, retrievalMs, firstResponseMs: result.timing.dnsConnectMs, llmTotalMs: result.timing.totalMs, chainTotalMs: Math.round(performance.now() - chainStarted), httpStatus: result.timing.status, retries: result.timing.retries, requestId: result.timing.requestId });
      } catch (error) { report.llm.push({ questionLanguage: detectLanguage(question), retrievalMs, chainTotalMs: Math.round(performance.now() - chainStarted), ...safeError(error) }); }
    }
    report.verifiedFactsUnchanged = sha256(fs.readFileSync(factsPath, 'utf8')) === factsHash;
    report.liveLlm = report.llm.every((item: any) => item.ok && item.schemaValid && item.personaLanguageCorrect && item.evidenceSufficient && item.evidencePathsValid && item.forbiddenFactsAbsent && item.priorSubgroupScoped && item.positioningCorrect) && report.verifiedFactsUnchanged ? 'SUCCESS' : report.llm.find((item: any) => item.errorCode)?.errorCode || 'INVALID_RESPONSE';
  }

  report.status = report.liveStt === 'SUCCESS' && report.liveLlm === 'SUCCESS' ? 'SUCCESS' : report.liveStt === 'SUCCESS' || report.liveLlm === 'SUCCESS' ? 'PARTIAL_SUCCESS' : 'BLOCKED';
  const attemptedLiveRequest = report.stt.length > 0 || report.llm.length > 0;
  if (!attemptedLiveRequest) { console.log(JSON.stringify(report, null, 2)); return; }
  fs.mkdirSync(outputDir, { recursive: true }); const file = path.join(outputDir, `cba-live-provider-smoke-${new Date().toISOString().replace(/[:.]/g, '-')}.json`); fs.writeFileSync(file, JSON.stringify(report, null, 2), { encoding: 'utf8', mode: 0o600 }); console.log(JSON.stringify({ ...report, reportFile: path.relative(process.cwd(), file).replace(/\\/g, '/') }, null, 2)); if (report.status === 'BLOCKED') process.exitCode = 1;
}

void main().catch(error => { console.log(JSON.stringify({ status: 'LIVE_PROVIDER_VALIDATION_FAILED', ...safeError(error) }, null, 2)); process.exitCode = 1; });
