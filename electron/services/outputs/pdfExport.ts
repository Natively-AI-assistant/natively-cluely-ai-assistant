// The notes as a PDF: the same self-contained HTML page "Share as file" writes,
// loaded in a hidden, sandboxed window with JavaScript off, printed with
// webContents.printToPDF and thrown away. The page is written to a private temp
// folder and loaded as a file (a data: URL caps out on long notes); the folder
// is removed afterwards on both systems.

import { BrowserWindow, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { pdfPageSize } from './exportFiles';

const LOAD_TIMEOUT_MS = 20_000;

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
    const dir = await fs.promises.mkdtemp(path.join(app.getPath('temp'), 'natively-pdf-'));
    const file = path.join(dir, 'notes.html');
    let win: BrowserWindow | null = null;
    try {
        await fs.promises.writeFile(file, html, 'utf8');
        win = new BrowserWindow({
            show: false,
            width: 816,
            height: 1056,
            skipTaskbar: true,
            focusable: false,
            webPreferences: {
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false,
                javascript: false,
                webSecurity: true,
                spellcheck: false,
                // A throwaway session: nothing it loads is cached or kept.
                partition: 'natively-pdf-export',
            },
        });
        const wc = win.webContents;
        wc.setWindowOpenHandler(() => ({ action: 'deny' }));
        wc.on('will-navigate', (e) => e.preventDefault());
        await Promise.race([
            win.loadFile(file),
            new Promise((_, reject) => setTimeout(() => reject(new Error('load timeout')), LOAD_TIMEOUT_MS).unref?.()),
        ]);
        let country: string | undefined;
        try { country = app.getLocaleCountryCode(); } catch { country = undefined; }
        return await wc.printToPDF({
            pageSize: pdfPageSize(country),
            printBackground: true,
            margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
        });
    } finally {
        try { if (win && !win.isDestroyed()) win.destroy(); } catch { /* already gone */ }
        // Windows can hold the file a moment after the window closes: retry the removal.
        fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
    }
}
