export type FunnelRule = 'int' | 'bool' | readonly string[];

export const ENTITLEMENTS: readonly ['none', 'byok', 'trial', 'trial_expired', 'api', 'pro', 'api_pro'];
export type FunnelEntitlement = (typeof ENTITLEMENTS)[number];

export const CHECKOUT_PRODUCTS: readonly [
  'api_standard', 'api_pro', 'api_max', 'api_ultra', 'pro_lifetime', 'pro_yearly',
];
export type CheckoutProduct = (typeof CHECKOUT_PRODUCTS)[number];

export const SURFACES: readonly string[];
export type FunnelSurface =
  | 'trial_card' | 'trial_promo' | 'api_promo' | 'api_settings' | 'pro_settings'
  | 'quota_banner' | 'profile_intelligence' | 'modes_settings'
  | 'max_ultra_toaster' | 'jd_toaster' | 'profile_toaster' | 'other';

export const CARD_IDS: readonly string[];
export const CARD_OUTCOMES: readonly string[];

export const FUNNEL_CATALOG: Readonly<Record<string, Readonly<Record<string, FunnelRule>>>>;
export const FUNNEL_EVENT_NAMES: readonly string[];
export const FUNNEL_INT_MAX: number;

export type FunnelProps = Record<string, string | number | boolean>;

export function checkFunnelProps(
  eventType: string,
  props: unknown,
): { ok: true; props: FunnelProps } | { ok: false; error: string };
