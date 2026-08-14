// tests/utils/internetFixtureCollector.mjs
// Opt-in downloader for public, legally accessible reference fixtures.
// Default behaviour is OFFLINE — tests use the synthetic fixtures in
// tests/fixtures/modes/*. Set RUN_INTERNET_FIXTURE_COLLECTION=1 to enable.
//
// Safety rules enforced:
//   - https only
//   - allow-list of hosts (wikipedia, github raw, ietf, w3)
//   - max 1 MiB per file
//   - allow-list of extensions (.txt .md .json .csv .xml .html)
//   - filenames sanitized: anything outside [a-zA-Z0-9._-] becomes _
//   - per-file metadata JSON sidecar with source URL, source type, sentinels
//   - on any failure: fall back to synthetic_fallback rather than skip

import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, '../fixtures/internet-sourced');
const MAX_BYTES = 1 * 1024 * 1024;
const ALLOWED_HOSTS = new Set([
  'en.wikipedia.org',
  'raw.githubusercontent.com',
  'www.ietf.org',
  'datatracker.ietf.org',
  'www.w3.org',
]);
const ALLOWED_EXT = new Set(['.txt', '.md', '.json', '.csv', '.xml', '.html']);

function sanitize(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

/**
 * Returns the local cached path. If RUN_INTERNET_FIXTURE_COLLECTION=1 and
 * the file is not cached, fetches it. On any failure, writes the
 * `fallbackContent` to disk with `synthetic_fallback` metadata.
 */
export async function collectFixture({ url, filename, mode, scenario, sentinelFacts, expectedRetrievalQueries, fallbackContent }) {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  const safeName = sanitize(filename);
  const filePath = path.join(CACHE_DIR, safeName);
  const metaPath = filePath + '.meta.json';

  if (fs.existsSync(filePath) && fs.existsSync(metaPath)) {
    return { filePath, cached: true };
  }

  if (process.env.RUN_INTERNET_FIXTURE_COLLECTION !== '1') {
    return writeFallback(filePath, metaPath, fallbackContent, { mode, scenario, filename, sentinelFacts, expectedRetrievalQueries });
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('Only https allowed');
    if (!ALLOWED_HOSTS.has(parsed.hostname)) throw new Error(`Host not allow-listed: ${parsed.hostname}`);
    const ext = path.extname(safeName).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) throw new Error(`Extension not allow-listed: ${ext}`);

    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cl = Number(res.headers.get('content-length') ?? 0);
    if (cl > MAX_BYTES) throw new Error(`Too large: ${cl} bytes`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error(`Too large after read: ${buf.length}`);
    fs.writeFileSync(filePath, buf);
    fs.writeFileSync(metaPath, JSON.stringify({
      mode,
      scenario,
      filename: safeName,
      fileType: ext.slice(1),
      sourceUrl: url,
      sourceType: 'downloaded_public',
      collectedAt: new Date().toISOString(),
      sentinelFacts,
      expectedRetrievalQueries,
    }, null, 2));
    return { filePath, cached: false };
  } catch (e) {
    console.warn(`[internetFixtureCollector] download failed for ${url}: ${e.message}. Falling back to synthetic.`);
    return writeFallback(filePath, metaPath, fallbackContent, { mode, scenario, filename: safeName, sentinelFacts, expectedRetrievalQueries });
  }
}

function writeFallback(filePath, metaPath, content, meta) {
  fs.writeFileSync(filePath, content ?? '');
  fs.writeFileSync(metaPath, JSON.stringify({
    ...meta,
    fileType: path.extname(meta.filename).slice(1),
    sourceType: 'synthetic_fallback',
    collectedAt: new Date().toISOString(),
  }, null, 2));
  return { filePath, cached: false, fallback: true };
}
