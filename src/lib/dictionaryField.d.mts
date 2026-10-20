export function isListPaste(text: string): boolean;
export function splitEntries(text: string): string[];
export function mergeEntries(terms: string[], text: string, max: number): { next: string[]; leftover: string[] };
export function pasteIntoDraft(draft: string, start: number | null, end: number | null, text: string): string;
