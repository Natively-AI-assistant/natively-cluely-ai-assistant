import 'dotenv/config';
import { loadDefenceConfig } from './config';
import { LlmProvider, ProviderError, SttProvider } from './providers';

function wavTone(durationMs = 450): Buffer {
  const rate = 16_000; const count = Math.floor(rate * durationMs / 1000); const data = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 1400), i * 2);
  const out = Buffer.alloc(44 + data.length); out.write('RIFF', 0); out.writeUInt32LE(36 + data.length, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(data.length, 40); data.copy(out, 44); return out;
}

async function main(): Promise<void> {
  const config = loadDefenceConfig(); const stt = new SttProvider(config.stt); const llm = new LlmProvider(config.llm);
  const report: any = { status: 'RUNNING', stt: { configured: stt.available() }, llm: { configured: llm.available() } };
  if (stt.available()) {
    const audio = wavTone();
    try { const result = await stt.transcribeWithMetrics(audio, 'audio/wav'); report.stt = { configured: true, testType: 'SYNTHETIC_AUDIO_PROVIDER_TEST', ok: !!result.value, transcriptNonEmpty: !!result.value, ...result.timing }; }
    catch (error) { const safe = error instanceof ProviderError ? error : new ProviderError('PROVIDER_INTERNAL_ERROR', 'STT smoke failed.'); report.stt = { configured: true, testType: 'SYNTHETIC_AUDIO_PROVIDER_TEST', ok: false, errorCode: safe.code, status: safe.status, retries: safe.retries }; }
    finally { audio.fill(0); }
  }
  if (llm.available()) {
    try { const result = await llm.answerWithMetrics('Return a short readiness statement. This contains no project data.', [], [], 'en', 'brief'); report.llm = { configured: true, ok: !!result.value.spokenAnswer, schemaValid: true, firstResponseMs: result.timing.dnsConnectMs, ...result.timing }; }
    catch (error) { const safe = error instanceof ProviderError ? error : new ProviderError('PROVIDER_INTERNAL_ERROR', 'LLM smoke failed.'); report.llm = { configured: true, ok: false, errorCode: safe.code, status: safe.status, retries: safe.retries }; }
  }
  report.liveStt = !stt.available() ? 'BLOCKED_MISSING_CONFIG' : report.stt.ok ? 'SUCCESS' : report.stt.errorCode || 'INVALID_RESPONSE';
  report.liveLlm = !llm.available() ? 'BLOCKED_MISSING_CONFIG' : report.llm.ok ? 'SUCCESS' : report.llm.errorCode || 'INVALID_RESPONSE';
  report.status = report.liveStt === 'SUCCESS' && report.liveLlm === 'SUCCESS' ? 'SUCCESS' : report.liveStt === 'SUCCESS' || report.liveLlm === 'SUCCESS' ? 'PARTIAL_SUCCESS' : 'BLOCKED'; console.log(JSON.stringify(report, null, 2));
}
main().catch(() => { console.log(JSON.stringify({ status: 'PROVIDER_SMOKE_FAILED', errorCode: 'PROVIDER_INTERNAL_ERROR' })); });
