// Ambient declaration for src/utils/resumeSummary.mjs — gives the .mjs ESM
// module an explicit type signature so strict TypeScript can resolve the import
// without `allowJs` bleeding into the rest of the project.
//
// Source of truth is resumeSummary.mjs — keep this file in sync if the
// module's exports change.

export const SUMMARY_CHAR_CAP: number;

export function truncateResumeSummary(
    raw: string | null | undefined
): string | null;
