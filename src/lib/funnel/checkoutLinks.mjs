// src/lib/funnel/checkoutLinks.mjs
//
// Checkout attribution: which install opened a checkout page, and from where.
//
// The 2026-10-01 trial review could not say how many people who clicked a plan
// went on to pay, because every checkout link in the app is the same static
// Dodo URL whoever opens it. Dodo's static links accept `metadata_*` query
// parameters and hand them back on the purchase webhook, so the main process
// adds three as the link leaves the app: the install id, the surface, and the
// product. natively-api reads them in lib/funnel.js (readCheckoutAttribution).
//
// This is done where links are OPENED (the open-external IPC), not where they
// are written, so every checkout link in the app is covered — including ones
// in the premium module and ones nobody has added yet.
//
// Pure. No Electron, no network.

const CHECKOUT_HOST = 'checkout.dodopayments.com';

/** Dodo product id → our name for it (the CHECKOUT_PRODUCTS enum). */
export const CHECKOUT_PRODUCT_BY_DODO_ID = Object.freeze({
  pdt_0NbFixGmD8CSeawb5qvVl: 'api_standard',
  pdt_0NcM6Aw0IWdspbsgUeCLA: 'api_pro',
  pdt_0NcM7JElX4Af6LNVFS1Yf: 'api_max',
  pdt_0NcM7rC2kAb69TFKsZnUU: 'api_ultra',
  pdt_0NbHo6EnXlNPqNcZ14OTi: 'pro_lifetime',
  pdt_0NcM4QBwy0CDcPV9CXaNP: 'pro_yearly',
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SURFACE = /^[a-z0-9_]{1,40}$/;

/**
 * Is this a Dodo checkout link, and for which product?
 *
 * @param {string} url
 * @returns {{ product: string | null } | null} null when it is not a checkout
 *   link at all; `product: null` for a checkout link to a product this build
 *   does not know.
 */
export function parseCheckoutUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== 'https:' || parsed.hostname !== CHECKOUT_HOST) return null;
  const m = /^\/buy\/([A-Za-z0-9_]+)\/?$/.exec(parsed.pathname);
  if (!m) return null;
  const product = Object.prototype.hasOwnProperty.call(CHECKOUT_PRODUCT_BY_DODO_ID, m[1])
    ? CHECKOUT_PRODUCT_BY_DODO_ID[m[1]]
    : null;
  return { product };
}

/**
 * Add attribution to a checkout link.
 *
 * Anything that is not a checkout link comes back unchanged with
 * `checkout: false`. Parameters the link already carries are kept; attribution
 * never overwrites a value a caller set on purpose. A malformed install id or
 * surface is left out rather than sent.
 *
 * @param {string} url
 * @param {{ installId?: string | null, surface?: string | null }} [ctx]
 * @returns {{ url: string, checkout: boolean, product: string | null }}
 */
export function tagCheckoutUrl(url, ctx = {}) {
  const info = parseCheckoutUrl(url);
  if (!info) return { url, checkout: false, product: null };
  const out = new URL(url);
  const add = (name, value) => {
    if (!value || out.searchParams.has(name)) return;
    out.searchParams.set(name, value);
  };
  if (typeof ctx.installId === 'string' && UUID.test(ctx.installId)) add('metadata_install_id', ctx.installId.toLowerCase());
  if (typeof ctx.surface === 'string' && SURFACE.test(ctx.surface)) add('metadata_surface', ctx.surface);
  if (info.product) add('metadata_product', info.product);
  return { url: out.toString(), checkout: true, product: info.product };
}
