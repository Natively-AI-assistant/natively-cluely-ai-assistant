/**
 * Centralised checkout & external URL constants.
 *
 * Change URLs here once — all files that import from this module
 * will pick up the update automatically.
 */

export const CHECKOUT_URLS = {
    /**
     * The Natively API Pro tier (monthly), the same product as `apiPro`.
     * NOT the standalone Pro licence: that is pdt_0NcM4QBwy0CDcPV9CXaNP (yearly)
     * and pdt_0NbHo6EnXlNPqNcZ14OTi (lifetime), in NativelyProSettings.tsx.
     * Nothing reads this key (2026-11-07); kept so an import cannot break.
     */
    pro: 'https://checkout.dodopayments.com/buy/pdt_0NcM6Aw0IWdspbsgUeCLA',
    /** Natively Pro licence, yearly (own AI keys); the Unlock Pro plans page */
    proYearly: 'https://checkout.dodopayments.com/buy/pdt_0NcM4QBwy0CDcPV9CXaNP',
    /** Natively Pro licence, lifetime (own AI keys) */
    proLifetime: 'https://checkout.dodopayments.com/buy/pdt_0NbHo6EnXlNPqNcZ14OTi',
    /** Natively API — Standard tier, monthly ($8) */
    apiStandard: 'https://checkout.dodopayments.com/buy/pdt_0NbFixGmD8CSeawb5qvVl',
    /** Natively API — Pro tier, monthly ($15) */
    apiPro: 'https://checkout.dodopayments.com/buy/pdt_0NcM6Aw0IWdspbsgUeCLA',
    /** Natively API — Max tier, monthly ($25) */
    apiMax: 'https://checkout.dodopayments.com/buy/pdt_0NcM7JElX4Af6LNVFS1Yf',
    /** Natively API — Ultra tier, monthly ($35) */
    apiUltra: 'https://checkout.dodopayments.com/buy/pdt_0NcM7rC2kAb69TFKsZnUU',
    // Yearly: 10x monthly, billed once a year. The allowance still refills monthly.
    /** Natively API — Standard tier, yearly ($80). No Natively Pro. */
    apiStandardYearly: 'https://checkout.dodopayments.com/buy/pdt_0NrMWrUcsLyeGzOKbTBvg',
    /** Natively API — Pro tier, yearly ($150) */
    apiProYearly: 'https://checkout.dodopayments.com/buy/pdt_0NrMWybuENVytnwJcQqPi',
    /** Natively API — Max tier, yearly ($250) */
    apiMaxYearly: 'https://checkout.dodopayments.com/buy/pdt_0NrMWz1alVbZKPXvGjxz2',
    /** Natively API — Ultra tier, yearly ($350) */
    apiUltraYearly: 'https://checkout.dodopayments.com/buy/pdt_0NrMWzLKdFcSU6HozUl55',
    // Pro packs: one-time. Natively Pro + the API until the hours or the days
    // run out, whichever comes first. Another pack adds hours. Never renews.
    /** Light pack — $5, 2 hours of meetings within 7 days */
    packLight: 'https://checkout.dodopayments.com/buy/pdt_0NrMWztmLVYzyt4L9SQJd',
    /** Heavy pack — $10, 5 hours of meetings within 14 days */
    packHeavy: 'https://checkout.dodopayments.com/buy/pdt_0NrMX0EGK6xaJYhsWRIla',
} as const;

/** The website's pricing page, every plan side by side. */
export const PRICING_PAGE_URL = 'https://heynatively.com/pricing';
