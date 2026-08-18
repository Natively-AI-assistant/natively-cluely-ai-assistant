// F-303 repro: the renderer's chat-stream guard superseded ACROSS surfaces.
//
// The desktop and phone-mirror paths allocate stream ids from ONE shared
// counter (`++_chatStreamId`) in the main process, and the renderer guard was
// strictly newest-numeric-wins. So a phone chat started while a desktop answer
// was streaming adopted the desktop bubble (its id is higher), appended phone
// text into it, and then DROPPED every remaining desktop token as "stale" —
// truncating the answer on screen while the main process kept streaming it.
// The phone's finalText-less done then finalized that mixed row, and the
// desktop's own later done was ALSO honored (double finalize).
//
// Both the main-process comment ("cross-surface false supersession can't
// happen") and the renderer comment ("a phone-mirror or stale desktop stream
// can't bleed into the active bubble") assert the opposite of what the code did.
//
// Expected (correct): a phone stream cannot take over a live desktop bubble.
// Bug (F-303): it adopts it and truncates the desktop answer → exit 1.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { resolveChatStreamToken, resolveChatStreamDone } =
  await import(path.resolve(__dirname, '../../src/lib/chatStreamGuard.mjs'));

let bad = false;
const show = (label, o) => console.log(`  ${label}:`, JSON.stringify(o));

// Desktop stream 41 is live and rendering.
let active = resolveChatStreamToken(null, 41, null, undefined);
show('desktop#41 adopted', active);

// A phone chat starts mid-answer and gets the NEXT id from the shared counter.
const phoneTok = resolveChatStreamToken(active.activeId, 42, active.activeSource, 'phone');
show('phone#42 token arrives', phoneTok);
if (phoneTok.accept) { console.error('[F-303] phone token was appended into the live desktop bubble'); bad = true; }

// The desktop stream keeps emitting; those tokens must still render.
const deskTok = resolveChatStreamToken(phoneTok.activeId, 41, phoneTok.activeSource, undefined);
show('desktop#41 continues', deskTok);
if (!deskTok.accept) { console.error('[F-303] remaining desktop tokens were dropped — the answer truncates on screen'); bad = true; }

// The phone's done (which carries no finalText) must not finalize the desktop row.
const phoneDone = resolveChatStreamDone(deskTok.activeId, 42, deskTok.activeSource, 'phone');
show('phone#42 done', phoneDone);
if (phoneDone.honor) { console.error("[F-303] the phone's done finalized the desktop bubble"); bad = true; }

// The desktop's own done still finalizes normally.
const deskDone = resolveChatStreamDone(deskTok.activeId, 41, deskTok.activeSource, undefined);
show('desktop#41 done', deskDone);
if (!deskDone.honor) { console.error('[F-303] the desktop stream could not finalize its own row'); bad = true; }

// Same-surface supersession must still work (a newer desktop turn wins).
const newerDesktop = resolveChatStreamToken(41, 43, 'desktop', undefined);
show('desktop#43 supersedes #41', newerDesktop);
if (!newerDesktop.accept || newerDesktop.activeId !== 43) { console.error('[F-303] same-surface supersession broke'); bad = true; }

// Back-compat: an id-less token is still accepted and changes nothing.
const legacy = resolveChatStreamToken(41, undefined, 'desktop', undefined);
if (!legacy.accept || legacy.activeId !== 41) { console.error('[F-303] id-less back-compat broke'); bad = true; }

if (bad) { console.error('[F-303] FAIL (F-303 reproduced).'); process.exit(1); }
console.log('[F-303] PASS: supersession is surface-scoped; the phone cannot hijack or finalize a live desktop bubble, and same-surface supersession still works.');
process.exit(0);
