// The speech providers whose live stream labels voices, for "People sharing
// your microphone" (Settings › Audio). A copy of DIARIZING_STT_PROVIDERS
// (electron/audio/sttDiarization.ts), which the renderer cannot import;
// RoomSpeakersProviders2026_10_17.test.mjs pins the two equal. Its own file so
// RoomSpeakersSettings.tsx exports only its component (Fast Refresh).
export const ROOM_SPEAKERS_PROVIDERS: ReadonlySet<string> = new Set(['natively', 'deepgram', 'soniox']);
