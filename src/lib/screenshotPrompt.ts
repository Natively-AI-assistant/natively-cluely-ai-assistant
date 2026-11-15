import { useSyncExternalStore } from 'react';

/**
 * Settings > Overlay: the user's preset screenshot prompt.
 *
 * When capturing a screenshot and asking AI (Cmd+Shift+Enter or What to Say
 * with image context), this prompt defines the default question displayed in
 * the chat card and passed to the intelligence engine.
 *
 * Defaults to "What should I say about this?". If customized, the custom
 * prompt is used unless an explicit dynamic action overrides it.
 */
export const DEFAULT_SCREENSHOT_PROMPT = 'What should I say about this?';
export const DEFAULT_SCREENSHOT_INSTRUCTION =
  'Analyze the attached screenshot and answer the interviewer question provided with it.';

export const SCREENSHOT_PRESET_PROMPT_KEY = 'natively_screenshot_preset_prompt';
export const SCREENSHOT_PRESET_PROMPT_MAX = 500;

function readStorage(): string {
  try {
    if (typeof localStorage === 'undefined') return '';
    const val = localStorage.getItem(SCREENSHOT_PRESET_PROMPT_KEY);
    return typeof val === 'string' ? val.trim().slice(0, SCREENSHOT_PRESET_PROMPT_MAX) : '';
  } catch {
    return '';
  }
}

let current: string = readStorage();
const listeners = new Set<() => void>();

function adopt(next: string) {
  if (current === next) return;
  current = next;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber error */
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e: StorageEvent) => {
    if (e.key === SCREENSHOT_PRESET_PROMPT_KEY || e.key === null) {
      adopt(readStorage());
    }
  });
}

/**
 * The saved prompt, trimmed, read from storage at call time. The Settings
 * panel is in the launcher window and the question is sent from the overlay,
 * and the `storage` event does not reliably cross BrowserWindows (see
 * genieAnimationSetting.ts), so a send reads storage rather than this
 * window's copy. Storage unavailable: this window's copy.
 */
export function getScreenshotPresetPrompt(): string {
  try {
    if (typeof localStorage === 'undefined') return current.trim();
    const val = localStorage.getItem(SCREENSHOT_PRESET_PROMPT_KEY);
    return typeof val === 'string' ? val.trim().slice(0, SCREENSHOT_PRESET_PROMPT_MAX) : '';
  } catch {
    return current.trim();
  }
}

/** The field's text as typed (spaces kept), for the Settings input. */
export function getScreenshotPresetPromptDraft(): string {
  return current;
}

export function resolveScreenshotPromptText(customPrompt?: string | null): string {
  const trimmed = typeof customPrompt === 'string' ? customPrompt.trim() : '';
  return trimmed || getScreenshotPresetPrompt() || DEFAULT_SCREENSHOT_PROMPT;
}

export function resolveScreenshotInstruction(customPrompt?: string | null): string {
  const trimmed = typeof customPrompt === 'string' ? customPrompt.trim() : '';
  return trimmed || getScreenshotPresetPrompt() || DEFAULT_SCREENSHOT_INSTRUCTION;
}

export function setScreenshotPresetPrompt(prompt: string): void {
  // Not trimmed: this runs on every keystroke, and trimming would eat the
  // space typed between two words. Readers trim; whitespace alone clears it.
  const raw = typeof prompt === 'string' ? prompt.slice(0, SCREENSHOT_PRESET_PROMPT_MAX) : '';
  const next = raw.trim() ? raw : '';
  try {
    if (typeof localStorage !== 'undefined') {
      if (next) {
        localStorage.setItem(SCREENSHOT_PRESET_PROMPT_KEY, next);
      } else {
        localStorage.removeItem(SCREENSHOT_PRESET_PROMPT_KEY);
      }
    }
  } catch {
    /* storage unavailable */
  }
  adopt(next);
}

export function subscribeScreenshotPresetPrompt(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function useScreenshotPresetPrompt(): [string, (next: string) => void] {
  const prompt = useSyncExternalStore(
    subscribeScreenshotPresetPrompt,
    getScreenshotPresetPromptDraft,
    getScreenshotPresetPromptDraft
  );
  return [prompt, setScreenshotPresetPrompt];
}

/** Testing helper to restore initial state between test runs */
export function resetScreenshotPresetPromptForTesting(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SCREENSHOT_PRESET_PROMPT_KEY);
    }
  } catch {
    /* ignore */
  }
  current = '';
}
