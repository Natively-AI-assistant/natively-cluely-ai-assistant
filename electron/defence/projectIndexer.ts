import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { extractSafeDocumentText } from '../services/SafeDocumentTextExtractor';
import type { IndexManifest, IndexedChunk, IndexProgress, ImplementationStatus } from './types';

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.venv', 'venv', '__pycache__', '.defence-index', 'cache', 'logs']);
const TEXT_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.csv', '.tsv', '.xml', '.html', '.css', '.scss',
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.java', '.cs', '.go', '.rs', '.sql', '.sh', '.bash', '.ps1', '.bat', '.cmd', '.c', '.h', '.cpp', '.hpp', '.swift', '.kt', '.kts', '.vue', '.svelte', '.rb', '.php', '.r', '.tex',
]);
const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.docx', '.pptx']);
const SECRET_NAMES = /^(?:\.env(?:\..*)?|id_rsa|id_ed25519|.*\.(?:pem|p12|pfx|key)|credentials?\.json|secrets?\..*)$/i;

function sha256(data: Buffer | string): string { return crypto.createHash('sha256').update(data).digest('hex'); }

export function tokenize(text: string): string[] {
  const latin = text.toLowerCase().match(/[a-z0-9_.$#-]{2,}/g) || [];
  const compactZh = (text.match(/[\u3400-\u9fff]+/g) || []).flatMap(s => {
    const chars = [...s]; return [...chars, ...chars.slice(0, -1).map((c, i) => c + chars[i + 1])];
  });
  return [...new Set([...latin, ...compactZh])];
}

export function vectorize(tokens: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const token of tokens) counts[token] = (counts[token] || 0) + 1;
  const norm = Math.sqrt(Object.values(counts).reduce((sum, value) => sum + value * value, 0)) || 1;
  for (const key of Object.keys(counts)) counts[key] /= norm;
  return counts;
}

function implementationStatus(filePath: string, content: string): ImplementationStatus {
  if (/deprecated|@deprecated/i.test(content)) return 'DEPRECATED';
  if (/(^|[\\/])(?:test|tests|__tests__|fixtures?)([\\/]|$)|\.(?:test|spec)\./i.test(filePath)) return 'TESTED_ONLY';
  if (/\b(?:TODO|planned|future work|not implemented)\b/i.test(content) && content.length < 1200) return 'PLANNED';
  return 'IMPLEMENTED';
}

function symbolFor(line: string): string | undefined {
  return line.match(/(?:class|interface|function|def|fn|func|type|const|let|var)\s+([A-Za-z_$][\w$]*)/)?.[1];
}

async function pptxText(filePath: string): Promise<string> {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(await fs.promises.readFile(filePath));
  const names = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const slides: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const xml = await zip.files[names[i]].async('string');
    const text = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m => m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')).join(' ');
    if (text.trim()) slides.push(`[Slide ${i + 1}]\n${text}`);
  }
  return slides.join('\n\n');
}

async function extractText(filePath: string, ext: string): Promise<{ content: string; hash: string }> {
  if (ext === '.pptx') {
    const binary = await fs.promises.readFile(filePath);
    return { content: await pptxText(filePath), hash: sha256(binary) };
  }
  if (ext === '.pdf' || ext === '.docx') {
    const result = await extractSafeDocumentText(filePath);
    return { content: result.content, hash: result.binarySha256 };
  }
  const binary = await fs.promises.readFile(filePath);
  const sample = binary.subarray(0, Math.min(4096, binary.length));
  const nulCount = sample.reduce((count, byte) => count + (byte === 0 ? 1 : 0), 0);
  if (nulCount / Math.max(1, sample.length) > 0.01) throw new Error('binary content');
  // A source file may deliberately contain a literal NUL in a sanitizer test.
  // Preserve it as a visible escape without treating two isolated bytes as a binary file.
  return { content: binary.toString('utf8').replace(/\0/g, '\\0'), hash: sha256(binary) };
}

function gitInfo(root: string): { commit?: string; files?: string[] } {
  const commitResult = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (commitResult.status !== 0) return {};
  const filesResult = spawnSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
  return {
    commit: commitResult.stdout.trim(),
    files: filesResult.status === 0 ? filesResult.stdout.split(/\r?\n/).filter(Boolean) : undefined,
  };
}

async function walk(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(dir: string): Promise<void> {
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!EXCLUDED_DIRS.has(entry.name)) await visit(absolute); }
      else if (entry.isFile()) result.push(absolute);
    }
  }
  await visit(root); return result;
}

function chunksFor(relativePath: string, content: string, hash: string, indexedAt: string, commit?: string): IndexedChunk[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const output: IndexedChunk[] = [];
  for (let start = 0; start < lines.length; start += 35) {
    const end = Math.min(lines.length, start + 40);
    const body = lines.slice(start, end).join('\n').trim();
    if (!body) continue;
    const tokens = tokenize(`${relativePath} ${body}`);
    const heading = lines.slice(start, end).find(line => /^#{1,6}\s+/.test(line))?.replace(/^#+\s*/, '');
    const symbol = lines.slice(start, Math.min(end, start + 8)).map(symbolFor).find(Boolean);
    output.push({
      id: sha256(`${relativePath}:${start + 1}:${hash}`).slice(0, 24), sourceType: 'project', path: relativePath,
      title: heading || path.basename(relativePath), symbol, lineStart: start + 1, lineEnd: end, commit,
      excerpt: body.slice(0, 700), content: body, status: implementationStatus(relativePath, body), score: 0,
      fileHash: hash, indexedAt, tokens, vector: vectorize(tokens),
    });
  }
  return output;
}

export class ProjectIndexer {
  private progress: IndexProgress = { running: false, scanned: 0, added: 0, updated: 0, skipped: 0, deleted: 0, excluded: 0, failed: [] };
  constructor(private root: string, private indexPath: string) {}
  getProgress(): IndexProgress { return structuredClone(this.progress); }
  private manifestPath(): string { return path.join(this.indexPath, 'manifest.json'); }
  async load(): Promise<IndexManifest> {
    try { return JSON.parse(await fs.promises.readFile(this.manifestPath(), 'utf8')); }
    catch { return { version: 1, projectRoot: this.root, files: {}, chunks: [] }; }
  }
  async clear(): Promise<void> {
    await fs.promises.rm(this.manifestPath(), { force: true });
  }
  async index(fullRebuild = false): Promise<IndexProgress> {
    if (this.progress.running) return this.getProgress();
    this.progress = { running: true, scanned: 0, added: 0, updated: 0, skipped: 0, deleted: 0, excluded: 0, failed: [], startedAt: new Date().toISOString() };
    const previous = fullRebuild ? { version: 1, projectRoot: this.root, files: {}, chunks: [] } as IndexManifest : await this.load();
    const git = gitInfo(this.root);
    const candidates = git.files?.map(file => path.resolve(this.root, file)) || await walk(this.root);
    const next: IndexManifest = { version: 1, projectRoot: this.root, commit: git.commit, files: {}, chunks: [] };
    const previousChunks = new Map(previous.chunks.map(chunk => [chunk.id, chunk]));
    for (const absolute of candidates) {
      const relative = path.relative(this.root, absolute).replace(/\\/g, '/');
      const ext = path.extname(relative).toLowerCase();
      if (relative.startsWith('../') || SECRET_NAMES.test(path.basename(relative)) || (!TEXT_EXTENSIONS.has(ext) && !DOCUMENT_EXTENSIONS.has(ext))) { this.progress.excluded++; continue; }
      this.progress.scanned++;
      try {
        const stat = await fs.promises.lstat(absolute);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 20 * 1024 * 1024) { this.progress.excluded++; continue; }
        const { content, hash } = await extractText(absolute, ext);
        const old = previous.files[relative];
        if (old?.hash === hash) {
          const retained = old.chunkIds.map(id => previousChunks.get(id)).filter((value): value is IndexedChunk => !!value);
          next.files[relative] = old; next.chunks.push(...retained); this.progress.skipped++; continue;
        }
        const indexedAt = new Date().toISOString();
        const chunks = chunksFor(relative, content, hash, indexedAt, git.commit);
        next.files[relative] = { hash, chunkIds: chunks.map(chunk => chunk.id), indexedAt };
        next.chunks.push(...chunks); old ? this.progress.updated++ : this.progress.added++;
      } catch (error) {
        this.progress.failed.push({ path: relative, reason: error instanceof Error ? error.message : 'parse failed' });
      }
    }
    this.progress.deleted = Object.keys(previous.files).filter(file => !next.files[file]).length;
    await fs.promises.mkdir(this.indexPath, { recursive: true });
    await fs.promises.writeFile(this.manifestPath(), JSON.stringify(next), { encoding: 'utf8', mode: 0o600 });
    this.progress.running = false; this.progress.completedAt = new Date().toISOString();
    return this.getProgress();
  }
}
