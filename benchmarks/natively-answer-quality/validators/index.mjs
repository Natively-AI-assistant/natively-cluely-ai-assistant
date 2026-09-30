// Deterministic validators (spec §24). They outrank the LLM judge: a failed validator caps the official score.
//
// validate(item, answer, ds) → { verdict: 'pass'|'fail'|'n/a', checks: [...], flags: [...] }
// Checks come from dataset/oracles-objective-v1.json (hand-authored from the scenario sources, never from answers).
// The WHOLE displayed text is checked — the answer body AND the [[GIST]] chip, since both are shown to the user.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliseNumbers, numbersIn } from './numbers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let ORACLES = null;
export function oracles() {
  if (ORACLES) return ORACLES;
  // Every dataset/oracles-*.json sidecar (objective, conflict, supplementary sets), merged by item id.
  const dir = path.join(HERE, '..', 'dataset');
  ORACLES = {};
  for (const f of fs.readdirSync(dir).filter((x) => /^oracles-.*\.json$/.test(x)).sort()) {
    Object.assign(ORACLES, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).oracles ?? {});
  }
  return ORACLES;
}

const near = (a, b, tol) => Math.abs(a - b) <= (tol ?? Math.max(0.005, Math.abs(b) * 1e-6));

export function runCheck(check, text) {
  const norm = normaliseNumbers(text);
  const nums = numbersIn(norm);
  switch (check.type) {
    case 'number_present': {
      const vals = [check.value, ...(check.alternatives ?? [])];
      const ok = nums.some((n) => vals.some((v) => near(n, v, check.tolerance)));
      return { ok, detail: ok ? `${check.value} stated` : `${check.value} not stated (numbers seen: ${[...new Set(nums)].slice(0, 12).join(', ') || 'none'})` };
    }
    case 'number_absent': {
      const hit = nums.find((n) => near(n, check.value, check.tolerance));
      return { ok: hit === undefined, detail: hit === undefined ? `${check.value} not stated` : `states ${check.value}` };
    }
    case 'pattern_present': {
      const ok = new RegExp(check.pattern, check.flags ?? 'i').test(norm);
      return { ok, detail: ok ? 'present' : 'missing' };
    }
    case 'pattern_absent': {
      const m = norm.match(new RegExp(check.pattern, check.flags ?? 'i'));
      return { ok: !m, detail: m ? `found: "${m[0].slice(0, 80)}"` : 'absent' };
    }
    case 'any_of': {
      const sub = check.checks.map((c) => runCheck(c, text));
      const ok = sub.some((s) => s.ok);
      return { ok, detail: sub.map((s) => s.detail).join(' | ') };
    }
    default: return { ok: true, detail: `unknown check type ${check.type} (ignored)` };
  }
}

export function validate(item, answer, _ds) {
  const o = oracles()[item?.id];
  if (!o || !o.checks?.length) return { verdict: 'n/a', checks: [], flags: [] };
  const text = String(answer ?? '');
  const checks = o.checks.map((c) => ({ label: c.label ?? c.type, flag: c.flag ?? o.flag ?? 'major_reasoning_error', ...runCheck(c, text) }));
  const failed = checks.filter((c) => !c.ok);
  return {
    verdict: failed.length ? 'fail' : 'pass',
    kind: o.kind,
    expected: o.expected_summary ?? null,
    checks,
    flags: [...new Set(failed.map((c) => c.flag))],
  };
}
