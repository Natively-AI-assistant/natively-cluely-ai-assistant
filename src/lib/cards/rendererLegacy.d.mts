import type { LegacyCardHistory } from './cardPolicy.mjs';

export function collectRendererLegacy(storage: { getItem(key: string): string | null }): LegacyCardHistory;
