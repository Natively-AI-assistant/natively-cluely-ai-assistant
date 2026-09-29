import {
  MODE_GENERAL_PROMPT, MODE_LECTURE_PROMPT, MODE_LOOKING_FOR_WORK_PROMPT,
  MODE_RECRUITING_PROMPT, MODE_SALES_PROMPT, MODE_SEMINAR_PROMPT,
  MODE_TEAM_MEET_PROMPT, MODE_TECHNICAL_INTERVIEW_PROMPT,
} from '../llm/prompts';
import {
  DIRECT_VISION_SYSTEM_PROMPT, GENERAL_VISION_SYSTEM_PROMPT,
  TECHNICAL_INTERVIEW_SYSTEM_PROMPT,
} from '../services/screen/visionPrompts';
import { promptHash } from './core';
import type { BenchmarkPromptKind, PromptPreview } from './types';

const PRODUCTION_MODES: Record<string, string> = {
  general: MODE_GENERAL_PROMPT,
  'looking-for-work': MODE_LOOKING_FOR_WORK_PROMPT,
  sales: MODE_SALES_PROMPT,
  recruiting: MODE_RECRUITING_PROMPT,
  'team-meeting': MODE_TEAM_MEET_PROMPT,
  lecture: MODE_LECTURE_PROMPT,
  'technical-interview': MODE_TECHNICAL_INTERVIEW_PROMPT,
  seminar: MODE_SEMINAR_PROMPT,
};

export const BENCHMARK_PROMPT_OPTIONS = [
  { id: 'general-vision', label: 'General screenshot prompt' },
  { id: 'technical-interview-vision', label: 'Technical Interview screenshot prompt' },
  { id: 'direct-vision', label: 'Direct vision-analysis prompt' },
  { id: 'production-mode', label: 'Fully assembled production mode prompt' },
] as const;

export const BENCHMARK_MODE_OPTIONS = Object.keys(PRODUCTION_MODES);

export function buildBenchmarkPrompt(
  promptKind: BenchmarkPromptKind,
  mode: string,
  userMessage: string,
  screenshotAttached = true,
): PromptPreview {
  let systemPrompt: string;
  let builder: string;
  switch (promptKind) {
    case 'general-vision':
      systemPrompt = GENERAL_VISION_SYSTEM_PROMPT;
      builder = 'GENERAL_VISION_SYSTEM_PROMPT';
      break;
    case 'technical-interview-vision':
      systemPrompt = TECHNICAL_INTERVIEW_SYSTEM_PROMPT;
      builder = 'TECHNICAL_INTERVIEW_SYSTEM_PROMPT';
      break;
    case 'direct-vision':
      systemPrompt = DIRECT_VISION_SYSTEM_PROMPT;
      builder = 'DIRECT_VISION_SYSTEM_PROMPT';
      break;
    case 'production-mode':
      systemPrompt = PRODUCTION_MODES[mode];
      if (!systemPrompt) throw Object.assign(new Error(`Unknown production mode: ${mode}`), { code: 'configuration' });
      builder = `MODE_${mode.replace(/-/g, '_').toUpperCase()}_PROMPT`;
      break;
  }
  return {
    selectedMode: mode, builder, systemPrompt, userMessage,
    systemPromptCharacters: systemPrompt.length,
    // Provider token counting is asynchronous and model-specific. Usage metadata
    // supplies the authoritative input count after each request.
    userMessageCharacters: userMessage.length,
    screenshotAttached,
    promptHash: promptHash(systemPrompt, userMessage),
  };
}
