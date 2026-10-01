export const TOOLTIP_FREE_WINDOWS: readonly string[];
export function shouldSuppressNativeTooltips(windowParam: string): boolean;
export function stripTitle(el: Element): void;
export function installNativeTooltipGuard(
  root: Element,
  MutationObserverImpl?: typeof MutationObserver,
): () => void;
export function restoreTitles(root: Element): void;
export function createSwitchableTooltipGuard(
  root: Element,
  MutationObserverImpl?: typeof MutationObserver,
): { setActive(active: boolean): void; isActive(): boolean };
