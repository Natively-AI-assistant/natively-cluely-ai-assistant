// CRM notes: the meeting's notes as a note on each attendee the CRM knows,
// found by email. HubSpot (private app token), Attio (API key), Affinity
// (API key), Salesforce (access token + the org's instance URL) and Pipedrive
// (personal API token, or a sign-in at the company's own API host). The user
// sees who matched before anything is written.
//
// Salesforce differs from the other three: it is reached at the user's own org
// host (instanceUrl), not one fixed API host, so every Salesforce call also
// takes `instanceUrl`. People are found with SOQL on Contact.Email; the meeting
// is logged as a completed Task on each contact (Salesforce's own "log a call"
// activity), one request per contact so a partial failure reports who already
// has theirs. A pasted access token is enough to post — no OAuth connected app
// is required — but such tokens expire, so the UI says to paste a fresh one
// when it stops working.

import type { ConnectionErrorKind, CrmService } from '../../../src/types/meetingOutputs';
import { errorKindOf, httpRequest, type FetchLike } from './httpRequest';
import { notesToMarkdown, notesToPlainText, type NotesDocument } from './notesDocument';

export const CRM_LABELS: Record<CrmService, string> = { hubspot: 'HubSpot', attio: 'Attio', affinity: 'Affinity', salesforce: 'Salesforce', pipedrive: 'Pipedrive' };

/** Salesforce REST API version Natively calls (a stable, widely available one). */
export const SALESFORCE_API_VERSION = 'v60.0';
/** Salesforce Task.Description is limited to 32,000 characters; Subject to 255. */
const SALESFORCE_DESCRIPTION_MAX = 32_000;
const SALESFORCE_SUBJECT_MAX = 255;

/**
 * The org REST host from whatever the user pasted ("acme.my.salesforce.com",
 * "https://acme.my.salesforce.com/", with or without a path). Returns a bare
 * `https://host` origin, or null when it is not an https Salesforce host. The
 * host allow-list keeps a stored value from pointing requests anywhere else.
 */
export function normaliseSalesforceInstanceUrl(raw: unknown): string | null {
    let s = String(raw ?? '').trim();
    if (!s) return null;
    if (!/^[a-z]+:\/\//i.test(s)) s = `https://${s}`;
    let u: URL;
    try { u = new URL(s); } catch { return null; }
    if (u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    if (!/(^|\.)(my\.salesforce\.com|salesforce\.com|force\.com)$/.test(host)) return null;
    return `https://${host}`;
}

/** Escape a value for a single-quoted SOQL string literal. */
function soqlEscape(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Salesforce ActivityDate wants YYYY-MM-DD; fall back to today for a bad date. */
export function salesforceActivityDate(dateIso: string, now: () => number = Date.now): string {
    const ms = Date.parse(dateIso);
    return new Date(Number.isNaN(ms) ? now() : ms).toISOString().slice(0, 10);
}

/** Attendees looked up per send; more are not worth a burst of requests. */
export const CRM_MAX_ATTENDEES = 25;
const NOTE_MAX_CHARS = 60_000;

export interface CrmRecord { id: string; name?: string }
export interface CrmMatch { email: string; name?: string; record?: CrmRecord }

interface CrmCallOpts {
    token: string; fetchImpl?: FetchLike; signal?: AbortSignal;
    /** Required for Salesforce (the org's REST host). For Pipedrive, a sign-in's company host; absent for a pasted token. */
    instanceUrl?: string;
}

export function normaliseEmail(raw: unknown): string | null {
    const e = String(raw ?? '').trim().toLowerCase();
    return /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/.test(e) ? e : null;
}

/**
 * The attendees worth looking up: valid, distinct emails, minus the user's own
 * addresses and calendar resources (rooms), at most CRM_MAX_ATTENDEES.
 */
export function crmCandidates(attendees: Array<{ email: string; name?: string }>, selfEmails: string[] = []): Array<{ email: string; name?: string }> {
    const self = new Set(selfEmails.map(normaliseEmail).filter(Boolean) as string[]);
    const seen = new Set<string>();
    const out: Array<{ email: string; name?: string }> = [];
    for (const a of attendees) {
        const email = normaliseEmail(a?.email);
        if (!email || self.has(email) || seen.has(email)) continue;
        if (/@resource\.calendar\.google\.com$/.test(email) || /@group\.calendar\.google\.com$/.test(email)) continue;
        seen.add(email);
        out.push({ email, ...(a.name ? { name: a.name } : {}) });
        if (out.length >= CRM_MAX_ATTENDEES) break;
    }
    return out;
}

// ── Lookups: one record per email, matched case-insensitively ─────────────

/** HubSpot contact search: the first contact whose email is exactly this one. */
export function parseHubspotContacts(data: any, email: string): CrmRecord | undefined {
    for (const r of Array.isArray(data?.results) ? data.results : []) {
        const p = r?.properties || {};
        if (String(p.email || '').toLowerCase() !== email) continue;
        const name = [p.firstname, p.lastname].filter(Boolean).join(' ').trim();
        return { id: String(r.id), ...(name ? { name } : {}) };
    }
    return undefined;
}

export function parseAttioPeople(data: any, email: string): CrmRecord | undefined {
    for (const r of Array.isArray(data?.data) ? data.data : []) {
        const emails: string[] = (r?.values?.email_addresses || []).map((e: any) => String(e?.email_address || '').toLowerCase());
        if (!emails.includes(email)) continue;
        const id = r?.id?.record_id;
        if (typeof id !== 'string') continue;
        const name = String(r?.values?.name?.[0]?.full_name || '').trim();
        return { id, ...(name ? { name } : {}) };
    }
    return undefined;
}

/** Salesforce SOQL result: the first Contact whose Email is exactly this one. */
export function parseSalesforceContacts(data: any, email: string): CrmRecord | undefined {
    for (const r of Array.isArray(data?.records) ? data.records : []) {
        if (String(r?.Email || '').toLowerCase() !== email) continue;
        const id = r?.Id;
        if (typeof id !== 'string' || !id) continue;
        const name = String(r?.Name || '').trim();
        return { id, ...(name ? { name } : {}) };
    }
    return undefined;
}

export function parseAffinityPersons(data: any, email: string): CrmRecord | undefined {
    for (const p of Array.isArray(data?.persons) ? data.persons : []) {
        const emails: string[] = [p?.primary_email, ...(Array.isArray(p?.emails) ? p.emails : [])].map((e) => String(e || '').toLowerCase());
        if (!emails.includes(email)) continue;
        if (p?.id === undefined || p?.id === null) continue;
        const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
        return { id: String(p.id), ...(name ? { name } : {}) };
    }
    return undefined;
}

/** Pipedrive person search: the first person with exactly this email. */
export function parsePipedrivePersons(data: any, email: string): CrmRecord | undefined {
    for (const it of Array.isArray(data?.data?.items) ? data.data.items : []) {
        const p = it?.item || {};
        const emails: string[] = (Array.isArray(p.emails) ? p.emails : []).map((e: any) => String(typeof e === 'string' ? e : e?.value || '').toLowerCase());
        if (!emails.includes(email)) continue;
        if (p.id === undefined || p.id === null) continue;
        const name = String(p.name || '').trim();
        return { id: String(p.id), ...(name ? { name } : {}) };
    }
    return undefined;
}

/**
 * Pipedrive: a sign-in calls its company host (`https://acme.pipedrive.com/api/v1`)
 * with a Bearer token; a pasted personal API token calls
 * `https://api.pipedrive.com/v1` with the x-api-token header.
 */
const pipedrive = (o: CrmCallOpts): { base: string; headers: Record<string, string> } => ({
    base: o.instanceUrl ? `${o.instanceUrl}/api/v1` : 'https://api.pipedrive.com/v1',
    headers: o.instanceUrl ? { Authorization: `Bearer ${o.token}` } : { 'x-api-token': o.token },
});

const HUBSPOT = 'https://api.hubapi.com';
const ATTIO = 'https://api.attio.com/v2';
const AFFINITY = 'https://api.affinity.co';

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
/** Affinity uses HTTP Basic with an empty user name and the key as the password. */
const affinityAuth = (token: string) => ({ Authorization: `Basic ${Buffer.from(`:${token}`).toString('base64')}` });

export async function findCrmRecord(service: CrmService, email: string, o: CrmCallOpts): Promise<CrmRecord | undefined> {
    if (service === 'hubspot') {
        const res = await httpRequest(`${HUBSPOT}/crm/v3/objects/contacts/search`, {
            method: 'POST',
            headers: bearer(o.token),
            json: { filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }], properties: ['email', 'firstname', 'lastname'], limit: 5 },
            fetchImpl: o.fetchImpl, signal: o.signal,
        });
        return parseHubspotContacts(res.data, email);
    }
    if (service === 'attio') {
        const res = await httpRequest(`${ATTIO}/objects/people/records/query`, {
            method: 'POST',
            headers: bearer(o.token),
            json: { filter: { email_addresses: email }, limit: 5 },
            fetchImpl: o.fetchImpl, signal: o.signal,
        });
        return parseAttioPeople(res.data, email);
    }
    if (service === 'pipedrive') {
        const p = pipedrive(o);
        const res = await httpRequest(`${p.base}/persons/search?term=${encodeURIComponent(email)}&fields=email&exact_match=true&limit=5`, {
            headers: p.headers, fetchImpl: o.fetchImpl, signal: o.signal,
        });
        return parsePipedrivePersons(res.data, email);
    }
    if (service === 'salesforce') {
        if (!o.instanceUrl) throw new Error('salesforce instance url missing');
        const soql = `SELECT Id, Name, Email FROM Contact WHERE Email = '${soqlEscape(email)}' LIMIT 5`;
        const res = await httpRequest(`${o.instanceUrl}/services/data/${SALESFORCE_API_VERSION}/query/?q=${encodeURIComponent(soql)}`, {
            headers: bearer(o.token), fetchImpl: o.fetchImpl, signal: o.signal,
        });
        return parseSalesforceContacts(res.data, email);
    }
    const res = await httpRequest(`${AFFINITY}/persons?term=${encodeURIComponent(email)}&page_size=10`, {
        headers: affinityAuth(o.token), fetchImpl: o.fetchImpl, signal: o.signal,
    });
    return parseAffinityPersons(res.data, email);
}

/** Each candidate with the CRM record its email belongs to, if any. Sequential, to stay under rate limits. */
export async function matchAttendees(service: CrmService, candidates: Array<{ email: string; name?: string }>, o: CrmCallOpts): Promise<CrmMatch[]> {
    const out: CrmMatch[] = [];
    for (const c of candidates) {
        const record = await findCrmRecord(service, c.email, o);
        out.push({ ...c, ...(record ? { record } : {}) });
    }
    return out;
}

export async function testCrm(service: CrmService, o: CrmCallOpts): Promise<void> {
    if (service === 'hubspot') {
        await httpRequest(`${HUBSPOT}/crm/v3/objects/contacts?limit=1`, { headers: bearer(o.token), fetchImpl: o.fetchImpl, signal: o.signal });
    } else if (service === 'attio') {
        await httpRequest(`${ATTIO}/self`, { headers: bearer(o.token), fetchImpl: o.fetchImpl, signal: o.signal });
    } else if (service === 'pipedrive') {
        const p = pipedrive(o);
        await httpRequest(`${p.base}/users/me`, { headers: p.headers, fetchImpl: o.fetchImpl, signal: o.signal });
    } else if (service === 'salesforce') {
        if (!o.instanceUrl) throw new Error('salesforce instance url missing');
        await httpRequest(`${o.instanceUrl}/services/data/${SALESFORCE_API_VERSION}/limits`, { headers: bearer(o.token), fetchImpl: o.fetchImpl, signal: o.signal });
    } else {
        await httpRequest(`${AFFINITY}/auth/whoami`, { headers: affinityAuth(o.token), fetchImpl: o.fetchImpl, signal: o.signal });
    }
}

// ── Writing the note ─────────────────────────────────────────────────────

function htmlParagraphs(text: string): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return text.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

/** The note bodies, per CRM: HubSpot and Pipedrive take HTML, Attio Markdown, Affinity and Salesforce plain text. */
export function crmNoteBody(service: CrmService, doc: NotesDocument): string {
    if (service === 'attio') return notesToMarkdown(doc, { includeTitle: false }).slice(0, NOTE_MAX_CHARS);
    if (service === 'salesforce') return notesToPlainText(doc).slice(0, SALESFORCE_DESCRIPTION_MAX);
    const text = notesToPlainText(doc).slice(0, NOTE_MAX_CHARS);
    return service === 'hubspot' || service === 'pipedrive' ? htmlParagraphs(text) : text;
}

/** HubSpot's own association type for note → contact. */
export const HUBSPOT_NOTE_TO_CONTACT = 202;

/** One record per person: two attendee emails can belong to the same CRM person. */
export function uniqueRecords(records: CrmRecord[]): CrmRecord[] {
    const seen = new Set<string>();
    const out: CrmRecord[] = [];
    for (const r of records) {
        if (!r || typeof r.id !== 'string' || seen.has(r.id)) continue;
        seen.add(r.id);
        out.push(r);
    }
    return out;
}

/**
 * What a send did, record by record. A send never throws for a CRM's refusal:
 * the records written before a failure are reported, so a retry can skip them
 * instead of writing their notes twice.
 */
export interface CrmSendOutcome {
    /** Record ids whose note was written. */
    sentIds: string[];
    /** Why the rest were not, when some were not. */
    error?: ConnectionErrorKind;
    /** How many notes were created (HubSpot and Affinity write one note for everyone). */
    notesCreated: number;
}

export async function sendCrmNote(service: CrmService, doc: NotesDocument, recordsIn: CrmRecord[], o: CrmCallOpts): Promise<CrmSendOutcome> {
    const records = uniqueRecords(recordsIn);
    if (!records.length) return { sentIds: [], notesCreated: 0 };
    const body = crmNoteBody(service, doc);
    if (service === 'hubspot' || service === 'affinity') {
        // One request, one note on everyone: it lands for all of them or for none.
        try {
            if (service === 'hubspot') {
                await httpRequest(`${HUBSPOT}/crm/v3/objects/notes`, {
                    method: 'POST',
                    headers: bearer(o.token),
                    json: {
                        properties: { hs_timestamp: Number.isNaN(Date.parse(doc.dateIso)) ? new Date().toISOString() : new Date(doc.dateIso).toISOString(), hs_note_body: body },
                        associations: records.map((r) => ({
                            to: { id: r.id },
                            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: HUBSPOT_NOTE_TO_CONTACT }],
                        })),
                    },
                    fetchImpl: o.fetchImpl, signal: o.signal,
                });
            } else {
                const ids = records.map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
                await httpRequest(`${AFFINITY}/notes`, {
                    method: 'POST',
                    headers: affinityAuth(o.token),
                    json: { person_ids: ids, content: `${doc.title}\n\n${body}`.slice(0, NOTE_MAX_CHARS) },
                    fetchImpl: o.fetchImpl, signal: o.signal,
                });
            }
            return { sentIds: records.map((r) => r.id), notesCreated: 1 };
        } catch (err) {
            return { sentIds: [], notesCreated: 0, error: errorKindOf(err) };
        }
    }
    // Attio, Salesforce and Pipedrive attach to one record each, written one after another
    // (their rate limits); a failure stops there and reports who already has
    // theirs. Salesforce logs a completed Task (its "log a call" activity);
    // Attio writes a note.
    if (service === 'salesforce' && !o.instanceUrl) return { sentIds: [], notesCreated: 0, error: 'not_connected' };
    const activityDate = service === 'salesforce' ? salesforceActivityDate(doc.dateIso) : '';
    const sentIds: string[] = [];
    for (const r of records) {
        try {
            if (service === 'pipedrive') {
                const p = pipedrive(o);
                await httpRequest(`${p.base}/notes`, {
                    method: 'POST',
                    headers: p.headers,
                    json: { content: `<p><b>${doc.title.replace(/[<>&]/g, '')}</b></p>${body}`.slice(0, NOTE_MAX_CHARS), person_id: Number(r.id) },
                    fetchImpl: o.fetchImpl, signal: o.signal,
                });
            } else if (service === 'salesforce') {
                await httpRequest(`${o.instanceUrl}/services/data/${SALESFORCE_API_VERSION}/sobjects/Task`, {
                    method: 'POST',
                    headers: bearer(o.token),
                    json: { Subject: doc.title.slice(0, SALESFORCE_SUBJECT_MAX), Description: body, WhoId: r.id, Status: 'Completed', ActivityDate: activityDate, TaskSubtype: 'Call' },
                    fetchImpl: o.fetchImpl, signal: o.signal,
                });
            } else {
                await httpRequest(`${ATTIO}/notes`, {
                    method: 'POST',
                    headers: bearer(o.token),
                    json: { data: { parent_object: 'people', parent_record_id: r.id, title: doc.title.slice(0, 250), format: 'markdown', content: body } },
                    fetchImpl: o.fetchImpl, signal: o.signal,
                });
            }
            sentIds.push(r.id);
        } catch (err) {
            return { sentIds, notesCreated: sentIds.length, error: errorKindOf(err) };
        }
    }
    return { sentIds, notesCreated: sentIds.length };
}

/**
 * Which records of a send still need their note, given those already written
 * for this meeting and CRM in this session (a retry after a partial failure).
 */
export function remainingRecords(records: CrmRecord[], alreadySent: ReadonlySet<string> | undefined): CrmRecord[] {
    return uniqueRecords(records).filter((r) => !alreadySent?.has(r.id));
}

/**
 * The notes already written in this app session, per meeting and CRM, so a
 * retry after a partial failure writes only the rest. In memory: a restart
 * forgets it, and the CRM itself then holds the truth.
 */
export class CrmSendSession {
    private readonly sent = new Map<string, Set<string>>();
    private key(meetingId: string, service: CrmService): string { return `${service}\u0000${meetingId}`; }
    sentFor(meetingId: string, service: CrmService): ReadonlySet<string> {
        return this.sent.get(this.key(meetingId, service)) ?? new Set();
    }
    markSent(meetingId: string, service: CrmService, ids: string[]): void {
        if (!ids.length) return;
        const k = this.key(meetingId, service);
        const set = this.sent.get(k) ?? new Set<string>();
        for (const id of ids) set.add(id);
        this.sent.set(k, set);
    }
}

/** The plain-words result of a send, counting partial successes. */
export function crmSendSummary(
    service: CrmService,
    outcome: CrmSendOutcome,
    attempted: number,
    describe: (kind: ConnectionErrorKind | undefined, label: string) => string,
): { ok: boolean; kind?: ConnectionErrorKind; message?: string; notesCreated: number; sentCount: number; remaining: number } {
    const label = CRM_LABELS[service];
    const sentCount = outcome.sentIds.length;
    const remaining = attempted - sentCount;
    if (!outcome.error) return { ok: true, notesCreated: outcome.notesCreated, sentCount, remaining: 0 };
    if (sentCount === 0) return { ok: false, kind: outcome.error, message: describe(outcome.error, label), notesCreated: 0, sentCount, remaining };
    return {
        ok: false,
        kind: outcome.error,
        notesCreated: outcome.notesCreated,
        sentCount,
        remaining,
        message: `The note is on ${sentCount} of ${attempted} people in ${label}. ${describe(outcome.error, label)} Send again to add it for the other ${remaining === 1 ? 'person' : `${remaining} people`}; the ones done already are skipped.`,
    };
}
