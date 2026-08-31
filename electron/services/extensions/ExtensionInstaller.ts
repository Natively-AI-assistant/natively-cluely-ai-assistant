/**
 * Getting an extension's payload onto disk, and browsing what exists.
 *
 * `ExtensionManager.install()` deliberately does not fetch anything — by the
 * time it is called the bytes are already staged and it decides only whether
 * they may be recorded. This file is the other half: it stages them.
 *
 * WHAT THIS DOES AND DOES NOT DO
 *
 * It installs from a LOCAL DIRECTORY. It does not download and execute a
 * payload from the internet. That is a deliberate line, not an oversight:
 *
 *   - An extension's entrypoint is real code that runs on the user's machine.
 *     The sandbox is defence in depth against a SLOPPY extension, and
 *     `docs/extensions.md` is explicit that it is not a boundary against a
 *     hostile one — a native addon does its I/O from C++ and never passes a
 *     patched `require`, and `process.spawn` runs a real binary outside the
 *     broker's reach.
 *   - So fetching arbitrary code from a URL and running it is a materially
 *     different risk from downloading MODEL WEIGHTS, which are data checked
 *     against a recorded sha256.
 *
 * The remote registry below is therefore METADATA ONLY: it tells the user what
 * extensions exist and where their repositories are. Obtaining the payload is
 * the user's explicit act. Remote payload installation, if it is ever added,
 * needs signature verification rather than just a host allowlist.
 */

import * as fs from 'fs';
import * as path from 'path';
import { extensionDir } from './paths';

/** Ceilings on a staged payload. A manifest is untrusted; so is what sits beside it. */
const MAX_PAYLOAD_FILES = 20_000;
const MAX_PAYLOAD_BYTES = 512 * 1024 * 1024;

/**
 * Directories never copied out of a source tree.
 *
 * `node_modules` is deliberately NOT on this list. Skipping it looks like an
 * obvious saving — the Ettin extension's is 264MB — but its entrypoint does
 * `await import('onnxruntime-node')` at init, so an install without it succeeds
 * and then fails to start with a module-not-found error. A broken install is
 * worse than a large one. The size ceiling below is what bounds this instead.
 *
 * `.bin` IS skipped. npm fills `node_modules/.bin` with symlinked CLI shims
 * (tsc, semver, tsserver), which would otherwise trip the symlink refusal below
 * and make every real extension uninstallable. They are build-time tools; no
 * entrypoint resolves through them at runtime. The refusal still applies
 * everywhere else, which is where a symlink could actually point somewhere it
 * should not.
 */
const SKIPPED_DIRS = new Set(['.git', '.github', '.bin']);

export interface StageResult {
  ok: boolean;
  /** Where the payload now lives, on success. */
  payloadDir?: string;
  manifestJson?: unknown;
  errors?: string[];
  warnings?: string[];
}

export interface RegistryEntry {
  id: string;
  repo: string;
  latestVersion: string;
  apiVersion: string;
  category: string;
  modelLicenses?: string[];
}

/**
 * Copy a local extension into `~/.natively/extensions/<id>/`.
 *
 * The manifest is read but NOT validated here — validation belongs to
 * `ExtensionManager.install()`, which owns the trust prompt and the registry
 * record. This only decides whether the bytes are safe to copy.
 */
export function stageFromDirectory(
  sourceDir: string,
  opts: { rootOverride?: string } = {},
): StageResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let manifestJson: unknown;
  const manifestPath = path.join(sourceDir, 'extension.json');
  try {
    manifestJson = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    return { ok: false, errors: [`could not read ${manifestPath}: ${errText(e)}`] };
  }

  const id = (manifestJson as any)?.id;
  const entrypoint = (manifestJson as any)?.entrypoint;
  if (typeof id !== 'string' || !id) return { ok: false, errors: ['manifest has no id'] };
  if (typeof entrypoint !== 'string' || !entrypoint) return { ok: false, errors: ['manifest has no entrypoint'] };

  // The entrypoint must exist BEFORE anything is copied. An extension whose
  // dist/ was never built would otherwise install cleanly and then fail to start
  // with a module-not-found error that reads like a Natively bug.
  const entryPath = path.join(sourceDir, entrypoint);
  if (!path.resolve(entryPath).startsWith(path.resolve(sourceDir) + path.sep)) {
    return { ok: false, errors: [`entrypoint ${JSON.stringify(entrypoint)} escapes the extension directory`] };
  }
  if (!fileExists(entryPath)) {
    return {
      ok: false,
      errors: [`entrypoint ${JSON.stringify(entrypoint)} does not exist — build the extension before installing it`],
    };
  }

  const survey = surveyTree(sourceDir);
  if (survey.symlinks.length > 0) {
    // A symlink in the payload can point anywhere. Copying it would put a
    // reference to a file outside the extension directory inside a directory
    // the broker treats as the extension's own.
    return {
      ok: false,
      errors: [`payload contains ${survey.symlinks.length} symlink(s), which are not copied: ${survey.symlinks.slice(0, 3).join(', ')}`],
    };
  }
  if (survey.files > MAX_PAYLOAD_FILES) {
    return { ok: false, errors: [`payload has ${survey.files} files, over the ${MAX_PAYLOAD_FILES} limit`] };
  }
  if (survey.bytes > MAX_PAYLOAD_BYTES) {
    return { ok: false, errors: [`payload is ${Math.round(survey.bytes / 1e6)}MB, over the ${MAX_PAYLOAD_BYTES / 1e6}MB limit`] };
  }
  if (survey.skipped.length > 0) {
    warnings.push(`not copied: ${survey.skipped.join(', ')}`);
  }
  if (survey.nativeAddons.length > 0) {
    // A prebuilt .node is compiled against ONE ABI. The extension host is an
    // Electron utilityProcess, so an addon built for plain Node fails at init
    // with ERR_DLOPEN_FAILED and a NODE_MODULE_VERSION mismatch — which reads
    // as a Natively crash rather than as an extension that needs rebuilding.
    // Nothing here can fix that, so say it plainly instead of discovering it
    // at load time.
    warnings.push(
      `contains ${survey.nativeAddons.length} native addon(s) (${survey.nativeAddons.slice(0, 2).join(', ')}). ` +
      'These must be built for Electron\'s ABI, not plain Node, or the extension will fail to start.',
    );
  }

  const destination = extensionDir(id, opts.rootOverride);
  try {
    // A reinstall replaces the payload wholesale. Merging would leave files from
    // a previous version behind, and a stale module beside a new entrypoint is a
    // very confusing failure.
    fs.rmSync(destination, { recursive: true, force: true });
    copyTree(sourceDir, destination);
  } catch (e) {
    return { ok: false, errors: [`could not stage payload: ${errText(e)}`] };
  }

  return { ok: true, payloadDir: destination, manifestJson, errors, warnings };
}

/**
 * Fetch the community registry. METADATA ONLY — ids, repositories, versions and
 * licence identifiers. No code and no weights cross this boundary.
 *
 * Never throws: an unreachable registry is an empty list, which the UI renders
 * as "could not check", not an error every caller has to handle.
 */
export async function fetchRemoteRegistry(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ entries: RegistryEntry[]; ok: boolean }> {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { entries: [], ok: false };
    const json: any = await res.json();
    const rows: any[] = Array.isArray(json?.extensions) ? json.extensions : [];
    const entries = rows
      .filter((r) => typeof r?.id === 'string' && typeof r?.repo === 'string')
      .map((r) => ({
        id: String(r.id),
        repo: String(r.repo),
        latestVersion: String(r.latestVersion ?? ''),
        apiVersion: String(r.apiVersion ?? ''),
        category: String(r.category ?? ''),
        modelLicenses: Array.isArray(r.modelLicenses) ? r.modelLicenses.map(String) : undefined,
      }));
    return { entries, ok: true };
  } catch {
    return { entries: [], ok: false };
  }
}

// ---------------------------------------------------------------------------

interface Survey { files: number; bytes: number; symlinks: string[]; skipped: string[]; nativeAddons: string[] }

function surveyTree(root: string): Survey {
  const out: Survey = { files: 0, bytes: 0, symlinks: [], skipped: [], nativeAddons: [] };

  const walk = (dir: string, rel: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) { out.symlinks.push(childRel); continue; }
      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name)) { out.skipped.push(childRel); continue; }
        walk(path.join(dir, entry.name), childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.endsWith('.node')) out.nativeAddons.push(childRel);
      out.files += 1;
      try { out.bytes += fs.statSync(path.join(dir, entry.name)).size; } catch { /* counted as 0 */ }
    }
  };

  walk(root, '');
  return out;
}

/**
 * Recursive copy that skips symlinks and the directories above.
 *
 * Hand-rolled rather than `fs.cpSync`, because the behaviour that matters is
 * REFUSING a symlink rather than choosing between copying the link and
 * following it, and because the skip list has to apply mid-walk.
 */
function copyTree(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      copyTree(src, dst);
    } else if (entry.isFile()) {
      fs.copyFileSync(src, dst);
    }
  }
}

function fileExists(p: string): boolean {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
