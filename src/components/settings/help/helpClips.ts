// GENERATED from the recording takes' logs (ffprobe sizes and durations, step
// times from the driving script's marks) — edit the takes, not these numbers.
// Every clip was recorded on macOS against the dev build; which platform may
// show each one is decided in src/lib/helpContent.mjs (`clips`).
import type { HelpClipSource } from './HelpParts';
import answerDark from '../../../assets/help/answer-dark.webm';
import speechDark from '../../../assets/help/speech-dark.webm';
import speechLight from '../../../assets/help/speech-light.webm';
import modelDark from '../../../assets/help/model-dark.webm';
import modelLight from '../../../assets/help/model-light.webm';
import stealthDark from '../../../assets/help/stealth-dark.webm';
import stealthLight from '../../../assets/help/stealth-light.webm';
import verifyDark from '../../../assets/help/verify-dark.webm';
import verifyLight from '../../../assets/help/verify-light.webm';
import syncDark from '../../../assets/help/sync-dark.webm';
import syncLight from '../../../assets/help/sync-light.webm';
import modesDark from '../../../assets/help/modes-dark.webm';
import modesLight from '../../../assets/help/modes-light.webm';
import profileDark from '../../../assets/help/profile-dark.webm';
import profileLight from '../../../assets/help/profile-light.webm';
import notesDark from '../../../assets/help/notes-dark.webm';
import notesLight from '../../../assets/help/notes-light.webm';
import searchDark from '../../../assets/help/search-dark.webm';
import searchLight from '../../../assets/help/search-light.webm';
import permissionsCardDark from '../../../assets/help/permissions-card-dark.webp';
import permissionsCardLight from '../../../assets/help/permissions-card-light.webp';

export interface HelpClipEntry extends HelpClipSource {
  /** What the recording shows, for screen readers. */
  label: string;
}

export const HELP_CLIPS = {
  // Screen recording of a real meeting: a spoken question, then What to
  // answer?. One version: it is footage of a desktop, not Settings UI. Its
  // steps were found in the frames (the bubble appearing, the first answer
  // text); the press itself isn't drawn.
  answer: {
    label: "The overlay during a meeting: the interviewer's question scrolls past in the live transcript, What to answer? is pressed, and a suggested answer appears.",
    dark: { src: answerDark, size: [972, 646], duration: 17.3, chapters: [{ at: 0.7, label: "They ask a question" }, { at: 10.6, label: "Press What to answer?" }, { at: 12.1, label: "Say the answer" }] },
  },
  speech: {
    label: "Settings, Audio: the Speech Provider list opens, Deepgram is picked and a key is typed into its field (shown as dots), then Language is set to English.",
    dark: { src: speechDark, size: [972, 866], duration: 17.33, chapters: [{ at: 0.7, label: "Open providers" }, { at: 2.49, label: "Pick one" }, { at: 6.24, label: "Add its key" }, { at: 11.85, label: "Set language" }] },
    light: { src: speechLight, size: [972, 866], duration: 17.13, chapters: [{ at: 0.7, label: "Open providers" }, { at: 2.56, label: "Pick one" }, { at: 6.33, label: "Add its key" }, { at: 11.5, label: "Set language" }] },
  },
  model: {
    label: "Settings, AI Providers: the Active Model menu opens, another model is picked, then the page scrolls to the Cloud Providers keys.",
    dark: { src: modelDark, size: [972, 802], duration: 9.23, chapters: [{ at: 0.7, label: "Open Active Model" }, { at: 2.57, label: "Pick a model" }, { at: 5.9, label: "Or add a key" }] },
    light: { src: modelLight, size: [972, 802], duration: 9.2, chapters: [{ at: 0.7, label: "Open Active Model" }, { at: 2.59, label: "Pick a model" }, { at: 5.92, label: "Or add a key" }] },
  },
  stealth: {
    label: "Settings, General: Terminal is picked under Process Disguise, then the Detectable switch is turned on and reads Undetectable.",
    dark: { src: stealthDark, size: [972, 866], duration: 9.57, chapters: [{ at: 0.6, label: "Pick a disguise" }, { at: 4.81, label: "Turn on Undetectable" }] },
    light: { src: stealthLight, size: [972, 866], duration: 9.6, chapters: [{ at: 0.6, label: "Pick a disguise" }, { at: 4.73, label: "Turn on Undetectable" }] },
  },
  verify: {
    label: "Settings, General: Show advanced settings opens, then Verify coding answers is turned on.",
    dark: { src: verifyDark, size: [972, 866], duration: 7.23, chapters: [{ at: 0.6, label: "Show advanced settings" }, { at: 3.89, label: "Turn on Verify coding answers" }] },
    light: { src: verifyLight, size: [972, 866], duration: 7.23, chapters: [{ at: 0.6, label: "Show advanced settings" }, { at: 3.89, label: "Turn on Verify coding answers" }] },
  },
  sync: {
    label: "Settings, Sync: Enable Phone Mirror and Allow LAN access are turned on, then Show code reveals the pairing code (blurred here).",
    dark: { src: syncDark, size: [972, 866], duration: 8.07, chapters: [{ at: 0.6, label: "Enable Phone Mirror" }, { at: 3.04, label: "Allow LAN access" }, { at: 5.21, label: "Scan the code" }] },
    light: { src: syncLight, size: [972, 866], duration: 8.07, chapters: [{ at: 0.6, label: "Enable Phone Mirror" }, { at: 3.06, label: "Allow LAN access" }, { at: 5.22, label: "Scan the code" }] },
  },
  modes: {
    label: "The Launcher: Modes opens, Technical Interview is picked, a Real-time prompt is typed and saved, then Set active.",
    dark: { src: modesDark, size: [972, 710], duration: 16.27, chapters: [{ at: 0.6, label: "Open Modes" }, { at: 3.21, label: "Pick a mode" }, { at: 5.52, label: "Write a prompt" }, { at: 13.18, label: "Set it active" }] },
    light: { src: modesLight, size: [972, 710], duration: 15.73, chapters: [{ at: 0.6, label: "Open Modes" }, { at: 3.1, label: "Pick a mode" }, { at: 5.41, label: "Write a prompt" }, { at: 12.65, label: "Set it active" }] },
  },
  profile: {
    label: "The Launcher: Profile Intelligence opens on Upload file; after a résumé and job description are added, the Profile tab lists the experience and Role Insight shows the match.",
    dark: { src: profileDark, size: [972, 710], duration: 11.83, chapters: [{ at: 0.6, label: "Open Profile" }, { at: 3.19, label: "Add your files" }, { at: 4.5, label: "Your profile" }, { at: 9.32, label: "Check your fit" }] },
    light: { src: profileLight, size: [972, 710], duration: 11.03, chapters: [{ at: 0.6, label: "Open Profile" }, { at: 3.11, label: "Add your files" }, { at: 4.43, label: "Your profile" }, { at: 8.53, label: "Check your fit" }] },
  },
  notes: {
    label: "The Launcher: a finished meeting opens on its notes, then its transcript, then a question typed into Ask about this meeting is answered from it.",
    dark: { src: notesDark, size: [972, 648], duration: 21.63, chapters: [{ at: 0.6, label: "Open a meeting" }, { at: 3.42, label: "Read the notes" }, { at: 8.06, label: "See transcript" }, { at: 13.22, label: "Ask about it" }] },
    light: { src: notesLight, size: [972, 648], duration: 21.53, chapters: [{ at: 0.6, label: "Open a meeting" }, { at: 3.42, label: "Read the notes" }, { at: 7.98, label: "See transcript" }, { at: 13.14, label: "Ask about it" }] },
  },
  search: {
    label: "The Launcher: the search bar opens, typing part of a title finds a past meeting, and choosing it opens its notes.",
    dark: { src: searchDark, size: [972, 648], duration: 7.7, chapters: [{ at: 0.6, label: "Open search" }, { at: 1.51, label: "Find a meeting" }, { at: 4.22, label: "Open it" }] },
    light: { src: searchLight, size: [972, 648], duration: 7.63, chapters: [{ at: 0.6, label: "Open search" }, { at: 1.51, label: "Find a meeting" }, { at: 4.16, label: "Open it" }] },
  },
} satisfies Record<string, HelpClipEntry>;

/** The launcher's permissions card, as a still: it has nothing to play. */
export const PERMISSIONS_CARD = {
  dark: permissionsCardDark,
  light: permissionsCardLight,
  size: [1156, 836] as const,
};
