export interface ProseBlock {
  kind: 'prose';
  start: number;
  end: number;
  text: string;
}

export type VisualBlockKind = 'mermaid' | 'chart' | 'notation';

export interface FenceBlock {
  /** 'mermaid' | 'chart' | 'notation' are visual artifacts; 'code' is everything else. */
  kind: 'code' | VisualBlockKind;
  /** First word of the info string, lower-cased ('' when untagged). */
  lang: string;
  info: string;
  fenceChar: '`' | '~';
  fenceLength: number;
  start: number;
  end: number;
  contentStart: number;
  /** Block content, bytes preserved (only the opening fence's indent removed). */
  source: string;
  /** False while the closing fence has not arrived, or the answer was cut off. */
  closed: boolean;
  /** Ordinal among all fences of the answer. Stable as the answer grows. */
  fenceIndex: number;
  /** Ordinal among the answer's visual blocks of every kind (-1 for ordinary code). */
  diagramIndex: number;
}

export type FencedBlock = ProseBlock | FenceBlock;

export interface FencedTail {
  /**
   * 'none'                — nothing undecided
   * 'maybe-fence'         — one or two fence characters at line start
   * 'opening-fence'       — an opening fence whose language tag is still arriving
   * 'maybe-closing-fence' — a partial line that may become the closing fence
   */
  kind: 'none' | 'maybe-fence' | 'opening-fence' | 'maybe-closing-fence';
  text: string;
}

export interface FencedParse {
  blocks: FencedBlock[];
  tail: FencedTail;
  final: boolean;
}

export function parseFencedBlocks(text: string, options?: { final?: boolean }): FencedParse;

export function createFencedBlockTracker(): {
  update(fullText: string, options?: { final?: boolean }): FencedParse;
  reset(): void;
};

export const VISUAL_FENCE_LANGS: Readonly<Record<string, VisualBlockKind>>;
export const VISUAL_BLOCK_KINDS: readonly VisualBlockKind[];
export const VISUAL_FENCE_TAG: Readonly<Record<VisualBlockKind, string>>;
export function isVisualBlock(block: { kind: string } | null | undefined): boolean;
export function mentionsVisualTag(text: unknown): boolean;
export function hasVisualFence(text: string, options?: { final?: boolean }): boolean;
export function extractVisualBlocks(text: string, options?: { final?: boolean }): FenceBlock[];
export function hasMermaidFence(text: string, options?: { final?: boolean }): boolean;
export function extractMermaidBlocks(text: string, options?: { final?: boolean }): FenceBlock[];
export function stripMermaidBlocks(text: string): string;
export function replaceMermaidBlock(text: string, diagramIndex: number, newSource: string): string;
export function replaceMermaidSource(text: string, originalSource: string, newSource: string): string;
