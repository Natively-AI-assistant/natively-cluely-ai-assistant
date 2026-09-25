/**
 * Fluxion AI sponsors Natively. This is Natively's own partner link: sign-ups
 * through it get $3 in API credit. It backs both the launcher's sponsor card
 * and the Fluxion provider card's "Get API key".
 */
export const FLUXION_REFERRAL_URL = 'https://fluxionai.world/register?source=github&campaign=natively&promo=NATIVELY';

/** Inbound address for advertising and sponsorship enquiries. */
export const SPONSORSHIP_EMAIL = 'natively.contact@gmail.com';

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
