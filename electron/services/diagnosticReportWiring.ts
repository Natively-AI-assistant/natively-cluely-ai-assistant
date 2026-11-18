/**
 * The one place the diagnostic report meets the running app (2026-11-18, #759):
 * the log file, the install identity, the last connection check, the network.
 * The decisions are in diagnosticReport.ts. Nothing here runs unless the person
 * clicks (src/components/settings/DiagnosticReportActions.tsx → IPC).
 *
 * No platform branches: the log path comes from resolveDebugLogPath (Documents
 * on both OSes), the identity from the same install token the transcript upload
 * uses, and the read is bounded.
 */
import { app } from 'electron';
import fs from 'node:fs';
import { nativelyApiBase } from './nativelyApiBase';
import { buildDiagnosticReport, sendDiagnosticReport, createReportSession, type SendOutcome } from './diagnosticReport';
import { getLastDiagnosis } from './connectivityWiring';
import { connectivityState } from './connectivityState';
import { getLogRedactionLevel } from '../utils/redactForLog';
import { maskCredentials } from '../rag/providers/probeError';
import { funnelTelemetry } from './FunnelTelemetry';
import { resolveDebugLogPath } from '../utils/debugLogPath.mjs';

/** The end of the log only: a log can be tens of megabytes and the report keeps 400 lines. */
const READ_BYTES = 256 * 1024;

function readLogTail(): string {
  try {
    const file = resolveDebugLogPath({
      isPackaged: app.isPackaged,
      agentUserData: process.env.NATIVELY_AGENT_USER_DATA,
      documentsDir: () => app.getPath('documents'),
    });
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const start = Math.max(0, size - READ_BYTES);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const text = buf.toString('utf8');
      // Starting mid-file: drop the first, probably partial, line.
      return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

// Read once per process, as FunnelTelemetry does: getOrCreateInstallId hands back a
// fresh id on every call when the id file cannot be written, and the token is
// registered for one id.
let cachedInstallId: string | undefined;
function installId(): string {
  if (cachedInstallId === undefined) {
    try { cachedInstallId = require('./InstallPingManager').getOrCreateInstallId() || ''; } catch { cachedInstallId = ''; }
  }
  return cachedInstallId as string;
}

export function buildCurrentDiagnosticReport() {
  return buildDiagnosticReport({
    logText: readLogTail(),
    installId: installId(),
    appVersion: app.getVersion(),
    platform: process.platform,
    diagnosis: getLastDiagnosis(),
    mask: maskCredentials,
    // Detailed logging keeps meeting text in the log: leave the log out rather than upload it.
    omitLog: getLogRedactionLevel() === 'full',
  });
}

/**
 * One session shared by every bundle (esbuild inlines this module into each
 * entry point): the preview a person read is the report a later click sends.
 */
const SESSION_KEY = '__nativelyDiagReportSessionV1__';
function reportSession() {
  const g = globalThis as unknown as Record<string, ReturnType<typeof createReportSession<ReturnType<typeof buildCurrentDiagnosticReport>>> | undefined>;
  return (g[SESSION_KEY] ??= createReportSession({
    build: buildCurrentDiagnosticReport,
    send: async (payload): Promise<SendOutcome> => {
      if (!payload.install_id) return { ok: false, error: 'rejected' };
      return sendDiagnosticReport({
        payload,
        endpoint: `${nativelyApiBase()}/v1/diagnostics/report`,
        // The install token first: a revoked or mistyped key must not stop someone reporting exactly that.
        headers: async () => {
          const token = await funnelTelemetry.installToken(payload.install_id);
          return { 'x-install-id': payload.install_id, ...(token ? { 'x-install-token': token } : {}) };
        },
      });
    },
  }));
}

export function previewCurrentDiagnosticReport(): Promise<{ preview: string }> {
  return reportSession().preview();
}

export async function sendCurrentDiagnosticReport(): Promise<SendOutcome> {
  try {
    return await reportSession().send();
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** The last finding shown to the person, for a Settings panel opened after it was sent. */
export function lastConnectionNotice() {
  return connectivityState().lastNotice ?? null;
}
