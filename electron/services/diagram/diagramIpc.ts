// IPC for system-design diagram artifacts.
//
// The renderer owns drawing (Mermaid needs a DOM). The main process owns what
// a renderer must not: a paid model call, a file on disk, the feature switch,
// and what reaches the phone. Every handler here takes bounded, validated
// input from a known app window and nothing else.
//
//   diagram:get-enabled        the feature switch (also pushed on change)
//   diagram:repair             ONE bounded model call to fix a block that did
//                              not parse; budgeted, abortable, sender-scoped
//   diagram:repair-cancel      stop it (card unmounted, user pressed Stop)
//   diagram:repair-accepted    the renderer validated the repaired block;
//                              record it where the broken one was recorded
//   diagram:export             save an SVG / PNG / .mmd the renderer produced
//   diagram:render-result      an app window's answer to a phone render request

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { AppState } from '../../main';
import {
  buildDiagramRepairRequest,
  extractRepairedDiagram,
  createRepairBudget,
  DIAGRAM_REPAIR_LIMITS,
} from '../../../src/lib/diagram/diagramRepair.mjs';
import { checkDiagramSource, DIAGRAM_LIMITS } from '../../../src/lib/diagram/diagramPolicy.mjs';
import { safeDiagramFileStem, uniqueDiagramFileName, diagramExportBytes, DIAGRAM_EXPORT_FILTERS, isDiagramExportFormat, saveDialogPlacement } from './diagramExport';
import { isSystemDesignDiagramsEnabled, activeDesignShareable } from '../../llm/diagramPromptSignals';
import { nativePromptsBlocked } from '../stealthPromptGate';
import { PhoneMirrorService } from '../PhoneMirrorService';
import { setPhoneDiagramProvider } from '../phoneMirrorMarkdown';
import { PhoneDiagramBroker } from './PhoneDiagramBroker';

type SafeHandle = (channel: string, listener: (event: any, ...args: any[]) => Promise<any> | any) => void;

const REPAIR_TIMEOUT_MS = 20_000;
const REPAIR_OUTPUT_MAX_CHARS = 12_000;

export const DIAGRAM_ENABLED_CHANGED_CHANNEL = 'diagram:enabled-changed';

/** Tell every window the switch moved, so open diagrams and settings agree. */
export function broadcastDiagramsEnabled(): void {
  const enabled = isSystemDesignDiagramsEnabled();
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) win.webContents.send(DIAGRAM_ENABLED_CHANGED_CHANNEL, enabled);
    } catch { /* a closing window */ }
  }
}

/** A path in `dir` that does not exist yet: "name.ext", then "name (2).ext", … */
function uniquePath(dir: string, stem: string, ext: string): string {
  return path.join(dir, uniqueDiagramFileName(stem, ext, (name) => fs.existsSync(path.join(dir, name))));
}

let phoneBroker: PhoneDiagramBroker | null = null;

/** Repair calls that may run at the same time, across both windows. */
const MAX_CONCURRENT_REPAIRS = 3;

export function registerDiagramIpc(appState: AppState, safeHandle: SafeHandle): void {
  const windows = () => {
    const helper = appState.getWindowHelper();
    return [helper.getLauncherWindow(), helper.getOverlayWindow()].filter(
      (w): w is BrowserWindow => Boolean(w) && !(w as BrowserWindow).isDestroyed(),
    );
  };
  /** Only the launcher and the overlay draw diagrams; nothing else may call these. */
  const fromAppWindow = (event: any): boolean => windows().some((w) => w.webContents === event?.sender);

  safeHandle('diagram:get-enabled', async () => isSystemDesignDiagramsEnabled());

  // ── Repair ────────────────────────────────────────────────────────────────
  const budget = createRepairBudget();
  const inFlight = new Map<string, { controller: AbortController; senderId: number }>();

  safeHandle('diagram:repair', async (event, payload: unknown) => {
    if (!fromAppWindow(event)) return { ok: false, reason: 'forbidden' };
    if (!isSystemDesignDiagramsEnabled()) return { ok: false, reason: 'disabled' };
    const p = (payload ?? {}) as { requestId?: unknown; source?: unknown; diagnostic?: unknown; stage?: unknown; manual?: unknown };
    const requestId = typeof p.requestId === 'string' ? p.requestId.slice(0, 80) : '';
    const source = typeof p.source === 'string' ? p.source : '';
    if (!requestId || !source || source.length > DIAGRAM_REPAIR_LIMITS.maxSourceChars) return { ok: false, reason: 'invalid' };
    const request = buildDiagramRepairRequest({
      source,
      diagnostic: typeof p.diagnostic === 'string' ? p.diagnostic : '',
      stage: typeof p.stage === 'string' ? p.stage : undefined,
    });
    if (!request) return { ok: false, reason: 'not_repairable' };
    const key = `${event.sender.id}:${requestId}`;
    if (inFlight.has(key)) return { ok: false, reason: 'in_flight' };
    // The request id is the page's to choose, so it cannot be what bounds how
    // many model calls run at once.
    if (inFlight.size >= MAX_CONCURRENT_REPAIRS) return { ok: false, reason: 'rate_limited' };
    const allowed = budget.take(source, { manual: p.manual === true });
    if (!allowed.allowed) return { ok: false, reason: allowed.reason };

    const controller = new AbortController();
    inFlight.set(key, { controller, senderId: event.sender.id });
    const timer = setTimeout(() => controller.abort(), REPAIR_TIMEOUT_MS);
    try {
      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      if (!llmHelper) return { ok: false, reason: 'unavailable' };
      // A diagram is something the assistant wrote about the conversation:
      // transcript-scope data, like the design handed back on a follow-up
      // (activeDesignShareable). With that scope withheld it goes to a model on
      // this device or to none.
      if (!activeDesignShareable() && (llmHelper as any).isUsingOllama?.() !== true) return { ok: false, reason: 'unavailable' };
      // The user's currently selected provider and model: the same route that
      // wrote the diagram. No mode prompt, no knowledge injection, no
      // transcript, no screenshot — the diagram and the parser message only.
      const stream = llmHelper.streamChat(request.user, undefined, undefined, request.system, true, true, ['transcript'], controller.signal);
      let out = '';
      for await (const chunk of stream) {
        out += chunk;
        if (out.length > REPAIR_OUTPUT_MAX_CHARS) {
          controller.abort();
          break;
        }
      }
      if (controller.signal.aborted && out.length <= REPAIR_OUTPUT_MAX_CHARS) return { ok: false, reason: 'cancelled' };
      const repaired = extractRepairedDiagram(out, source);
      return repaired.ok ? { ok: true, source: repaired.source } : { ok: false, reason: repaired.reason };
    } catch (err: any) {
      if (controller.signal.aborted) return { ok: false, reason: 'cancelled' };
      console.warn('[Diagram] repair failed:', err?.message || err);
      return { ok: false, reason: 'provider_error' };
    } finally {
      clearTimeout(timer);
      inFlight.delete(key);
    }
  });

  safeHandle('diagram:repair-cancel', async (event, requestId: unknown) => {
    if (!fromAppWindow(event) || typeof requestId !== 'string') return false;
    const entry = inFlight.get(`${event.sender.id}:${requestId.slice(0, 80)}`);
    if (!entry) return false;
    entry.controller.abort();
    return true;
  });

  safeHandle('diagram:repair-accepted', async (event, payload: unknown) => {
    if (!fromAppWindow(event)) return false;
    const p = (payload ?? {}) as { originalSource?: unknown; repairedSource?: unknown };
    if (typeof p.originalSource !== 'string' || typeof p.repairedSource !== 'string') return false;
    if (p.originalSource.length > DIAGRAM_LIMITS.maxSourceChars || p.repairedSource.length > DIAGRAM_LIMITS.maxSourceChars) return false;
    // The renderer says it drew; the main process still only stores a block
    // that passes policy, and only in place of the exact broken source.
    if (!checkDiagramSource(p.repairedSource).ok) return false;
    try {
      return appState.getIntelligenceManager?.()?.applyDiagramRepair?.(p.originalSource, p.repairedSource) === true;
    } catch {
      return false;
    }
  });

  // ── Export ────────────────────────────────────────────────────────────────
  safeHandle('diagram:export', async (event, payload: unknown) => {
    if (!fromAppWindow(event)) return { saved: false, error: 'forbidden' };
    const p = (payload ?? {}) as { format?: unknown; data?: unknown; name?: unknown };
    const format = isDiagramExportFormat(p.format) ? p.format : null;
    const bytes = format ? diagramExportBytes(format, p.data) : null;
    if (!format || !bytes) return { saved: false, error: 'invalid' };
    const stem = safeDiagramFileStem(p.name);
    try {
      const downloads = app.getPath('downloads');
      let target: string;
      if (nativePromptsBlocked(() => appState.getUndetectable())) {
        // A save dialog is its own OS window and would show in a screen share
        // (see stealthPromptGate). In Undetectable mode the file goes straight
        // to Downloads under a name that does not overwrite anything: opened
        // exclusively ('wx'), so a file that appeared since the name was chosen
        // is not replaced — the next free name is tried instead.
        for (let attempt = 0; ; attempt += 1) {
          target = uniquePath(downloads, stem, format);
          try {
            await fs.promises.writeFile(target, bytes, { flag: 'wx' });
            break;
          } catch (err: any) {
            if (err?.code !== 'EEXIST' || attempt >= 4) throw err;
          }
        }
        return { saved: true, fileName: path.basename(target), silent: true };
      } else {
        const options = {
          title: 'Save diagram',
          defaultPath: path.join(downloads, `${stem}.${format}`),
          filters: [DIAGRAM_EXPORT_FILTERS[format]],
        };
        // The overlay never takes focus, so a dialog opened plainly from it
        // opens behind whatever the user has in front (see saveDialogPlacement).
        const placement = saveDialogPlacement(process.platform);
        let owner: BrowserWindow | null = null;
        if (placement === 'own-by-sender') {
          try {
            const win = BrowserWindow.fromWebContents(event.sender);
            owner = win && !win.isDestroyed() ? win : null;
          } catch { owner = null; }
        } else if (placement === 'activate-app') {
          try { app.focus({ steal: true }); } catch { /* the dialog still opens */ }
        }
        const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
        if (result.canceled || !result.filePath) return { saved: false, canceled: true };
        target = path.extname(result.filePath) ? result.filePath : `${result.filePath}.${format}`;
      }
      await fs.promises.writeFile(target, bytes);
      return { saved: true, fileName: path.basename(target), silent: nativePromptsBlocked(() => appState.getUndetectable()) };
    } catch (err: any) {
      console.warn('[Diagram] export failed:', err?.message || err);
      return { saved: false, error: 'write_failed' };
    }
  });

  // ── Phone Mirror ──────────────────────────────────────────────────────────
  if (!phoneBroker) {
    phoneBroker = new PhoneDiagramBroker({
      pickTarget: (tried = []) => {
        const win = windows().find((w) => !tried.includes(w.webContents.id));
        if (!win) return null;
        const wc = win.webContents;
        return { id: wc.id, send: (channel, data) => wc.send(channel, data) };
      },
      onSettled: (key, dataUrl) => {
        try { PhoneMirrorService.getInstance().publishDiagram(key, dataUrl); } catch { /* phone only */ }
      },
    });
  }
  const broker = phoneBroker;
  setPhoneDiagramProvider({
    enabled: () => isSystemDesignDiagramsEnabled(),
    lookup: (key) => broker.lookup(key),
    failed: (key) => broker.failed(key),
    request: (key, source) => {
      // Nothing is drawn for a phone that is not being served.
      try {
        if (!PhoneMirrorService.getInstance().isRunning()) return;
      } catch { return; }
      broker.request(key, source);
    },
  });
  ipcMain.removeAllListeners('diagram:render-result');
  ipcMain.on('diagram:render-result', (event, payload: unknown) => {
    if (!fromAppWindow(event)) return;
    broker.receive(event.sender.id, payload);
  });
}
