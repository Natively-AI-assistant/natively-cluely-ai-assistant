// Judge-free measurement for evidence-rich-v1.
//
//   funnel(...)     where in  upload → parse → index → retrieve → prompt → answer  a case got to, from the app's own
//                   records (ingest results, the `[V3]` trace line of the turn, the prompt that was sent).
//   objective(...)  deterministic checks of the answer against the frozen oracle (arithmetic, fixed strings, the
//                   other profile's identity strings, code tests). These outrank the judge.
//
// Nothing here reads a judgment, and nothing here is shown to the app.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normaliseNumbers, numbersIn } from '../validators/numbers.mjs';

const HERE0 = path.dirname(fileURLToPath(import.meta.url));
const HERE = process.env.ER_BENCH_DIR ? path.resolve(process.env.ER_BENCH_DIR) : HERE0;
export const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
export const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
export const norm = (s) => String(s ?? '').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014\u2212]/g, '-').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const lc = (s) => norm(s).toLowerCase();
export const PI_MODES = new Set(['looking-for-work', 'technical-interview']);
export const GIST_RE = /\[\[GIST\]\]([\s\S]*)$/;
export const answerOf = (row) => row?.rendered_answer ?? row?.raw_answer ?? '';
export function splitGist(text) { const t = String(text ?? ''); const m = t.match(GIST_RE); return { body: (m ? t.slice(0, m.index) : t).trim(), gist: m ? m[1].trim() : null }; }

/** Version of the deterministic checks. obj-1: as first written. obj-2 (2026-10-09): an identity string the mode's own
 *  loaded reference files state is not a profile leak. Judgments made before obj-2 carry no version (= obj-1). */
export const OBJECTIVE_VERSION = 'obj-2';
let BENCH = null;
export function bench() {
  if (BENCH) return BENCH;
  const manifest = readJson(path.join(HERE, 'oracles', 'evidence-manifest.json'));
  const texts = readJson(path.join(HERE, 'oracles', 'evidence-texts.json')).texts;
  const idf = path.join(HERE, 'oracles', 'pi-identities.json');
  const files = new Map(manifest.files.map((f) => [f.id, f]));
  const byName = new Map();
  for (const f of manifest.files) (byName.get(f.filename) ?? byName.set(f.filename, []).get(f.filename)).push(f);
  // Files of every evidence configuration, read from the datasets' `configs` only (no question is read here).
  const configFiles = new Map();
  for (const n of fs.readdirSync(path.join(HERE, 'datasets')).filter((x) => x.endsWith('.json'))) { try { for (const c of readJson(path.join(HERE, 'datasets', n)).configs ?? []) if (!configFiles.has(c.id)) configFiles.set(c.id, c.files ?? []); } catch { /* not a dataset */ } }
  BENCH = { manifest, texts, files, byName, configFiles, identities: fs.existsSync(idf) ? readJson(idf) : {} };
  return BENCH;
}
export function loadDataset(partition) {
  const ds = readJson(path.join(HERE, 'datasets', `${partition}.json`));
  return { ...ds, byId: Object.fromEntries(ds.items.map((i) => [i.id, i])), configsById: new Map(ds.configs.map((c) => [c.id, c])) };
}
export function loadRun(dir) {
  const header = readJson(path.join(dir, 'run.json'));
  const rows = readJsonl(path.join(dir, 'rows.jsonl'));
  const wire = Object.fromEntries(readJsonl(path.join(dir, 'wire.jsonl')).map((w) => [w.benchmark_id, w]));
  const systems = fs.existsSync(path.join(dir, 'systems.json')) ? readJson(path.join(dir, 'systems.json')) : {};
  const ingest = readJsonl(path.join(dir, 'ingest.jsonl'));
  const pi = readJsonl(path.join(dir, 'pi.jsonl'));
  const ds = loadDataset(header.partition);
  return { dir, header, rows, rowsById: Object.fromEntries(rows.map((r) => [r.benchmark_id, r])), wire, systems, ingest, pi, ds };
}
export const factOf = (ref) => { const [id, fid] = String(ref).split('#'); const f = bench().files.get(id); return f ? { file: f, fact: (f.facts ?? []).find((x) => x.id === fid) ?? null } : { file: null, fact: null }; };
export function promptTextOf(run, id) {
  const w = run.wire[id];
  if (!w) return null;
  return [run.systems[w.system_sha] ?? '', ...(w.messages ?? []).map((m) => m.text ?? '')].join('\n');
}

// ------------------------------------------------------------------------------------------------ funnel
/**
 * Stage flags for one row. `null` means "does not apply to this case" (no document facts are required), never "false".
 */
export function funnel(item, row, run) {
  const B = bench();
  const o = item.oracle ?? {};
  const cfg = run.ds.configsById.get(row.evidence_config ?? item.evidence_config);
  const loadedIds = new Set([...(cfg?.files ?? []), ...(B.manifest.pi_states[row.pi_state ?? 'none'] ?? [])]);
  const prompt = promptTextOf(run, row.benchmark_id);
  // Needles are matched with all whitespace removed (PDF line wraps, breaks after hyphens, chunk joins).
  const sq = (t) => norm(String(t ?? '').replace(/--\s*\d+\s*of\s*\d+\s*--/g, ' ').replace(/\[Page \d+\]/g, ' ')).replace(/\s+/g, '');
  const P = prompt == null ? null : sq(prompt);
  const tags = row.prompt_evidence ?? [];
  const refNames = new Set(tags.filter((t) => t.provenance === 'MODE_REFERENCE_FILE' || t.source_type === 'REFERENCE_FILE').map((t) => t.source_name));
  const hasResume = tags.some((t) => /RESUME|PROFILE_FACT/.test(String(t.source_type)) && t.provenance !== 'MODE_REFERENCE_FILE');
  const hasJd = tags.some((t) => /JOB_DESCRIPTION/.test(String(t.source_type)) && t.provenance !== 'MODE_REFERENCE_FILE');
  const lastIngest = (id) => [...run.ingest].reverse().find((r) => r.evidence_id === id && r.mode === item.mode) ?? null;

  // What the answer rests on: the required facts, and the document values a calculation is computed from (an oracle
  // often lists only the result as required; its inputs still have to be in the prompt for the result to be reachable).
  const calcInputs = Object.values(o.calculation_oracle?.inputs ?? {}).flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v) => typeof v === 'string' && /#F\d+/.test(v) && factOf(v).fact);
  const seenRefs = new Set((o.required_facts ?? []).map((r) => r.fact));
  const traced = [...(o.required_facts ?? []), ...calcInputs.filter((v) => !seenRefs.has(v)).map((v) => ({ fact: v, calc_input: true }))];
  const required = traced.filter((r) => r.fact && r.fact !== 'CONVERSATION').map((r) => {
    const { file, fact } = factOf(r.fact);
    const needles = fact?.doc_needles ?? [];
    const ing = file && file.mode !== 'profiles' ? lastIngest(file.id) : null;
    const lost = new Set((ing?.needles_lost ?? []).filter((x) => x.startsWith(`${fact?.id}:`)).map((x) => x.slice(String(fact?.id).length + 1)));
    const live = needles.filter((n) => !lost.has(n));
    const hits = P == null ? null : live.map((n) => P.includes(sq(n)));
    return {
      fact: r.fact, calc_input: !!r.calc_input, file: file?.id ?? null, is_pi: file?.mode === 'profiles', needles: needles.length, needles_lost_in_parse: lost.size,
      survived_parse: file?.mode === 'profiles' ? null : (ing ? lost.size === 0 : null),
      reached_prompt_all: hits == null ? null : (live.length ? hits.every(Boolean) : null),
      reached_prompt_any: hits == null ? null : (live.length ? hits.some(Boolean) : null),
    };
  });
  const srcFiles = (o.source_ids ?? []).filter((s) => B.files.has(s));
  const refSrc = srcFiles.filter((s) => B.files.get(s).mode !== 'profiles');
  const wantsResume = (o.source_ids ?? []).includes('PI:RESUME') || srcFiles.some((s) => /-RESUME$/.test(s));
  const wantsJd = (o.source_ids ?? []).includes('PI:JD') || srcFiles.some((s) => /-JD$/.test(s));
  const ing = refSrc.map((s) => lastIngest(s));
  const every = (xs, f) => (xs.length ? xs.every(f) : null);
  const loadedStale = [...loadedIds].map((id) => B.files.get(id)).filter((f) => f && f.mode !== 'profiles' && ['outdated', 'draft'].includes(f.status));
  const staleNames = new Set(loadedStale.map((f) => f.filename));
  const activeNames = new Set([...loadedIds].map((id) => B.files.get(id)?.filename).filter(Boolean));
  // A file name that belongs to another mode's pack and not to this mode's loaded set.
  const foreign = [...refNames].filter((n) => !activeNames.has(n) && (B.byName.get(n) ?? []).some((f) => f.mode !== item.mode));
  const unknownNames = [...refNames].filter((n) => !activeNames.has(n) && !(B.byName.get(n) ?? []).length);
  const forbiddenDoc = (o.forbidden_claims ?? []).filter((c) => c.fact && ['stale', 'draft'].includes(c.kind)).map((c) => {
    const { fact } = factOf(c.fact);
    return { fact: c.fact, kind: c.kind, in_prompt: P == null ? null : (fact?.doc_needles ?? []).some((n) => P.includes(sq(n))) };
  });
  const prof = String(row.pi_state ?? 'none').split('-')[0];
  const otherIds = Object.entries(B.identities).filter(([k]) => k !== prof);
  const otherProfileInPrompt = P == null ? null : otherIds.flatMap(([k, v]) => [...(v.resume_needles ?? []), ...(v.jd_needles ?? [])].filter((n) => P.includes(sq(n))).map((n) => `${k}:${n}`));
  const v3 = row.v3_trace ?? null;
  const docRequired = required.filter((r) => !r.is_pi), piRequired = required.filter((r) => r.is_pi);
  // A fact none of whose needles survived the parser cannot be traced by string: it is left out, not counted as missing.
  const traceable = required.filter((r) => r.reached_prompt_all !== null);
  const reachedAll = traceable.length ? traceable.every((r) => r.reached_prompt_all === true) : null;
  return {
    evidence_required: required.length > 0,
    // reference files
    file_uploaded: every(ing, (r) => !!r?.file_uploaded), file_parse_success: every(ing, (r) => !!r?.file_parse_success),
    fact_survived_parse: docRequired.length ? docRequired.every((r) => r.survived_parse !== false) : null,
    file_indexed: every(ing, (r) => !!r?.file_indexed), index_status: ing.map((r) => r?.index_status ?? null),
    read_whole: row.read_whole ?? null,
    retrieval_attempted: v3 ? (v3.path === 'GROUNDED' || (v3.planned ?? []).some((p) => p !== 'MEETING_TRANSCRIPT')) : null,
    retrieval_path: v3?.path ?? null, retrieval_planned: v3?.planned ?? null,
    retrieval_candidates: v3 ? (v3.retrieval ?? []).reduce((n, r) => n + (r.candidates ?? 0), 0) : null,
    retrieval_admitted: v3 ? (v3.retrieval ?? []).reduce((n, r) => n + (r.admitted ?? 0), 0) : null,
    retrieval_ms: v3?.retrievalMs ?? null, orchestrate_ms: v3?.orchestrateMs ?? null, answerability: v3?.answerability ?? null, v3_fallback: v3?.fallback ?? null,
    evidence_items_in_prompt: tags.reduce((n, t) => n + (t.n ?? 1), 0),
    correct_source_retrieved: refSrc.length ? refSrc.every((s) => refNames.has(B.files.get(s).filename)) : null,
    any_correct_source_retrieved: refSrc.length ? refSrc.some((s) => refNames.has(B.files.get(s).filename)) : null,
    relevant_fact_reached_prompt: reachedAll,
    relevant_fact_reached_prompt_any: required.length ? required.every((r) => r.reached_prompt_any === true) : null,
    doc_fact_reached_prompt: docRequired.length ? docRequired.every((r) => r.reached_prompt_all === true) : null,
    wrong_source_retrieved: refSrc.length ? (refNames.size > 0 && !refSrc.some((s) => refNames.has(B.files.get(s).filename))) : null,
    stale_source_retrieved: loadedStale.length ? [...refNames].some((n) => staleNames.has(n)) : null,
    stale_value_in_prompt: forbiddenDoc.length ? forbiddenDoc.some((f) => f.in_prompt) : null,
    cross_mode_source_in_prompt: foreign, unknown_source_in_prompt: unknownNames,
    reference_evidence_without_files: (cfg?.files ?? []).length === 0 && refNames.size > 0,
    // profile intelligence
    pi_permitted: PI_MODES.has(item.mode), pi_loaded: (row.pi_state ?? 'none') !== 'none',
    profile_loaded: (row.pi_state ?? 'none') === 'none' ? null : !!(row.profile_state && (row.profile_state.hasStructuredResume || row.profile_state.hasStructuredJD)),
    resume_parsed: row.profile_state?.hasStructuredResume ?? null, jd_parsed: row.profile_state?.hasStructuredJD ?? null, pi_extraction_mode: row.pi_extraction_mode ?? null,
    pi_retrieval_attempted: v3 ? (v3.profileSources ?? 0) > 0 : null,
    pi_evidence_in_prompt: hasResume || hasJd, resume_evidence_in_prompt: hasResume, jd_evidence_in_prompt: hasJd,
    correct_profile_reached_prompt: (wantsResume || wantsJd) ? ((!wantsResume || hasResume) && (!wantsJd || hasJd)) : null,
    pi_fact_reached_prompt: piRequired.length ? piRequired.every((r) => r.reached_prompt_all === true) : null,
    wrong_profile_reached_prompt: otherProfileInPrompt == null ? null : otherProfileInPrompt.length > 0, wrong_profile_needles_in_prompt: otherProfileInPrompt ?? [],
    pi_in_forbidden_mode_prompt: !PI_MODES.has(item.mode) && (hasResume || hasJd),
    required,
    // The objective definition of "the evidence was delivered": every required document / profile fact is in the prompt.
    evidence_delivered: reachedAll,
  };
}

// ------------------------------------------------------------------------------------------------ objective checks
// Emphasis marks are dropped before matching: "**$7,750** on acceptance" states "$7,750 on acceptance".
const plain = (s) => lc(String(s ?? '').replace(/[*`]/g, ''));
const has = (text, needle) => plain(text).includes(plain(needle));
function numbersOf(text) { try { return numbersIn(normaliseNumbers(String(text))); } catch { return []; } }

/** Every python / javascript / typescript code block of the answer, in order. */
function codeBlocks(answer) {
  const lang = (l) => (['python', 'py'].includes(l) ? 'python' : ['javascript', 'js', 'jsx', 'node'].includes(l) ? 'javascript' : ['typescript', 'ts', 'tsx'].includes(l) ? 'typescript' : null);
  return [...String(answer).matchAll(/```([a-zA-Z0-9+#]*)\n([\s\S]*?)```/g)].map((m) => ({ lang: lang(m[1].toLowerCase()), code: m[2] })).filter((b) => b.lang);
}
const fnNames = (code, lang) => (lang === 'python'
  ? [...code.matchAll(/^def\s+([A-Za-z_]\w*)/gm)].map((m) => m[1])
  : [...code.matchAll(/function\s+([A-Za-z_$][\w$]*)/g), ...code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\(|function|[A-Za-z_$][\w$]*\s*=>)/g)].map((m) => m[1]));
/** Run one function of one block against the oracle's tests, in a subprocess that cannot write files or use the network. */
function runOne(code, lang, fn, oracle) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'er-code-'));
  try {
    const tests = JSON.stringify(oracle.tests);
    let cmd;
    if (lang === 'python') {
      const file = path.join(dir, 't.py');
      fs.writeFileSync(file, `${code}\nimport json\n_t=json.loads(${JSON.stringify(tests)})\n_r=[]\nfor c in _t:\n    try:\n        _o=${fn}(*c["input"])\n        _r.append(json.loads(json.dumps(_o))==c["expected"])\n    except Exception as e:\n        _r.append(False)\nprint("ER_RESULT "+json.dumps(_r))\n`);
      cmd = ['python3', '-B', file];
    } else {
      // TypeScript runs through Node's own type stripping, so annotations in the answer are not a crash.
      const file = path.join(dir, lang === 'typescript' ? 't.ts' : 't.cjs');
      fs.writeFileSync(file, `${code.replace(/^\s*export\s+(default\s+)?/gm, '')}\nconst _t=${tests};const _r=[];for(const c of _t){try{_r.push(JSON.stringify(${fn}(...c.input))===JSON.stringify(c.expected));}catch(e){_r.push(false);}}console.log("ER_RESULT "+JSON.stringify(_r));\n`);
      cmd = lang === 'typescript' ? [process.execPath, '--experimental-strip-types', '--no-warnings', file] : [process.execPath, file];
    }
    const profile = '(version 1)(allow default)(deny network*)(deny file-write*)';
    const r = spawnSync('/usr/bin/sandbox-exec', ['-p', profile, ...cmd], { encoding: 'utf8', timeout: 10000, cwd: dir });
    const m = String(r.stdout ?? '').match(/ER_RESULT (\[.*\])/);
    if (!m) return { ran: false, reason: r.error ? 'timeout or spawn error' : `no result (${String(r.stderr ?? '').split('\n').filter(Boolean).at(-1)?.slice(0, 120) ?? 'no output'})` };
    const res = JSON.parse(m[1]);
    return { ran: true, passed: res.filter(Boolean).length, total: res.length, fn, lang };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
/**
 * The answer's code against the oracle's tests. The block judged is the LAST one that defines the asked function (an
 * answer that shows a first version and then an improved one is judged on the improved one); when the answer names
 * its function differently, every function of the last code block is tried and the best one counts (the tests are
 * specific enough that a helper does not pass them by accident).
 */
function runCodeTests(answer, oracle) {
  if (process.platform !== 'darwin' || !fs.existsSync('/usr/bin/sandbox-exec')) return { ran: false, reason: 'no sandbox on this platform' };
  const want = oracle.language === 'python' ? ['python'] : oracle.language === 'javascript' ? ['javascript', 'typescript'] : ['python', 'javascript', 'typescript'];
  const blocks = codeBlocks(answer).filter((b) => want.includes(b.lang));
  if (!blocks.length) return { ran: false, reason: 'no runnable python/javascript code block found in the answer' };
  const hint = oracle.function_hint;
  const hinted = hint ? blocks.filter((b) => fnNames(b.code, b.lang).includes(hint)).at(-1) : null;
  if (hinted) return runOne(hinted.code, hinted.lang, hint, oracle);
  const last = blocks.at(-1);
  const names = [...new Set(fnNames(last.code, last.lang))];
  if (!names.length) return { ran: false, reason: 'no function found in the code' };
  const runs = names.map((n) => runOne(last.code, last.lang, n, oracle));
  const ok = runs.filter((r) => r.ran).sort((x, y) => y.passed - x.passed)[0];
  return ok ?? runs[0];
}

/**
 * Deterministic checks of the shown answer. verdict: 'fail' only when a check PROVES the answer wrong;
 * 'pass' when every applicable check passed; 'n/a' when nothing applies; notes inform the judge without deciding.
 */
export function objective(item, row) {
  const B = bench();
  const o = item.oracle ?? {};
  const shown = answerOf(row);
  const { body } = splitGist(shown);
  const text = shown; // body and chip: both are displayed
  const checks = [], notes = [], flags = new Set();
  let applicable = 0;

  const req = (o.required_facts ?? []).filter((r) => (r.answer_needles ?? []).length).map((r) => ({ fact: r.fact, hit: r.answer_needles.some((n) => has(text, n)) }));
  if (req.length) { const miss = req.filter((r) => !r.hit); if (miss.length) notes.push(`fixed strings of ${miss.length} of ${req.length} required facts were not found in the answer (it may still convey them in other words): ${miss.map((m) => m.fact).join(', ')}`); }

  for (const c of o.forbidden_claims ?? []) {
    const hit = (c.answer_needles ?? []).find((n) => has(text, n));
    if (!hit) continue;
    if (c.kind === 'other_profile') { applicable++; checks.push({ label: 'other profile string in answer', ok: false, detail: `"${hit}"` }); flags.add('wrong_profile_used'); }
    else if (c.kind === 'other_mode') { applicable++; checks.push({ label: 'other mode string in answer', ok: false, detail: `"${hit}"` }); flags.add('cross_mode_reference_leak'); }
    else notes.push(`the answer contains "${hit}" (${c.kind}: ${c.text}); decide whether it is presented as the truth`);
  }
  // Identity strings of a profile that is not the loaded one (employers, project names): never legitimate,
  // UNLESS the mode's own loaded reference files state them (obj-2, 2026-10-09). Looking for work with no profile
  // loaded still has the candidate's own prep notes loaded, and they name his employers: ER-D2-LFW-036 asks why he
  // left "the job before", the oracle requires the Tessarine answer from those notes, and obj-1 capped the right
  // answer at 2 as a profile leak. A string the loaded pack states cannot show that a profile leaked.
  const prof = String(row.pi_state ?? 'none').split('-')[0];
  const ownPack = (B.configFiles.get(row.evidence_config ?? item.evidence_config) ?? []).map((id) => B.texts[id] ?? '').join('\n');
  for (const [k, v] of Object.entries(B.identities)) {
    if (k === prof) continue;
    const hit = [...(v.resume_needles ?? []), ...(v.jd_needles ?? [])].find((n) => has(text, n) && !has(item.question, n) && !has(ownPack, n) && !(item.prior_transcript ?? []).some((l) => has(l.text, n)));
    if (hit) { applicable++; checks.push({ label: `profile ${k} identity string in answer`, ok: false, detail: `"${hit}"` }); flags.add(PI_MODES.has(item.mode) && prof !== 'none' ? 'wrong_profile_used' : 'pi_leak'); }
  }
  if (!PI_MODES.has(item.mode) && prof !== 'none' && B.identities[prof]) {
    const hit = (B.identities[prof].resume_needles ?? []).find((n) => has(text, n) && !has(item.question, n) && !has(ownPack, n) && !(item.prior_transcript ?? []).some((l) => has(l.text, n)));
    if (hit) { applicable++; checks.push({ label: 'profile string in a mode without Profile Intelligence', ok: false, detail: `"${hit}"` }); flags.add('pi_leak'); }
  }

  if (o.requires_calculation && o.calculation_oracle) {
    const c = o.calculation_oracle;
    const nums = numbersOf(text);
    const tol = Math.max(0.005, Math.abs(Number(c.result)) * 0.002);
    // A small whole number (4, 14, 30) turns up in an answer by chance, so only a distinctive result is matched as a
    // number; small results must appear in one of the oracle's accepted forms.
    const distinctive = typeof c.result === 'number' && (Math.abs(c.result) >= 100 || !Number.isInteger(c.result));
    const numeric = distinctive && nums.some((n) => Math.abs(n - c.result) <= tol);
    const literal = (c.accepted_forms ?? []).some((f) => has(text, f));
    const wrong = (c.wrong_results_common ?? []).find((f) => has(text, String(f)));
    if (numeric || literal) { applicable++; checks.push({ label: 'calculation result stated', ok: true, detail: String(c.result) }); }
    else if (wrong) { applicable++; checks.push({ label: 'calculation result', ok: false, detail: `states a known wrong result "${wrong}"; correct is ${c.result}` }); flags.add('arithmetic_error'); }
    else notes.push(`the computed result ${c.result}${c.unit ? ' ' + c.unit : ''} (${c.expression ?? ''}) was not found in the answer; numbers stated: ${[...new Set(nums)].slice(0, 10).join(', ') || 'none'}`);
  }
  if (o.requires_code_validation && o.code_oracle?.tests?.length) {
    const r = runCodeTests(body, o.code_oracle);
    if (!r.ran) notes.push(`code not executed: ${r.reason}`);
    else { applicable++; const ok = r.passed === r.total; checks.push({ label: 'code tests', ok, detail: `${r.passed}/${r.total} passed (${r.lang}, function ${r.fn})` }); if (!ok) flags.add('code_incorrect'); }
  }
  const failed = checks.filter((c) => !c.ok);
  return { verdict: failed.length ? 'fail' : applicable ? 'pass' : 'n/a', checks, notes, flags: [...flags], version: OBJECTIVE_VERSION, required_strings: { total: req.length, found: req.filter((r) => r.hit).length } };
}
