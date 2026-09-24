// electron/genieSnapshots.ts
//
// Snapshots of popup cards for the renderer's genie.
//
// macOS draws the genie by warping ONE finished picture of the window (the
// window server bends its texture over a mesh). The renderer used to fake that
// with two dozen live DOM copies of the card, each laid out and rasterized on
// its own, which ran the GPU out of tile memory and showed. It now warps a
// single picture of the card, and this module takes and keeps those pictures:
//
//   capture   webContents.capturePage(rect): Chromium's own compositor, read
//             back. It is exact (what is on screen, blur and all), takes a few
//             milliseconds, and is not an OS screen capture, so content
//             protection (undetectable mode) does not blank it.
//   keep      one file per card view, so the NEXT open can pour out a picture
//             of the view it opens into, the way macOS restores a window from
//             its last texture. Pictures of Profile Intelligence show résumé
//             and JD text, so a file is encrypted with safeStorage (Keychain
//             on macOS, DPAPI on Windows). Without an OS keyring the pictures
//             stay in memory for the session and nothing is written.
//
// Files live under userData/genie-snapshots/<app version>/: a new version can
// draw its cards differently, so the old folders are removed at start-up.
// Keys come from the renderer and are never used as paths: a file is named by
// the key's hash.

import { app, safeStorage, type WebContents } from 'electron';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** More than this many pictures and the oldest go. */
const MAX_SNAPSHOTS = 48;
/** A capture rect larger than this in either direction is refused. */
const MAX_EDGE = 8192;

interface IndexEntry { key: string; file: string; savedAt: number }

const memory = new Map<string, Buffer>();
let index: IndexEntry[] | null = null;

const root = () => path.join(app.getPath('userData'), 'genie-snapshots');
const versionDir = () => path.join(root(), app.getVersion().replace(/[^\w.-]/g, '_'));
const indexPath = () => path.join(versionDir(), 'index.json');
const fileFor = (key: string) => `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.bin`;

const encrypted = (): boolean => {
  try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
};

async function loadIndex(): Promise<IndexEntry[]> {
  if (index) return index;
  try {
    const parsed = JSON.parse(await fs.readFile(indexPath(), 'utf8'));
    index = Array.isArray(parsed) ? parsed.filter(e => e && typeof e.key === 'string' && typeof e.file === 'string') : [];
  } catch {
    index = [];
  }
  return index!;
}

async function writeIndex(): Promise<void> {
  if (!index) return;
  await fs.mkdir(versionDir(), { recursive: true });
  const tmp = `${indexPath()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(index));
  await fs.rename(tmp, indexPath());
}

/** Remove folders left by other app versions. Called once at start-up. */
export async function pruneOldGenieSnapshots(): Promise<void> {
  try {
    const keep = path.basename(versionDir());
    for (const name of await fs.readdir(root())) {
      if (name !== keep) await fs.rm(path.join(root(), name), { recursive: true, force: true });
    }
  } catch { /* nothing stored yet */ }
}

export interface GenieCaptureRect { x: number; y: number; width: number; height: number }

/** The card's pixels as they are on screen now, or null if there is nothing to take. */
export async function captureGenieSnapshot(
  sender: WebContents,
  rect: GenieCaptureRect,
): Promise<{ png: Buffer; width: number; height: number } | null> {
  const ok = rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && rect.width > 0 && rect.height > 0 && rect.width <= MAX_EDGE && rect.height <= MAX_EDGE;
  if (!ok || sender.isDestroyed()) return null;
  const image = await sender.capturePage({
    x: Math.round(rect.x), y: Math.round(rect.y),
    width: Math.round(rect.width), height: Math.round(rect.height),
  });
  if (image.isEmpty()) return null;
  const size = image.getSize();
  return { png: image.toPNG(), width: size.width, height: size.height };
}

export async function saveGenieSnapshot(key: string, png: Buffer): Promise<boolean> {
  if (typeof key !== 'string' || !key || !Buffer.isBuffer(png) || png.length === 0) return false;
  memory.set(key, png);
  if (!encrypted()) return true;
  const entries = await loadIndex();
  const file = fileFor(key);
  await fs.mkdir(versionDir(), { recursive: true });
  const tmp = path.join(versionDir(), `${file}.tmp`);
  await fs.writeFile(tmp, safeStorage.encryptString(png.toString('base64')));
  await fs.rename(tmp, path.join(versionDir(), file));
  const others = entries.filter(e => e.key !== key);
  others.push({ key, file, savedAt: Date.now() });
  others.sort((a, b) => a.savedAt - b.savedAt);
  while (others.length > MAX_SNAPSHOTS) {
    const gone = others.shift()!;
    memory.delete(gone.key);
    await fs.rm(path.join(versionDir(), gone.file), { force: true });
  }
  index = others;
  await writeIndex();
  return true;
}

export async function loadGenieSnapshot(key: string): Promise<Buffer | null> {
  if (typeof key !== 'string') return null;
  const hit = memory.get(key);
  if (hit) return hit;
  if (!encrypted()) return null;
  const entry = (await loadIndex()).find(e => e.key === key);
  if (!entry) return null;
  try {
    const png = Buffer.from(safeStorage.decryptString(await fs.readFile(path.join(versionDir(), entry.file))), 'base64');
    memory.set(key, png);
    return png;
  } catch {
    // Unreadable (keyring changed, file damaged): forget it; the card is simply
    // captured again the next time it is on screen.
    await clearGenieSnapshots(key, true);
    return null;
  }
}

/** Every kept key, oldest first: the renderer warms the newest it can hold. */
export async function listGenieSnapshots(): Promise<string[]> {
  // The index is in the order the pictures were saved; pictures held only in
  // memory (no keyring) were all taken this session, so they come after it.
  const keys = new Set<string>();
  if (encrypted()) for (const e of await loadIndex()) keys.add(e.key);
  for (const k of memory.keys()) keys.add(k);
  return [...keys];
}

/** Forget pictures whose key starts with `prefix` (all of them without one). */
export async function clearGenieSnapshots(prefix = '', exact = false): Promise<void> {
  const match = (k: string) => (exact ? k === prefix : k.startsWith(prefix));
  for (const k of [...memory.keys()]) if (match(k)) memory.delete(k);
  const entries = await loadIndex();
  const gone = entries.filter(e => match(e.key));
  for (const e of gone) await fs.rm(path.join(versionDir(), e.file), { force: true });
  index = entries.filter(e => !match(e.key));
  await writeIndex().catch(() => {});
}
