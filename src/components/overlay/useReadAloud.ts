import { useCallback, useEffect, useRef, useState } from 'react';
import { createChunker, type ReadAloudChunker } from '../../lib/readAloudChunker.mjs';

/**
 * Read-aloud for AI answers, through the OS voices behind the Web Speech API
 * (window.speechSynthesis): no key, no network. The overlay feeds streamed
 * tokens with feed(); each completed sentence is queued as its own
 * utterance, so speech starts on the first sentence while the rest is still
 * streaming. A token for a different stream cuts off the previous answer.
 *
 * The toggle is a per-window convenience, saved in localStorage
 * (natively_readAloud) and off by default. Turning it off, ending the
 * meeting, or unmounting stops speech at once.
 */
export interface ReadAloud {
  supported: boolean;
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  /** One streamed token of the answer identified by streamId. */
  feed: (streamId: string | number | null | undefined, token: string) => void;
  /** The stream ended: speak whatever is left of it. */
  finish: (streamId?: string | number | null) => void;
  /** Stop speaking and forget the current stream. */
  cancel: () => void;
}

const STORAGE_KEY = 'natively_readAloud';

const synth = (): SpeechSynthesis | null =>
  typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

export function useReadAloud(): ReadAloud {
  const supported = synth() !== null;
  const [enabled, setEnabledState] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; }
  });
  const enabledRef = useRef(enabled);
  const streamRef = useRef<string | number | null>(null);
  const chunkerRef = useRef<ReadAloudChunker | null>(null);

  const speak = (sentences: string[]) => {
    const s = synth();
    if (!s) return;
    for (const text of sentences) s.speak(new SpeechSynthesisUtterance(text));
  };

  const cancel = useCallback(() => {
    streamRef.current = null;
    chunkerRef.current = null;
    synth()?.cancel();
  }, []);

  const setEnabled = useCallback((on: boolean) => {
    enabledRef.current = on;
    setEnabledState(on);
    try { localStorage.setItem(STORAGE_KEY, String(on)); } catch { /* not saved */ }
    if (!on) cancel();
  }, [cancel]);

  const feed = useCallback((streamId: string | number | null | undefined, token: string) => {
    if (!enabledRef.current || !token) return;
    const id = streamId ?? 'default';
    if (streamRef.current !== id) {
      // A new answer: whatever the previous one was still saying is stale.
      synth()?.cancel();
      streamRef.current = id;
      chunkerRef.current = createChunker();
    }
    // A finished stream keeps its id but no chunker: late tokens are ignored
    // rather than cutting off the tail that is still being spoken.
    if (chunkerRef.current) speak(chunkerRef.current.push(token));
  }, []);

  const finish = useCallback((streamId?: string | number | null) => {
    const chunker = chunkerRef.current;
    if (!chunker) return;
    if (streamId != null && streamRef.current !== streamId) return;
    chunkerRef.current = null;
    if (enabledRef.current) speak(chunker.flush());
  }, []);

  useEffect(() => {
    const off = window.electronAPI?.onMeetingStateChanged?.((data) => {
      if (!data?.isActive) cancel();
    });
    return () => { off?.(); cancel(); };
  }, [cancel]);

  return { supported, enabled, setEnabled, feed, finish, cancel };
}
