export function wireStealthTooltips(
  root: Element,
  api?: {
    getUndetectable?: () => Promise<boolean>;
    onUndetectableChanged?: (fn: (undetectable: boolean) => void) => (() => void) | void;
  },
): () => void;
