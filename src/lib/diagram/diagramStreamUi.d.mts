import type { FencedBlock, FencedTail } from './fencedBlocks.mjs';

export function hasOpeningMermaidFence(text: string): boolean;
export function mayHoldMermaidFence(text: string, streaming?: boolean): boolean;
export function shouldUseStreamingDiagramUi(token: string, previousText?: string): boolean;
export function isMermaidOpeningTail(tail: FencedTail | null | undefined): boolean;
export function fastForwardDiagramReveal(blocks: readonly FencedBlock[], revealedLen: number, arrivedLen: number): number;
export function completedDiagramCount(blocks: readonly FencedBlock[]): number;
export function previousVersionFor(partialSource: string | null | undefined, previousSource: string | null | undefined): string | undefined;
export function describeDiagramFromLead(leadProse: string | null | undefined): string;
