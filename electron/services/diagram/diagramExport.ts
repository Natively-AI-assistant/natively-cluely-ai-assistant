// Export validation for diagram artifacts — pure, no Electron imports, so it is
// testable under plain Node and usable on any platform.
//
// The export handler (diagramIpc.ts) writes bytes a RENDERER produced. Nothing
// is written unless it is what it claims to be: an inert SVG drawing, a real
// PNG, or bounded Mermaid text — under a file name legal on macOS and Windows.

import { isSafeDiagramSvg, DIAGRAM_LIMITS } from '../../../src/lib/diagram/diagramPolicy.mjs';

const EXPORT_PNG_MAX_BYTES = 12 * 1024 * 1024;
/** A chart's or notation model's canonical JSON, and a chart's data table as CSV. */
const EXPORT_JSON_MAX_CHARS = 96 * 1024;
const EXPORT_CSV_MAX_CHARS = 256 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** File-name stem safe on macOS and Windows (reserved characters, device names, length). */
export function safeDiagramFileStem(name: unknown): string {
  const raw = typeof name === 'string' ? name : '';
  const cleaned = raw
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // A leading dot makes a hidden file on macOS; a trailing dot or space is
    // dropped by Windows, which then opens a different name from the one written.
    .replace(/^[. ]+/, '')
    .slice(0, 60)
    .replace(/[. ]+$/, '');
  if (!cleaned) return 'diagram';
  // Windows device names are reserved with ANY extension: "con.v2" and
  // "NUL.txt" are the device, so what counts is the part before the first dot.
  // (NFKC above has already turned "COM¹" into "COM1".)
  const base = cleaned.split('.')[0].trim();
  if (WINDOWS_DEVICE_NAME_RE.test(base)) return `diagram-${cleaned}`;
  return cleaned;
}

const WINDOWS_DEVICE_NAME_RE = /^(?:con|prn|aux|nul|com\d|lpt\d|conin\$|conout\$)$/i;

/**
 * A file name in a folder that does not hold it yet: "name.ext", then
 * "name (2).ext", … and, if a few hundred of those are taken, a name with the
 * time in it. Never a name that exists — the caller also opens the file
 * exclusively, so a file created in between is not overwritten either.
 */
export function uniqueDiagramFileName(stem: string, ext: string, exists: (name: string) => boolean, now: () => number = Date.now): string {
  let candidate = `${stem}.${ext}`;
  for (let n = 2; n <= 200 && exists(candidate); n += 1) candidate = `${stem} (${n}).${ext}`;
  for (let n = 0; n < 50 && exists(candidate); n += 1) candidate = `${stem} ${now().toString(36)}${n ? `-${n}` : ''}.${ext}`;
  return candidate;
}

export type DiagramExportFormat = 'svg' | 'png' | 'mmd' | 'json' | 'csv';
export const DIAGRAM_EXPORT_FORMATS: readonly DiagramExportFormat[] = ['svg', 'png', 'mmd', 'json', 'csv'];
export const DIAGRAM_EXPORT_FILTERS: Record<DiagramExportFormat, { name: string; extensions: string[] }> = {
  svg: { name: 'SVG image', extensions: ['svg'] },
  png: { name: 'PNG image', extensions: ['png'] },
  mmd: { name: 'Mermaid source', extensions: ['mmd'] },
  // A chart's inputs and computed table, or a Chen / automaton model. It is this
  // app's own format and is named as such — never offered as Mermaid source.
  json: { name: 'Chart or diagram data (JSON)', extensions: ['json'] },
  csv: { name: 'Chart data (CSV)', extensions: ['csv'] },
};

/**
 * How the save dialog is brought in front of the user, per platform.
 *
 * The export button lives in the overlay, and the overlay never takes focus on
 * either system (a non-activating panel on macOS, WS_EX_NOACTIVATE on Windows):
 * clicking it leaves the user's meeting app in the foreground. A save dialog
 * opened plainly from there belongs to an app that is not in front. Seen on
 * macOS (2026-10-02): the dialog existed — "Save diagram" was one of the app's
 * windows — behind the frontmost app, and Export looked like it did nothing.
 *
 *  - macOS: the app is brought forward first, and the dialog stands alone. (A
 *    dialog given a parent there is a sheet on that window: on a transparent,
 *    non-activating panel that is the wrong thing.)
 *  - Windows: the dialog is owned by the window that asked. An owned window
 *    opens above its owner, and the overlay is always on top.
 *  - anything else: opened plainly, as before.
 */
export type SaveDialogPlacement = 'activate-app' | 'own-by-sender' | 'plain';
export function saveDialogPlacement(platform: NodeJS.Platform): SaveDialogPlacement {
  switch (platform) {
    case 'darwin':
      return 'activate-app';
    case 'win32':
      return 'own-by-sender';
    default:
      return 'plain';
  }
}

export function isDiagramExportFormat(value: unknown): value is DiagramExportFormat {
  return typeof value === 'string' && (DIAGRAM_EXPORT_FORMATS as readonly string[]).includes(value);
}

/** Validate an export payload and turn it into bytes. Null = refused. Pure; exported for tests. */
export function diagramExportBytes(format: unknown, data: unknown): Buffer | null {
  if (typeof data !== 'string' || !data) return null;
  if (format === 'svg') {
    // The same check the renderer and the phone path use: only an inert drawing is written.
    return isSafeDiagramSvg(data) ? Buffer.from(data, 'utf8') : null;
  }
  if (format === 'mmd') {
    if (data.length > DIAGRAM_LIMITS.maxSourceChars) return null;
    return Buffer.from(data.replace(/\r\n?/g, '\n').replace(/\s*$/, '\n'), 'utf8');
  }
  if (format === 'json') {
    // Written only if it IS JSON, and re-serialised so the file is exactly a
    // JSON document (nothing a renderer appended survives).
    if (data.length > EXPORT_JSON_MAX_CHARS) return null;
    try {
      const value = JSON.parse(data);
      if (value === null || typeof value !== 'object') return null;
      return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    } catch {
      return null;
    }
  }
  if (format === 'csv') {
    if (data.length > EXPORT_CSV_MAX_CHARS) return null;
    // Text only: no NUL or other control characters besides tab and line breaks.
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(data)) return null;
    // UTF-8 with a byte-order mark, so a spreadsheet reads non-ASCII labels correctly.
    return Buffer.from(`\uFEFF${data.replace(/\r\n?|\n/g, '\r\n')}`, 'utf8');
  }
  if (format === 'png') {
    if (data.length > Math.ceil(EXPORT_PNG_MAX_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return null;
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length < PNG_MAGIC.length || bytes.length > EXPORT_PNG_MAX_BYTES) return null;
    return bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC) ? bytes : null;
  }
  return null;
}
