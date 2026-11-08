// Attendee enrichment: a job title and company for the people in a meeting,
// looked up by email in an outside directory (Clearbit's person API, the shape
// Granola uses), offered on the People page as SUGGESTIONS the user accepts.
//
// This is the one place Natively asks an outside service about a person, so it
// is strictly opt-in: it runs only when the user has pasted a Clearbit key AND
// presses "Look up attendees" on a meeting. Nothing is looked up in the
// background, and a result is never applied on its own; it becomes a suggested
// fact (person_facts, status 'suggested') exactly like a title heard in the
// meeting, and only an accepted suggestion reaches the notes prompt.

import { errorKindOf, httpRequest, type FetchLike } from './httpRequest';
import { normaliseEmail } from './crm';

export const ENRICHMENT_LABEL = 'Clearbit';
const PERSON_API = 'https://person.clearbit.com/v2/people/find';
/** A fixed public address for the connection test, so no user data is sent to verify a key. */
const TEST_EMAIL = 'hello@clearbit.com';
const VALUE_MAX = 80;
export const ENRICH_MAX_ATTENDEES = 25;

export interface EnrichedPerson {
    email: string;
    name?: string;
    title?: string;
    company?: string;
}

interface CallOpts { token: string; fetchImpl?: FetchLike; signal?: AbortSignal }

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const oneLine = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Clearbit's person record → the three fields we offer. Unknown shapes give an empty result. */
export function parseEnrichedPerson(data: any, email: string): EnrichedPerson {
    const out: EnrichedPerson = { email };
    const name = oneLine(data?.name?.fullName ?? [data?.name?.givenName, data?.name?.familyName].filter(Boolean).join(' '), VALUE_MAX);
    const title = oneLine(data?.employment?.title, VALUE_MAX);
    const company = oneLine(data?.employment?.name, VALUE_MAX);
    if (name) out.name = name;
    if (title) out.title = title;
    if (company) out.company = company;
    return out;
}

/**
 * One person by email. A 404 is "not in the directory" (an empty result), not a
 * failure; anything else that fails is thrown for the caller to word.
 */
export async function lookupPerson(email: string, o: CallOpts): Promise<EnrichedPerson> {
    const clean = normaliseEmail(email);
    if (!clean) return { email: String(email ?? '') };
    try {
        const res = await httpRequest(`${PERSON_API}?email=${encodeURIComponent(clean)}`, { headers: bearer(o.token), fetchImpl: o.fetchImpl, signal: o.signal });
        return parseEnrichedPerson(res.data, clean);
    } catch (err) {
        if (errorKindOf(err) === 'not_found') return { email: clean };
        throw err;
    }
}

/** Looks up each attendee in turn (their rate limits); stops at the first real failure. */
export async function lookupAttendees(emails: string[], o: CallOpts): Promise<{ people: EnrichedPerson[]; error?: ReturnType<typeof errorKindOf> }> {
    const people: EnrichedPerson[] = [];
    const seen = new Set<string>();
    for (const raw of emails) {
        const email = normaliseEmail(raw);
        if (!email || seen.has(email)) continue;
        seen.add(email);
        if (people.length >= ENRICH_MAX_ATTENDEES) break;
        try {
            people.push(await lookupPerson(email, o));
        } catch (err) {
            return { people, error: errorKindOf(err) };
        }
    }
    return { people };
}

/**
 * Verifies a key with a lookup of a fixed public address. A 404 proves the key
 * was accepted (the directory just has no record), so it counts as success.
 */
export async function testEnrichment(o: CallOpts): Promise<void> {
    try {
        await httpRequest(`${PERSON_API}?email=${encodeURIComponent(TEST_EMAIL)}`, { headers: bearer(o.token), fetchImpl: o.fetchImpl, signal: o.signal });
    } catch (err) {
        if (errorKindOf(err) === 'not_found') return;
        throw err;
    }
}

const COMPANY_API = 'https://company.clearbit.com/v2/companies/find';
const DESCRIPTION_MAX = 600;

export interface EnrichedCompany { domain: string; name?: string; description?: string }

/** Clearbit's company record → name and one-paragraph description. */
export function parseEnrichedCompany(data: any, domain: string): EnrichedCompany {
    const out: EnrichedCompany = { domain };
    const name = oneLine(data?.name, VALUE_MAX);
    const description = oneLine(data?.description, DESCRIPTION_MAX);
    if (name) out.name = name;
    if (description) out.description = description;
    return out;
}

/** One company by domain; 404 is "not in the directory" (an empty result). */
export async function lookupCompany(domain: string, o: CallOpts): Promise<EnrichedCompany> {
    const clean = String(domain ?? '').trim().toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) return { domain: clean };
    try {
        const res = await httpRequest(`${COMPANY_API}?domain=${encodeURIComponent(clean)}`, { headers: bearer(o.token), fetchImpl: o.fetchImpl, signal: o.signal });
        return parseEnrichedCompany(res.data, clean);
    } catch (err) {
        if (errorKindOf(err) === 'not_found') return { domain: clean };
        throw err;
    }
}

export interface SuggestedFact { kind: 'title' | 'company'; value: string; quote: string }

/**
 * The suggestions one lookup yields, each carrying where it came from as its
 * quote, so the People page shows "Clearbit: …" where it shows the transcript
 * words for a heard fact.
 */
export function enrichmentFacts(p: EnrichedPerson): SuggestedFact[] {
    const out: SuggestedFact[] = [];
    const where = p.company ? ` at ${p.company}` : '';
    if (p.title) out.push({ kind: 'title', value: p.title, quote: `${ENRICHMENT_LABEL}: ${p.title}${where}` });
    if (p.company) out.push({ kind: 'company', value: p.company, quote: `${ENRICHMENT_LABEL}: ${p.company}` });
    return out;
}
