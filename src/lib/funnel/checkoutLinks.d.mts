import type { CheckoutProduct } from './funnelCatalog.mjs';

export const CHECKOUT_PRODUCT_BY_DODO_ID: Readonly<Record<string, CheckoutProduct>>;

export function parseCheckoutUrl(url: string): { product: CheckoutProduct | null } | null;

export function tagCheckoutUrl(
  url: string,
  ctx?: { installId?: string | null; surface?: string | null },
): { url: string; checkout: boolean; product: CheckoutProduct | null };
