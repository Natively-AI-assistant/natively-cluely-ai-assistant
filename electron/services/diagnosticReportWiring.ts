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
import { buildDiagnosticReport, sendDiagnosticReport, type SendOutcome } from './diagnosticReport';
import { getLastDiagnosis } from './connectivityWiring';
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

function installId(): string {
  try { return require('./InstallPingManager').getOrCreateInstallId() || ''; } catch { return ''; }
}

export function buildCurrentDiagnosticReport() {
  return buildDiagnosticReport({
    logText: readLogTail(),
    installId: installId(),
    appVersion: app.getVersion(),
    platform: process.platform,
    diagnosis: getLastDiagnosis(),
    mask: maskCredentials,
  });
}

export async function sendCurrentDiagnosticReport(): Promise<SendOutcome> {
  try {
    const { payload } = buildCurrentDiagnosticReport();
    if (!payload.install_id) return { ok: false, error: 'rejected' };
    return await sendDiagnosticReport({
      payload,
      endpoint: `${nativelyApiBase()}/v1/diagnostics/report`,
      // The install token first: a revoked or mistyped key must not stop someone reporting exactly that.
      headers: async () => {
        const token = await funnelTelemetry.installToken(payload.install_id);
        return { 'x-install-id': payload.install_id, ...(token ? { 'x-install-token': token } : {}) };
      },
    });
  } catch {
    return { ok: false, error: 'network' };
  }
}
