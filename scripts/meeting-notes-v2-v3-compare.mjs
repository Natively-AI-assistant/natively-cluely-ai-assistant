// Opt-in comparison harness: runs the SAME transcript through both of Natively's
// meeting-notes pipelines (V2 legacy single-pass, V3 chunked map-reduce) in one
// process and dumps both results side by side for manual quality comparison.
//
//   RUN_NOTES_QUALITY_PROBE=1 node scripts/meeting-notes-v2-v3-compare.mjs <transcript.json> [--mode <templateType>]
//
// This is an instrument, not a test: no assertions, only files on disk. It makes REAL
// LLM calls (same provider chain the app uses) and never touches the local database or
// the user's app settings — meetingSummaryV3Enabled / followUpDraftV2Enabled are NEVER
// read; both pipelines are invoked directly, bypassing the feature-flag gate in
// electron/MeetingPersistence.ts entirely, so this harness's output is independent of
// however those flags happen to be set on this machine.
//
// V3 arm: MeetingContextAssembler.assembleSummary(...) — reused verbatim from
// scripts/meeting-notes-quality-probe.mjs (same LLMHelper construction, same fake-electron
// shim, same env loading). Read that script first if touching this one.
//
// V2 arm: electron/MeetingPersistence.ts's fallback branch (search that file for the JSON
// shape hint `"overview": "1-2 sentence summary of what was discussed"`, roughly lines
// 511-606 as of this writing) is NOT exported, so it cannot be imported — it is inline
// code inside the giant processAndSaveMeeting method. Per the task brief we do not modify
// MeetingPersistence.ts to export it. Instead the prompt construction and the
// buildBalancedTranscriptContext(...) helper are copied verbatim below, credited to their
// source lines, so a future reader knows the two must be kept in step by hand:
//   - baseRules literal                              MeetingPersistence.ts ~512-521
//   - mode-specific summaryPrompt template            MeetingPersistence.ts ~526-551
//   - generic (no-sections) summaryPrompt template    MeetingPersistence.ts ~556-565
//   - buildBalancedTranscriptContext(...)             MeetingPersistence.ts ~1074-1094 (copied verbatim, not reformatted)
//   - fallbackContext char budget (16000)             MeetingPersistence.ts:569
//   - JSON-fence stripping + parse of the response    MeetingPersistence.ts ~572-602
// The one piece that IS imported for real (not copied) is GROQ_SUMMARY_JSON_PROMPT,
// because electron/llm/index.ts already exports it and MeetingPersistence.ts imports it
// the same way — there is nothing to fork there.
// One thing this harness does NOT replicate: modeContextBlock, which MeetingPersistence
// only populates from a *custom* mode's DB-configured sections/instructions
// (ModesManager.buildSummarySafeModeContextBlock). This harness runs template-only modes
// with no custom mode record, so modeContextBlock is '' on the real code path too in that
// situation — this is not an approximation, it is the same empty state MeetingPersistence
// would produce for a stock built-in mode with no custom instructions.
//
// generateMeetingSummary(...) itself (the provider fallback ladder: custom provider ->
// Natively API -> Codex CLI -> Groq -> Gemini Flash-Lite -> Flash -> Pro -> Ollama) is
// called directly on the real, compiled LLMHelper — nothing about that ladder is
// reimplemented here.
//
// Platform note: this script is platform-neutral (no shell-outs, no sqlite3 CLI unlike
// meeting-notes-quality-probe.mjs's --meeting mode). It only needs Node + the compiled
// dist-electron/electron bundle, on macOS, Linux, or Windows.
if (process.env.RUN_NOTES_QUALITY_PROBE !== '1') {
  console.log('Set RUN_NOTES_QUALITY_PROBE=1 to run. This makes real LLM calls.');
  process.exit(0);
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Module from 'node:module';

// Identical fake-electron shim to scripts/meeting-notes-quality-probe.mjs — see that
// file's comment block for the full rationale (LLMHelper's compiled bundle
// require()s 'electron' at several call sites; under plain `node` that resolves to a
// path string, not a module, so the constructor throws without this shim).
const probeUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-v2v3-compare-'));
const fakeElectron = {
  app: {
    getPath: () => probeUserData,
    getName: () => 'Natively',
    getVersion: () => '0.0.0-probe',
    isPackaged: false,
    on: () => {},
    whenReady: () => Promise.resolve(),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s) => Buffer.from(String(s)),
    decryptString: (b) => Buffer.from(b).toString('utf8'),
  },
  BrowserWindow: class {},
  ipcMain: { on: () => {}, handle: () => {}, removeHandler: () => {} },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
  nativeTheme: { shouldUseDarkColors: false },
};
const origModuleLoad = Module._load;
Module._load = function patchedLoad(request, ...rest) {
  if (request === 'electron') return fakeElectron;
  return origModuleLoad.call(this, request, ...rest);
};

try {
  const dotenv = await import('dotenv');
  dotenv.config({ path: path.resolve('.env') });
} catch {
  // dotenv not available — fall back to whatever is already in the environment.
}

function parseArgs(argv) {
  const out = { transcriptPath: null, mode: 'general' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') { out.mode = argv[++i]; continue; }
    if (!a.startsWith('--') && !out.transcriptPath) { out.transcriptPath = a; continue; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.transcriptPath) {
  console.error('usage: node scripts/meeting-notes-v2-v3-compare.mjs <transcript.json> [--mode <templateType>]');
  process.exit(1);
}

const transcript = JSON.parse(fs.readFileSync(args.transcriptPath, 'utf8'));
if (!Array.isArray(transcript) || transcript.length === 0) {
  console.error('Transcript file must be a non-empty JSON array of { speaker, text, timestamp, final }.');
  process.exit(1);
}

const base = path.resolve('dist-electron/electron');
const { MeetingContextAssembler } = await import(pathToFileURL(path.join(base, 'services/meeting/MeetingContextAssembler.js')).href);
const { LLMHelper } = await import(pathToFileURL(path.join(base, 'LLMHelper.js')).href);
const { TEMPLATE_NOTE_SECTIONS } = await import(pathToFileURL(path.join(base, 'services/ModesManager.js')).href);
const { GROQ_SUMMARY_JSON_PROMPT } = await import(pathToFileURL(path.join(base, 'llm/index.js')).href);

const modeTemplateType = args.mode;
const modeNoteSections = TEMPLATE_NOTE_SECTIONS[modeTemplateType];
if (!modeNoteSections) {
  console.error(`Unknown --mode value "${modeTemplateType}". Known: ${Object.keys(TEMPLATE_NOTE_SECTIONS).join(', ')}`);
  process.exit(1);
}

const apiKey = process.env.GEMINI_API_KEY;
const groqApiKey = process.env.GROQ_API_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY;
const claudeApiKey = process.env.CLAUDE_API_KEY;
const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
const nvidiaNimApiKey = process.env.NVIDIA_NIM_API_KEY;

if (!apiKey && !groqApiKey && !openaiApiKey && !claudeApiKey && !deepseekApiKey && !nvidiaNimApiKey) {
  console.error('No provider API keys found in the environment (.env). Refusing to run a comparison that would measure nothing.');
  process.exit(1);
}

console.log(`transcript         ${args.transcriptPath} (${transcript.length} segments)`);
console.log(`mode               ${modeTemplateType} (${modeNoteSections.length} sections)`);
console.log(`credentials        gemini=${apiKey ? 'yes' : 'no'} groq=${groqApiKey ? 'yes' : 'no'} openai=${openaiApiKey ? 'yes' : 'no'} claude=${claudeApiKey ? 'yes' : 'no'} deepseek=${deepseekApiKey ? 'yes' : 'no'} nvidia=${nvidiaNimApiKey ? 'yes' : 'no'}`);

// ---------------------------------------------------------------------------
// V2 (legacy single-pass) — copied verbatim from electron/MeetingPersistence.ts.
// See the header comment above for exact source line ranges.
// ---------------------------------------------------------------------------

// Copied verbatim from electron/MeetingPersistence.ts:1074-1094 (buildBalancedTranscriptContext).
function buildBalancedTranscriptContext(transcript, maxChars) {
    const lines = (Array.isArray(transcript) ? transcript : [])
        .map(segment => `${segment.speaker || 'speaker'}: ${segment.text || ''}`)
        .filter(line => line.trim().length > 0);
    const full = lines.join('\n');
    if (full.length <= maxChars) return full;

    const budget = Math.max(3000, maxChars);
    const part = Math.floor(budget / 3);
    const start = full.slice(0, part);
    const middleStart = Math.max(0, Math.floor(full.length / 2) - Math.floor(part / 2));
    const middle = full.slice(middleStart, middleStart + part);
    const end = full.slice(Math.max(0, full.length - part));
    return [
        start,
        '\n[...middle of transcript preserved below...]\n',
        middle,
        '\n[...end of transcript preserved below...]\n',
        end,
    ].join('').slice(0, maxChars);
}

// Copied verbatim from electron/MeetingPersistence.ts:511-566 (prompt construction inside
// the `summaryData.schemaVersion !== 3` fallback branch). modeContextBlock is always ''
// here — see header comment for why that matches the real code path for a template-only
// mode with no custom mode record.
function buildV2Prompts(modeNoteSections) {
    const modeContextBlock = '';
    const baseRules = `RULES:
- Do NOT invent information not present in the context
- You MAY infer implied action items or next steps if they are logical consequences of the discussion
- Do NOT explain or define concepts mentioned
- Do NOT use filler phrases like "The meeting covered..." or "Discussed various..."
- Do NOT mention transcripts, AI, or summaries
- Do NOT sound like an AI assistant
- Sound like a senior PM's internal notes

STYLE: Calm, neutral, professional, skim-friendly. Short bullets, no sub-bullets.`;

    let summaryPrompt;
    let groqSummaryPrompt;

    if (modeNoteSections.length > 0) {
        const sectionList = modeNoteSections
            .map(s => s.description?.trim()
                ? `- "${s.title}": ${s.description}`
                : `- "${s.title}"`)
            .join('\n');
        const sectionKeys = modeNoteSections
            .map(s => `    "${s.title}": []`)
            .join(',\n');

        summaryPrompt = `You are a silent meeting note-taker. Extract structured notes from the conversation transcript below.
${modeContextBlock}
${baseRules}

SECTIONS TO FILL (extract only what is present in the transcript):
${sectionList}

Return ONLY valid JSON — no markdown fences, no comments, no extra keys. Each section value is an array of concise factual bullet strings taken directly from the conversation. Use [] if a section has no relevant content.

{
  "overview": "1-2 sentence summary of what was discussed",
  "sections": {
${sectionKeys}
  }
}`;
        groqSummaryPrompt = summaryPrompt;
    } else {
        summaryPrompt = `You are a silent meeting summarizer. Convert this conversation into concise internal meeting notes.

${baseRules}

Return ONLY valid JSON (no markdown code blocks):
{
  "overview": "1-2 sentence description of what was discussed",
  "keyPoints": ["3-6 specific bullets - each = one concrete topic or point discussed"],
  "actionItems": ["specific next steps, assigned tasks, or implied follow-ups. If absolutely none found, return empty array"]
}`;
        groqSummaryPrompt = GROQ_SUMMARY_JSON_PROMPT;
    }

    return { summaryPrompt, groqSummaryPrompt };
}

// generateMeetingSummary() logs the winning provider via console.log("[LLMHelper] ✅ ...
// summary generated successfully.") but returns only the raw string — there is no
// structured { provider, model } return value on this path (unlike V3's summary.generation).
// Capture stdout during the call to recover it, the only way to attribute an arm to a
// provider without modifying LLMHelper.
function captureProviderFromLogs(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => { lines.push(a.map(String).join(' ')); orig(...a); };
  return fn().finally(() => { console.log = orig; }).then(result => {
    const hit = lines.find(l => /✅ .*summary generated successfully/i.test(l));
    const providerMatch = hit ? hit.match(/✅ (?:\[)?([^\]]+?)(?:\])? summary generated successfully/i) : null;
    return { result, provider: providerMatch ? providerMatch[1].trim() : (hit || 'unknown (no match on success log line)') };
  });
}

async function runV2(llmHelper, transcript, modeNoteSections) {
  const { summaryPrompt, groqSummaryPrompt } = buildV2Prompts(modeNoteSections);
  const fallbackContext = buildBalancedTranscriptContext(transcript, 16000);

  const { result: generatedSummary, provider } = await captureProviderFromLogs(() =>
    llmHelper.generateMeetingSummary(summaryPrompt, fallbackContext, groqSummaryPrompt)
  );

  if (!generatedSummary) {
    return { summaryData: null, provider, error: 'empty response from generateMeetingSummary' };
  }

  const jsonMatch = generatedSummary.match(/```(?:json)?\n?([\s\S]*?)\n?```/) || [null, generatedSummary];
  const jsonStr = (jsonMatch[1] || generatedSummary).trim();
  try {
    const parsed = JSON.parse(jsonStr);
    let summaryData;
    if (modeNoteSections.length > 0 && parsed.sections && typeof parsed.sections === 'object') {
      const sectionsArr = modeNoteSections.map(s => ({
        title: s.title,
        bullets: Array.isArray(parsed.sections[s.title]) ? parsed.sections[s.title] : [],
      }));
      summaryData = { overview: parsed.overview, actionItems: [], keyPoints: [], sections: sectionsArr };
    } else {
      summaryData = parsed;
    }
    return { summaryData, provider, error: null };
  } catch (e) {
    return { summaryData: null, provider, error: `JSON parse failed: ${e.message}`, raw: jsonStr.slice(0, 500) };
  }
}

// ---------------------------------------------------------------------------
// V3 (chunked / map-reduce) — same call shape as scripts/meeting-notes-quality-probe.mjs.
// ---------------------------------------------------------------------------

// V3's summary.generation only carries { strategy, startedAt, chunkCount, warnings,
// completedAt, durationMs } — MeetingContextAssembler never plumbs a provider/model into it
// (see electron/services/meeting/MeetingSummaryReducer.ts:85-86, which only copies
// params.generation.provider/model through IF the caller supplied them, and
// MeetingContextAssembler.ts never does). So, like V2, provider attribution has to come
// from run logs. Under the hood, every chunk-atom extraction AND the reduce/polish call
// (generateStructured -> ChunkSummaryGenerator.generateAtoms, see
// electron/services/meeting/generateStructured.ts:90) routes through the SAME
// LLMHelper.generateMeetingSummary(...) as V2, so it logs the identical
// "[LLMHelper] ✅ <Provider> summary generated successfully" line — collect ALL of them
// (there can be several: one per chunk, plus repair retries, plus polish) rather than
// just the first.
function captureProvidersFromLogs(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => { lines.push(a.map(String).join(' ')); orig(...a); };
  return fn().finally(() => { console.log = orig; }).then(result => {
    const providers = lines
      .map(l => l.match(/✅ (?:\[)?([^\]]+?)(?:\])? summary generated successfully/i))
      .filter(Boolean)
      .map(m => m[1].trim());
    return { result, providers };
  });
}

async function runV3(llmHelper, transcript, modeTemplateType, modeNoteSections) {
  const started = Date.now();
  const { result, providers } = await captureProvidersFromLogs(() =>
    new MeetingContextAssembler(llmHelper).assembleSummary({
      transcript,
      title: 'Comparison Probe',
      modeTemplateType,
      modeNoteSections,
      polishSummary: true,
      generateFollowUpDraft: false,
      startedAtMs: started,
      startedAtIso: new Date(started).toISOString(),
    })
  );
  return { summary: result.summary, meta: result.meta, elapsedMs: Date.now() - started, providers };
}

// ---------------------------------------------------------------------------
// Drive both arms against the identical transcript, in one invocation.
// ---------------------------------------------------------------------------

// Two independent LLMHelper instances so the two arms cannot share mutable
// per-call state (e.g. lastProviderModel) across the concurrent-looking-but-actually-
// sequential calls below.
const llmHelperV2 = new LLMHelper(apiKey, false, undefined, undefined, groqApiKey, openaiApiKey, claudeApiKey, deepseekApiKey, nvidiaNimApiKey);
const llmHelperV3 = new LLMHelper(apiKey, false, undefined, undefined, groqApiKey, openaiApiKey, claudeApiKey, deepseekApiKey, nvidiaNimApiKey);

console.log('\n=== Running V2 (legacy single-pass) ===');
const v2Started = Date.now();
const v2 = await runV2(llmHelperV2, transcript, modeNoteSections);
const v2ElapsedMs = Date.now() - v2Started;
console.log(`V2 done in ${Math.round(v2ElapsedMs / 1000)}s — provider: ${v2.provider}${v2.error ? ` — ERROR: ${v2.error}` : ''}`);

console.log('\n=== Running V3 (chunked map-reduce) ===');
const v3 = await runV3(llmHelperV3, transcript, modeTemplateType, modeNoteSections);
const v3ProviderSummary = v3.providers.length > 0 ? [...new Set(v3.providers)].join(', ') : 'unknown (no match on success log lines)';
console.log(`V3 done in ${Math.round(v3.elapsedMs / 1000)}s — provider(s): ${v3ProviderSummary} (${v3.providers.length} calls) strategy: ${v3.meta?.strategy} chunks: ${v3.meta?.chunkCount}`);

// ---------------------------------------------------------------------------
// Render output files.
// ---------------------------------------------------------------------------

const outDir = path.dirname(path.resolve(args.transcriptPath));
const v2Path = path.join(outDir, 'v2-notes.md');
const v3Path = path.join(outDir, 'v3-notes.md');
const comparisonPath = path.join(outDir, 'v2-v3-comparison.md');

function renderV2Md(v2) {
  const lines = [`# V2 (legacy single-pass) notes`, ''];
  if (v2.error) {
    lines.push(`**ERROR:** ${v2.error}`);
    if (v2.raw) lines.push('', '```', v2.raw, '```');
    return lines.join('\n');
  }
  const sd = v2.summaryData || {};
  lines.push('## Overview', '', sd.overview || '_(none)_', '');
  if (Array.isArray(sd.keyPoints) && sd.keyPoints.length > 0) {
    lines.push('## Key Points', '');
    for (const kp of sd.keyPoints) lines.push(`- ${kp}`);
    lines.push('');
  }
  if (Array.isArray(sd.actionItems) && sd.actionItems.length > 0) {
    lines.push('## Action Items', '');
    for (const ai of sd.actionItems) lines.push(`- ${ai}`);
    lines.push('');
  }
  if (Array.isArray(sd.sections) && sd.sections.length > 0) {
    for (const section of sd.sections) {
      lines.push(`## ${section.title}`, '');
      if (Array.isArray(section.bullets) && section.bullets.length > 0) {
        for (const b of section.bullets) lines.push(`- ${b}`);
      } else {
        lines.push('_(no bullets)_');
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

function renderV3Md(v3) {
  const s = v3.summary;
  const lines = [`# V3 (chunked map-reduce) notes`, ''];
  if (!s) {
    lines.push('**NO SUMMARY PRODUCED**', '', '```json', JSON.stringify(v3.meta, null, 2), '```');
    return lines.join('\n');
  }
  if (Array.isArray(s.tldr) && s.tldr.length > 0) {
    lines.push('## TLDR', '');
    for (const line of s.tldr) lines.push(`- ${line}`);
    lines.push('');
  }
  lines.push('## Overview', '', s.overview || '_(none)_', '');
  for (const section of s.sections || []) {
    lines.push(`## ${section.title}`, '');
    if (Array.isArray(section.bullets) && section.bullets.length > 0) {
      for (const b of section.bullets) lines.push(`- ${b.text}`);
    } else {
      lines.push('_(no bullets)_');
    }
    lines.push('');
  }
  return lines.join('\n');
}

function countWords(text) {
  return (text || '').split(/\s+/).filter(Boolean).length;
}

function renderComparisonMd({ v2, v3, v2ElapsedMs, modeTemplateType, modeNoteSections, transcriptPath, transcriptLength }) {
  const lines = [];
  lines.push('# V2 vs V3 meeting-notes comparison', '');
  lines.push(`Transcript: \`${transcriptPath}\` (${transcriptLength} segments) — mode: \`${modeTemplateType}\``, '');

  const v3ProviderList = v3.providers.length > 0 ? [...new Set(v3.providers)].join(', ') : 'unknown (no match on success log lines)';
  lines.push('## Provider attribution', '');
  lines.push(`- **V2** served by: **${v2.provider}**${v2.error ? ` (ERROR: ${v2.error})` : ''}`);
  lines.push(`- **V3** served by: **${v3ProviderList}** across ${v3.providers.length} structured-generation call(s) (one per chunk, plus reduce/polish). \`summary.generation\` itself carries no provider/model field for this pipeline (see script header) — this is recovered from run logs.`);
  lines.push('');

  lines.push('## Section-by-section bullet counts', '');
  lines.push('| Section | V2 bullets | V3 bullets |');
  lines.push('|---|---|---|');
  const v2Sections = new Map((v2.summaryData?.sections || []).map(s => [s.title, (s.bullets || []).length]));
  const v3Sections = new Map((v3.summary?.sections || []).map(s => [s.title, (s.bullets || []).length]));
  const allTitles = modeNoteSections.length > 0
    ? modeNoteSections.map(s => s.title)
    : Array.from(new Set([...v2Sections.keys(), ...v3Sections.keys()]));
  for (const title of allTitles) {
    lines.push(`| ${title} | ${v2Sections.get(title) ?? 0} | ${v3Sections.get(title) ?? 0} |`);
  }
  lines.push('');

  const v2Bullets = (v2.summaryData?.sections || []).flatMap(s => s.bullets || []).length
    + (v2.summaryData?.keyPoints || []).length
    + (v2.summaryData?.actionItems || []).length;
  const v3Bullets = (v3.summary?.sections || []).flatMap(s => s.bullets || []).length;

  lines.push('## Overview / summary-line counts', '');
  lines.push(`- V2 overview: ${countWords(v2.summaryData?.overview)} words`);
  lines.push(`- V3 overview: ${countWords(v3.summary?.overview)} words`);
  lines.push(`- V3 TLDR lines: ${v3.summary?.tldr?.length ?? 0}`);
  lines.push('');

  lines.push('## Totals', '');
  lines.push(`- V2 total bullets (sections + keyPoints + actionItems): ${v2Bullets}`);
  lines.push(`- V3 total bullets (sections only): ${v3Bullets}`);
  lines.push(`- V2 elapsed: ${Math.round(v2ElapsedMs / 1000)}s`);
  lines.push(`- V3 elapsed: ${Math.round(v3.elapsedMs / 1000)}s (strategy: ${v3.meta?.strategy}, chunks: ${v3.meta?.chunkCount})`);
  lines.push('');

  lines.push('## Caveats', '');
  lines.push('- V2 prompt construction is COPIED (not imported) from `electron/MeetingPersistence.ts` — see this script\'s header comment for exact source line ranges. If that file\'s fallback branch changes, this copy goes stale silently; there is no compile-time link between them.');
  lines.push('- V2\'s `modeContextBlock` is hardcoded to `\'\'` here, matching the real code path for a template-only mode with no custom mode DB record (no custom mode is configured in this harness). A meeting run under a customized mode with `buildSummarySafeModeContextBlock(...)` content would see a different V2 prompt than this harness reproduces.');
  lines.push('- Both arms\' provider attribution is recovered by grepping `console.log` output for the `✅ ... summary generated successfully` line LLMHelper.generateMeetingSummary logs on success — neither V2\'s raw string return nor V3\'s `summary.generation` object carries a structured provider/model field on this call path. If LLMHelper changes that log message wording, this heuristic silently breaks (falls back to "unknown").');
  lines.push('- Two independent `LLMHelper` instances are used for the two arms specifically so they cannot race on shared per-instance state; provider choice can still differ between arms purely due to which provider happened to be available/rate-limited at the moment each arm ran, not necessarily a quality difference between V2 and V3.');
  lines.push('- This is a single run on one (here, synthetic) transcript — not a statistically meaningful sample.');

  return lines.join('\n');
}

fs.writeFileSync(v2Path, renderV2Md(v2), 'utf8');
fs.writeFileSync(v3Path, renderV3Md(v3), 'utf8');
fs.writeFileSync(comparisonPath, renderComparisonMd({
  v2, v3, v2ElapsedMs,
  modeTemplateType, modeNoteSections,
  transcriptPath: args.transcriptPath,
  transcriptLength: transcript.length,
}), 'utf8');

console.log('\n=== Output files ===');
console.log(v2Path);
console.log(v3Path);
console.log(comparisonPath);
