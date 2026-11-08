export declare const MAX_ATTACHMENTS: number;

export declare function addAttachment<T extends { path: string; formulaCapture?: string }>(
  tray: T[],
  item: T,
  max?: number,
): T[];

export declare function withoutFormulaImages<T extends { path: string; formulaCapture?: string }>(tray: T[]): T[];

export declare function revealsOverlay(item: { quiet?: boolean }): boolean;
