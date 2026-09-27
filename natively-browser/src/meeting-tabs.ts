/**
 * The open meeting tabs, as the desktop app's meeting detection asked for them
 * (`meeting-tabs-subscribe`). It links a Natively session to its calendar event
 * by the meeting link itself.
 *
 * Only a tab whose address joins a meeting is reported, and only as that
 * meeting's key (`meet:abc-defg-hij`, `zoom:81234567890`): never the address,
 * which for Zoom carries the passcode, and never any other tab. Incognito tabs
 * are never reported. The key rules are the app's own (meetingLinks.ts), so
 * both sides agree on what counts as the same meeting.
 */
import { meetingRefOf } from '../../electron/services/meetingDetection/meetingLinks';

export interface MeetingTabReport {
  key: string;
  title: string;
  /** Sound is playing: the call's audio. */
  audible: boolean;
  /** The tab in front of its window. */
  active: boolean;
}

export interface MeetingTabLike {
  url?: string;
  pendingUrl?: string;
  title?: string;
  audible?: boolean;
  active?: boolean;
  incognito?: boolean;
  lastAccessed?: number;
}

export const MAX_MEETING_TABS = 8;
const MAX_TITLE = 120;

/** The report for these tabs: one per meeting, the likeliest call first. */
export function meetingTabsReport(tabs: readonly MeetingTabLike[]): MeetingTabReport[] {
  const ordered = [...tabs].sort((a, b) =>
    Number(!!b.audible) - Number(!!a.audible)
    || Number(!!b.active) - Number(!!a.active)
    || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  const out: MeetingTabReport[] = [];
  const seen = new Set<string>();
  for (const tab of ordered) {
    if (tab.incognito) continue;
    const ref = meetingRefOf(tab.url || tab.pendingUrl || '');
    if (!ref || seen.has(ref.key)) continue;
    seen.add(ref.key);
    out.push({ key: ref.key, title: (tab.title || '').slice(0, MAX_TITLE), audible: !!tab.audible, active: !!tab.active });
    if (out.length >= MAX_MEETING_TABS) break;
  }
  return out;
}
