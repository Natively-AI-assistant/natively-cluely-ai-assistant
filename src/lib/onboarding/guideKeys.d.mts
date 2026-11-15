export const GUIDE_KEY_DEFAULTS: Readonly<Record<string, string>>;
export function guideKeys(
  keybinds: ReadonlyArray<{ id: string; accelerator: string }> | null | undefined,
  id: string,
  platform: string,
): string[];
