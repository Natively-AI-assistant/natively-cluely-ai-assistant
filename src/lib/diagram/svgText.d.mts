export const SVG_FONT_FAMILY: string;
export function escapeXml(value: unknown): string;
export function wellFormedText(value: unknown): string;
export function clipText(value: unknown, max: number): string;
export function estimateTextWidth(text: unknown, fontSize?: number, weight?: number): number;
export function truncateToWidth(text: unknown, maxWidth: number, fontSize?: number, weight?: number): string;
export function wrapText(text: unknown, maxWidth: number, fontSize?: number, maxLines?: number): string[];
export function svgText(
  x: number,
  y: number,
  text: unknown,
  opts?: { size?: number; fill?: string; anchor?: 'start' | 'middle' | 'end'; weight?: number; italic?: boolean; decoration?: string; baseline?: string; transform?: string; cls?: string; halo?: string },
): string;
export function svgDocument(width: number, height: number, body: string, opts?: { title?: string; kind?: string }): string;
export function svgNum(n: number): number;
