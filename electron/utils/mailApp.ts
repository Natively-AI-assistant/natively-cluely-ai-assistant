// The computer's own mail app, for the follow-up sheet's send menu: the default
// handler of mailto:, by its name and with its icon, so the menu can say "Mail"
// or "Outlook" rather than "your mail app". Electron reads it from Launch
// Services on macOS and from the mailto association on Windows. Natively ships
// on those two only, so any other platform reports none and the menu keeps its
// generic "Mail app" row.

export interface MailAppInfo {
  name: string;
  /** A 32px PNG data URL of the app's icon, when the system has one. */
  icon?: string;
}

/** What defaultMailApp reads: Electron's `app`, or a stand-in in tests. */
export interface MailProtocolSource {
  getApplicationInfoForProtocol(url: string): Promise<{
    name: string;
    icon?: { isEmpty(): boolean; resize(size: { width: number; height: number }): { toDataURL(): string } };
  }>;
  getApplicationNameForProtocol(url: string): string;
}

// Both methods want a whole URL, "://" at least.
const MAILTO = 'mailto://';

/** The app's display name without a bundle or executable suffix ("Mail.app", "OUTLOOK.EXE"). */
export function mailAppName(raw: string | undefined | null): string {
  return String(raw ?? '').trim().replace(/\.(app|exe)$/i, '').trim();
}

export async function defaultMailApp(platform: NodeJS.Platform, source: MailProtocolSource): Promise<MailAppInfo | null> {
  switch (platform) {
    case 'darwin':
    case 'win32':
      break;
    default:
      return null;
  }
  try {
    const info = await source.getApplicationInfoForProtocol(MAILTO);
    const name = mailAppName(info?.name);
    if (!name) return null;
    const icon = info.icon && !info.icon.isEmpty() ? info.icon.resize({ width: 32, height: 32 }).toDataURL() : undefined;
    return icon ? { name, icon } : { name };
  } catch {
    // No icon to be had (or no handler at all): the name alone, if there is one.
    try {
      const name = mailAppName(source.getApplicationNameForProtocol(MAILTO));
      return name ? { name } : null;
    } catch {
      return null;
    }
  }
}
