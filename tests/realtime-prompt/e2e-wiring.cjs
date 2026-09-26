// tests/realtime-prompt/e2e-wiring.cjs — run: npm run test:realtime-prompt
//
// REAL-WIRING E2E (no network, no keys). Real: DatabaseManager (isolated dir), ModesManager API,
// IntelligenceEngine, WhatToAnswerLLM, V3 bridge/composer, AnswerValidator.
// Stubbed: ONLY the provider call (LLMHelper.streamChat) — it captures the exact
// (userMessage, systemPrompt) that would leave the process and returns a canned answer.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const root = path.resolve(__dirname, '..', '..');
// `--v3=0` drives the legacy / promptSystemV2 fallback path; default is the V3 path.
const V3 = (process.argv.find(a => a.startsWith('--v3=')) || '--v3=1').slice(5);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-e2e-wiring-'));
process.env.NATIVELY_TEST_USERDATA = userData;
process.env.NATIVELY_CONTEXT_INTELLIGENCE_V3 = V3;
const d = (p) => path.join(root, 'dist-electron/electron', p);

const realLog = console.log.bind(console);
const logLines = [];
const quiet = (...a) => { try { logLines.push(a); } catch {} };
console.log = quiet; console.warn = quiet; console.info = quiet; console.debug = quiet;
const out = (...a) => realLog(...a);

const CONTRACT = 'Pair programming contract: for every coding question respond in exactly this format. First restate the problem in one line. Then list the approach as numbered steps. Then give the code in Java. Then give a dry run on one example. Do not use the Approach / Complexity / Edge cases headings.';
const OBEDIENT = ['Problem: return indices of the two numbers that add up to target.', '', 'Steps:', '1. Walk the array once, keeping a map of value -> index.', '2. For each number, look up target minus that number in the map.', '3. If it is there, return both indices; otherwise store the current number.', '', '```java', 'class Solution {', '    public int[] twoSum(int[] nums, int target) {', '        Map<Integer, Integer> seen = new HashMap<>();', '        for (int i = 0; i < nums.length; i++) {', '            Integer j = seen.get(target - nums[i]);', '            if (j != null) return new int[]{j, i};', '            seen.put(nums[i], i);', '        }', '        return new int[0];', '    }', '}', '```', '', 'Example: nums=[2,7,11,15], target=9. i=0 stores 2. i=1 finds 9-7=2 at index 0, returns [0,1].'].join('\n');
const PROSE = 'You can return an opened item within thirty days as long as you still have the receipt and the original packaging. We refund to the original payment method, usually inside five business days.';

function makeHelper(canned, captured) {
  const base = {
    setNegotiationCoachingHandler() {}, isUsingOllama() { return false; }, canUseLocalFallback() { return false; },
    getPromptTier() { return 'cloud'; }, getCapabilities() { return { contextWindow: 128000, supportsVision: true }; },
    fitContextForCurrentModel(x) { return x; }, rememberAnswerCall() {},
    async *streamChat(...args) { captured.push({ user: String(args[0] ?? ''), system: String(args[3] ?? '') }); for (const part of canned.match(/[\s\S]{1,60}/g) || []) yield part; },
  };
  const missing = new Set();
  return new Proxy(base, { get(t, k) { if (k in t) return t[k]; if (typeof k === 'string' && !['then', 'toJSON', 'constructor'].includes(k)) missing.add(k); return undefined; }, has() { return true; } , ownKeys(t) { return Reflect.ownKeys(t); } });
}

async function turn({ modeTemplate, customMode, instructions, question, canned }) {
  const { ModesManager } = require(d('services/ModesManager.js'));
  const { IntelligenceEngine } = require(d('IntelligenceEngine.js'));
  const { SessionTracker } = require(d('SessionTracker.js'));
  const mm = ModesManager.getInstance();
  let mode;
  if (customMode) mode = mm.createMode({ name: customMode, templateType: modeTemplate });
  else mode = mm.getModes().find((m) => m.templateType === modeTemplate);
  if (!mode) throw new Error(`no mode for template ${modeTemplate}; have: ${mm.getModes().map(m => m.templateType).join(',')}`);
  mm.updateMode(mode.id, { customContext: instructions });
  mm.setActiveMode(mode.id);

  const captured = [];
  const session = new SessionTracker();
  session.addTranscript({ speaker: 'system', text: question, timestamp: Date.now(), final: true });
  const engine = new IntelligenceEngine(makeHelper(canned, captured), session);
  let emitted = null;
  engine.on('suggested_answer', (a) => { emitted = a; });
  const mark = logLines.length;
  const returned = await engine.runWhatShouldISay(question, 0.9, undefined, { skipCooldown: true });
  const logs = logLines.slice(mark);
  const find = (tag) => logs.filter((a) => a[0] === tag).map((a) => a[1]);
  return { mode: mode.id, captured, committed: emitted ?? returned ?? '', delivery: find('[UserInstructions]')[0], output: find('[UserInstructions] output')[0] };
}

const results = [];
const check = (scenario, name, ok, detail) => { results.push({ scenario, name, ok }); out(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        -> ${detail}`}`); };
const both = (c) => `${c?.system ?? ''}\n${c?.user ?? ''}`;

(async () => {
  out(`\n##### V3=${V3}  userData=${userData}`);

  out('\nE1  General mode · "Answer in 100 words." · spoken question');
  let r = await turn({ modeTemplate: 'general', instructions: 'Answer in 100 words.', question: 'What is your return policy for opened items?', canned: PROSE });
  let c = r.captured[0];
  check('E1', 'the provider was called', !!c, 'no dispatch captured');
  check('E1', 'the user instruction reaches the provider', /Answer in 100 words\./.test(both(c)), 'instruction text absent from system+user');
  check('E1', 'resolved LENGTH line present', /LENGTH is set by the user: about 100 words/.test(both(c)), 'no resolved length line');
  check('E1', 'NO competing app word ceiling anywhere', !/Hard ceiling|roughly \d+ to \d+ words|LENGTH LIMIT: at most/.test(both(c)), (both(c).match(/.{0,60}(Hard ceiling|roughly \d+ to \d+ words|LENGTH LIMIT).{0,80}/) || [''])[0]);
  if (V3 === '1') {
    check('E1', 'block is the LAST thing in the user message', c.user.trimEnd().endsWith('</user_instructions>'), c.user.slice(-160));
    check('E1', 'system prompt carries the static precedence note', /# User instructions/.test(c.system), 'note missing');
    check('E1', 'raw user text is NOT in the system prompt (§19.2)', !/Answer in 100 words\./.test(c.system), 'raw text leaked into system');
    check('E1', '[UserInstructions] trace: delivered + app length suppressed', r.delivery?.delivery?.delivered === true && r.delivery?.delivery?.appLength === 'suppressed_by_user', JSON.stringify(r.delivery?.delivery));
  } else {
    check('E1', 'fallback carrier declares authority', /<custom_instructions_authority>|<user_instructions/.test(both(c)), 'no authority block on the non-V3 path');
  }

  out('\nE2  Technical-interview · pair-programming contract · model obeys it');
  r = await turn({ modeTemplate: 'technical-interview', instructions: CONTRACT, question: 'Write a function to solve two sum.', canned: OBEDIENT });
  c = r.captured[0];
  check('E2', 'the contract reaches the provider whole', both(c).includes('Do not use the Approach / Complexity / Edge cases headings.'), 'contract missing/truncated');
  check('E2', 'coding contract is the USER-FORMAT variant', /standing instructions[^\n]*define the answer FORMAT/i.test(c?.system ?? ''), 'custom_format directive missing from system');
  check('E2', 'mandatory six-heading contract is NOT attached', !/Every heading is mandatory/.test(c?.system ?? ''), 'six-section contract still attached');
  check('E2', 'STRUCTURE + Java resolved lines present', /STRUCTURE is set by the user/.test(both(c)) && /CODE LANGUAGE is set by the user: Java/.test(both(c)), 'resolved lines missing');
  check('E2', 'COMMITTED ANSWER IS NOT REWRITTEN', r.committed.includes('Problem: return indices') && !/O\(\?\)/.test(r.committed) && !/^## (Approach|Complexity)/m.test(r.committed), r.committed.slice(0, 300));
  check('E2', '[UserInstructions] output: custom_format, no repair', r.output?.codingFormat === 'custom_format' && r.output?.willRepair === false, JSON.stringify(r.output));

  out('\nE3  CONTROL · same turn, mode has NO instructions · default behaviour must be unchanged');
  r = await turn({ modeTemplate: 'technical-interview', instructions: '', question: 'Write a function to solve two sum.', canned: OBEDIENT });
  c = r.captured[0];
  check('E3', 'six-heading contract IS attached', /Every heading is mandatory/.test(c?.system ?? ''), 'default contract missing');
  check('E3', 'no user-instruction block is rendered', !/<user_instructions|<custom_instructions>/.test(both(c)), 'block rendered with empty instructions');
  check('E3', 'non-conforming answer IS still repaired', /^## Complexity/m.test(r.committed), r.committed.slice(0, 200));

  out('\nE4  Technical-interview · "Use Java only" (the phrasing the old gate dropped)');
  r = await turn({ modeTemplate: 'technical-interview', instructions: 'Use Java only', question: 'Write a function to reverse a linked list.', canned: OBEDIENT });
  c = r.captured[0];
  check('E4', 'delivered on a coding turn', /Use Java only/.test(both(c)), 'dropped');
  check('E4', 'CODE LANGUAGE resolved to Java', /CODE LANGUAGE is set by the user: Java/.test(both(c)), 'not resolved');
  check('E4', 'a plain constraint does NOT switch off the six-section contract', /Every heading is mandatory/.test(c?.system ?? ''), 'contract wrongly replaced');

  out('\nE5  SAFETY · instruction + salary + personal fact, on a coding turn');
  r = await turn({ modeTemplate: 'technical-interview', instructions: 'Use Java only.\n\nMy expected salary is 30 LPA.\n\nI used Java at my last job at RedisMart.', question: 'Write a function to reverse a linked list.', canned: OBEDIENT });
  c = r.captured[0];
  check('E5', 'the instruction still arrives', /Use Java only/.test(both(c)), 'dropped');
  check('E5', 'salary never reaches the provider', !/30 LPA/.test(both(c)), 'SALARY LEAKED');
  check('E5', 'personal fact never reaches the provider', !/RedisMart/.test(both(c)), 'FACT LEAKED');

  out('\nE6  TRAP · user-built mode NAMED "Interview Format:" with a plain constraint');
  r = await turn({ modeTemplate: 'technical-interview', customMode: 'Interview Format: Strict', instructions: 'Be concise.', question: 'Write a function to solve two sum.', canned: OBEDIENT });
  c = r.captured[0];
  check('E6', 'the mode NAME is not mistaken for a format definition', /Every heading is mandatory/.test(c?.system ?? '') && r.output?.codingFormat !== 'custom_format', JSON.stringify(r.output));
  check('E6', 'and is not reported as STRUCTURE set by the user', !/STRUCTURE is set by the user/.test(both(c)), 'name read as structure');

  out('\nE7  Call-centre mode · multi-paragraph prompt order + persona');
  const paras = ['You are a call centre agent for a broadband company.', 'When asked about an outage, follow this order.', 'Always apologise first.', 'Then give the estimated fix time.', 'Never promise a refund.'];
  r = await turn({ modeTemplate: 'call-center', instructions: paras.join('\n\n'), question: 'My internet has been down since morning, what is going on?', canned: PROSE });
  c = r.captured[0];
  const pos = paras.map((p) => both(c).indexOf(p));
  check('E7', 'every paragraph arrives', pos.every((p) => p >= 0), `positions=${pos}`);
  check('E7', 'in the order the user wrote them', pos.every((p, i) => i === 0 || p > pos[i - 1]), `positions=${pos}`);

  out('\nE8  Long prompt · rule placed after the OLD 1,200-char cutoff');
  r = await turn({ modeTemplate: 'seminar', instructions: `${'Keep the tone warm and encouraging for students. '.repeat(40)}\n\nLATE RULE: end every answer with a follow-up question.`, question: 'Can you explain what gradient descent is?', canned: PROSE });
  c = r.captured[0];
  check('E8', 'text past 1,200 chars reaches the provider', /LATE RULE: end every answer with a follow-up question\./.test(both(c)), 'truncated');
  check('E8', 'not marked truncated', !/\[truncated\]/.test(both(c)), 'truncation marker present');

  const failed = results.filter((x) => !x.ok);
  out(`\n##### V3=${V3}: ${results.length - failed.length}/${results.length} passed${failed.length ? `  FAILED: ${failed.map((f) => `${f.scenario}:${f.name}`).join(' | ')}` : ''}`);
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  setTimeout(() => process.exit(failed.length ? 1 : 0), 200);
})().catch((e) => { out('HARNESS ERROR', e && e.stack || e); process.exit(2); });
