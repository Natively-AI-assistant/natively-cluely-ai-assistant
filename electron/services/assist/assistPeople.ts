// assistPeople.ts
//
// Who the user is, and whether an action item's owner is the user or one of
// the people on an invite. The notes name owners the way the transcript did:
// "Me" (the microphone), the user's name or first name once the calendar named
// them, or the other person's name. Several owners can share one item
// ("Priya and me", "Rob, Priya").
//
// Pure, no I/O, no platform branches.

export interface UserIdentity {
  /** Full names the user goes by (résumé, calendar account), any case. */
  names: string[];
  /** The user's own addresses (the calendar accounts). */
  emails: string[];
}

export interface PersonRef {
  email?: string;
  name?: string;
}

// Words that stand for the person who recorded the meeting.
const SELF_WORDS = new Set(['me', 'i', 'myself', 'you', 'yourself', 'the user', 'user']);

/** Lower case, letters, digits, spaces and "@" / "." only, single spaces. */
export function normalizePersonText(text: unknown): string {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}@.\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Priya and me", "Rob, Priya", "Rob & Priya", "Rob / Priya" -> parts. */
export function splitOwners(owner: unknown): string[] {
  return String(owner ?? '')
    .split(/\s*(?:,|;|&|\/|\+|\band\b)\s*/i)
    .map((p) => normalizePersonText(p))
    .filter(Boolean);
}

function firstToken(name: string): string {
  return normalizePersonText(name).split(' ')[0] ?? '';
}

export function buildUserIdentity(input: { names?: Array<string | null | undefined>; emails?: Array<string | null | undefined> }): UserIdentity {
  const names = Array.from(new Set((input.names ?? []).map((n) => String(n ?? '').trim()).filter(Boolean)));
  const emails = Array.from(new Set((input.emails ?? []).map((e) => String(e ?? '').trim().toLowerCase()).filter((e) => e.includes('@'))));
  return { names, emails };
}

function partIsUser(part: string, identity: UserIdentity): boolean {
  if (SELF_WORDS.has(part)) return true;
  // "me (evin)", "evin (me)"
  if (/^(me|i)\b/.test(part) || /\((me|you)\)$/.test(part)) return true;
  for (const email of identity.emails) {
    if (part === email || part === email.split('@')[0]) return true;
  }
  for (const name of identity.names) {
    const full = normalizePersonText(name);
    if (!full) continue;
    if (part === full) return true;
    const first = firstToken(name);
    if (first.length >= 2 && part === first) return true;
  }
  return false;
}

/** True when the item's owner is (or includes) the user. An unowned item is not the user's. */
export function ownerIsUser(owner: unknown, identity: UserIdentity): boolean {
  const parts = splitOwners(owner);
  return parts.some((p) => partIsUser(p, identity));
}

/** True when the owner is (or includes) this person, by full name, first name or address. */
export function ownerIsPerson(owner: unknown, person: PersonRef): boolean {
  const parts = splitOwners(owner);
  if (parts.length === 0) return false;
  const email = String(person.email ?? '').trim().toLowerCase();
  const local = email.includes('@') ? email.split('@')[0] : '';
  const full = normalizePersonText(person.name);
  const first = person.name ? firstToken(person.name) : '';
  return parts.some((p) =>
    (email && p === email)
    || (local && local.length >= 2 && p === local)
    || (full && p === full)
    || (first.length >= 2 && p === first));
}

/** The name to show for a person: their name, else the part of the address before "@". */
export function displayName(person: PersonRef): string {
  const name = String(person.name ?? '').trim();
  if (name) return name;
  const email = String(person.email ?? '').trim();
  return email.includes('@') ? email.split('@')[0] : email;
}

/** First name for a greeting: "Priya Nair" -> "Priya"; an address -> its local part. */
export function firstNameOf(person: PersonRef): string {
  const name = displayName(person);
  return name.split(/\s+/)[0] || name;
}
