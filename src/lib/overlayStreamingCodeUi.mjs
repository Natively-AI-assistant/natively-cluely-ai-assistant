const STREAMING_CODE_UI_INTENTS = new Set(['what_to_answer', 'chat']);

export function shouldUseStreamingCodeUi(intent, token, previousText = '') {
  if (!STREAMING_CODE_UI_INTENTS.has(intent) || typeof token !== 'string') return false;
  const combined = `${typeof previousText === 'string' ? previousText : ''}${token}`;
  return combined.includes('```');
}
