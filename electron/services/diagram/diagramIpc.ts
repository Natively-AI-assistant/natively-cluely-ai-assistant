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
import { safeDiagramFileStem, diagramExportBytes, DIAGRAM_EXPORT_FILTERS } from './diagramExport';
import { isSystemDesignDiagramsEnabled } from '../../llm/diagramPromptSignals';
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
  let candidate = path.join(dir, `${stem}.${ext}`);
  for (let n = 2; n < 500 && fs.existsSync(candidate); n += 1) {
    candidate = path.join(dir, `${stem} (${n}).${ext}`);
  }
  return candidate;
}

let phoneBroker: PhoneDiagramBroker | null = null;

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
    const allowed = budget.take(source, { manual: p.manual === true });
    if (!allowed.allowed) return { ok: false, reason: allowed.reason };

    const controller = new AbortController();
    inFlight.set(key, { controller, senderId: event.sender.id });
    const timer = setTimeout(() => controller.abort(), REPAIR_TIMEOUT_MS);
    try {
      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      if (!llmHelper) return { ok: false, reason: 'unavailable' };
      // The user's currently selected provider and model: the same route that
      // wrote the diagram. No mode prompt, no knowledge injection, no
      // transcript, no screenshot — the diagram and the parser message only.
      const stream = llmHelper.streamChat(request.user, undefined, undefined, request.system, true, true, [], controller.signal);
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
    const format = p.format === 'svg' || p.format === 'png' || p.format === 'mmd' ? p.format : null;
    const bytes = format ? diagramExportBytes(format, p.data) : null;
    if (!format || !bytes) return { saved: false, error: 'invalid' };
    const stem = safeDiagramFileStem(p.name);
    try {
      const downloads = app.getPath('downloads');
      let target: string;
      if (nativePromptsBlocked(() => appState.getUndetectable())) {
        // A save dialog is its own OS window and would show in a screen share
        // (see stealthPromptGate). In Undetectable mode the file goes straight
        // to Downloads under a name that does not overwrite anything.
        target = uniquePath(downloads, stem, format);
      } else {
        const result = await dialog.showSaveDialog({
          title: 'Save diagram',
          defaultPath: path.join(downloads, `${stem}.${format}`),
          filters: [DIAGRAM_EXPORT_FILTERS[format]],
        });
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
      pickTarget: () => {
        const win = windows()[0];
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
