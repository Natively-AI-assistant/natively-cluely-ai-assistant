import { useEffect, useState } from 'react';

/**
 * Ambient AI Chat (Settings › General), as the meeting overlay sees it.
 *
 * With the setting on, main starts a meeting without mic or system audio
 * capture and without STT (electron/main.ts, the `_ambientChatEnabled` gate in
 * the meeting's audio init). Nothing is ever transcribed, so the overlay says
 * so instead of drawing "Listening..." for audio that is not captured
 * (issue #679): the mic button raises a "Mic is off" banner with a way to turn
 * it on. (An "Ambient" pill beside the settings button was removed, 2026-10-27.)
 *
 * Main owns the fact, per meeting (`_meetingWithoutAudio`): set when a
 * meeting starts with the setting on, cleared when anything starts a capture
 * after all (a speech-engine change in Settings › Audio rebuilds the pipeline
 * mid-meeting) and when the meeting ends. The setting alone is not enough: it
 * can change mid-meeting, and main reads it only at the start. The fact is
 * read on mount (a reloaded overlay mid-meeting) and at session-reset, and
 * every change is pushed as 'meeting-audio-capture'. A pushed change wins over
 * a read that was already in flight when it came.
 */
export interface AmbientChatMeeting {
  /** This meeting captures no audio: it started with Ambient AI Chat on. */
  on: boolean;
}

export function useAmbientChatMeeting(): AmbientChatMeeting {
  const [withoutAudio, setWithoutAudio] = useState(false);

  useEffect(() => {
    const api = window.electronAPI;
    let mounted = true;
    let pushes = 0;
    const read = () => {
      const pushesAtRead = pushes;
      api?.getMeetingAudioCapture?.()
        .then((state) => {
          if (mounted && pushes === pushesAtRead) setWithoutAudio(state?.withoutAudio === true);
        })
        .catch(() => {});
    };
    read();
    const unsubReset = api?.onSessionReset?.(read);
    const unsubPush = api?.onMeetingAudioCapture?.((state) => {
      pushes += 1;
      setWithoutAudio(state?.withoutAudio === true);
    });
    return () => {
      mounted = false;
      unsubReset?.();
      unsubPush?.();
    };
  }, []);

  return { on: withoutAudio };
}
