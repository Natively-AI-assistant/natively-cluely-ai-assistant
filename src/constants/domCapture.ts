// Single source of truth for DOM capture character budget.
// If changing, also update the sibling constant in electron/config/constants.ts to prevent drift.
export const DOM_CONTEXT_MAX_CHARS = 25000;
