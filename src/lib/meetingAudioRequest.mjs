// The audio devices a meeting start asks main for (2026-11-02), from the
// choices saved in this renderer's localStorage. One place for the launcher's
// Start (App.tsx) and Resume in the notepad (NotesWindow.tsx), which are
// different windows of the same origin, so both start a meeting the same way.
//
//   input    the saved microphone, unless it is one of Natively's own capture
//            devices (the system-audio tap aggregate was once saved here and
//            failed every meeting); main falls back to the default.
//   output   'sck' (ScreenCaptureKit) only on macOS with the experimental
//            switch on: that backend exists only in the macOS speaker module,
//            and a synced key on Windows would hand WASAPI an unknown device.
//            Otherwise the saved output device (CoreAudio on macOS, WASAPI on
//            Windows; main picks the default when it is null).
//
// Pure: storage reads and the platform are passed in (meetingAudioRequest.test.mjs).

/**
 * @param {{ savedInput: string | null, savedOutput: string | null, experimentalSck: boolean, isMac: boolean, isInternal: (id: string | null) => boolean }} input
 * @returns {{ inputDeviceId: string | null, outputDeviceId: string | null, discardSavedInput: boolean, backend: 'sck' | 'coreaudio' | 'default' }}
 */
export function meetingAudioRequest({ savedInput, savedOutput, experimentalSck, isMac, isInternal }) {
  const discardSavedInput = !!savedInput && isInternal(savedInput);
  const inputDeviceId = discardSavedInput ? null : (savedInput ?? null);
  const useSck = isMac && experimentalSck === true;
  return {
    inputDeviceId,
    outputDeviceId: useSck ? 'sck' : (savedOutput ?? null),
    discardSavedInput,
    backend: useSck ? 'sck' : isMac ? 'coreaudio' : 'default',
  };
}
