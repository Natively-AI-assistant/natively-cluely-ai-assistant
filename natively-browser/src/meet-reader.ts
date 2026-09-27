/**
 * The Meet reader: a content script on Google Meet, registered by the service
 * worker only while the desktop's meeting detection asks for it and the user
 * granted meet.google.com ("Read names in Google Meet" in the popup).
 *
 * It reports, to the local Natively app only, who is in the call and who is
 * speaking (meet-dom.ts reads that from the page): on every change, and every
 * couple of seconds regardless, so a long turn keeps its span open on the
 * desktop. Nothing else about the page, and nothing while not in a call.
 */
import { meetingRefOf } from '../../electron/services/meetingDetection/meetingLinks';
import { createMeetReader } from './meet-dom';

const TICK_MS = 400;
const HEARTBEAT_MS = 2_000;

(() => {
  const w = window as unknown as { __nativelyMeetReader?: boolean };
  if (w.__nativelyMeetReader) return; // injected twice (open tab + registration)
  w.__nativelyMeetReader = true;

  const reader = createMeetReader(document);
  let last = '';
  let sentAt = 0;
  const tick = () => {
    const ref = meetingRefOf(location.href);
    if (!ref) return;
    const people = reader.read();
    if (people.length === 0) return; // not in the call (lobby, left)
    const json = JSON.stringify(people);
    const now = Date.now();
    if (json === last && now - sentAt < HEARTBEAT_MS) return;
    last = json;
    sentAt = now;
    try {
      void chrome.runtime.sendMessage({ type: 'meet-people', key: ref.key, people }).catch(() => {});
    } catch (_) {
      // The extension was reloaded: this copy is orphaned; stop.
      clearInterval(timer);
      reader.stop();
    }
  };
  const timer = setInterval(tick, TICK_MS);
})();
