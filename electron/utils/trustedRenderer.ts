import { app } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

export interface TrustedRendererConfig {
  appPath: string;
  isPackaged: boolean;
  devPort?: number;
}

function defaultConfig(): TrustedRendererConfig {
  return {
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    devPort: 5180,
  };
}

export function isTrustedRendererUrl(
  rawUrl: string | null | undefined,
  config: TrustedRendererConfig = defaultConfig(),
): boolean {
  if (!rawUrl) return false;

  try {
    const parsed = new URL(rawUrl);
    if (!config.isPackaged) {
      return parsed.protocol === 'http:' &&
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
        Number(parsed.port || 80) === (config.devPort || 5180);
    }

    if (parsed.protocol !== 'file:') return false;
    const expectedPath = path.resolve(config.appPath, 'dist', 'index.html');
    return path.resolve(fileURLToPath(parsed)) === expectedPath;
  } catch {
    return false;
  }
}

export function isTrustedIpcSender(event: any, config?: TrustedRendererConfig): boolean {
  const senderUrl = event?.senderFrame?.url || event?.sender?.getURL?.();
  return isTrustedRendererUrl(senderUrl, config);
}

export function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(rawUrl).protocol);
  } catch {
    return false;
  }
}
