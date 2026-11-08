// Folders, tags, People and Companies (Granola parity round 2, 2026-10-15).
//
//   - folder rules: title / attendee (address or domain) / mode, at save and
//     "apply to past", never putting back a meeting the user took out
//   - tags: free text, case-insensitive, filterable
//   - people: who a meeting was with, merged by address; call and speaker
//     names join the attendee they plainly are; the user never listed
//   - companies: grouped by work email domain, personal mail left out
//   - proposed titles/companies: only from words actually said or noted,
//     about someone who was there, and only suggestions until accepted
//   - what the notes prompt is told: accepted values and the user's notes, bounded
//   - the mode detector's participant signals
//
// Real SQLite (better-sqlite3) on scratch databases; the model is a stub, no
// network. Nothing in these modules branches on the platform (plain SQL, pure
// string work, Intl with explicit zones), so these assertions are the macOS
// and Windows behaviour alike.
//
// Run under `ELECTRON_RUN_AS_NODE=1 electron --test` (native ABI).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const dist = (rel) => require(path.join(root, 'dist-electron/electron', rel));

const { ensureOrganiseSchema } = dist('db/organiseSchema.js');
const { OrganiseStore } = dist('services/organise/OrganiseStore.js');
const people = dist('services/organise/people.js');
const rules = dist('services/organise/folderRules.js');
const facts = dist('services/organise/personFacts.js');
const company = dist('services/organise/companyDescription.js');
const { afterMeetingSaved, factLines } = dist('services/organise/organiseService.js');
const ctxMod = dist('services/meeting/meetingNotesContext.js');
const { buildNotesInputs } = dist('services/meeting/notesInputs.js');
const { MeetingModeDetector, participantSignals } = dist('services/meeting/MeetingModeDetector.js');

let Sqlite = null;
try { Sqlite = require('better-sqlite3'); new Sqlite(':memory:').close(); } catch { Sqlite = null; }
const NO_SQLITE = 'better-sqlite3 is not loadable here (run under ELECTRON_RUN_AS_NODE=1 electron --test)';

function freshDb() {
  const db = new Sqlite(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT, start_time INTEGER, duration_ms INTEGER, summary_json TEXT,
    created_at TEXT, calendar_event_id TEXT, source TEXT, is_processed INTEGER DEFAULT 1, summary_status TEXT, calendar_event_json TEXT)`);
  ensureOrganiseSchema(db);
  return db;
}

let clock = 1_000;
const now = () => ++clock;

function addMeeting(db, id, { title = `Meeting ${id}`, startMs = 1_700_000_000_000, event = null, detailed = {} } = {}) {
  db.prepare(`INSERT INTO meetings (id, title, start_time, duration_ms, summary_json, created_at, source, is_processed, calendar_event_json)
    VALUES (?, ?, ?, 1800000, ?, ?, 'manual', 1, ?)`)
    .run(id, title, startMs, JSON.stringify({ detailedSummary: detailed }), new Date(startMs).toISOString(), event ? JSON.stringify(event) : null);
}

const EVENT = (title, attendees) => ({ id: `ev-${title}`, title, startTime: '2026-10-15T14:00:00Z', endTime: '2026-10-15T15:00:00Z', attendees, linkedBy: 'start' });
const USER = { email: 'evin@natively.ai', name: 'Evin John' };

// ── Folder rules (pure) ─────────────────────────────────────────────────────
describe('folder rules', () => {
  test('a rule value is cleaned the way it is stored, or refused', () => {
    assert.equal(rules.normaliseRuleValue('title', '  Weekly   sync '), 'Weekly sync');
    assert.equal(rules.normaliseRuleValue('title', 'a'), null, 'one letter matches almost everything');
    assert.equal(rules.normaliseRuleValue('attendee', '@Acme.com'), 'acme.com');
    assert.equal(rules.normaliseRuleValue('attendee', 'Dana@Acme.com'), 'dana@acme.com');
    assert.equal(rules.normaliseRuleValue('attendee', 'not a domain'), null);
    assert.equal(rules.normaliseRuleValue('attendee', 'acme'), null, 'a bare word is not a domain');
    assert.equal(rules.normaliseRuleValue('bogus', 'x'), null);
  });

  test('title, attendee (address, domain, subdomain) and mode match; nothing else does', () => {
    const facts1 = { title: 'Acme / Natively weekly', calendarTitle: 'Weekly Sync with ACME', attendeeEmails: ['evin@natively.ai', 'Dana@eng.acme.com'], modes: ['mode-sales', 'sales'] };
    assert.equal(rules.ruleMatches({ kind: 'title', value: 'weekly sync' }, facts1), true, 'calendar title, any case');
    assert.equal(rules.ruleMatches({ kind: 'title', value: 'natively weekly' }, facts1), true, 'or the meeting title');
    assert.equal(rules.ruleMatches({ kind: 'title', value: 'retro' }, facts1), false);
    assert.equal(rules.ruleMatches({ kind: 'attendee', value: 'acme.com' }, facts1), true, 'a subdomain is the same company');
    assert.equal(rules.ruleMatches({ kind: 'attendee', value: 'dana@eng.acme.com' }, facts1), true);
    assert.equal(rules.ruleMatches({ kind: 'attendee', value: 'dana@acme.com' }, facts1), false, 'an address must be exact');
    assert.equal(rules.ruleMatches({ kind: 'attendee', value: 'cme.com' }, facts1), false, 'not a substring of the domain');
    assert.equal(rules.ruleMatches({ kind: 'mode', value: 'mode-sales' }, facts1), true);
    assert.equal(rules.ruleMatches({ kind: 'mode', value: 'lecture' }, facts1), false);
  });

  test('foldersForMeeting lists each matching folder once, in rule order', () => {
    const list = [
      { folderId: 'b', kind: 'title', value: 'sync' },
      { folderId: 'a', kind: 'attendee', value: 'acme.com' },
      { folderId: 'b', kind: 'attendee', value: 'acme.com' },
      { folderId: 'c', kind: 'mode', value: 'lecture' },
    ];
    assert.deepEqual(rules.foldersForMeeting({ calendarTitle: 'Weekly sync', attendeeEmails: ['x@acme.com'] }, list), ['b', 'a']);
  });

  test('ruleFactsFromMeeting reads the title, the event and both modes', () => {
    const f = rules.ruleFactsFromMeeting({
      title: 'Notes title',
      calendarEvent: { title: 'Event title', attendees: [{ email: 'a@b.com' }, {}] },
      detailedSummary: { mode: { selectedModeId: 'm1', selectedTemplateType: 'general', detectedModeId: 'm2' } },
    }, { detectedTemplateType: 'sales' });
    assert.deepEqual(f, { title: 'Notes title', calendarTitle: 'Event title', attendeeEmails: ['a@b.com'], modes: ['m1', 'general', 'm2', 'sales'] });
  });
});

// ── Folders and tags in the store ───────────────────────────────────────────
describe('folders and tags (store)', () => {
  test('create, rename, rules, file by rule, take out, apply to past', (t) => {
    if (!Sqlite) return t.skip(NO_SQLITE);
    const db = freshDb();
    const store = new OrganiseStore(db, now);
    const folder = store.createFolder('  Customers ');
    assert.equal(folder.name, 'Customers');
    assert.equal(store.createFolder('   '), null);
    assert.equal(store.renameFolder(folder.id, 'Customer calls'), true);

    addMeeting(db, 'old-acme', { event: EVENT('Pricing', [{ email: 'dana@acme.com' }]) });
    addMeeting(db, 'old-other', { event: EVENT('Standup', [{ email: 'tom@natively.ai' }]) });

    const res = store.setFolderRules(folder.id, [{ kind: 'attendee', value: 'Acme.com' }, { kind: 'title', value: 'x' }, { kind: 'attendee', value: 'acme.com' }]);
    assert.deepEqual(res.saved, [{ kind: 'attendee', value: 'acme.com' }], 'invalid and duplicate rules dropped');
    assert.equal(res.offerPast, true, 'a new rule opens the past-meetings offer');

    // A new meeting is filed at save.
    addMeeting(db, 'new-acme', { event: EVENT('Kickoff', [{ email: 'lee@sub.acme.com' }]) });
    assert.deepEqual(store.applyRulesToMeeting('new-acme', rules.ruleFactsFromMeeting(store.meetingSnapshot('new-acme'))), [folder.id]);
    assert.deepEqual(store.foldersOfMeeting('new-acme'), [folder.id]);

    // The user takes it out; the rule does not put it back.
    assert.equal(store.removeMeetingFromFolder('new-acme', folder.id), true);
    assert.deepEqual(store.applyRulesToMeeting('new-acme', rules.ruleFactsFromMeeting(store.meetingSnapshot('new-acme'))), []);
    assert.deepEqual(store.foldersOfMeeting('new-acme'), []);

    // Apply to past: only the matching old meeting, once; the offer is then answered.
    const factsFor = (id) => rules.ruleFactsFromMeeting(store.meetingSnapshot(id));
    assert.equal(store.applyFolderRulesToPast(folder.id, factsFor), 1);
    assert.equal(store.applyFolderRulesToPast(folder.id, factsFor), 0, 'already there');
    assert.deepEqual(store.meetingIdsInFolder(folder.id), ['old-acme']);
    assert.notEqual(store.listFolders()[0].pastOfferedAt, null);
    // Saving the same rules again keeps the offer answered; a new rule reopens it.
    assert.equal(store.setFolderRules(folder.id, [{ kind: 'attendee', value: 'acme.com' }]).offerPast, false);
    assert.equal(store.setFolderRules(folder.id, [{ kind: 'attendee', value: 'acme.com' }, { kind: 'title', value: 'Standup' }]).offerPast, true);

    // Moving it back by hand works (a user add overrides the removal).
    assert.equal(store.addMeetingToFolder('new-acme', folder.id, 'user'), true);
    assert.equal(store.listFolders()[0].meetingCount, 2);
    assert.deepEqual(store.listMeetings({ folderId: folder.id }).map((m) => m.id).sort(), ['new-acme', 'old-acme']);

    // A meeting can be in several folders.
    const second = store.createFolder('Q4');
    store.addMeetingToFolder('new-acme', second.id);
    assert.deepEqual(store.foldersOfMeeting('new-acme').sort(), [folder.id, second.id].sort());

    // Deleting a folder keeps the meetings.
    assert.equal(store.deleteFolder(second.id), true);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM meetings').get().n, 3);
  });

  test('mode rules match the mode a meeting ran in or was detected as', (t) => {
    if (!Sqlite) return t.skip(NO_SQLITE);
    const db = freshDb();
    const store = new OrganiseStore(db, now);
    const f = store.createFolder('Sales calls');
    store.setFolderRules(f.id, [{ kind: 'mode', value: 'mode-sales' }]);
    addMeeting(db, 'ran', { detailed: { mode: { selectedModeId: 'mode-sales' } } });
    addMeeting(db, 'detected', { detailed: { mode: { selectedModeId: 'general', detectedModeId: 'mode-sales' } } });
    addMeeting(db, 'neither', { detailed: { mode: { selectedModeId: 'general' } } });
    for (const id of ['ran', 'detected', 'neither']) store.applyRulesToMeeting(id, rules.ruleFactsFromMeeting(store.meetingSnapshot(id)));
    assert.deepEqual(store.meetingIdsInFolder(f.id).sort(), ['detected', 'ran']);
  });

  test('tags: free text, one per name whatever the case, filterable, unused ones removed', (t) => {
    if (!Sqlite) return t.skip(NO_SQLITE);
    const db = freshDb();
    const store = new OrganiseStore(db, now);
    addMeeting(db, 'm1');
    addMeeting(db, 'm2');
    assert.deepEqual(store.setMeetingTags('m1', ['#Renewal', 'renewal', ' Q4 ', '']), ['Q4', 'Renewal']);
    assert.deepEqual(store.setMeetingTags('m2', ['RENEWAL']), ['Renewal'], 'the existing spelling is reused');
    assert.deepEqual(store.listTags().map((x) => [x.name, x.meetingCount]), [['Q4', 1], ['Renewal', 2]]);
    assert.deepEqual(store.listMeetings({ tag: 'renewal' }).map((m) => m.id).sort(), ['m1', 'm2']);
    store.setMeetingTags('m1', ['Renewal']);
    assert.deepEqual(store.listTags().map((x) => x.name), ['Renewal'], 'Q4 had no meetings left');
    assert.equal(store.setMeetingTags('missing', ['x']), null);
  });
});

// ── People ──────────────────────────────────────────────────────────────────
describe('people in a meeting', () => {
  test('attendees by address; the user, declined invitees and placeholders left out; call names join their attendee', () => {
    const refs = people.peopleInMeeting({
      calendarEvent: { attendees: [
        { email: 'Dana@Acme.com', name: 'Dana Fox' },
        { email: 'evin@natively.ai', name: 'Evin John' },
        { email: 'no@acme.com', name: 'Declined Person', response: 'declined' },
        { email: 'tom.lee@acme.com' },
      ] },
      callParticipants: ['Dana', 'Evin John (You)', 'Tom Lee', 'Priya Shah', 'Speaker 2'],
      speakerLabels: { me: 'Evin', speaker_1: 'Dana Fox', speaker_3: 'Raj' },
      user: USER,
    });
    assert.deepEqual(refs, [
      { email: 'dana@acme.com', name: 'Dana Fox', via: 'attendee' },
      { email: 'tom.lee@acme.com', name: 'Tom Lee', via: 'attendee' },
      { name: 'Priya Shah', via: 'participant' },
      { name: 'Raj', via: 'speaker' },
    ]);
  });

  test('a first name joins an attendee only when no other attendee shares it', () => {
    const refs = people.peopleInMeeting({
      calendarEvent: { attendees: [{ email: 'dana@acme.com', name: 'Dana Fox' }, { email: 'dana.lee@beta.io', name: 'Dana Lee' }] },
      callParticipants: ['Dana'],
      user: USER,
    });
    assert.equal(refs.length, 3, 'two Danas on the invite: "Dana" stays its own entry');
  });

  test('merged by address across meetings; a name-only entry joins the address-holder with that name', (t) => {
    if (!Sqlite) return t.skip(NO_SQLITE);
    const db = freshDb();
    const store = new OrganiseStore(db, now);
    addMeeting(db, 'call-only', { startMs: 1_700_000_000_000 });
    addMeeting(db, 'invite-1', { startMs: 1_700_100_000_000 });
    addMeeting(db, 'invite-2', { startMs: 1_700_200_000_000 });
    store.indexMeetingPeople('call-only', [{ name: 'Dana Fox', via: 'participant' }]);
    assert.equal(store.listPeople().length, 1);
    store.indexMeetingPeople('invite-1', [{ email: 'DANA@acme.com', name: 'Dana Fox', via: 'attendee' }]);
    store.indexMeetingPeople('invite-2', [{ email: 'dana@acme.com', name: '', via: 'attendee' }]);
    const list = store.listPeople();
    assert.equal(list.length, 1, 'one Dana: the call-only entry merged into the address');
    assert.equal(list[0].email, 'dana@acme.com');
    assert.equal(list[0].meetingCount, 3);
    const detail = store.getPerson(list[0].id);
    assert.deepEqual(detail.meetings.map((m) => m.id), ['invite-2', 'invite-1', 'call-only'], 'newest first');

    // Re-indexing a meeting replaces its list; someone with no meetings left and nothing written goes.
    store.indexMeetingPeople('call-only', [{ name: 'Someone Else', via: 'participant' }]);
    store.indexMeetingPeople('call-only', []);
    assert.equal(store.listPeople().length, 1, 'Someone Else had nothing else, so is gone');
    assert.deepEqual(store.unindexedMeetingIds(), []);
  });

  test('a person page: open action items they own, last time with a one-line recap, notes kept', (t) => {
    if (!Sqlite) return t.skip(NO_SQLITE);
    const db = freshDb();
    const store = new OrganiseStore(db, now);
    addMeeting(db, 'earlier', { startMs: 1_700_000_000_000, detailed: { actionItemsV3: [
      { text: 'Send the security review', owner: 'Dana', status: 'open' },
      { text: 'Old thing', owner: 'Dana Fox', status: 'done' },
      { text: 'Book the room', owner: 'Tom' },
    ] } });
    addMeeting(db, 'latest', { title: 'Renewal call', startMs: 1_700_500_000_000, detailed: { overview: 'Acme agreed to renew for two years. Pricing is next.' } });
    store.indexMeetingPeople('earlier', [{ email: 'dana@acme.com', name: 'Dana Fox', via: 'attendee' }, { email: 'tom@acme.com', name: 'Tom Lee', via: 'attendee' }]);
    store.indexMeetingPeople('latest', [{ email: 'dana@acme.com', name: 'Dana Fox', via: 'attendee' }]);
    const dana = store.listPeople().find((p) => p.email === 'dana@acme.com');
    store.updatePerson(dana.id, { notes: 'Prefers async updates.', title: 'VP Sales' });
    const detail = store.getPerson(dana.id);
    assert.deepEqual(detail.openActionItems.map((a) => a.text), ['Send the security review']);
    assert.deepEqual(detail.lastMet, { meetingId: 'latest', title: 'Renewal call', date: new Date(1_700_500_000_000).toISOString(), recap: 'Acme agreed to renew for two years.' });
    assert.equal(detail.notes, 'Prefers async updates.');
    assert.equal(detail.title, 'VP Sales');
    assert.equal(detail.titleSource, 'user');
    // People with notes outlive their meetings.
    store.indexMeetingPeople('earlier', []);
    store.indexMeetingPeople('latest', []);
    assert.ok(store.getPerson(dana.id), 'kept: the user wrote about them');
  });

  test('action item owners: full name always, first name only when unique in that meeting', () => {
    const others = [{ name: 'Dana Fox' }, { name: 'Dana Lee' }];
    assert.equal(people.ownerIsPerson('Dana Fox', { name: 'Dana Fox' }, others), true);
    assert.equal(people.ownerIsPerson('Dana (Acme)', { name: 'Dana Fox' }, [{ name: 'Dana Fox' }]), true);
    assert.equal(people.ownerIsPerson('Dana', { name: 'Dana Fox' }, others), false, 'two Danas: ambiguous');
    assert.equal(people.ownerIsPerson('Dana Lee', { name: 'Dana Fox' }, others), false);
    assert.equal(people.ownerIsPerson('Dana Fox and Tom', { name: 'Dana Fox' }, others), true);
    assert.equal(people.ownerIsPerson('', { name: 'Dana Fox' }), false);
  });
});

// ── Companies ───────────────────────────────────────────────────────────────
describe('companies', () => {
  test('personal mail is never a company', () => {
    for (const d of ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.fr', 'icloud.com', 'me.com', 'yahoo.com', 'yahoo.co.uk', 'proton.me', 'protonmail.com', 'live.co.uk', 'gmx.de', 'aol.com']) {
      assert.equal(people.isFreeMailDomain(d), true, d);
      assert.equal(people.companyDomainForEmail(`someone@${d}`), null, d);
    }
    for (const d of ['acme.com', 'natively.ai', 'outlook-consulting.com']) assert.equal(people.isFreeMailDomain(d), false, d);
  });

  test('a company is its registrable domain, named from it until renamed', () => {
    assert.equal(people.registrableDomain('eng.acme.com'), 'acme.com');
    assert.equal(people.registrableDomain('mail.acme.co.uk'), 'acme.co.uk');
    assert.equal(people.registrableDomain('acme.com.au'), 'acme.com.au');
    assert.equal(people.companyDomainForEmail('Dana@Eng.Acme.com'), 'acme.com');
    assert.equal(people.companyNameFromDomain('blue-river.co.uk'), 'Blue River');
    assert.equal(people.companyNameFromDomain('ibm.com'), 'IBM');
    assert.equal(people.companyNameFromDomain('hp.com'), 'HP');
    assert.equal(people.companyNameFromDomain('bmw.com'), 'BMW');
    assert.equal(people.companyNameFromDomain('box.com'), 'Box', 'a word-shaped name is not initials');
    assert.equal(people.companyNameFromDomain('acme.com'), 'Acme');
  });

  test('listed by domain, the user\'s own company and personal mail left out; a company page has its people and meetings', (t) => {
    if (!Sqlite) return t.skip(NO_SQLITE);
    const db = freshDb();
    const store = new OrganiseStore(db, now);
    addMeeting(db, 'm1', { startMs: 1_700_000_000_000, detailed: { actionItemsV3: [{ text: 'Send pricing', owner: 'Lee Park' }] } });
    addMeeting(db, 'm2', { startMs: 1_700_300_000_000 });
    store.indexMeetingPeople('m1', [
      { email: 'dana@acme.com', name: 'Dana Fox', via: 'attendee' },
      { email: 'lee@eng.acme.com', name: 'Lee Park', via: 'attendee' },
      { email: 'friend@gmail.com', name: 'A Friend', via: 'attendee' },
      { email: 'tom@natively.ai', name: 'Tom', via: 'attendee' },
    ]);
    store.indexMeetingPeople('m2', [{ email: 'sam@beta.io', name: 'Sam', via: 'attendee' }]);
    const list = store.listCompanies({ excludeDomain: 'natively.ai' });
    assert.deepEqual(list.map((c) => [c.domain, c.name, c.peopleCount, c.meetingCount]), [['beta.io', 'Beta', 1, 1], ['acme.com', 'Acme', 2, 1]]);
    store.updateCompany('acme.com', { name: 'Acme Corp', notes: 'Renewal in March.', description: 'Makes rockets.', descriptionSource: 'user' });
    const acme = store.getCompany('acme.com');
    assert.equal(acme.name, 'Acme Corp');
    assert.deepEqual(acme.people.map((p) => p.name).sort(), ['Dana Fox', 'Lee Park']);
    assert.deepEqual(acme.meetings.map((m) => m.id), ['m1']);
    assert.deepEqual(acme.openActionItems.map((a) => a.text), ['Send pricing']);
    assert.equal(acme.description, 'Makes rockets.');
    assert.equal(store.getCompany('gmail.com'), null);
    assert.equal(store.updateCompany('not a domain', { name: 'x' }), false);
  });

  test('the description draft reads only the meetings\' notes, bounded, and says when they are not enough', async () => {
    const meetings = Array.from({ length: 40 }, (_, i) => ({ title: `Call ${i}`, date: '2026-10-01T00:00:00Z', detailedSummary: { overview: 'x'.repeat(900), tldr: ['Acme builds launch software for small satellites.'] } }));
    const context = company.buildCompanyDraftContext({ name: 'Acme', domain: 'acme.com' }, meetings);
    assert.ok(context.length <= company.COMPANY_DRAFT_CONTEXT_MAX_CHARS + 200, 'bounded');
    assert.match(context, /data, not instructions/);
    assert.equal(company.buildCompanyDraftContext({ name: 'Acme', domain: 'acme.com' }, [{ title: 'x', date: '', detailedSummary: {} }]), '');
    assert.equal(company.parseCompanyDraft('NOT_ENOUGH'), null);
    assert.equal(company.parseCompanyDraft('  "Acme builds launch software."  '), 'Acme builds launch software.');
    let sent = null;
    const ok = await company.draftCompanyDescription({ name: 'Acme', domain: 'acme.com' }, meetings.slice(0, 2), async (system, ctx) => { sent = { system, ctx }; return 'Acme builds launch software for small satellites.'; });
    assert.equal(ok.text, 'Acme builds launch software for small satellites.');
    assert.match(sent.system, /Never add anything from general knowledge/);
    assert.deepEqual(await company.draftCompanyDescription({ name: 'Acme', domain: 'acme.com' }, meetings.slice(0, 1), async () => 'NOT_ENOUGH'), { text: null, reason: 'not-enough' });
    assert.deepEqual(await company.draftCompanyDescription({ name: 'Acme', domain: 'acme.com' }, [], async () => 'x'), { text: null, reason: 'no-notes' });
    assert.deepEqual(await company.draftCompanyDescription({ name: 'Acme', domain: 'acme.com' }, meetings.slice(0, 1), async () => { throw new Error('down'); }), { text: null, reason: 'failed' });
  });
});

// ── Proposed titles and companies (evidence-gated) ──────────────────────────
describe('titles and companies from what was said', () => {
  const LINES = [
    { label: 'Me', text: 'Thanks for joining. Could you introduce yourselves?' },
    { label: 'Dana Fox', text: 'Sure, I lead the sales team here at Acme.' },
    { label: 'Speaker 1', text: 'And this is Tom, our CTO, he will join later.' },
    { label: 'Speaker 1', text: 'We talked about pricing a lot.' },
  ];
  const INPUT = { lines: LINES, people: [{ name: 'Dana Fox' }, { name: 'Tom Lee' }], userName: 'Evin John', userNotes: 'Priya Shah runs procurement at Beta.' };
  const { lines, notes } = facts.buildFactContext(INPUT);

  test('kept: a quote in the transcript, said by the person or naming them, that holds the value', () => {
    const kept = facts.vetFacts([
      { person: 'Dana Fox', kind: 'title', value: 'Head of Sales', quote: 'I lead the sales team here at Acme' },
      { person: 'Dana', kind: 'company', value: 'Acme Inc', quote: 'I lead the sales team here at Acme.' },
      { person: 'Tom Lee', kind: 'title', value: 'CTO', quote: 'this is Tom, our CTO' },
    ], INPUT, lines, notes);
    assert.deepEqual(kept.map((f) => [f.person, f.kind, f.value, f.source]), [
      ['Dana Fox', 'title', 'Head of Sales', 'transcript'],
      ['Dana Fox', 'company', 'Acme Inc', 'transcript'],
      ['Tom Lee', 'title', 'CTO', 'transcript'],
    ]);
  });

  test('dropped: a quote not in the transcript, a value the quote does not hold, someone not there, the user, the wrong speaker', () => {
    const dropped = facts.vetFacts([
      { person: 'Dana Fox', kind: 'title', value: 'VP Sales', quote: 'I am the VP of Sales at Acme' },          // never said
      { person: 'Dana Fox', kind: 'company', value: 'Globex', quote: 'I lead the sales team here at Acme' },  // value not in quote
      { person: 'Dana Fox', kind: 'title', value: 'Product Manager', quote: 'I lead the sales team here at Acme' },
      { person: 'Zed Unknown', kind: 'title', value: 'CEO', quote: 'I lead the sales team here at Acme' },  // not in the meeting
      { person: 'Evin John', kind: 'title', value: 'Founder', quote: 'Thanks for joining' },                // the user
      { person: 'Tom Lee', kind: 'title', value: 'Sales', quote: 'I lead the sales team here at Acme' },     // Dana said it, about Dana
      { person: 'Dana Fox', kind: 'title', value: 'Sales', quote: 'sales' },                                  // too short to be evidence
      { person: 'Dana Fox', kind: 'role', value: 'Sales', quote: 'I lead the sales team here at Acme' },     // unknown kind
    ], INPUT, lines, notes);
    assert.deepEqual(dropped, []);
  });

  test('the user\'s notes count only for someone they name, who was there', () => {
    const input = { ...INPUT, people: [...INPUT.people, { name: 'Priya Shah' }] };
    const built = facts.buildFactContext(input);
    const kept = facts.vetFacts([
      { person: 'Priya Shah', kind: 'company', value: 'Beta', quote: 'Priya Shah runs procurement at Beta' },
      { person: 'Dana Fox', kind: 'company', value: 'Beta', quote: 'runs procurement at Beta' },
    ], input, built.lines, built.notes);
    assert.deepEqual(kept.map((f) => [f.person, f.value, f.source]), [['Priya Shah', 'Beta', 'notes']]);
  });

  test('parsing tolerates fences and refuses anything that is not the asked JSON', () => {
    assert.equal(facts.parseFactReply('```json\n{"facts":[{"person":"a"}]}\n```').length, 1);
    assert.deepEqual(facts.parseFactReply('no json here'), []);
    assert.deepEqual(facts.parseFactReply(null), []);
  });

  test('no call at all without other people or anything said', async () => {
    let calls = 0;
    const call = async () => { calls++; return '{"facts":[]}'; };
    assert.deepEqual(await facts.extractPersonFacts({ lines: LINES, people: [] }, call), []);
    assert.deepEqual(await facts.extractPersonFacts({ lines: [], people: [{ name: 'Dana Fox' }] }, call), []);
    assert.equal(calls, 0);
  });

  test('after a save: people indexed, folder rules applied, facts stored as suggestions; accepting one sets the title', async (t) => {
    if (!Sqlite) return t.skip(NO_SQLITE);
    const db = freshDb();
    const store = new OrganiseStore(db, now);
    const folder = store.createFolder('Acme');
    store.setFolderRules(folder.id, [{ kind: 'attendee', value: 'acme.com' }]);
    addMeeting(db, 'm1', { event: EVENT('Discovery', [{ email: 'dana@acme.com', name: 'Dana Fox' }, { email: 'tom@acme.com', name: 'Tom Lee' }]) });
    const transcript = [
      { speaker: 'user', text: 'Could you introduce yourselves?', origin: 'stt' },
      { speaker: 'interviewer', speakerId: 'speaker_2', text: 'Sure, I lead the sales team here at Acme.', origin: 'stt' },
      { speaker: 'assistant', text: 'Dana is the CEO of Acme.', origin: 'assistant' },
    ];
    const labels = { speaker_2: 'Dana Fox' };
    assert.deepEqual(factLines(transcript, labels).map((l) => l.label), ['Me', 'Dana Fox'], 'assistant lines are not evidence');
    let context = '';
    const result = await afterMeetingSaved({
      meetingId: 'm1',
      transcript,
      speakerLabels: labels,
      allowModel: true,
      call: async (_system, ctx) => {
        context = ctx;
        return JSON.stringify({ facts: [
          { person: 'Dana Fox', kind: 'title', value: 'Head of Sales', quote: 'I lead the sales team here at Acme' },
          { person: 'Dana Fox', kind: 'title', value: 'CEO', quote: 'Dana is the CEO of Acme' },
        ] });
      },
    }, store);
    assert.equal(result.people, 2);
    assert.deepEqual(result.folders, [folder.id]);
    assert.equal(result.facts, 1, 'the CEO claim came from the assistant line, which the model never saw as transcript');
    assert.doesNotMatch(context, /CEO of Acme/);

    const dana = store.listPeople().find((p) => p.name === 'Dana Fox');
    assert.equal(dana.title, null, 'a suggestion is not a title until accepted');
    assert.deepEqual(store.knownPeopleByEmail(['dana@acme.com']), [], 'and the notes prompt is not told it');
    const [suggestion] = store.getPerson(dana.id).suggestions;
    assert.equal(suggestion.quote, 'I lead the sales team here at Acme');
    assert.equal(store.resolveFact(suggestion.id, true), true);
    const after = store.getPerson(dana.id);
    assert.equal(after.title, 'Head of Sales');
    assert.equal(after.titleSource, 'evidence');
    assert.deepEqual(after.suggestions, []);
    assert.deepEqual(store.knownPeopleByEmail(['DANA@acme.com']), [{ email: 'dana@acme.com', name: 'Dana Fox', title: 'Head of Sales' }]);
    // The same fact proposed again is not offered twice.
    assert.equal(store.addFact(dana.id, 'm1', 'title', 'head of sales', 'I lead the sales team here at Acme'), false);

    // No model call when the notes may not be written.
    let called = false;
    await afterMeetingSaved({ meetingId: 'm1', transcript, speakerLabels: labels, allowModel: false, call: async () => { called = true; return ''; } }, store);
    assert.equal(called, false);
  });
});

// ── What the notes prompt is told ───────────────────────────────────────────
describe('the summary prompt\'s people block', () => {
  const event = EVENT('Renewal', [
    { email: 'dana@acme.com', name: 'Dana Fox' },
    { email: 'tom@natively.ai', name: 'Tom Ng' },
    { email: 'lee@acme.com', name: 'Lee Park' },
  ]);
  const base = { calendarEvent: event, meetingStartMs: Date.parse('2026-10-15T14:00:00Z'), nowMs: Date.parse('2026-10-15T16:00:00Z'), timeZone: 'UTC', user: { email: 'evin@natively.ai', name: 'Evin John' } };

  test('without known people the block is exactly what it was', () => {
    const plain = ctxMod.formatMeetingPeopleBlock(ctxMod.buildMeetingPeopleContext(base));
    assert.equal(ctxMod.formatMeetingPeopleBlock(ctxMod.buildMeetingPeopleContext({ ...base, knownPeople: [] })), plain);
    assert.match(plain, /- Other side on the invite: Dana Fox <dana@acme\.com>; Lee Park <lee@acme\.com>/);
    assert.doesNotMatch(plain, /own notes/);
  });

  test('accepted titles and companies sit beside the name, on both sides of the split', () => {
    const block = ctxMod.formatMeetingPeopleBlock(ctxMod.buildMeetingPeopleContext({ ...base, knownPeople: [
      { email: 'DANA@acme.com', title: 'Head of Sales', company: 'Acme' },
      { email: 'tom@natively.ai', title: 'Engineer' },
    ] }));
    assert.match(block, /Other side on the invite: Dana Fox <dana@acme\.com> \(Head of Sales, Acme\); Lee Park <lee@acme\.com>/);
    assert.match(block, /colleagues on the invite: Tom Ng <tom@natively\.ai> \(Engineer\)/);
    assert.match(ctxMod.MEETING_CONTEXT_RULES, /shown in brackets after a name in MEETING CONTEXT was confirmed by the user/);
    assert.match(ctxMod.MEETING_CONTEXT_RULES, /Never invent or guess anyone's job title, role or company/);
  });

  test('the user\'s notes: each cut, all together bounded, each company once, background only', () => {
    const attendees = Array.from({ length: 20 }, (_, i) => ({ email: `p${i}@acme.com`, name: `Person ${i}` }));
    const known = attendees.map((a) => ({ email: a.email, notes: `Note about ${a.name}. ${'detail '.repeat(80)}`, companyName: 'Acme', companyNotes: `Acme note ${'z'.repeat(400)}` }));
    const ctx = ctxMod.buildMeetingPeopleContext({ ...base, calendarEvent: EVENT('Big', attendees), knownPeople: known });
    const total = ctx.userKnowledge.join('').length;
    assert.ok(total <= ctxMod.KNOWN_NOTES_MAX_CHARS, `bounded (${total})`);
    for (const line of ctx.userKnowledge) assert.ok(line.length <= ctxMod.KNOWN_NOTE_MAX_CHARS + 90, 'each note cut');
    assert.equal(ctx.userKnowledge.filter((l) => l.startsWith('Acme (company)')).length, 1, 'the company once');
    const block = ctxMod.formatMeetingPeopleBlock(ctx);
    assert.match(block, /The user's own notes about these people \(background the user wrote before; not from this call\)/);
    assert.match(ctxMod.MEETING_CONTEXT_RULES, /Never present them as something said in this meeting/);
  });

  test('a long title is cut', () => {
    const ctx = ctxMod.buildMeetingPeopleContext({ ...base, knownPeople: [{ email: 'dana@acme.com', title: 'T'.repeat(200) }] });
    assert.ok(ctx.external[0].length < 140);
  });

  test('buildNotesInputs passes them through, and hands the detector the invite\'s addresses', () => {
    const inputs = buildNotesInputs({ meetingId: 'm', startMs: base.meetingStartMs, nowMs: base.nowMs, calendarEvent: { ...event, attendees: [...event.attendees, { email: 'gone@acme.com', response: 'declined' }] }, user: base.user, knownPeople: [{ email: 'dana@acme.com', title: 'Head of Sales' }] });
    assert.match(inputs.meetingContextBlock, /Dana Fox <dana@acme\.com> \(Head of Sales\)/);
    assert.deepEqual(inputs.participantEmails, ['dana@acme.com', 'tom@natively.ai', 'lee@acme.com']);
  });
});

// ── Mode detection from who was there ───────────────────────────────────────
describe('MeetingModeDetector participants', () => {
  const seg = (text, i = 0) => ({ speaker: 'interviewer', text, timestamp: 1000 + i * 1000, final: true });
  const detector = new MeetingModeDetector();

  test('title and description results are unchanged when there are no addresses', () => {
    const cases = [
      { transcript: [seg('Hello'), seg('Lets begin'), seg('Thanks')], calendarTitle: 'Weekly', calendarDescription: 'Sprint planning and retro for the team' },
      { transcript: [seg('Hello'), seg('ok'), seg('bye')], calendarTitle: 'Sales demo with Acme' },
      { transcript: [seg('Tell me about yourself'), seg('My background is in design'), seg('Why do you want this role')], calendarTitle: 'Interview' },
      { transcript: [seg('Today we will cover chapter three'), seg('The theorem says'), seg('For homework')], calendarTitle: 'Lecture 4' },
    ];
    for (const c of cases) {
      const before = detector.detect(c);
      const withNames = detector.detect({ ...c, participants: ['Dana Fox', 'Tom Lee'] });
      const withPersonalUser = detector.detect({ ...c, participantEmails: ['dana@acme.com'], userEmail: 'me@gmail.com' });
      assert.deepEqual(withNames, before, `names alone change nothing (${c.calendarTitle})`);
      assert.deepEqual(withPersonalUser, before, `a personal-mail user has no colleagues to compare (${c.calendarTitle})`);
    }
  });

  test('all colleagues leans Team Meet; another company leans Sales; neither decides by itself', () => {
    assert.deepEqual(participantSignals({ participantEmails: ['tom@natively.ai', 'lee@eng.natively.ai', 'evin@natively.ai'], userEmail: 'evin@natively.ai' }), [{ type: 'team-meet', w: 2, label: 'participants:all-internal' }]);
    assert.deepEqual(participantSignals({ participantEmails: ['tom@natively.ai', 'dana@acme.com'], userEmail: 'evin@natively.ai' }), [{ type: 'sales', w: 1, label: 'participants:external-company' }]);
    assert.deepEqual(participantSignals({ participantEmails: ['friend@gmail.com'], userEmail: 'evin@natively.ai' }), [], 'personal mail says nothing about a company');
    assert.deepEqual(participantSignals({ participantEmails: [], userEmail: 'evin@natively.ai' }), []);

    // Alone, never enough to leave General (the 3-point floor).
    const quiet = [seg('Hello'), seg('Hi there'), seg('Talk soon')];
    assert.equal(detector.detect({ transcript: quiet, participantEmails: ['tom@natively.ai'], userEmail: 'evin@natively.ai' }).templateType, 'general');
    // With the transcript already leaning that way, it tips it.
    const sync = [seg('Quick status update'), seg('No blockers on my side'), seg('Thanks team')];
    const plain = detector.detect({ transcript: sync });
    const internal = detector.detect({ transcript: sync, participantEmails: ['tom@natively.ai', 'lee@natively.ai'], userEmail: 'evin@natively.ai' });
    assert.ok(internal.scores['team-meet'] === plain.scores['team-meet'] + 2);
    assert.ok(internal.signals.includes('participants:all-internal'));
  });

  test('a very large room leans Lecture and Seminar by one point each', () => {
    const many = Array.from({ length: 35 }, (_, i) => `Student ${i}`);
    assert.deepEqual(participantSignals({ participants: many }).map((s) => s.type), ['lecture', 'seminar']);
    assert.deepEqual(participantSignals({ participants: many.slice(0, 10) }), []);
  });
});
