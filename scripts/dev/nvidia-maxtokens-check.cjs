/**
 * NVIDIA's /v1/models exposes no per-model output ceiling, and the picker
 * offers the whole catalogue — so a fixed max_tokens can 400 every request for
 * a model whose ceiling is lower. createNvidiaNimCompletion must retry once
 * without the cap, and must NOT swallow unrelated errors.
 */
const path = require('path'); const fs = require('fs'); const os = require('os');
const esbuild = require('esbuild');
const ROOT = path.resolve(__dirname, '../..');
let failures = 0;
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!ok) failures++; };

// Pull the two methods out of LLMHelper.ts without booting the whole class.
const srcText = fs.readFileSync(path.join(ROOT, 'electron/LLMHelper.ts'), 'utf8');
const grab = (name) => {
  const i = srcText.indexOf(`  private ${name}(`) >= 0
    ? srcText.indexOf(`  private ${name}(`) : srcText.indexOf(`  private async ${name}(`);
  if (i < 0) throw new Error(`method ${name} not found`);
  const end = srcText.indexOf('\n  }\n', i) + '\n  }\n'.length;
  return srcText.slice(i, end);
};
const CONST = /const NVIDIA_NIM_MAX_OUTPUT_TOKENS = (\d+)/.exec(srcText);
check('NVIDIA_NIM_MAX_OUTPUT_TOKENS is a named constant', !!CONST, CONST && CONST[1]);

const shim = `
const NVIDIA_NIM_MAX_OUTPUT_TOKENS = ${CONST[1]};
class Harness {
  constructor(client) { this.nvidiaNimClient = client; }
${grab('isNvidiaNimMaxTokensRejection')}
${grab('createNvidiaNimCompletion')}
}
module.exports = { Harness, NVIDIA_NIM_MAX_OUTPUT_TOKENS };
`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-maxtok-'));
const tsFile = path.join(tmp, 'h.ts'); fs.writeFileSync(tsFile, shim);
const outFile = path.join(tmp, 'h.cjs');
esbuild.buildSync({ entryPoints: [tsFile], outfile: outFile, bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'error' });
const { Harness, NVIDIA_NIM_MAX_OUTPUT_TOKENS } = require(outFile);

const clientThatRejects = (err) => {
  const calls = [];
  return { calls, chat: { completions: { create: async (req) => {
    calls.push(req);
    if (calls.length === 1 && err) throw err;
    return { ok: true, sawMaxTokens: 'max_tokens' in req };
  } } } };
};
const err = (status, message) => Object.assign(new Error(message), { status });

(async () => {
  // Happy path: the cap is sent, one call.
  let c = clientThatRejects(null);
  let r = await new Harness(c).createNvidiaNimCompletion({ model: 'm', messages: [] });
  check('sends the requested ceiling on the first try', c.calls[0].max_tokens === NVIDIA_NIM_MAX_OUTPUT_TOKENS, String(c.calls[0].max_tokens));
  check('does not retry when the call succeeds', c.calls.length === 1, `${c.calls.length} call(s)`);

  // The regression: model ceiling below our default.
  for (const [status, msg] of [[400, "max_tokens must be <= 4096"], [400, 'Maximum tokens exceeded for this model'], [422, 'invalid max tokens value']]) {
    c = clientThatRejects(err(status, msg));
    r = await new Harness(c).createNvidiaNimCompletion({ model: 'small-model', messages: [] });
    check(`retries without the cap on ${status} "${msg.slice(0, 28)}..."`, c.calls.length === 2, `${c.calls.length} call(s)`);
    check('  retry omits max_tokens entirely', c.calls[1] && !('max_tokens' in c.calls[1]), JSON.stringify(Object.keys(c.calls[1] || {})));
    check('  caller still gets a result', r && r.ok === true, JSON.stringify(r));
  }

  // Unrelated failures must propagate, not silently retry.
  for (const [status, msg] of [[401, 'invalid api key'], [429, 'rate limited'], [400, 'model not found'], [500, 'server error']]) {
    c = clientThatRejects(err(status, msg));
    let threw = null;
    try { await new Harness(c).createNvidiaNimCompletion({ model: 'm', messages: [] }); } catch (e) { threw = e; }
    check(`propagates ${status} "${msg}"`, threw && threw.message === msg, threw ? threw.message : 'no throw');
    check('  does not retry', c.calls.length === 1, `${c.calls.length} call(s)`);
  }

  // Nested error shapes NVIDIA/axios can produce.
  c = clientThatRejects(Object.assign(new Error('Request failed'), { response: { status: 400, data: { error: { message: 'max_tokens is too large' } } } }));
  await new Harness(c).createNvidiaNimCompletion({ model: 'm', messages: [] });
  check('recognises the axios-shaped rejection too', c.calls.length === 2, `${c.calls.length} call(s)`);

  // Streaming requests keep their options (abort signal).
  c = clientThatRejects(err(400, 'max_tokens too large'));
  const sig = { aborted: false };
  await new Harness(c).createNvidiaNimCompletion({ model: 'm', messages: [], stream: true }, { signal: sig });
  check('retry preserves stream:true', c.calls[1].stream === true);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
