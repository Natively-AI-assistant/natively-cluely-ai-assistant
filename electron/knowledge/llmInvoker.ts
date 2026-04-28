import { GenerateContentFn } from './types';
import { JSON_REPAIR_PROMPT } from './prompts';
import { safeParseJSON } from './jsonUtils';

/**
 * Calls the injected LLM and salvages JSON. On parse failure, asks the model
 * once to fix its own output. Returns parsed object or throws.
 */
export async function generateJSON<T>(
  generateFn: GenerateContentFn,
  prompt: string,
  context: string = ''
): Promise<T> {
  const text = `${prompt}${context ? '\n\n' + context : ''}`;
  let raw = '';
  try {
    raw = await generateFn([{ text }]);
    return safeParseJSON<T>(raw);
  } catch (firstErr: any) {
    if (!raw) throw firstErr;
    const repairPrompt = JSON_REPAIR_PROMPT.replace('{{PREV}}', raw.slice(0, 8000));
    const repaired = await generateFn([{ text: repairPrompt }]);
    return safeParseJSON<T>(repaired);
  }
}

export async function generateText(
  generateFn: GenerateContentFn,
  prompt: string
): Promise<string> {
  const out = await generateFn([{ text: prompt }]);
  return (out ?? '').trim();
}

export function fillTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, v),
    template
  );
}
