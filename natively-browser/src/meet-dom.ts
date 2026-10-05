/**
 * Who is in a Google Meet call and who is speaking, read from the page.
 *
 * Measured in a live call (2026-09-27, three participants, the host's view):
 *   - Each participant's camera tile is `[data-participant-id][data-tile-media-id]`
 *     with the two ids equal (a screen share is a second tile with its own
 *     media id). The display name is the tile's `span.notranslate`, the
 *     class Google uses to keep names out of translation: not an obfuscated one.
 *   - Speaking: each tile's voice indicator (`[jsname="QgSmzd"]`) switches its
 *     classes several times a second while that person talks (audio level
 *     steps) and holds still in silence. The classes themselves are obfuscated
 *     and change between Meet builds, so what counts is that they CHANGE, not
 *     which they are: a tile is speaking within HOLD_MS of its last change.
 *   - The user's own tile carries the self-view controls (reframe, effects:
 *     `[jsname="nsKqzb"]`, `[jsname="Ac69Jc"]`) that no other tile has.
 *   - With captions on, the "Captions" region prefixes each utterance with
 *     the speaker's name; its newest name, while its text is still growing,
 *     is speaking too (a second signal, and one that updates in a background tab).
 *
 * Limits, and what comes next:
 *   - It reads only while the Meet tab is visible: in a background tab Meet
 *     stops updating the voice indicators. Whether captions keep updating
 *     there is unverified.
 *   - Only Meet. Zoom web and Teams web readers would follow this pattern; the
 *     plan is in electron/services/meetingDetection/callRoster.ts.
 */
export interface MeetPerson {
  name: string;
  speaking: boolean;
  /** The user's own tile. */
  self?: boolean;
}

const HOLD_MS = 800;
const CAPTION_HOLD_MS = 1_500;
const INDICATOR = '[jsname="QgSmzd"]';
const SELF_MARKERS = '[jsname="nsKqzb"], [jsname="Ac69Jc"]';

interface Tile {
  el: Element;
  id: string;
  name: string;
  self: boolean;
}

function cameraTiles(doc: Document): Tile[] {
  const out: Tile[] = [];
  const seen = new Set<string>();
  for (const el of Array.from(doc.querySelectorAll('[data-participant-id][data-tile-media-id]'))) {
    const id = el.getAttribute('data-participant-id') || '';
    if (!id || el.getAttribute('data-tile-media-id') !== id || seen.has(id)) continue;
    const name = (el.querySelector('span.notranslate')?.textContent || '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    seen.add(id);
    out.push({ el, id, name, self: !!el.querySelector(SELF_MARKERS) });
  }
  return out;
}

/**
 * A reader with memory: it watches the voice indicators for changes (a
 * MutationObserver, so a change between two reads still counts) and the
 * captions for growth. `read()` answers for now.
 */
export function createMeetReader(doc: Document, now: () => number = Date.now) {
  const lastChange = new Map<string, number>(); // participant id → last indicator change
  let caption = { speaker: '', text: '', changedAt: 0 };

  const observer = new MutationObserver((mutations) => {
    const t = now();
    for (const m of mutations) {
      const el = m.target as Element;
      if (!el.closest || !el.closest(INDICATOR)) continue;
      const tile = el.closest('[data-participant-id]');
      const id = tile?.getAttribute('data-participant-id');
      if (id) lastChange.set(id, t);
    }
  });
  observer.observe(doc.body, { subtree: true, attributes: true, attributeFilter: ['class'] });

  const readCaption = (names: string[]): void => {
    // The captions region: a region naming a participant that holds no tiles
    // (the tile grid names everyone too).
    const region = Array.from(doc.querySelectorAll('[role="region"]')).find((r) =>
      !r.querySelector('[data-participant-id]') && names.some((n) => (r as HTMLElement).innerText?.includes(n)));
    const text = (region as HTMLElement | undefined)?.innerText?.replace(/\s+/g, ' ').trim() ?? '';
    if (!text) return;
    // The newest utterance's speaker: the name that appears last.
    let speaker = '';
    let at = -1;
    for (const n of names) {
      const i = text.lastIndexOf(n);
      if (i > at) { at = i; speaker = n; }
    }
    const tail = text.slice(Math.max(0, text.length - 200));
    if (!speaker || (speaker === caption.speaker && tail === caption.text)) return;
    // The first look only learns what is already there: old captions are not speech now.
    caption = { speaker, text: tail, changedAt: caption.text ? now() : 0 };
  };

  return {
    read(): MeetPerson[] {
      const tiles = cameraTiles(doc);
      readCaption(tiles.map((t) => t.name));
      const t = now();
      return tiles.map((tile) => ({
        name: tile.name,
        speaking: t - (lastChange.get(tile.id) ?? -Infinity) < HOLD_MS
          || (caption.speaker === tile.name && t - caption.changedAt < CAPTION_HOLD_MS),
        ...(tile.self ? { self: true } : {}),
      }));
    },
    stop(): void {
      observer.disconnect();
    },
  };
}

/** One-shot read with no history (who is in the call; nobody counts as speaking). */
export function readMeetPeople(doc: Document): MeetPerson[] {
  return cameraTiles(doc).map((tile) => ({ name: tile.name, speaking: false, ...(tile.self ? { self: true } : {}) }));
}
