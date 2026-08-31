/**
 * Constructs the extension subsystem for the running app, and tears it down.
 *
 * Until this file existed nothing built an `ExtensionManager`, so no extension
 * could run in a shipped build no matter what the registry on disk said. Every
 * piece below already existed; this connects them and hands the result to the
 * rerank seam.
 *
 * Two guarantees this wiring must not lose:
 *
 *  - **Nothing ships enabled.** `install()` records `enabled: false`
 *    unconditionally, and `loadEnabled()` starts only what the user switched on.
 *  - **Both gates still apply at the seam.** The `extensionRerankers` flag AND
 *    exactly one enabled reranker extension. Wiring the source in does not flip
 *    the flag, which is what keeps this safe to ship.
 */

import { app, dialog, BrowserWindow } from 'electron';
import { ExtensionManager, type InstallPrompt } from './ExtensionManager';
import { getExtensionRegistry } from './ExtensionRegistry';
import { ModelStore } from './ModelStore';
import { HuggingFaceModelDownloader } from './HuggingFaceModelDownloader';
import { processSingleton, resetProcessSingleton } from './singleton';

const SINGLETON_KEY = 'ExtensionManagerApp';

function humanBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.round(bytes / 1e3)} KB`;
}

/**
 * The trust prompt. It lists every requested permission in words, because the
 * sandbox is not a boundary against a hostile extension and this dialog is what
 * actually stands between the user and code they did not write.
 *
 * A confirmer that throws is treated as a refusal by the manager, so a broken
 * dialog can never read as consent.
 */
export function buildInstallPromptText(prompt: InstallPrompt): { message: string; detail: string } {
  const lines: string[] = [];

  lines.push(`${prompt.name} ${prompt.version} — by ${prompt.author}`);
  lines.push(prompt.homepage);
  lines.push('');
  lines.push('This is a community extension. It is not part of Natively and is not reviewed by Natively.');
  lines.push('');

  if (prompt.permissions.length > 0) {
    lines.push('It is asking for:');
    for (const p of prompt.permissions) {
      lines.push(`  • ${describePermission(p)}`);
    }
    lines.push('');
  }

  if (prompt.highRiskPermissions.length > 0) {
    lines.push('Some of these give it reach beyond Natively:');
    for (const p of prompt.highRiskPermissions) lines.push(`  • ${p}`);
    lines.push('');
  }

  if (prompt.models.length > 0) {
    lines.push('It can download these models. Nothing downloads until you ask:');
    for (const m of prompt.models) {
      const flags = [
        m.spdx,
        humanBytes(m.approxBytes),
        m.commercialUseRestricted ? 'NON-COMMERCIAL USE ONLY' : null,
        m.requiresAcknowledgement ? 'licence acknowledgement required' : null,
      ].filter(Boolean).join(' · ');
      lines.push(`  • ${m.key} — ${flags}`);
    }
  }

  return {
    message: `Install ${prompt.name}?`,
    detail: lines.join('\n'),
  };
}

function describePermission(permission: string): string {
  switch (permission) {
    case 'filesystem.models': return 'Read and write inside its own model folder';
    case 'filesystem.workspace': return 'Read a folder you choose, for that session only';
    case 'network.localhost': return 'Connect to programs running on this computer';
    case 'network.remote': return 'Connect to the internet hosts listed in its manifest';
    case 'process.spawn': return 'Run the programs listed in its manifest';
    default: return permission;
  }
}

export interface WireExtensionsOptions {
  /** Injected by tests. Production uses Electron's dialog. */
  confirmInstall?: (prompt: InstallPrompt) => Promise<boolean>;
  rootOverride?: string;
  appVersion?: string;
}

/**
 * Build the manager and register it as the rerank seam's extension source.
 * Idempotent: repeated calls return the same instance, because esbuild gives
 * every electron TS file its own bundle and a per-module singleton would not be
 * one (see singleton.ts).
 */
export function wireExtensions(options: WireExtensionsOptions = {}): ExtensionManager {
  return processSingleton(SINGLETON_KEY, () => {
    const appVersion = options.appVersion ?? safeAppVersion();
    const registry = getExtensionRegistry(appVersion);

    // The licence gate lives in ModelStore and is written once. Injecting the
    // downloader here cannot bypass it: download() checks isLoadAllowed() before
    // it ever reaches the downloader.
    const modelStore = new ModelStore({
      downloader: new HuggingFaceModelDownloader({ logger: console }),
      rootOverride: options.rootOverride,
    });

    const manager = new ExtensionManager({
      registry,
      modelStore,
      appVersion,
      rootOverride: options.rootOverride,
      confirmInstall: options.confirmInstall ?? defaultConfirmInstall,
      logger: consoleExtensionLogger(),
    });

    // Hand the seam its source. This does NOT enable anything: the
    // `extensionRerankers` flag is still off by default, and the registry still
    // requires exactly one enabled reranker extension.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getRerankerRegistry, RerankerRegistry, setRerankerRegistry } =
        require('../reranking/RerankerRegistry') as typeof import('../reranking/RerankerRegistry');
      const current = getRerankerRegistry() as any;
      setRerankerRegistry(new RerankerRegistry({
        ...current.options,
        source: {
          list: () => manager.list().map((r) => ({ id: r.id, enabled: r.enabled, manifest: { type: r.manifest.type } })),
          running: () => manager.running(),
          load: (id) => manager.load(id),
          rerank: (id, query, candidates, topK, signal) => manager.rerank(id, query, candidates, topK, signal),
        },
      }));
    } catch (e) {
      // A seam that cannot be wired leaves the built-in reranker in place, which
      // is the correct degradation. It must never stop the app from starting.
      console.warn('[extensions] could not attach the rerank seam:', e);
    }

    return manager;
  });
}

/** Start every extension the user has enabled. Failures are isolated per extension. */
export async function startExtensions(manager: ExtensionManager): Promise<void> {
  try {
    await manager.loadEnabled();
  } catch (e) {
    console.warn('[extensions] loadEnabled failed:', e);
  }
}

/**
 * Stop every running extension. Called on quit.
 *
 * Without this, a utilityProcess outlives the window that owned it and the app
 * appears to hang on quit — the failure mode is a process that never exits, not
 * an error anyone sees.
 */
export async function disposeExtensions(): Promise<void> {
  try {
    const manager = processSingleton<ExtensionManager | null>(SINGLETON_KEY, () => null);
    if (manager) await manager.unloadAll();
  } catch (e) {
    console.warn('[extensions] teardown failed:', e);
  } finally {
    resetProcessSingleton(SINGLETON_KEY);
  }
}

/** The wired manager, or null when wireExtensions() has not run. */
export function getExtensionManager(): ExtensionManager | null {
  try {
    return processSingleton<ExtensionManager | null>(SINGLETON_KEY, () => null);
  } catch {
    return null;
  }
}

async function defaultConfirmInstall(prompt: InstallPrompt): Promise<boolean> {
  const { message, detail } = buildInstallPromptText(prompt);
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const opts: Electron.MessageBoxOptions = {
    type: 'warning',
    // "Install" is deliberately NOT the default button. A default that installs
    // turns a stray Return keypress into consent.
    buttons: ['Cancel', 'Install'],
    defaultId: 0,
    cancelId: 0,
    message,
    detail,
    noLink: true,
  };
  const result = parent
    ? await dialog.showMessageBox(parent, opts)
    : await dialog.showMessageBox(opts);
  return result.response === 1;
}

function safeAppVersion(): string {
  try { return app.getVersion(); } catch { return '0.0.0'; }
}

function consoleExtensionLogger() {
  return {
    debug: (msg: string, ...args: unknown[]) => console.debug('[extensions]', msg, ...args),
    info: (msg: string, ...args: unknown[]) => console.log('[extensions]', msg, ...args),
    warn: (msg: string, ...args: unknown[]) => console.warn('[extensions]', msg, ...args),
    error: (msg: string, ...args: unknown[]) => console.error('[extensions]', msg, ...args),
  };
}
