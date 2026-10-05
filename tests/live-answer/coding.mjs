// Coding-shape benchmark (2026-09-29): does a coding answer scale with what was
// actually asked? Drives the real pipeline (typed box and Cmd+Enter, optional
// screenshots) and records the answer plus the coding contract that reached the
// model (NATIVELY_PROMPT_DEBUG=1 recorder).
//
//   NATIVELY_E2E=1 NATIVELY_PROMPT_DEBUG=1 npm run dev:agent
//   node tests/live-answer/coding.mjs <label> [--models=a,b] [--surfaces=typed,hotkey] [--modes=general,technical-interview] [--only=C01,F03]
//
// Screenshot rows need LIVE_ANSWER_IMAGES=<dir holding problem.png and code.png>.
import fs from 'node:fs';
import path from 'node:path';
import { connect, setup, setMode, askTyped, askHotkey, promptDebug } from './cdp.mjs';

const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
const label = process.argv[2];
if (!label) { console.error('usage: coding.mjs <label> [--models=..] [--surfaces=..] [--modes=..] [--only=..]'); process.exit(2); }
const models = arg('models', 'gemini-3.1-flash-lite,deepseek-flash').split(',');
const surfaces = arg('surfaces', 'typed,hotkey').split(',');
const modes = arg('modes', 'general').split(',');
const only = arg('only', '').split(',').filter(Boolean);
const RESULTS = process.env.LIVE_ANSWER_RESULTS ? path.resolve(process.env.LIVE_ANSWER_RESULTS) : path.resolve(new URL('./results/', import.meta.url).pathname);
fs.mkdirSync(RESULTS, { recursive: true });
const IMG = process.env.LIVE_ANSWER_IMAGES ? path.resolve(process.env.LIVE_ANSWER_IMAGES) : null;

const TWO_SUM = 'Given an array of integers nums and a target, return the indices of the two numbers that add up to the target.';
const BRUTE = '```python\ndef two_sum(nums, target):\n    for i in range(len(nums)):\n        for j in range(i + 1, len(nums)):\n            if nums[i] + nums[j] == target:\n                return [i, j]\n    return []\n```';
const DUP = '```python\ndef first_repeat(nums):\n    seen = set()\n    for n in nums:\n        if n in seen:\n            return n\n        seen.add(n)\n    return -1\n```';
const BUGGY = '```python\ndef binary_search(nums, target):\n    lo, hi = 0, len(nums)\n    while lo < hi:\n        mid = (lo + hi) // 2\n        if nums[mid] == target:\n            return mid\n        if nums[mid] < target:\n            lo = mid\n        else:\n            hi = mid\n    return -1\n```';

// `want` is the shape the request asks for (the thing being measured):
//   code, solve, approach, brute_force, optimize, complexity, dry_run, explain, debug, walkthrough
// Follow-ups (`after: 'two-sum'`) run after a Two Sum turn: on the typed box the
// first question is asked in the same chat; on Cmd+Enter it is in the transcript.
export const CASES = [
  { id: 'C01', want: 'code', q: 'write the code for odd even' },
  { id: 'C02', want: 'code', q: 'write Fibonacci' },
  { id: 'C03', want: 'solve', q: 'solve Two Sum' },
  { id: 'C04', want: 'solve', q: 'Solve this: given an array of coin denominations and an amount, return the fewest coins needed to make up that amount, or -1 if it cannot be made.' },
  { id: 'C05', want: 'solve', q: 'Solve this LeetCode problem: given an array of intervals, merge all overlapping intervals and return the result.' },
  { id: 'C06', want: 'solve', q: 'Solve Two Sum and give me the time complexity.' },
  { id: 'F01', want: 'brute_force', after: 'two-sum', q: "What's the brute-force approach?" },
  { id: 'F02', want: 'brute_force', after: 'two-sum', q: 'Give me the brute force first.' },
  { id: 'F03', want: 'optimize', after: 'two-sum', q: 'Optimise this.' },
  { id: 'F04', want: 'complexity', after: 'two-sum', q: "What's the time complexity?" },
  { id: 'F05', want: 'dry_run', after: 'two-sum', q: 'Dry run this input: nums = [3, 2, 4], target = 6.' },
  { id: 'F06', want: 'walkthrough', after: 'two-sum', q: 'Walk me through the solution.' },
  { id: 'F07', want: 'approach', after: 'two-sum', q: 'What data structure would you use?' },
  { id: 'F08', want: 'approach', after: 'two-sum', q: 'What approach should I use?' },
  { id: 'P01', want: 'explain', q: `Explain this code:\n${DUP}` },
  { id: 'P02', want: 'optimize', q: `Optimise this:\n${BRUTE}` },
  { id: 'P03', want: 'complexity', q: `What's the time complexity of this?\n${BRUTE}` },
  { id: 'P04', want: 'dry_run', q: `Dry run this with nums = [3, 1, 3]:\n${DUP}` },
  { id: 'P05', want: 'debug', q: `Why does this hang? Fix it:\n${BUGGY}` },
  { id: 'I01', want: 'solve', img: 'problem.png', q: 'Solve this.' },
  { id: 'I02', want: 'complexity', img: 'code.png', q: "What's the complexity of this?" },
  { id: 'I03', want: 'explain', img: 'code.png', q: 'Explain this.' },
  { id: 'I04', want: 'optimize', img: 'code.png', q: 'Optimise this.' },
];

const PRIOR = {
  'two-sum': {
    typed: `Solve Two Sum: ${TWO_SUM}`,
    transcript: [
      { speaker: 'interviewer', text: `Let's start with Two Sum. ${TWO_SUM}` },
      { speaker: 'user', text: 'Sure. I would use a hash map: as I scan the array I check whether target minus the current number is already in the map, and if it is I return both indices.' },
    ],
  },
};

// What the answer contains, measured on the text the overlay shows.
export function measure(text) {
  const t = String(text || '').replace(/\n?\[\[GIST\]\][^\n]*$/, '');
  const headings = (t.match(/^\s{0,3}#{1,6}\s+\S.*$/gm) || []).map(h => h.replace(/^\s*#+\s*/, '').trim());
  const fences = (t.match(/```/g) || []).length / 2;
  const prose = t.replace(/```[\s\S]*?```/g, ' ');
  const words = (prose.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || []).length;
  return {
    headings, headingCount: headings.length, words, codeBlocks: Math.floor(fences),
    hasComplexity: /\bO\([^)]{1,25}\)/.test(t),
    hasDryRunSection: headings.some(h => /dry run/i.test(h)),
    hasFollowUps: headings.some(h => /follow-?up/i.test(h)),
    placeholders: /O\(\?\)|_Working on|_Identifying|See the approach above for the core technique|_Writing the solution/.test(t),
  };
}

// Which coding contract reached the model, from the recorder's wire copy.
// The composition note holds the full composed system prompt; the wire copy is
// empty on Gemini requests served from cachedContents.
function contractOf(dbg) {
  const records = dbg?.records || [];
  const notes = dbg?.notes || [];
  const rec = [...records].reverse().find(r => r.note) || records.at(-1);
  const note = [...notes].reverse().find(n => typeof n.system === 'string' && n.system);
  const sys = note?.system || rec?.system || '';
  const block = (sys.match(/<coding_contract>[\s\S]*?<\/coding_contract>/) || [''])[0];
  return {
    provider: rec?.provider ?? null, model: rec?.model ?? null, systemChars: sys.length,
    hasCodingContract: Boolean(block),
    sixMandatory: /Every heading is mandatory/.test(block),
    impl: /IMPLEMENTATION RESPONSE CONTRACT/.test(block),
    explicitFormat: /stated the output format explicitly/.test(block),
    shape: (block.match(/<coding_shape name="([a-z_]+)"/) || [])[1] ?? null,
    promptSource: note?.promptSource ?? rec?.note?.promptSource ?? null,
    codingTask: note?.extra?.turnFacts?.codingTask ?? rec?.note?.extra?.turnFacts?.codingTask ?? null,
  };
}

const outFile = path.join(RESULTS, `${label}.jsonl`);
const c = await connect();
for (const mode of modes) {
  for (const model of models) {
    const s = await setup(c, model);
    let m = await setMode(c, mode);
    if (m?.error && mode !== 'general') {
      await c.evaluate(`window.electronAPI.modesCreate({ name: 'Bench ${mode}', templateType: ${JSON.stringify(mode)} })`);
      m = await setMode(c, mode);
    }
    console.log(`== ${mode} / ${model}: keys gem=${s.gem} ds=${s.ds} mode=${m?.name ?? JSON.stringify(m)}`);
    for (const it of CASES) {
      if (only.length && !only.includes(it.id)) continue;
      if (it.img && !IMG) continue;
      for (const surface of surfaces) {
        await promptDebug(c, { clear: true });
        const prior = it.after ? PRIOR[it.after] : null;
        const imagePaths = it.img ? [path.join(IMG, it.img)] : undefined;
        let r;
        try {
          if (surface === 'typed') {
            if (prior) {
              await askTyped(c, prior.typed);
              r = await askTyped(c, it.q, imagePaths ? { imagePaths } : {}, [], { reset: false });
            } else {
              r = await askTyped(c, it.q, imagePaths ? { imagePaths } : {});
            }
          } else if (imagePaths) {
            // Cmd+Enter with a screenshot attached: the same runWhatShouldISay call
            // the hotkey handler makes when the screenshot tray holds an image.
            await c.invoke('__e2e__:reset-session');
            const x = await c.invoke('__e2e__:ask', { question: it.q, hotkey: true, imagePaths, timeoutMs: 90000 });
            r = { surface: 'hotkey', final: x?.answer ?? '', raw: x?.streamedTokens ?? '', ok: !!x?.success };
          } else {
            r = await askHotkey(c, null, it.q, prior ? prior.transcript : []);
          }
        } catch (e) { r = { surface, ok: false, err: String(e).slice(0, 200), final: '' }; }
        const dbg = await promptDebug(c, { clear: true });
        const row = { label, mode, model, id: it.id, want: it.want, q: it.q, surface, ok: r.ok, err: r.err, final: r.final, raw: r.raw, m: measure(r.final), contract: contractOf(dbg) };
        fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
        console.log(`${mode.slice(0, 4)} ${model.slice(0, 6)} ${it.id} ${surface.padEnd(6)} want=${it.want.padEnd(11)} ok=${r.ok} h=${row.m.headingCount} w=${row.m.words} code=${row.m.codeBlocks} six=${row.contract.sixMandatory} shape=${row.contract.shape} | ${JSON.stringify((r.final || r.err || '').slice(0, 70))}`);
      }
    }
  }
}
c.close();
process.exit(0);
