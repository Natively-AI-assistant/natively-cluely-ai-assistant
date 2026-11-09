// src/hooks/useCornerSlot.ts
//
// A bottom-right notice's share of the corner (src/lib/cornerSlot.mjs). While
// `wants` is true the notice asks for the corner; it is shown only while it
// holds it. `displaced` is true when it wants the corner but a higher one has
// it: the notice then leaves at once (GenieModal closeInstantly), the hand-over
// the update card already uses, so only the incoming notice pours.
import { useEffect, useSyncExternalStore } from 'react';
import { cornerSlot, type CornerNoticeId } from '../lib/cornerSlot.mjs';

const subscribe = (listener: () => void) => cornerSlot.subscribe(listener);
const holder = () => cornerSlot.holder();

export function useCornerSlot(id: CornerNoticeId, wants: boolean): { show: boolean; displaced: boolean } {
  useEffect(() => {
    if (!wants) return;
    cornerSlot.request(id);
    return () => cornerSlot.release(id);
  }, [id, wants]);
  const current = useSyncExternalStore(subscribe, holder);
  const show = wants && current === id;
  return { show, displaced: wants && !show };
}
