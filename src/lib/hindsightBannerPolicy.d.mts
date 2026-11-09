export interface HindsightStatusLike {
  state: string;
  reason?: string;
  logPath?: string;
  at?: number;
}

export interface HindsightBannerState<S extends HindsightStatusLike = HindsightStatusLike> {
  status: S | null;
  /** The user closed it; holds until a 'ready' status. */
  dismissed: boolean;
}

export function initialHindsightBanner<S extends HindsightStatusLike = HindsightStatusLike>(): HindsightBannerState<S>;
export function hindsightStatusKey(status: HindsightStatusLike | null | undefined): string | null;
export function applyHindsightStatus<S extends HindsightStatusLike>(prev: HindsightBannerState<S>, status: S | null | undefined): HindsightBannerState<S>;
export function dismissHindsightBanner<S extends HindsightStatusLike>(prev: HindsightBannerState<S>): HindsightBannerState<S>;
export function hindsightBannerDismissed(state: HindsightBannerState): boolean;
