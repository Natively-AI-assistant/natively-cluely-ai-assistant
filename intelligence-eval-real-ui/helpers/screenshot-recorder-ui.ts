import type { Page } from 'playwright-core';
import path from 'node:path';
export async function snap(win: Page, dir: string, name: string): Promise<string> {
  const f = path.join(dir, `${name}.png`);
  try { await win.screenshot({ path: f, timeout: 10000 }); return f; } catch { return ''; }
}
