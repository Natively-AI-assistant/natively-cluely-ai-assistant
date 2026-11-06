// Extract the declaration closure of the recovered components, without the app entrypoint.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
module.exports = function recoverRenderer({ source, root, write, record }) {
  const assets = path.resolve(source, 'recovered/reconstructed/readable/dist/assets');
  const app = path.join(assets, 'App-h7VwvpAg.js');
  const names = ['ProfileVisualizer', 'RoleInsightPanel', 'NegotiationCoachingCard', 'ProfileFeatureToaster', 'JDAwarenessToaster', 'NativelyApiPromoToaster', 'MaxUltraUpgradeToaster', 'RemoteCampaignToaster'];
  const inputFiles = fs.readdirSync(assets).filter(n => n.endsWith('.js')).map(n => path.join(assets, n));
  const program = ts.createProgram(inputFiles, { allowJs: true, noResolve: true, noLib: true });
  const checker = program.getTypeChecker(), modules = new Map();
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  function module(file) {
    if (modules.has(file)) return modules.get(file);
    const sf = program.getSourceFile(file);
    if (!sf) throw new Error('Missing renderer dependency: ' + file);
    const mod = { sf, units: new Map(), selected: new Set(), imports: new Map(), exports: new Map(), usedExports: new Set() };
    modules.set(file, mod);
    for (const st of sf.statements) {
      if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) {
        const add = n => { if (ts.isIdentifier(n)) mod.units.set(n.text, { node: d, statement: st }); else if (ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n)) for (const b of n.elements) if (ts.isBindingElement(b)) add(b.name); };
        add(d.name);
      }
      else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) mod.units.set(st.name.text, { node: st, statement: st });
      else if (ts.isImportDeclaration(st)) {
        const clause = st.importClause, specifier = st.moduleSpecifier.text;
        if (clause?.name) mod.imports.set(clause.name.text, { local: clause.name.text, imported: 'default', specifier });
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const s of clause.namedBindings.elements) mod.imports.set(s.name.text, { local: s.name.text, imported: (s.propertyName ?? s.name).text, specifier });
        else if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) mod.imports.set(clause.namedBindings.name.text, { local: clause.namedBindings.name.text, imported: '*', specifier });
      }
      else if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) for (const e of st.exportClause.elements) mod.exports.set(e.name.text, (e.propertyName ?? e.name).text);
    }
    return mod;
  }
  function ref(n) {
    const p = n.parent;
    if (ts.isPropertyAccessExpression(p) && p.name === n) return false;
    if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p)) && p.name === n) return false;
    if (ts.isBindingElement(p) && p.propertyName === n) return false;
    return true;
  }
  const externalBridges = {
    'data-vendor-B3TydLvu.js': 'data-runtime.js',
    'i18n-B6QSQDnD.js': 'i18n-runtime.js',
  };
  const usedImports = new Map();
  function select(file, name) {
    const mod = module(file);
    const imp = mod.imports.get(name);
    if (imp) {
      let used = usedImports.get(file); if (!used) usedImports.set(file, used = new Set());
      used.add(name);
      if (!externalBridges[path.basename(imp.specifier)]) {
        const depFile = path.resolve(path.dirname(file), imp.specifier), dep = module(depFile);
        if (imp.imported === '*') throw new Error('Namespace import requires explicit closure: ' + imp.specifier);
        const local = dep.exports.get(imp.imported);
        if (!local) throw new Error('Missing export ' + imp.imported + ' from ' + depFile);
        dep.usedExports.add(imp.imported); select(depFile, local);
      }
      return;
    }
    const unit = mod.units.get(name);
    if (!unit) throw new Error('Missing renderer declaration: ' + file + ' ' + name);
    if (mod.selected.has(unit.node)) return;
    mod.selected.add(unit.node);
    function visit(n) {
      if (ts.isIdentifier(n) && ref(n)) {
        const sym = checker.getSymbolAtLocation(n);
        for (const dec of sym?.declarations ?? []) {
          let top = dec;
          while (top.parent && top.parent !== mod.sf) top = top.parent;
          if (top.parent !== mod.sf) continue;
          const global = mod.units.get(n.text);
          if (!ts.isImportDeclaration(top) && (!global || (dec !== global.node && !(ts.isBindingElement(dec) && global.node.pos <= dec.pos && global.node.end >= dec.end)))) continue;
          if (ts.isImportDeclaration(top) || (ts.isVariableStatement(top) && (mod.units.get(n.text)?.node !== unit.node)) || ((ts.isFunctionDeclaration(top) || ts.isClassDeclaration(top)) && top !== unit.node)) select(file, n.text);
        }
      }
      ts.forEachChild(n, visit);
    }
    visit(unit.node);
  }
  const appMod = module(app), roots = new Map();
  const findComponents = n => {
    if (ts.isPropertyAssignment(n) && names.includes(n.name.getText(appMod.sf)) && ts.isIdentifier(n.initializer)) roots.set(n.name.getText(appMod.sf), n.initializer.text);
    ts.forEachChild(n, findComponents);
  };
  findComponents(appMod.sf);
  for (const name of names) { if (!roots.has(name)) throw new Error('Component not located: ' + name); select(app, roots.get(name)); }
  write('premium/src/recovered/data-runtime.js', `import * as React from 'react';\nimport * as jsx from 'react/jsx-runtime';\nexport { QueryClient as Q, QueryClientProvider as a } from '@tanstack/react-query';\nconst getDefault = value => value && value.__esModule && Object.prototype.hasOwnProperty.call(value, 'default') ? value.default : value;\nconst getReact = () => React;\nexport { React as r, React as R, React as b, jsx as j, getDefault as g, getReact as c };\n`);
  write('premium/src/recovered/i18n-runtime.js', `export { useT, useLanguage, LANG_NATIVE_NAMES } from '../../../src/i18n';\n`);
  const copiedAssets = new Set();
  for (const [file, mod] of modules) {
    if (!mod.selected.size) continue;
    const output = 'premium/src/recovered/' + path.basename(file), imports = [];
    for (const local of usedImports.get(file) ?? []) {
      const imp = mod.imports.get(local), bridge = externalBridges[path.basename(imp.specifier)];
      const spec = bridge ? './' + bridge : imp.specifier;
      imports.push(imp.imported === 'default' ? `import ${local} from ${JSON.stringify(spec)};` : `import { ${imp.imported}${imp.imported === local ? '' : ' as ' + local} } from ${JSON.stringify(spec)};`);
    }
    const declarations = [];
    for (const st of mod.sf.statements) {
      if (ts.isVariableStatement(st)) {
        const ds = st.declarationList.declarations.filter(d => mod.selected.has(d));
        if (ds.length) declarations.push(printer.printNode(ts.EmitHint.Unspecified, ts.factory.updateVariableStatement(st, undefined, ts.factory.updateVariableDeclarationList(st.declarationList, ds)), mod.sf));
      } else if (mod.selected.has(st)) declarations.push(st.getText(mod.sf));
    }
    const exports = file === app ? [...roots].map(([name, local]) => `${local} as ${name}`) : [...mod.usedExports].map(name => `${mod.exports.get(name)} as ${name}`);
    let content = '// Recovered declaration closure; runtime React and translations come from the host app.\n' + imports.join('\n') + '\n' + declarations.join('\n') + '\nexport { ' + exports.join(', ') + ' };\n';
    for (const match of content.matchAll(/new URL\(["']([^"']+)["'],\s*import\.meta\.url\)/g)) {
      const asset = match[1];
      if (/^(https?:|data:)/.test(asset)) continue;
      let assetFile = path.resolve(path.dirname(file), asset);
      if (!fs.existsSync(assetFile)) assetFile = path.resolve(source, 'recovered/compiled/app/dist/assets', asset);
      if (!fs.existsSync(assetFile)) throw new Error('Missing asset: ' + asset);
      if (!copiedAssets.has(asset)) { write('premium/src/recovered/' + asset, fs.readFileSync(assetFile)); record(assetFile, 'premium/src/recovered/' + asset); copiedAssets.add(asset); }
    }
    // Reject app bootstrapping in recovered declarations: only exported components may render.
    if (/\.createRoot\(/.test(content)) throw new Error('App bootstrap leaked into ' + output);
    write(output, content); record(file, output);
  }
  const signatures = {
    ProfileVisualizer: 'profile: unknown; isPremium?: boolean; isTrialActive?: boolean',
    RoleInsightPanel: 'hasAccess?: boolean; onNeedUpgrade?: () => void; onGoToProfile?: () => void',
    NegotiationCoachingCard: 'coaching: unknown; onDismiss?: () => void',
  };
  write('premium/src/recovered/App-h7VwvpAg.d.ts', `import type { ComponentType } from 'react';\n` + names.map(name => `export const ${name}: ComponentType<{ ${signatures[name] ?? '[key: string]: unknown'} }>;`).join('\n') + '\n');
  for (const name of names) write('premium/src/' + name + '.tsx', `// Original compiled component and its complete dependency closure.\nexport { ${name} } from './recovered/App-h7VwvpAg.js';\n`);
  console.log('Recovered', names.length, 'renderer components across', modules.size, 'chunks.');
};
