export function resolveCgEventTapAvailable(platform: string): boolean;

export function shouldBlockFocus(params: {
  stealthAutoEngageOk: boolean;
  isCgEventTapAvailable: boolean;
}): boolean;

export function shouldFireStealthTapStart(params: {
  stealthTapActive: boolean;
  stealthAutoEngageOk: boolean;
  isStealthEngageTarget: boolean;
}): boolean;
