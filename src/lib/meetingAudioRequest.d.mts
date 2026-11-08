export function meetingAudioRequest(input: {
  savedInput: string | null;
  savedOutput: string | null;
  experimentalSck: boolean;
  isMac: boolean;
  isInternal: (id: string | null) => boolean;
}): {
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  discardSavedInput: boolean;
  backend: 'sck' | 'coreaudio' | 'default';
};
