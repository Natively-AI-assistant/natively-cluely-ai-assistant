// Whether the meeting's microphone should move to a new system default input.
//
// cpal binds a capture stream to the device it opened, on macOS and Windows
// alike. A meeting on the default mic kept that device after the user plugged
// in a USB headset or picked another mic in system settings, so they spoke
// into a mic Natively was not listening to. Interview Coder restarts its
// capture on every device change; this follows the default instead, within the
// rules reconfigureAudio already applies at meeting start:
//  - a device the user picked (or that reconfigureAudio switched to, which it
//    records as the requested device) is never left;
//  - a Bluetooth mic is not taken while a built-in one exists: opening it drops
//    the headset into call mode (HFP), the reason meeting start avoids it;
//  - only a device the input list offers is taken: following goes through the
//    mic recovery, so a default that cannot be opened would replace a working
//    mic with "gave up", and Natively's own tap device (left out of the list)
//    would transcribe system audio as the user.
// Losing the old device entirely is not this rule's job: the stream errors and
// the mic recovery reopens on the default.

export type DefaultInputDecision =
  /** Rebuild the mic on the new default. */
  | 'follow'
  /** Note the new default, do not rebuild, do not re-check it every tick. */
  | 'observe'
  /** Change nothing; look again on the next tick. */
  | 'skip';

export interface DefaultInputState {
  meetingActive: boolean;
  /** The input the meeting asked for; empty when it uses the default. */
  pinnedInput: string | null | undefined;
  hasCapture: boolean;
  /** Mic recovery or another rebuild is running. */
  busy: boolean;
  previous: string;
  current: string;
  currentIsBluetooth: boolean;
  builtInAvailable: boolean;
  /** The new default is in the selectable input list (AudioDevices.getInputDevices). */
  currentSelectable: boolean;
}

export function defaultInputDecision(s: DefaultInputState): DefaultInputDecision {
  if (!s.meetingActive || !s.hasCapture || s.busy) return 'skip';
  if (!s.current || s.current === s.previous) return 'skip';
  if (s.pinnedInput) return 'observe';
  if (!s.currentSelectable) return 'observe';
  if (s.currentIsBluetooth && s.builtInAvailable) return 'observe';
  return 'follow';
}
