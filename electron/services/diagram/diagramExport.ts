// Export validation for diagram artifacts — pure, no Electron imports, so it is
// testable under plain Node and usable on any platform.
//
// The export handler (diagramIpc.ts) writes bytes a RENDERER produced. Nothing
// is written unless it is what it claims to be: an inert SVG drawing, a real
// PNG, or bounded Mermaid text — under a file name legal on macOS and Windows.

import { isSafeDiagramSvg, DIAGRAM_LIMITS } from '../../../src/lib/diagram/diagramPolicy.mjs';

const EXPORT_PNG_MAX_BYTES = 12 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** File-name stem safe on macOS and Windows (reserved characters, device names, length). */
export function safeDiagramFileStem(name: unknown): string {
  const raw = typeof name === 'string' ? name : '';
  const cleaned = raw
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 60);
  if (!cleaned) return 'diagram';
  // Windows device names are reserved with or without an extension.
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)) return `diagram-${cleaned}`;
  return cleaned;
}

export type DiagramExportFormat = 'svg' | 'png' | 'mmd';
export const DIAGRAM_EXPORT_FILTERS: Record<DiagramExportFormat, { name: string; extensions: string[] }> = {
  svg: { name: 'SVG image', extensions: ['svg'] },
  png: { name: 'PNG image', extensions: ['png'] },
  mmd: { name: 'Mermaid source', extensions: ['mmd'] },
};

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
  if (format === 'png') {
    if (data.length > Math.ceil(EXPORT_PNG_MAX_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return null;
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length < PNG_MAGIC.length || bytes.length > EXPORT_PNG_MAX_BYTES) return null;
    return bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC) ? bytes : null;
  }
  return null;
}
