#!/usr/bin/env node
// Recover module bodies without bringing bundled copies of shared app services along.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '../..');
const source = process.argv[2];
const outputRootIndex = process.argv.indexOf('--output-root');
const root = outputRootIndex === -1 ? repoRoot : path.resolve(process.argv[outputRootIndex + 1]);
if (!source || (outputRootIndex !== -1 && !process.argv[outputRootIndex + 1])) throw new Error('Usage: node scripts/recovery/recover-premium.cjs <recovered-source-directory> [--output-root <directory>]');
const typescriptSource = path.resolve(source, 'recovered/source/natively-3.1.0/premium/electron');
const compiled = path.resolve(source, 'recovered/compiled/app/dist-electron');
const premium = path.join(compiled, 'premium/electron');
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
const provenance = [];
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
function relative(from, to) {
  const rel = path.relative(path.dirname(from), to).split(path.sep).join('/').replace(/\.(?:ts|js)$/, '');
  return rel.startsWith('.') ? rel : './' + rel;
}
function record(file, out) {
  provenance.push({
    source: path.relative(path.resolve(source), file).split(path.sep).join('/'),
    sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    output: out,
    outputSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, out))).digest('hex'),
  });
}
function write(out, text) {
  const destination = path.join(root, out);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, text);
}
function applyTypeFlowFix(relativePath, text) {
  if (relativePath.split(path.sep).join('/') !== 'knowledge/HeuristicExtractor.ts') return text;

  for (const [startMarker, endMarker, declaration] of [
    ['const parseExperience =', 'const HONORS_RE =', 'let cur: ExperienceEntry | null = null;'],
    ['const parseEducation =', '// ── public API', 'let cur: EducationEntry | null = null;'],
  ]) {
    const start = text.indexOf(startMarker);
    const end = text.indexOf(endMarker, start);
    if (start < 0 || end < 0) throw new Error(`Could not locate HeuristicExtractor type-flow section: ${startMarker}`);
    let section = text.slice(start, end);
    if (!section.includes(declaration)) throw new Error(`Could not locate expected parser state declaration: ${declaration}`);
    section = section.replace(declaration, declaration.replace(/^let cur: (.+) = null;$/, 'const state: { current: $1 } = { current: null };'));
    section = section.replace(/\bcur\b/g, 'state.current');
    text = text.slice(0, start) + section + text.slice(end);
  }
  return text;
}
function reference(n) {
  const p = n.parent;
  if (ts.isBindingElement(p) && p.propertyName === n) return false;
  if ((ts.isPropertyAccessExpression(p) && p.name === n) || ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p)) && p.name === n)) return false;
  return true;
}
function inspect(file) {
  const program = ts.createProgram([file], { allowJs: true, noResolve: true, noLib: true });
  const sf = program.getSourceFile(file), checker = program.getTypeChecker();
  let owner = null;
  const owners = new Map(), exports = new Map();
  for (const st of sf.statements) {
    const comments = sf.text.slice(st.pos, st.getStart(sf));
    const marks = [...comments.matchAll(/^\/\/ ([^\n]+\.(?:ts|js|mjs|cjs))\s*$/gm)];
    if (marks.length) owner = marks.at(-1)[1];
    owners.set(st, owner);
    if (ts.isExpressionStatement(st) && ts.isCallExpression(st.expression) && st.expression.expression.getText(sf) === '__export') {
      const obj = st.expression.arguments[1];
      if (obj && ts.isObjectLiteralExpression(obj)) {
        const map = exports.get(owner) ?? new Map();
        for (const prop of obj.properties) if (ts.isPropertyAssignment(prop) && ts.isArrowFunction(prop.initializer)) map.set(prop.initializer.body.getText(sf), prop.name.getText(sf).replace(/^"|"$/g, ''));
        exports.set(owner, map);
      }
    }
  }
  return { sf, checker, owners, exports };
}
const inputs = files(premium).filter(f => f.endsWith('.js'));
const typescriptInputs = files(typescriptSource).filter(f => f.endsWith('.ts'));
if (typescriptInputs.length !== 45) throw new Error(`Expected 45 Natively 3.1.0 premium TypeScript files, found ${typescriptInputs.length}`);
for (const file of typescriptInputs) {
  const relativePath = path.relative(typescriptSource, file);
  const output = path.join('premium/electron', relativePath);
  const destination = path.join(root, output);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, applyTypeFlowFix(relativePath, fs.readFileSync(file, 'utf8')));
  fs.rmSync(destination.replace(/\.ts$/, '.js'), { force: true });
  record(file, output);
}
const publicNames = new Map();
for (const file of inputs) {
  const { exports } = inspect(file), name = path.relative(compiled, file).split(path.sep).join('/').replace(/\.js$/, '.ts');
  publicNames.set(name, exports.get(name) ?? new Map());
}
for (const file of inputs) {
  const { sf, checker, owners, exports } = inspect(file);
  const name = path.relative(compiled, file).split(path.sep).join('/').replace(/\.js$/, '.ts');
  if (fs.existsSync(path.join(typescriptSource, name.replace(/^premium\/electron\//, '')))) continue;
  const output = name.replace(/\.ts$/, '.js'), imports = new Map(), initSymbols = new Set();
  const ownExports = exports.get(name);
  if (!ownExports?.size) throw new Error('No exports found: ' + name);
  const selected = sf.statements.filter(st => owners.get(st) === name).filter(st => {
    const text = st.getText(sf);
    return !/^var \w+_exports\s*=\s*\{\};$/.test(text) && !/^__export\(/.test(text) && !/^module\.exports\s*=/.test(text) && !/^0 && \(module\.exports/.test(text);
  });
  function origin(n) {
    const symbol = checker.getSymbolAtLocation(n);
    for (const dec of symbol?.declarations ?? []) {
      let top = dec;
      while (top.parent && top.parent !== sf) top = top.parent;
      if (top.parent === sf) return owners.get(top);
    }
    return null;
  }
  const exportStatements = sf.statements.filter(st => owners.get(st) === name && /^__export\(/.test(st.getText(sf)));
  for (const st of [...selected, ...exportStatements]) {
    const visit = n => {
      if (ts.isIdentifier(n) && reference(n)) {
        const owner = origin(n);
        if (owner && owner !== name) {
          if (/^init_/.test(n.text)) { initSymbols.add(n.text); return; }
          let specifier;
          if (owner.startsWith('node_modules/')) {
            const parts = owner.slice(13).split('/');
            specifier = parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
          } else {
            const target = path.join(root, owner);
            if (!fs.existsSync(target) && !fs.existsSync(target.replace(/\.ts$/, '.js')) && !publicNames.has(owner)) throw new Error('Missing shared dependency: ' + owner);
            specifier = relative(path.join(root, name), target);
          }
          const map = exports.get(owner) ?? publicNames.get(owner) ?? new Map();
          let exported = map.get(n.text);
          if (/_exports$/.test(n.text)) exported = '*';
          if (!exported) {
            const names = new Set([...(publicNames.get(owner)?.values() ?? []), ...map.values()]);
            exported = names.has(n.text) ? n.text : names.has(n.text.replace(/\d+$/, '')) ? n.text.replace(/\d+$/, '') : n.text;
          }
          imports.set(n.text, { exported, specifier });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(st);
  }
  const helpers = sf.statements.filter(st => !owners.get(st) && ts.isVariableStatement(st)).map(st => st.getText(sf)).join('\n');
  const transform = context => {
    const visit = node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && initSymbols.has(node.expression.text)) return context.factory.createVoidZero();
      return ts.visitEachChild(node, visit, context);
    };
    return node => ts.visitNode(node, visit);
  };
  let body = selected.map(st => {
    const transformed = ts.transform(st, [transform]);
    const result = printer.printNode(ts.EmitHint.Unspecified, transformed.transformed[0], sf);
    transformed.dispose();
    return result;
  }).join('\n');
  const importsText = [...imports].map(([local, { exported, specifier }]) => exported === '*' ? `import * as ${local} from ${JSON.stringify(specifier)};` : `import { ${exported}${exported === local ? '' : ' as ' + local} } from ${JSON.stringify(specifier)};`).join('\n');
  const exportsText = `export { ${[...ownExports].map(([local, exported]) => local === exported ? local : local + ' as ' + exported).join(', ')} };`;
  write(output, `// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.\n${importsText}\n${helpers}\n${body}\n${exportsText}\n`);
  record(file, output);
}
const providerOutputs = provenance.filter(item => item.output.startsWith('premium/electron/') && item.output.endsWith('.js')).map(item => item.output).sort();
if (providerOutputs.join(',') !== 'premium/electron/knowledge/NativelySearchProvider.js,premium/electron/knowledge/TavilySearchProvider.js') {
  throw new Error(`Expected only the two JS-only search providers, found: ${providerOutputs.join(', ') || '(none)'}`);
}
for (const provider of providerOutputs) {
  const output = provider.replace(/\.js$/, '.d.ts');
  const declaration = provider.endsWith('/TavilySearchProvider.js')
    ? `import type { SearchResult } from "./CompanyResearchEngine";\n\nexport declare class TavilySearchProvider {\n  creditsUsed: number;\n  constructor(apiKey: string);\n  get sessionCreditsUsed(): number;\n  search(query: string, numResults?: number): Promise<SearchResult[]>;\n  extractUrl(url: string): Promise<{ title: string; content: string } | null>;\n}\n`
    : `import type { SearchResult } from "./CompanyResearchEngine";\n\nexport declare class NativelySearchProvider {\n  apiKey: string;\n  trialToken: string | undefined;\n  endpoint: string;\n  sessionId: string;\n  quotaExhausted: boolean;\n  constructor(apiKey: string, trialToken?: string);\n  search(query: string, numResults?: number): Promise<SearchResult[]>;\n}\n`;
  write(output, declaration);
  record(path.resolve(compiled, provider), output);
}
require('./recover-premium-renderer.cjs')({ source, root, write, record });
write('premium/RECOVERY.json', JSON.stringify({ format: 2, files: provenance }, null, 2) + '\n');
console.log('Recovered', typescriptInputs.length, 'premium TypeScript modules and', providerOutputs.length, 'JS-only providers.');
