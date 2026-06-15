export const CODE_EXPANSION_TRANSITION: {
  type: 'spring';
  duration: number;
  bounce: number;
  restDelta: number;
  restSpeed: number;
};

export function shouldEagerExpandForCodeToken(
  intent: string,
  token: string,
  previousText?: string,
): boolean;

export function shouldHoldEagerCodeExpansion(params: {
  hasCodeElements: boolean;
  hasVisibleCodeElement: boolean;
  eagerExpansionHold: boolean;
}): boolean;
