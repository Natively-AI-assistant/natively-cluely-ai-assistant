/**
 * Salvage JSON from LLM output. Handles:
 * - Markdown code fences (```json ... ```)
 * - Leading/trailing prose ("Here's the JSON: { ... } I hope this helps")
 * - Truncated outputs (best-effort brace balancing)
 *
 * Throws if no balanced object/array can be extracted.
 */
export function safeParseJSON<T = any>(raw: string): T {
  if (!raw || typeof raw !== 'string') {
    throw new Error('Empty LLM response');
  }

  let text = raw.trim();

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) text = fenceMatch[1].trim();

  const start = firstStructuralChar(text);
  if (start < 0) throw new Error('No JSON object/array found');

  const opener = text[start];
  const closer = opener === '{' ? '}' : ']';
  const end = matchingClose(text, start, opener, closer);
  if (end < 0) throw new Error('Unbalanced JSON braces');

  const candidate = text.slice(start, end + 1);
  try {
    return JSON.parse(candidate) as T;
  } catch (e: any) {
    throw new Error(`JSON parse failed: ${e?.message ?? 'unknown'}`);
  }
}

function firstStructuralChar(s: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{' || s[i] === '[') return i;
  }
  return -1;
}

function matchingClose(s: string, start: number, opener: string, closer: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
