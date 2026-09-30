// GENERATED from the recording takes' logs (ffprobe sizes and durations, step
// times from the driving script's marks) — edit the takes, not these numbers.
// Every clip was recorded on macOS against the dev build (2026-09-30); which
// platform may show each one is decided in src/lib/helpContent.mjs (`clips`).
import type { HelpClipSource } from './HelpParts';
import answerDark from '../../../assets/help/answer-dark.webm';
import autoanswerDark from '../../../assets/help/autoanswer-dark.webm';
import speechDark from '../../../assets/help/speech-dark.webm';
import speechLight from '../../../assets/help/speech-light.webm';
import modelDark from '../../../assets/help/model-dark.webm';
import modelLight from '../../../assets/help/model-light.webm';
import retrievalDark from '../../../assets/help/retrieval-dark.webm';
import retrievalLight from '../../../assets/help/retrieval-light.webm';
import stealthDark from '../../../assets/help/stealth-dark.webm';
import stealthLight from '../../../assets/help/stealth-light.webm';
import verifyDark from '../../../assets/help/verify-dark.webm';
import verifyLight from '../../../assets/help/verify-light.webm';
import syncDark from '../../../assets/help/sync-dark.webm';
import syncLight from '../../../assets/help/sync-light.webm';
import phoneDark from '../../../assets/help/phone-dark.webm';
import modesDark from '../../../assets/help/modes-dark.webm';
import modesLight from '../../../assets/help/modes-light.webm';
import profileDark from '../../../assets/help/profile-dark.webm';
import profileLight from '../../../assets/help/profile-light.webm';
import notesDark from '../../../assets/help/notes-dark.webm';
import notesLight from '../../../assets/help/notes-light.webm';
import followupDark from '../../../assets/help/followup-dark.webm';
import searchDark from '../../../assets/help/search-dark.webm';
import searchLight from '../../../assets/help/search-light.webm';
import permissionsCardDark from '../../../assets/help/permissions-card-dark.webp';
import permissionsCardLight from '../../../assets/help/permissions-card-light.webp';

export interface HelpClipEntry extends HelpClipSource {
  /** What the recording shows, for screen readers. */
  label: string;
}

export const HELP_CLIPS = {
  // The overlay over a plain backdrop during a real meeting: a spoken question,
  // then What to answer?. One version: it is the overlay, not Settings UI.
  answer: {
    label: "Screen recording of a meeting: the interviewer asks how to design a rate limiter, What to answer? is pressed, and a suggested answer streams into the overlay.",
    dark: { src: answerDark, size: [972, 712], duration: 15.6, chapters: [{ at: 0.6, label: "They ask a question" }, { at: 7.32, label: "Press What to answer?" }, { at: 9.78, label: "Say the answer" }] },
  },
  // Auto Answer on, nothing pressed: the answer starts when the question ends.
  autoanswer: {
    label: "The overlay with Auto Answer on: the interviewer asks about pushing back on a deadline, and an answer appears on its own when the question ends.",
    dark: { src: autoanswerDark, size: [972, 766], duration: 14.33, chapters: [{ at: 0.6, label: "They ask a question" }, { at: 8.75, label: "The answer appears" }] },
  },
  speech: {
    label: "Settings, Audio: the Speech Provider list opens, Deepgram is picked (its saved key shows as dots), then Language is set to English.",
    dark: { src: speechDark, size: [972, 866], duration: 14.57, chapters: [{ at: 0.6, label: "Open providers" }, { at: 3.37, label: "Pick one" }, { at: 7.03, label: "Set language" }] },
    light: { src: speechLight, size: [972, 866], duration: 14.5, chapters: [{ at: 0.6, label: "Open providers" }, { at: 3.41, label: "Pick one" }, { at: 6.98, label: "Set language" }] },
  },
  model: {
    label: "Settings, AI Providers: the Active Model menu opens, another model is picked, then the page scrolls to the Cloud Providers keys.",
    dark: { src: modelDark, size: [972, 866], duration: 12.57, chapters: [{ at: 0.6, label: "Open Active Model" }, { at: 3.57, label: "Pick a model" }, { at: 6.86, label: "Or add a key" }] },
    light: { src: modelLight, size: [972, 866], duration: 12.57, chapters: [{ at: 0.6, label: "Open Active Model" }, { at: 3.61, label: "Pick a model" }, { at: 6.89, label: "Or add a key" }] },
  },
  retrieval: {
    label: "Settings, Retrieval: the Active Embedding Model and Active Reranker Model menus open in turn, then the page scrolls to the on-device models on the Embedding and Reranker tabs.",
    dark: { src: retrievalDark, size: [972, 866], duration: 20.37, chapters: [{ at: 0.6, label: "Choose an embedder" }, { at: 5.18, label: "Choose a reranker" }, { at: 9.51, label: "Or run on this device" }] },
    light: { src: retrievalLight, size: [972, 866], duration: 20.33, chapters: [{ at: 0.6, label: "Choose an embedder" }, { at: 5.14, label: "Choose a reranker" }, { at: 9.43, label: "Or run on this device" }] },
  },
  stealth: {
    label: "Settings, General: Terminal is picked under Process Disguise, then the Detectable switch is turned on and reads Undetectable.",
    dark: { src: stealthDark, size: [972, 866], duration: 12.5, chapters: [{ at: 0.6, label: "Pick a disguise" }, { at: 6.64, label: "Turn on Undetectable" }] },
    light: { src: stealthLight, size: [972, 866], duration: 12.4, chapters: [{ at: 0.6, label: "Pick a disguise" }, { at: 6.56, label: "Turn on Undetectable" }] },
  },
  verify: {
    label: "Settings, General: Show advanced settings opens, then Verify coding answers is turned on.",
    dark: { src: verifyDark, size: [972, 866], duration: 11.03, chapters: [{ at: 0.6, label: "Show advanced settings" }, { at: 4.56, label: "Turn on Verify coding answers" }] },
    light: { src: verifyLight, size: [972, 866], duration: 10.97, chapters: [{ at: 0.6, label: "Show advanced settings" }, { at: 4.51, label: "Turn on Verify coding answers" }] },
  },
  sync: {
    label: "Settings, Sync: Enable Phone Mirror and Allow LAN access are turned on, then Show code reveals the pairing code (blurred here).",
    dark: { src: syncDark, size: [972, 866], duration: 14.5, chapters: [{ at: 0.6, label: "Enable Phone Mirror" }, { at: 4.53, label: "Allow LAN access" }, { at: 8.35, label: "Scan the code" }] },
    light: { src: syncLight, size: [972, 866], duration: 14.53, chapters: [{ at: 0.6, label: "Enable Phone Mirror" }, { at: 4.53, label: "Allow LAN access" }, { at: 8.41, label: "Scan the code" }] },
  },
  // The companion page in a phone-sized browser during a real meeting.
  phone: {
    label: "Phone Mirror on a phone: the live transcript shows the interviewer's question, What to Say is tapped, and the answer streams onto the phone.",
    dark: { src: phoneDark, size: [972, 760], duration: 13.17, chapters: [{ at: 0.6, label: "They ask a question" }, { at: 6.59, label: "Tap What to Say" }, { at: 9.07, label: "Read the answer" }] },
  },
  modes: {
    label: "The Launcher: Modes opens, Technical Interview is picked, a Real-time prompt is typed and saved, then Set active.",
    dark: { src: modesDark, size: [972, 680], duration: 21.47, chapters: [{ at: 0.6, label: "Open Modes" }, { at: 4.21, label: "Pick a mode" }, { at: 7.46, label: "Write a prompt" }, { at: 15.78, label: "Set it active" }] },
    light: { src: modesLight, size: [972, 680], duration: 21.43, chapters: [{ at: 0.6, label: "Open Modes" }, { at: 4.14, label: "Pick a mode" }, { at: 7.41, label: "Write a prompt" }, { at: 15.79, label: "Set it active" }] },
  },
  profile: {
    label: "The Launcher: Profile Intelligence opens on the résumé and job description, then the Profile tab lists the experience and Role Insight shows the match.",
    dark: { src: profileDark, size: [972, 680], duration: 20.63, chapters: [{ at: 0.6, label: "Open Profile" }, { at: 4.35, label: "Your documents" }, { at: 8.53, label: "Your profile" }, { at: 12.87, label: "Check your fit" }] },
    light: { src: profileLight, size: [972, 680], duration: 20.57, chapters: [{ at: 0.6, label: "Open Profile" }, { at: 4.34, label: "Your documents" }, { at: 8.49, label: "Your profile" }, { at: 12.82, label: "Check your fit" }] },
  },
  notes: {
    label: "The Launcher: a finished meeting opens on its notes, then its transcript, then a question typed into Ask about this meeting is answered from it.",
    dark: { src: notesDark, size: [972, 778], duration: 32.7, chapters: [{ at: 0.6, label: "Open a meeting" }, { at: 4.75, label: "Read the notes" }, { at: 9.34, label: "See transcript" }, { at: 15.14, label: "Ask about it" }] },
    light: { src: notesLight, size: [972, 778], duration: 25.6, chapters: [{ at: 0.6, label: "Open a meeting" }, { at: 4.78, label: "Read the notes" }, { at: 9.35, label: "See transcript" }, { at: 14.88, label: "Ask about it" }] },
  },
  // One version: the draft is written once per meeting.
  followup: {
    label: "A meeting's notes: Generate under Follow-up email writes a draft with a subject line, a tone menu and Copy.",
    dark: { src: followupDark, size: [972, 778], duration: 17.07, chapters: [{ at: 0.6, label: "Find Follow-up email" }, { at: 3.2, label: "Press Generate" }, { at: 9.41, label: "Copy or change tone" }] },
  },
  search: {
    label: "The Launcher: the search bar opens, typing part of a title finds a past meeting, and choosing it opens its notes.",
    dark: { src: searchDark, size: [972, 744], duration: 12.8, chapters: [{ at: 0.6, label: "Open search" }, { at: 3.35, label: "Find a meeting" }, { at: 6.4, label: "Open it" }] },
    light: { src: searchLight, size: [972, 744], duration: 12.83, chapters: [{ at: 0.6, label: "Open search" }, { at: 3.34, label: "Find a meeting" }, { at: 6.43, label: "Open it" }] },
  },
} satisfies Record<string, HelpClipEntry>;

/** The launcher's permissions card, as a still: it has nothing to play. */
export const PERMISSIONS_CARD = {
  dark: permissionsCardDark,
  light: permissionsCardLight,
  size: [1156, 836] as const,
};
