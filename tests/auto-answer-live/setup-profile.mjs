// Configure the isolated profile for an auto-answer pass.
//   node tests/auto-answer-live/setup-profile.mjs --llm natively|deepseek|gemini [--mode <name substring>]
import { connect, envKey, sleep } from './cdp.mjs';
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const llm = opt('llm', 'natively');
const modeName = opt('mode', null);
const { evalIn, browser } = await connect();
const call = (fn, arg) => evalIn('launcher', fn, arg, 60000);

const out = {};
out.verbose = await call(() => window.electronAPI.setVerboseLogging(true));
if (llm === 'natively') {
  out.key = await call((k) => window.electronAPI.setNativelyApiKey(k), envKey('NATIVELY_API_KEY'));
} else if (llm === 'deepseek') {
  out.key = await call((k) => window.electronAPI.setDeepseekApiKey(k), envKey('DEEPSEEK_API_KEY'));
} else if (llm === 'gemini') {
  out.key = await call((k) => window.electronAPI.setGeminiApiKey(k), envKey('GEMINI_API_KEY'));
}
out.autoAnswer = await call(() => window.electronAPI.setAutoAnswerEnabled(true));
if (modeName) {
  const modes = await call(() => window.electronAPI.modesList?.() ?? window.electronAPI.modesGetAll?.());
  out.modes = (modes?.modes ?? modes ?? []).map?.((m) => ({ id: m.id, name: m.name, t: m.templateType ?? m.template_type }));
}
console.log(JSON.stringify(out, (k, v) => (typeof v === 'string' && v.length > 200 ? v.slice(0, 200) : v), 2));
await browser.close().catch(() => {});
process.exit(0);
