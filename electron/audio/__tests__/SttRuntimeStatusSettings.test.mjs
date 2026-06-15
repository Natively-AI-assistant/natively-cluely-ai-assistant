import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

describe('STT runtime status settings wiring', () => {
  const ipcHandlers = read('electron/ipcHandlers.ts');
  const main = read('electron/main.ts');
  const preload = read('electron/preload.ts');
  const electronTypes = read('src/types/electron.d.ts');
  const settings = read('src/components/SettingsOverlay.tsx');

  it('main process stores the latest STT status per channel for settings polling', () => {
    assert.match(main, /_lastSttStatusByChannel/);
    assert.match(main, /getSttStatusSnapshot\(\)/);
    assert.match(main, /this\._lastSttStatusByChannel\[channel\]\s*=\s*payload/);
  });

  it('exposes a runtime status IPC that checks GigaSTT health, readiness, and pool exhaustion', () => {
    assert.match(ipcHandlers, /import \{ ensureManagedGigaSTTServer, getGigaSTTBinaryStatus \}/);
    assert.match(ipcHandlers, /safeHandle\('stt-runtime-status'/);
    assert.match(ipcHandlers, /checkGigaSTTRuntime/);
    assert.match(ipcHandlers, /await ensureManagedGigaSTTServer\(\)/);
    assert.match(ipcHandlers, /\/health/);
    assert.match(ipcHandlers, /\/ready/);
    assert.match(ipcHandlers, /pool_exhausted/);
    assert.match(ipcHandlers, /pool_available/);
    assert.match(ipcHandlers, /natively-gigastt\.log/);
  });

  it('marks old GigaSTT binaries as outdated instead of reporting ready', () => {
    assert.match(ipcHandlers, /getGigaSTTBinaryStatus\(\)/);
    assert.match(ipcHandlers, /'outdated'/);
    assert.match(ipcHandlers, /binary\.meetsMinimum/);
    assert.match(ipcHandlers, /Update required/);
    assert.match(ipcHandlers, /stable Russian STT/);
  });

  it('reports Local Whisper model cache status through the same runtime IPC', () => {
    assert.match(ipcHandlers, /provider === 'local-whisper'/);
    assert.match(ipcHandlers, /getAvailableModels/);
    assert.match(ipcHandlers, /modelStatus/);
  });

  it('preload and renderer types expose getSttRuntimeStatus', () => {
    assert.match(preload, /getSttRuntimeStatus:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('stt-runtime-status'\)/);
    assert.match(electronTypes, /getSttRuntimeStatus:\s*\(\)\s*=>\s*Promise/);
  });

  it('SettingsOverlay polls runtime status and merges live stt-status events', () => {
    assert.match(settings, /Runtime status/);
    assert.match(settings, /getSttRuntimeStatus/);
    assert.match(settings, /setInterval\(refreshSttRuntimeStatus,\s*3500\)/);
    assert.match(settings, /onSttStatusChanged/);
    assert.match(settings, /runtimeHealth\?\.server\?\.poolAvailable/);
  });
});
