// GENERATED from the recording takes' logs (ffprobe sizes and durations, step
// times from the driving script's marks) — edit the takes, not these numbers.
// Every clip was recorded on macOS against the dev build, all of them re-recorded
// for 3.0 on 2026-11-01 in dark and light (VP9, TV range: full-range VP9 shows a
// blank box in Electron).
// Which platform may show each one is decided in src/lib/helpContent.mjs (`clips`).
import type { HelpClipSource } from './HelpParts';
import answerDark from '../../../assets/help/answer-dark.webm';
import answerLight from '../../../assets/help/answer-light.webm';
import autoanswerDark from '../../../assets/help/autoanswer-dark.webm';
import autoanswerLight from '../../../assets/help/autoanswer-light.webm';
import overlayDark from '../../../assets/help/overlay-dark.webm';
import overlayLight from '../../../assets/help/overlay-light.webm';
import notepadDark from '../../../assets/help/notepad-dark.webm';
import notepadLight from '../../../assets/help/notepad-light.webm';
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
import phoneDark from '../../../assets/help/phone-dark.webm';
import phoneLight from '../../../assets/help/phone-light.webm';
import syncDark from '../../../assets/help/sync-dark.webm';
import syncLight from '../../../assets/help/sync-light.webm';
import modesDark from '../../../assets/help/modes-dark.webm';
import modesLight from '../../../assets/help/modes-light.webm';
import profileDark from '../../../assets/help/profile-dark.webm';
import profileLight from '../../../assets/help/profile-light.webm';
import buttonsDark from '../../../assets/help/buttons-dark.webm';
import buttonsLight from '../../../assets/help/buttons-light.webm';
import notesDark from '../../../assets/help/notes-dark.webm';
import notesLight from '../../../assets/help/notes-light.webm';
import followupDark from '../../../assets/help/followup-dark.webm';
import followupLight from '../../../assets/help/followup-light.webm';
import shareDark from '../../../assets/help/share-dark.webm';
import shareLight from '../../../assets/help/share-light.webm';
import mcpDark from '../../../assets/help/mcp-dark.webm';
import mcpLight from '../../../assets/help/mcp-light.webm';
import calendarDark from '../../../assets/help/calendar-dark.webm';
import calendarLight from '../../../assets/help/calendar-light.webm';
import searchDark from '../../../assets/help/search-dark.webm';
import searchLight from '../../../assets/help/search-light.webm';
import permissionsCardDark from '../../../assets/help/permissions-card-dark.webp';
import permissionsCardLight from '../../../assets/help/permissions-card-light.webp';

export interface HelpClipEntry extends HelpClipSource {
  /** What the recording shows, for screen readers. */
  label: string;
}

export const HELP_CLIPS = {
  // The overlay over a pastel backdrop during a bench interview (fictional
  // people): a question plays, then What to answer?. Its height is pinned.
  answer: {
    label: "The overlay during an interview: the interviewer asks about an outage during Monday morning check-ins, What to answer? is pressed, and a suggested answer streams in.",
    dark: { src: answerDark, size: [972, 674], duration: 18.1, chapters: [{ at: 0.51, label: "They ask a question" }, { at: 10.66, label: "Press What to answer?" }, { at: 12.67, label: "Say the answer" }] },
    light: { src: answerLight, size: [972, 674], duration: 18.9, chapters: [{ at: 0.51, label: "They ask a question" }, { at: 10.68, label: "Press What to answer?" }, { at: 13.48, label: "Say the answer" }] },
  },
  // Auto Answer on, nothing pressed: the answer starts when the question ends.
  autoanswer: {
    label: "The overlay with Auto Answer on: the other side asks a question, and an answer appears on its own when they finish, with nothing pressed.",
    dark: { src: autoanswerDark, size: [972, 674], duration: 14.13, chapters: [{ at: 0.51, label: "They ask a question" }, { at: 7.08, label: "The answer appears" }] },
    light: { src: autoanswerLight, size: [972, 674], duration: 14.93, chapters: [{ at: 0.51, label: "They ask a question" }, { at: 8.7, label: "The answer appears" }] },
  },
  // The overlay over a pastel backdrop during a bench call (fictional people):
  // a question plays, then What to answer?. Its height is pinned so it holds still.
  overlay: {
    label: "The overlay during a call: the other side asks whether it handles their old contracts, What to answer? is pressed, and a suggested reply appears.",
    dark: { src: overlayDark, size: [972, 674], duration: 14.43, chapters: [{ at: 0.51, label: "They ask a question" }, { at: 5.74, label: "What to answer?" }] },
    light: { src: overlayLight, size: [972, 674], duration: 15.23, chapters: [{ at: 0.51, label: "They ask a question" }, { at: 5.74, label: "What to answer?" }] },
  },
  // The notepad window over a pastel backdrop, live on a bench call (fictional people).
  notepad: {
    label: "The meeting notepad during a call: two notes are typed, the live transcript opens, then What did I miss answers from the call so far.",
    dark: { src: notepadDark, size: [972, 816], duration: 17.84, chapters: [{ at: 0.52, label: "Write your notes" }, { at: 3.56, label: "See the transcript" }, { at: 8.45, label: "Ask with a recipe" }] },
    light: { src: notepadLight, size: [972, 816], duration: 17.72, chapters: [{ at: 0.52, label: "Write your notes" }, { at: 3.43, label: "See the transcript" }, { at: 8.31, label: "Ask with a recipe" }] },
  },
  speech: {
    label: "Settings, Audio: the Speech Provider list opens, a provider is picked, then the language is set.",
    dark: { src: speechDark, size: [972, 694], duration: 9.8, chapters: [{ at: 0.53, label: "Open providers" }, { at: 3.31, label: "Pick one" }, { at: 5.75, label: "Set language" }] },
    light: { src: speechLight, size: [972, 694], duration: 9.8, chapters: [{ at: 0.54, label: "Open providers" }, { at: 3.07, label: "Pick one" }, { at: 5.26, label: "Set language" }] },
  },
  model: {
    label: "Settings, AI Providers: the Active Model menu opens and a model is picked, then the page moves down to the provider keys.",
    dark: { src: modelDark, size: [972, 694], duration: 8.23, chapters: [{ at: 0.52, label: "Open Active Model" }, { at: 2.81, label: "Pick a model" }, { at: 4.74, label: "Or add a key" }] },
    light: { src: modelLight, size: [972, 694], duration: 8.17, chapters: [{ at: 0.51, label: "Open Active Model" }, { at: 2.71, label: "Pick a model" }, { at: 4.68, label: "Or add a key" }] },
  },
  retrieval: {
    label: "Settings, Retrieval: the embedding and reranker menus open in turn, then the page moves down to the models that run on this device.",
    dark: { src: retrievalDark, size: [972, 694], duration: 10.23, chapters: [{ at: 0.51, label: "Choose an embedder" }, { at: 3.12, label: "Choose a reranker" }, { at: 5.73, label: "Or run on this device" }] },
    light: { src: retrievalLight, size: [972, 694], duration: 10.37, chapters: [{ at: 0.52, label: "Choose an embedder" }, { at: 3.27, label: "Choose a reranker" }, { at: 5.89, label: "Or run on this device" }] },
  },
  stealth: {
    label: "Settings, General: a Process Disguise is picked, then the Detectable switch is turned to Undetectable.",
    dark: { src: stealthDark, size: [972, 694], duration: 8.6, chapters: [{ at: 0.51, label: "Pick a disguise" }, { at: 3.73, label: "Turn on Undetectable" }] },
    light: { src: stealthLight, size: [972, 694], duration: 9.23, chapters: [{ at: 0.54, label: "Pick a disguise" }, { at: 3.82, label: "Turn on Undetectable" }] },
  },
  verify: {
    label: "Settings, General: Show advanced settings opens, then Verify coding answers is turned on.",
    dark: { src: verifyDark, size: [972, 694], duration: 7.53, chapters: [{ at: 0.51, label: "Show advanced settings" }, { at: 4.21, label: "Turn on Verify coding answers" }] },
    light: { src: verifyLight, size: [972, 694], duration: 7.53, chapters: [{ at: 0.52, label: "Show advanced settings" }, { at: 4.21, label: "Turn on Verify coding answers" }] },
  },
  // The companion page in a phone-sized browser during a bench call, composited
  // onto a pastel backdrop. No pairing link or code is on screen.
  phone: {
    label: "Phone Mirror on a phone during a call: the question shows in the live transcript, What to Say is tapped, and the answer appears on the phone.",
    dark: { src: phoneDark, size: [972, 760], duration: 14.93, chapters: [{ at: 0.5, label: "They ask a question" }, { at: 6.1, label: "Tap What to Say" }, { at: 9.82, label: "Read the answer" }] },
    light: { src: phoneLight, size: [972, 760], duration: 15.13, chapters: [{ at: 0.5, label: "They ask a question" }, { at: 6.9, label: "Tap What to Say" }, { at: 10.45, label: "Read the answer" }] },
  },
  // The QR code and pairing link are blurred: they carry a working token.
  sync: {
    label: "Settings, Companion: Phone Mirror is turned on, then Show code reveals the pairing code and link (blurred in this recording).",
    dark: { src: syncDark, size: [972, 694], duration: 7.27, chapters: [{ at: 0.51, label: "Turn on Phone Mirror" }, { at: 3.5, label: "Show the code" }] },
    light: { src: syncLight, size: [972, 694], duration: 7.23, chapters: [{ at: 0.52, label: "Turn on Phone Mirror" }, { at: 3.52, label: "Show the code" }] },
  },
  modes: {
    label: "The Launcher: Modes opens, a mode is picked, a Real-time prompt is typed and saved, then the mode is set active.",
    dark: { src: modesDark, size: [972, 680], duration: 11.9, chapters: [{ at: 0.51, label: "Open Modes" }, { at: 2.49, label: "Pick a mode" }, { at: 4.13, label: "Write a prompt" }, { at: 8.48, label: "Set it active" }] },
    light: { src: modesLight, size: [972, 680], duration: 11.97, chapters: [{ at: 0.51, label: "Open Modes" }, { at: 2.51, label: "Pick a mode" }, { at: 4.13, label: "Write a prompt" }, { at: 8.55, label: "Set it active" }] },
  },
  profile: {
    label: "The Launcher: Profile Intelligence opens on a résumé and a job description, the Profile tab lists the experience and skills, and Role Insight shows the match.",
    dark: { src: profileDark, size: [972, 670], duration: 16.03, chapters: [{ at: 0.52, label: "Open Profile" }, { at: 2.15, label: "Your documents" }, { at: 5.65, label: "Your profile" }, { at: 9.52, label: "Check your fit" }] },
    light: { src: profileLight, size: [972, 670], duration: 16.63, chapters: [{ at: 0.52, label: "Open Profile" }, { at: 2.76, label: "Your documents" }, { at: 6.25, label: "Your profile" }, { at: 10.13, label: "Check your fit" }] },
  },
  buttons: {
    label: "Settings, Overlay: Make a button opens, a name and a description are typed, and Add turns them into a button that joins the overlay's row.",
    dark: { src: buttonsDark, size: [972, 694], duration: 12.47, chapters: [{ at: 0.53, label: "Make a button" }, { at: 3.3, label: "Name it" }, { at: 4.98, label: "Describe it" }, { at: 7.14, label: "Add it" }] },
    light: { src: buttonsLight, size: [972, 694], duration: 12.27, chapters: [{ at: 0.51, label: "Make a button" }, { at: 3.3, label: "Name it" }, { at: 4.88, label: "Describe it" }, { at: 6.95, label: "Add it" }] },
  },
  notes: {
    label: "The Launcher: a finished meeting opens on its notes, then its transcript, then a question asked about the meeting is answered from it.",
    dark: { src: notesDark, size: [972, 864], duration: 19.07, chapters: [{ at: 0.52, label: "Read the notes" }, { at: 5.17, label: "Open the transcript" }, { at: 8.6, label: "Ask about it" }] },
    light: { src: notesLight, size: [972, 864], duration: 19.37, chapters: [{ at: 0.52, label: "Read the notes" }, { at: 5.09, label: "Open the transcript" }, { at: 8.44, label: "Ask about it" }] },
  },
  // Demo meeting (fictional people); the email is never sent.
  followup: {
    label: "A meeting's page: Follow-up email opens a drafted email, a different tone rewrites it, then the send menu offers Gmail, Outlook and the Mail app.",
    dark: { src: followupDark, size: [972, 864], duration: 13.13, chapters: [{ at: 0.52, label: "Open Follow-up email" }, { at: 2.59, label: "Pick a tone" }, { at: 8.93, label: "Send it" }] },
    light: { src: followupLight, size: [972, 864], duration: 13.07, chapters: [{ at: 0.51, label: "Open Follow-up email" }, { at: 2.58, label: "Pick a tone" }, { at: 8.81, label: "Send it" }] },
  },
  // Copy only: Link would publish the notes.
  share: {
    label: "A meeting's page: Share opens its menu (Copy, File, Link, Slack, Notion, CRM) and Copy puts the notes on the clipboard.",
    dark: { src: shareDark, size: [972, 648], duration: 8.83, chapters: [{ at: 0.52, label: "Open Share" }, { at: 2.03, label: "Pick where it goes" }, { at: 5.41, label: "Copy the notes" }] },
    light: { src: shareLight, size: [972, 648], duration: 8.87, chapters: [{ at: 0.51, label: "Open Share" }, { at: 2.02, label: "Pick where it goes" }, { at: 5.52, label: "Copy the notes" }] },
  },
  // The per-app command is blurred: it carries the local token.
  mcp: {
    label: "Settings, Connectors: MCP is turned on, then the setup for Claude Code, Claude Desktop, Cursor and Codex is shown in turn (blurred in this recording).",
    dark: { src: mcpDark, size: [972, 694], duration: 10.43, chapters: [{ at: 0.51, label: "Turn it on" }, { at: 4.91, label: "Pick your app" }] },
    light: { src: mcpLight, size: [972, 694], duration: 10.47, chapters: [{ at: 0.51, label: "Turn it on" }, { at: 4.92, label: "Pick your app" }] },
  },
  // A demo week (example.com people), served to the recording instance in memory.
  calendar: {
    label: "Settings, Calendar: Connect on Google Calendar links a demo account, the week's meetings appear by day, Start Natively shows on the meeting about to begin, then Detect meetings.",
    dark: { src: calendarDark, size: [972, 694], duration: 17.2, chapters: [{ at: 0.51, label: "Connect it" }, { at: 4.19, label: "See your week" }, { at: 9.44, label: "Start a meeting" }, { at: 12.91, label: "Detect meetings" }] },
    light: { src: calendarLight, size: [972, 694], duration: 17.23, chapters: [{ at: 0.51, label: "Connect it" }, { at: 4.2, label: "See your week" }, { at: 9.45, label: "Start a meeting" }, { at: 12.91, label: "Detect meetings" }] },
  },
  search: {
    label: "The Launcher: search opens, typing a name finds a past meeting, and choosing it opens that meeting.",
    dark: { src: searchDark, size: [972, 648], duration: 7.87, chapters: [{ at: 0.53, label: "Open search" }, { at: 1.43, label: "Type a name" }, { at: 4.38, label: "Open the meeting" }] },
    light: { src: searchLight, size: [972, 648], duration: 7.87, chapters: [{ at: 0.53, label: "Open search" }, { at: 1.49, label: "Type a name" }, { at: 4.43, label: "Open the meeting" }] },
  },
} satisfies Record<string, HelpClipEntry>;

/** The launcher's permissions card, as a still: it has nothing to play. */
export const PERMISSIONS_CARD = {
  dark: permissionsCardDark,
  light: permissionsCardLight,
  size: [1156, 836] as const,
};
