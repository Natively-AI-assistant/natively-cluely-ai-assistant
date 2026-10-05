export type ReleaseNotesDigestCount = { key: 'more' | 'new' | 'improvements' | 'fixes'; count: number };

export type ReleaseNotesDigest = {
    summary: string;
    highlights: string[];
    counts: ReleaseNotesDigestCount[];
};

export function plainText(md: string | null | undefined): string;
export function headlineOf(item: string | null | undefined): string;
export function digestReleaseNotes(
    notes: { summary?: string; sections?: Array<{ title: string; items: string[] }> } | null | undefined,
    options?: { maxHighlights?: number },
): ReleaseNotesDigest | null;
export function bareVersion(version: string | null | undefined): string;
