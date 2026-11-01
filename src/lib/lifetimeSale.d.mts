export const LIFETIME_LIST: number;
export const LIFETIME_SALE: number;
export const LIFETIME_PCT_OFF: number;
export type LifetimeSale = 'halloween' | 'blackfriday' | 'christmas' | 'newyear';
export function lifetimeSaleOn(now: Date): LifetimeSale | null;
export function lifetimeSaleLabel(now: Date): string | null;
