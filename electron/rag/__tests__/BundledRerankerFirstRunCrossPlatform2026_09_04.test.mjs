/**
 * The bundled reranker must work on a fresh install, on BOTH platforms, with no
 * configuration whatsoever.
 *
 * `LocalRerankerPackagedBuildSimulation` proves the first-run chain end to end —
 * empty userData, no settings.json, packaged resourcesPath layout, and a real
 * rerank that ranks correctly. But it can only prove it for the platform it runs
 * on, and CI runs the suites advisory on the Windows leg, so that file's
 * evidence is macOS evidence.
 *
 * What is portable is the PATH ARITHMETIC, and that is what breaks across
 * platforms. A model id carries a forward slash (`Xenova/ms-marco-MiniLM-L-6-v2`)
 * and must become a backslash on disk under win32. Every site that composes one
 * does `path.join(root, ...id.split('/'))` — five of them across LocalReranker
 * and the worker — and a single `path.join(root, id)` among them would produce
 * a path that works on macOS and not on Windows, with no error anywhere: the
 * model would simply appear absent and reranking would silently no-op.
 *
 * So these exercise both separator regimes explicitly, via `path.win32` and
 * `path.posix`, which run identically on either host.
 *
 * Run: `node --test electron/rag/__tests__/BundledRerankerFirstRunCrossPlatform2026_09_04.test.mjs`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const localReranker = fs.readFileSync(path.join(repoRoot, 'electron/rag/LocalReranker.ts'), 'utf8');
const worker = fs.readFileSync(path.join(repoRoot, 'electron/rag/localRerankerWorker.ts'), 'utf8');

/** The model the installer ships, read from the code that loads it. */
const MODEL_ID = (() => {
  const m = localReranker.match(/const DEFAULT_RERANKER_MODEL = '([^']+)'/);
  assert.ok(m, 'DEFAULT_RERANKER_MODEL is gone from LocalReranker.ts');
  return m[1];
})();

// ── it is actually there ──────────────────────────────────────────────────

test('the bundled model is present in resources/models with real weights', () => {
  // extraResources copies this directory verbatim into the packaged app on
  // every platform, so what is here is what ships.
  const dir = path.join(repoRoot, 'resources/models', ...MODEL_ID.split('/'));
  for (const rel of ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']) {
    const full = path.join(dir, ...rel.split('/'));
    assert.ok(fs.existsSync(full), `${rel} is missing — run \`node scripts/download-models.js\``);
    assert.ok(fs.statSync(full).size > 0, `${rel} is empty`);
  }
  // A cross-encoder that small is the point: the previous default was 283MB and
  // measurably worse. Guard the order of magnitude, not the exact byte count.
  const weights = fs.statSync(path.join(dir, 'onnx', 'model_quantized.onnx')).size;
  assert.ok(weights > 5e6 && weights < 60e6,
    `bundled weights are ${(weights / 1e6).toFixed(1)}MB — expected the ~24MB quantized cross-encoder`);
});

test('it ships on every platform, because nothing overrides extraResources', () => {
  // A per-platform `extraResources` would silently drop the model from one
  // installer. The entry is top-level for exactly that reason.
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const entry = (pkg.build.extraResources ?? []).find(r => r.from === 'resources/models/');
  assert.ok(entry, 'resources/models/ is not in extraResources at all');
  assert.equal(entry.to, 'models/');
  for (const platform of ['mac', 'win', 'linux']) {
    assert.equal(pkg.build?.[platform]?.extraResources, undefined,
      `${platform} overrides extraResources — the bundled model would differ per installer`);
  }
});

// ── the path arithmetic works under BOTH separator regimes ────────────────

test('the model id composes correctly under win32 AND posix', () => {
  // The bug this prevents: `path.join(root, id)` leaves the forward slash in
  // place. On macOS that is still a valid path; on Windows it is not the path
  // the file lives at, and the model reads as absent with no error.
  const segments = MODEL_ID.split('/');
  assert.ok(segments.length >= 2, `${MODEL_ID} has no org/name split to get wrong`);

  const win = path.win32.join('C:\\Program Files\\Natively\\resources\\models', ...segments, 'tokenizer.json');
  assert.ok(win.includes('\\' + segments.join('\\') + '\\tokenizer.json'),
    `win32 path did not use backslashes throughout: ${win}`);
  assert.ok(!win.includes('/'), `a forward slash survived into a win32 path: ${win}`);

  const posix = path.posix.join('/Applications/Natively.app/Contents/Resources/models', ...segments, 'tokenizer.json');
  assert.ok(posix.endsWith(`/${segments.join('/')}/tokenizer.json`), posix);
});

test('every site that builds a model path splits the id first', () => {
  // Five of them, and one missed would be a Windows-only silent failure. The
  // shape is asserted rather than the count, so adding a sixth is fine.
  const sources = [
    ['LocalReranker.ts', localReranker],
    ['localRerankerWorker.ts', worker],
  ];
  for (const [name, src] of sources) {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // Line-based, not a balanced-paren match: `[^)]*` stops inside
    // `.split('/')` and truncates the very construct being looked for, which
    // made this assertion fail on correct code the first time it ran.
    const lines = code.split('\n').filter(l => l.includes('path.join(') && /[Mm]odelId/.test(l));
    assert.ok(lines.length > 0, `${name} composes no model paths — has the loader moved?`);
    for (const line of lines) {
      assert.match(line, /[Mm]odelId\)?\.split\('\/'\)/,
        `${name}: \`${line.trim()}\` passes the id whole — it must be split on '/' so Windows gets backslashes`);
      assert.match(line, /\.\.\./,
        `${name}: \`${line.trim()}\` must SPREAD the split segments into path.join`);
    }
  }
});

// ── it needs no configuration ─────────────────────────────────────────────

test('a fresh install with no settings resolves to the bundled model', () => {
  // `localModelId` absent means "use the bundled one". If that stopped being
  // true, a clean install would have no reranker at all until the user opened
  // Settings — and nothing would say so.
  const code = localReranker.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(code, /this\.modelId = envModel \|\| selected\?\.modelId \|\| DEFAULT_RERANKER_MODEL/,
    'the bundled model must be the terminal fallback when nothing is selected');
  assert.match(code, /if \(!id \|\| typeof id !== 'string'\) return null;/,
    'an absent localModelId must yield "no selection", not an error');
});

test('the packaged layout is the FIRST place a packaged app looks', () => {
  // extraResources lands the model at `<resourcesPath>/models`. If a
  // userData or cwd candidate were consulted first on a clean install — where
  // both are empty — resolution would fall through to an unverified download
  // cache instead of the bundle that just shipped.
  const code = localReranker.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const body = code.slice(code.indexOf('resolveModelPath'));
  const packagedAt = body.indexOf("process.resourcesPath");
  const cwdAt = body.indexOf("process.cwd()");
  assert.ok(packagedAt > 0, 'the packaged resourcesPath candidate is gone');
  assert.ok(cwdAt === -1 || packagedAt < cwdAt,
    'a cwd-relative candidate is consulted before the packaged one');
  assert.match(body, /app\?\.isPackaged/,
    'the packaged candidate must be gated on isPackaged, not added unconditionally');
});

test('the three names for the bundled model agree', () => {
  // DEFAULT_RERANKER_MODEL is what loads; BUILT_IN_RERANKER describes it; the
  // preflight looks for it on disk. Any two disagreeing means one of them is
  // checking for a model that is not there — which is exactly what happened
  // when the default changed and the preflight kept its own literal.
  const catalogue = fs.readFileSync(path.join(repoRoot, 'electron/rag/rerankerModelCatalog.ts'), 'utf8');
  const builtIn = catalogue.slice(catalogue.indexOf('export const BUILT_IN_RERANKER'), catalogue.indexOf('export const BUILT_IN_RERANKER') + 400);
  assert.ok(builtIn.includes(`modelId: '${MODEL_ID}'`), `BUILT_IN_RERANKER names a different model than ${MODEL_ID}`);

  const preflight = fs.readFileSync(path.join(repoRoot, 'electron/services/LocalFallbackPreflight.ts'), 'utf8');
  assert.match(preflight, /getBundledRerankerModelId/,
    'the preflight must ask LocalReranker rather than carrying its own literal');
});
