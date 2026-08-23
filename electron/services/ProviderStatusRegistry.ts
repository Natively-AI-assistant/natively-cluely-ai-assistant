import { BrowserWindow } from 'electron';
import { cloneProviderStatus, type ProviderStatus } from './providerStatus';

type Broadcaster = (channel: string, payload: unknown) => void;

export class ProviderStatusRegistry {
  private static instance: ProviderStatusRegistry;
  private statuses = new Map<string, ProviderStatus>();
  private broadcaster: Broadcaster | null = null;

  private constructor() {}

  static getInstance(): ProviderStatusRegistry {
    // Instance anchored on globalThis (25 dist bundles). Writers live in the
    // OllamaManager/embedding/intent-classifier bundles; the pull-reader is
    // ipcHandlers' provider-status:getAll — per-bundle instances meant a
    // window created after a status change hydrated EMPTY and stayed wrong
    // until the next push.
    const g = globalThis as unknown as Record<string, ProviderStatusRegistry | undefined>;
    if (!g.__nativelyProviderStatusRegistryV1__) {
      g.__nativelyProviderStatusRegistryV1__ = ProviderStatusRegistry.instance ?? new ProviderStatusRegistry();
    }
    ProviderStatusRegistry.instance = g.__nativelyProviderStatusRegistryV1__;
    return g.__nativelyProviderStatusRegistryV1__;
  }

  setBroadcaster(broadcaster: Broadcaster | null): void {
    this.broadcaster = broadcaster;
  }

  setStatus(status: ProviderStatus): ProviderStatus {
    const next: ProviderStatus = {
      ...status,
      updatedAt: status.updatedAt || new Date().toISOString(),
      details: status.details ? { ...status.details } : undefined,
    };
    const prev = this.statuses.get(next.id);
    this.statuses.set(next.id, next);

    if (!prev || prev.health !== next.health || prev.message !== next.message) {
      console.log('[ProviderStatus]', next.id, next.health, next.message);
    }

    this.emit(next);
    return cloneProviderStatus(next);
  }

  getStatus(id: string): ProviderStatus | null {
    const status = this.statuses.get(id);
    return status ? cloneProviderStatus(status) : null;
  }

  getAll(): ProviderStatus[] {
    return [...this.statuses.values()].map(cloneProviderStatus);
  }

  clearForTests(): void {
    this.statuses.clear();
    this.broadcaster = null;
  }

  private emit(status: ProviderStatus): void {
    const payload = cloneProviderStatus(status);
    try {
      this.broadcaster?.('provider-status-changed', payload);
    } catch (err: any) {
      console.warn('[ProviderStatus] broadcast failed:', err?.message || err);
    }

    try {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('provider-status-changed', payload);
      }
    } catch {
      // Tests and early startup may not have a usable BrowserWindow binding yet.
    }
  }
}

export function providerStatusRegistry(): ProviderStatusRegistry {
  return ProviderStatusRegistry.getInstance();
}
