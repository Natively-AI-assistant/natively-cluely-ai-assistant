const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const esbuild = require('esbuild');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const recovered = process.env.NATIVELY_RECOVERED_SOURCE;
const comparisonSkip = recovered ? false : 'Set NATIVELY_RECOVERED_SOURCE to run recovered-source comparisons';
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-recovery-test-'));
test.after(() => fs.rmSync(userData, { recursive: true, force: true }));
function load(relative, original = false) {
  const compiledRelative = relative.endsWith('.js') ? relative : `${relative}.js`;
  let file = original
    ? path.join(recovered, 'recovered/compiled/app/dist-electron/premium/electron', compiledRelative)
    : path.join(root, 'premium/electron', compiledRelative);
  if (!original && !fs.existsSync(file)) file = file.replace(/\.js$/, '.ts');
  const code = original || file.endsWith('.js')
    ? fs.readFileSync(file, 'utf8')
    : esbuild.buildSync({ entryPoints: [file], bundle: true, packages: 'external', platform: 'node', format: 'cjs', write: false, logLevel: 'silent' }).outputFiles[0].text;
  const mod = { exports: {} };
  const localRequire = name => name === 'electron' ? { app: { isReady: () => true, isPackaged: false, getPath: () => userData } } : require(name);
  new Function('require', 'module', 'exports', '__dirname', '__filename', code)(localRequire, mod, mod.exports, path.dirname(file), file);
  return mod.exports;
}
const fixtures = [
  ['services/licenseVerifyPolicy.js', 'classifyProVerify', [[200, { ok: true, has_pro: true }], [401, { has_pro: false, error: 'subscription_inactive' }], [503, {}], [200, { has_pro: false }]]],
  ['knowledge/roleInsight/CoverageCalculator.js', 'calculateCoverage', [[{ requirements: [], assessments: [] }], [{ requirements: [{ id: 'r1', priority: 'critical', category: 'technical', excluded: false, hardGate: false }], assessments: [{ requirementId: 'r1', status: 'proven' }] }]]],
  ['knowledge/types.js', null, []],
  ['knowledge/skillsUtil.js', 'coerceSkills', [[[' React ', 'React', 'TypeScript', 'AWS']], [{ languages: ['Go', 'go'], other: ['Git'] }], [null]]],
  ['knowledge/StructuredJDNormalizer.js', 'normalizeStructuredJD', [[{}], [{ title: 'Developer', company: 'Example', level: 'invalid', requirements: [' JS ', null, 'JS'], min_years_experience: Infinity }]]],
  ['knowledge/roleInsight/skillOntology.js', 'extractCanonicalTerms', [['React and TypeScript on AWS with PostgreSQL'], ['C++ C# .NET Node.js CI/CD Kubernetes']]],
  ['knowledge/roleInsight/skillOntology.js', 'normalizeTerm', [['  REACT.JS '], ['Amazon Web Services'], ['TypeScript']]],
];
for (const [file, fn, cases] of fixtures) test('Recovered parity: ' + file + (fn ? '#' + fn : ''), { skip: comparisonSkip }, () => {
  const expected = load(file, true), actual = load(file);
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  if (fn) for (const args of cases) assert.deepEqual(actual[fn](...structuredClone(args)), expected[fn](...structuredClone(args)));
  else assert.deepEqual(actual.DocType, expected.DocType);
});
test('Premium TypeScript files match recovered source provenance and deterministic output hashes', { skip: comparisonSkip }, () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'premium/RECOVERY.json'), 'utf8'));
  const files = manifest.files.filter(item => item.output.startsWith('premium/electron/') && item.output.endsWith('.ts') && !item.output.endsWith('.d.ts'));
  assert.equal(files.length, 45);
  for (const item of files) {
    const source = fs.readFileSync(path.join(recovered, item.source));
    const output = fs.readFileSync(path.join(root, item.output));
    assert.equal(crypto.createHash('sha256').update(source).digest('hex'), item.sha256, item.source);
    assert.equal(crypto.createHash('sha256').update(output).digest('hex'), item.outputSha256, item.output);
  }
  const heuristic = fs.readFileSync(path.join(root, 'premium/electron/knowledge/HeuristicExtractor.ts'), 'utf8');
  assert.match(heuristic, /const state: \{ current: ExperienceEntry \| null \} = \{ current: null \};/);
  assert.match(heuristic, /const state: \{ current: EducationEntry \| null \} = \{ current: null \};/);
});
test('JD wire value and complete premium export graph', () => {
  assert.equal(load('knowledge/types.js').DocType.JD, 'job_description');
  const exports = load('knowledge/roleInsight/index.js');
  for (const name of ['RoleInsightService', 'RoleInsightEngine', 'resolveFromUrl', 'validateAssessments']) assert.equal(typeof exports[name], 'function', name);
});
test('JS-only search providers have runtime-matched, reproducible declarations', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'premium/RECOVERY.json'), 'utf8'));
  const declarations = [
    ['knowledge/TavilySearchProvider.d.ts', [
      'import type { SearchResult } from "./CompanyResearchEngine";',
      'constructor(apiKey: string);',
      'get sessionCreditsUsed(): number;',
      'search(query: string, numResults?: number): Promise<SearchResult[]>;',
      'extractUrl(url: string): Promise<{ title: string; content: string } | null>;',
    ]],
    ['knowledge/NativelySearchProvider.d.ts', [
      'import type { SearchResult } from "./CompanyResearchEngine";',
      'constructor(apiKey: string, trialToken?: string);',
      'quotaExhausted: boolean;',
      'search(query: string, numResults?: number): Promise<SearchResult[]>;',
    ]],
  ];
  for (const [relative, signatures] of declarations) {
    const file = path.join(root, 'premium/electron', relative);
    const text = fs.readFileSync(file, 'utf8');
    for (const signature of signatures) assert.ok(text.includes(signature), `${relative}: ${signature}`);
    assert.ok(manifest.files.some(item => item.output === `premium/electron/${relative}`), `${relative} missing from recovery manifest`);
  }
  const tavily = fs.readFileSync(path.join(root, 'premium/electron/knowledge/TavilySearchProvider.js'), 'utf8');
  const natively = fs.readFileSync(path.join(root, 'premium/electron/knowledge/NativelySearchProvider.js'), 'utf8');
  assert.match(tavily, /return \{ title: hit\.title \|\| "", content: hit\.rawContent \}/);
  assert.match(natively, /quotaExhausted = false/);
});
test('Every recovered backend export resolves without embedded shared-service copies', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'premium/RECOVERY.json'), 'utf8'));
  for (const item of manifest.files.filter(f => f.output.startsWith('premium/electron/'))) {
    const code = fs.readFileSync(path.join(root, item.output), 'utf8');
    assert.doesNotMatch(code, /"electron\/(?:db\/DatabaseManager|services\/SettingsManager|services\/CredentialsManager)\.ts"\(\)/, item.output);
    esbuild.buildSync({ entryPoints: [path.join(root, item.output)], bundle: true, packages: 'external', platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
  }
});
test('Renderer closes over existing React and exports all eight original components', () => {
  const file = path.join(root, 'premium/src/recovered/App-h7VwvpAg.js');
  const result = esbuild.buildSync({ entryPoints: [file], bundle: true, packages: 'external', platform: 'browser', format: 'esm', write: false, logLevel: 'silent' });
  const code = result.outputFiles[0].text;
  assert.doesNotMatch(code, /react\.production\.js|ReactDOMClient\.createRoot|\.createRoot\(/);
  for (const name of ['ProfileVisualizer', 'RoleInsightPanel', 'NegotiationCoachingCard', 'ProfileFeatureToaster', 'JDAwarenessToaster', 'NativelyApiPromoToaster', 'MaxUltraUpgradeToaster', 'RemoteCampaignToaster']) assert.match(code, new RegExp('\\b' + name + '\\b'));
});
test('Recovered closures have no unresolved lexical identifiers', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'premium/RECOVERY.json'), 'utf8'));
  const files = manifest.files.filter(f => f.output.endsWith('.js')).map(f => path.join(root, f.output));
  const program = ts.createProgram(files, { allowJs: true, checkJs: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler, esModuleInterop: true, types: ['node'] });
  const failures = ts.getPreEmitDiagnostics(program).filter(d => [2304, 2305, 2307, 2552, 18004].includes(d.code) && d.file?.fileName.includes(path.join(root, 'premium')));
  assert.equal(failures.length, 0, ts.formatDiagnostics(failures, { getCurrentDirectory: () => root, getCanonicalFileName: f => f, getNewLine: () => '\n' }));
});

test('Profile database and orchestrator initialize, persist and delete in the Electron SQLite runtime', { skip: !process.versions.electron }, () => {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  try {
    const { KnowledgeDatabaseManager } = load('knowledge/KnowledgeDatabaseManager.js');
    const { KnowledgeOrchestrator } = load('knowledge/KnowledgeOrchestrator.js');
    const database = new KnowledgeDatabaseManager(sqlite);
    database.initializeSchema();
    const { normalizeStructuredResume } = load('knowledge/StructuredResumeNormalizer.js');
    const resume = normalizeStructuredResume({ identity: { name: 'Test Person' }, skills: { languages: ['TypeScript'] }, experience: [], education: [], projects: [] });
    database.saveDocument({ type: 'resume', source_uri: 'fixture.txt', structured_data: resume, raw_text: 'Test Person develops TypeScript applications.' });
    const orchestrator = new KnowledgeOrchestrator(database);
    assert.equal(orchestrator.activeResume.structured_data.identity.name, 'Test Person');
    orchestrator.attachRoleInsight(sqlite);
    assert.equal(orchestrator.getRoleInsightService().getStatus().hasResume, true);
    for (const method of ['ingestDocument', 'processQuestion', 'setGenerateContentFn', 'setEmbedFn', 'generateCoverLetterOnDemand', 'generateNegotiationScriptOnDemand']) assert.equal(typeof orchestrator[method], 'function', method);
    database.deleteDocumentsByType('resume');
    assert.equal(database.getDocumentByType('resume'), null);
  } finally { sqlite.close(); }
});
