// F-122 repro: the rag:stream-* scope discriminator was populated at every send
// site and read at none.
//
// Main emits three payload shapes on ONE channel — {meetingId,chunk},
// {live:true,chunk}, {global:true,chunk} — but all three renderer consumers
// destructured {chunk} only. GlobalChatOverlay and MeetingDetails (which hosts
// MeetingChatOverlay) are siblings in the SAME Launcher renderer, and
// abortPriorRAGQueriesOfClass supersedes only WITHIN a class, so two
// different-class queries can genuinely be in flight together — and either
// could paint into the other's bubble.
//
// Verifies each consumer now filters by its own scope, and that the preload
// type union admits `live` (it was omitted, so the field was invisible to TS).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const read = (r) => fs.readFileSync(path.join(root, r), 'utf8');

let bad = false;

const global_ = read('src/components/GlobalChatOverlay.tsx');
if (!/const isGlobal = \(d: any\) => d\?\.global === true;/.test(global_)) {
  console.error('[F-122] GlobalChatOverlay does not define a scope predicate'); bad = true;
}
const globalGuards = (global_.match(/isGlobal\(data\)/g) ?? []).length;
if (globalGuards < 3) {
  console.error(`[F-122] GlobalChatOverlay guards only ${globalGuards}/3 listeners (chunk/complete/error)`); bad = true;
} else console.log('[F-122] ok — GlobalChatOverlay filters all three listeners');

const meeting = read('src/components/MeetingChatOverlay.tsx');
if (!/d\?\.global !== true && d\?\.live !== true/.test(meeting)) {
  console.error('[F-122] MeetingChatOverlay does not exclude global/live payloads'); bad = true;
}
if (!/d\.meetingId === meetingContext\?\.id/.test(meeting)) {
  console.error('[F-122] MeetingChatOverlay does not bind to THIS meeting'); bad = true;
}
const meetingGuards = (meeting.match(/isThisMeeting\(data\)/g) ?? []).length;
if (meetingGuards < 3) {
  console.error(`[F-122] MeetingChatOverlay guards only ${meetingGuards}/3 listeners`); bad = true;
} else console.log('[F-122] ok — MeetingChatOverlay filters all three listeners');

const preload = read('electron/preload.ts');
if (!/global\?: boolean; live\?: boolean; chunk: string/.test(preload)) {
  console.error('[F-122] the preload chunk type still omits `live`'); bad = true;
} else console.log('[F-122] ok — the preload type union admits `live`');

// Behavioural check of the predicates themselves.
const isGlobal = (d) => d?.global === true;
const isThisMeeting = (d, id) => d?.global !== true && d?.live !== true && (d?.meetingId == null || d.meetingId === id);
const cases = [
  [isGlobal({ global: true, chunk: 'x' }), true, 'global accepts its own'],
  [isGlobal({ meetingId: 'm1', chunk: 'x' }), false, 'global rejects meeting-scoped'],
  [isGlobal({ live: true, chunk: 'x' }), false, 'global rejects live'],
  [isThisMeeting({ meetingId: 'm1' }, 'm1'), true, 'meeting accepts its own'],
  [isThisMeeting({ meetingId: 'm2' }, 'm1'), false, 'meeting rejects another meeting'],
  [isThisMeeting({ global: true }, 'm1'), false, 'meeting rejects global'],
  [isThisMeeting({ live: true }, 'm1'), false, 'meeting rejects live'],
];
for (const [got, want, why] of cases) {
  if (got !== want) { console.error(`[F-122] predicate wrong: ${why}`); bad = true; }
}

if (bad) { console.error('[F-122] FAIL (F-122 reproduced).'); process.exit(1); }
console.log('[F-122] PASS: every RAG consumer honours the scope discriminator main already sends.');
process.exit(0);
