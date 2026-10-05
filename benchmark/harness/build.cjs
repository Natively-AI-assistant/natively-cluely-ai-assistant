// Same esbuild options as scripts/build-electron.js, single entry, isolated outdir.
const { build } = require('esbuild');
const path = require('path');
const root = path.resolve(__dirname, '../..');
build({
  entryPoints: [path.join(__dirname, 'pipeline-entry.ts')],
  bundle: true,
  outfile: path.join(root, 'benchmark/build/pipeline.cjs'),
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron', 'better-sqlite3', 'keytar', 'sqlite-vec', '@vectorize-io/hindsight-client', 'onnxruntime-node', 'pdfjs-dist', 'pdf-parse', 'mammoth'],
  sourcemap: false,
  jsx: 'automatic',
  loader: { '.ts': 'ts', '.js': 'js' },
  logLevel: 'warning',
  absWorkingDir: root,
}).then(() => console.log('built')).catch(e => { console.error(e.message); process.exit(1); });
