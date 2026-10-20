/**
 * Sidrune AI (formerly Fluxion AI) sponsors Natively. This is Natively's own
 * partner link: sign-ups through it get $3 in API credit. It backs both the
 * launcher's sponsor card and the Fluxion provider card's "Get API key".
 * The rebrand kept this link exactly as it was, parameters included, at the
 * sponsor's request; the name stays FLUXION_ to match the provider id.
 */
export const FLUXION_REFERRAL_URL = 'https://fluxionai.world/register?source=github&campaign=natively&promo=NATIVELY';

/**
 * AgentRouter's "Get API key" link on its provider card — Natively's own
 * referral code (`aff=9ZCx`), as Evin supplied it. Not the `aff=IPN5` code in
 * AgentRouter's docs navigation, which is someone else's.
 */
export const AGENTROUTER_REFERRAL_URL = 'https://agentrouter.org/register?aff=9ZCx';

/** heynatively.com/creators: a public post that reaches 5,000 views earns a month of Ultra. */
export const CREATORS_PROGRAM_URL = 'https://heynatively.com/creators';

/** heynatively.com/affiliate: a commission on sales referred within 30 days of a click. */
export const AFFILIATE_PROGRAM_URL = 'https://heynatively.com/affiliate';

/** Inbound address for advertising and sponsorship enquiries. */
export const SPONSORSHIP_EMAIL = 'partnerships@heynatively.com';

/**
 * Gmail compose, pre-addressed to SPONSORSHIP_EMAIL. Opened in the default
 * browser (open-external only allows https), so it works the same on macOS
 * and Windows whether or not a desktop mail client is configured.
 */
export const SPONSORSHIP_GMAIL_COMPOSE_URL = `https://mail.google.com/mail/?${new URLSearchParams({
    view: 'cm',
    fs: '1',
    to: SPONSORSHIP_EMAIL,
    su: 'Sponsorship / advertising on Natively',
}).toString().replace(/\+/g, '%20')}`;
