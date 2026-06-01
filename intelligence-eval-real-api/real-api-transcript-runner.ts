// intelligence-eval-real-api/real-api-transcript-runner.ts
//
// Reproduces the production "What to answer?" path for a transcript test:
//   parse transcript turns → REAL extractLatestQuestion → toCandidateFraming →
//   (follow-up: ground on resolved target) → assemble the candidate-grounded
//   prompt the same way IntelligenceEngine.runWhatShouldISay + WhatToAnswerLLM do,
//   then return the system + userContent to send to the REAL /v1/chat.
//
// The answer perspective is first-person candidate (production uses
// UNIVERSAL_WHAT_TO_ANSWER_PROMPT). We pass that universal prompt as the base
// system prompt so the live model answers in the candidate voice.

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assembleManual, type LoadedSession } from './real-api-session-loader.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '../');

const { extractLatestQuestion, toCandidateFraming } = await import(pathToFileURL(
  path.resolve(ROOT, 'dist-electron/electron/llm/transcriptQuestionExtractor.js')).href);
const { prepareTranscriptForWhatToAnswer } = await import(pathToFileURL(
  path.resolve(ROOT, 'dist-electron/electron/llm/transcriptCleaner.js')).href);
const prompts = require(path.resolve(ROOT, 'dist-electron/electron/llm/prompts.js'));
const UNIVERSAL_WHAT_TO_ANSWER_PROMPT: string =
  prompts.UNIVERSAL_WHAT_TO_ANSWER_PROMPT || prompts.HARD_SYSTEM_PROMPT;

export interface TranscriptExtraction {
  detectedSpeaker: string;
  latestQuestion: string;
  questionType: string;
  isFollowUp: boolean;
  followUpTarget: string;
  confidence: number;
  ignoredNoiseCount: number;
  extractionMs: number;
}

export function parseTranscript(t: string) {
  const turns: Array<{ role: 'interviewer' | 'user' | 'assistant'; text: string; timestamp: number }> = [];
  let ts = 1_000_000;
  for (const line of (t || '').split('\n')) {
    const m = line.match(/^\s*(Interviewer|Candidate|Me|User|Assistant)\s*:\s*(.+)$/i);
    if (!m) continue;
    const who = m[1].toLowerCase();
    const role = who === 'interviewer' ? 'interviewer' : who === 'assistant' ? 'assistant' : 'user';
    turns.push({ role, text: m[2].trim(), timestamp: (ts += 1000) });
  }
  return turns;
}

export function extract(transcript: string): TranscriptExtraction {
  const turns = parseTranscript(transcript);
  const t0 = process.hrtime.bigint();
  prepareTranscriptForWhatToAnswer(turns, 12); // real cleaner cost
  const e = extractLatestQuestion(turns);
  const extractionMs = Number(process.hrtime.bigint() - t0) / 1e6;
  return {
    detectedSpeaker: e.detectedSpeaker,
    latestQuestion: e.latestQuestion,
    questionType: e.questionType,
    isFollowUp: e.isFollowUp,
    followUpTarget: e.followUpTarget,
    confidence: e.confidence,
    ignoredNoiseCount: e.ignoredTranscriptNoise.length,
    extractionMs: Math.round(extractionMs * 1000) / 1000,
  };
}

// Build the candidate-grounded prompt for a what-to-answer test. The lookup
// question is the interviewer question normalized to first person; for
// follow-ups it grounds on the resolved target. Uses the SAME assembleManual
// path with the universal what-to-answer system prompt as the base.
export async function assembleWhatToAnswer(session: LoadedSession, ext: TranscriptExtraction) {
  let lookup = toCandidateFraming(ext.latestQuestion);
  if (ext.isFollowUp && ext.followUpTarget) lookup = `Tell me about my ${ext.followUpTarget}`;
  const assembled = await assembleManual(session, lookup, UNIVERSAL_WHAT_TO_ANSWER_PROMPT);
  return { ...assembled, lookup };
}

export { UNIVERSAL_WHAT_TO_ANSWER_PROMPT };
