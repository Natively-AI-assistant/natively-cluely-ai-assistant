// intelligence-eval-real-ui/helpers/transcript-injector-ui.ts
// Injects a meeting transcript through the app's REAL transcript path via the
// test-only preload bridge `__evalInjectTranscript`, which calls the
// `test-inject-transcript` IPC (gated to NODE_ENV==='test') →
// intelligenceManager.addTranscript — the SAME method the live STT pipeline
// uses. The "What to answer?" button then reads from the real SessionTracker.

import type { Page } from 'playwright-core';

export interface TranscriptTurn { speaker: 'interviewer' | 'user' | 'assistant'; text: string }

export function parseTranscript(t: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const line of (t || '').split('\n')) {
    const m = line.match(/^\s*(Interviewer|Candidate|Me|User|Assistant)\s*:\s*(.+)$/i);
    if (!m) continue;
    const who = m[1].toLowerCase();
    const speaker = who === 'interviewer' ? 'interviewer' : who === 'assistant' ? 'assistant' : 'user';
    turns.push({ speaker, text: m[2].trim() });
  }
  return turns;
}

// Feed turns over the real IPC from the overlay renderer, timestamped within the
// last ~180s so the what-to-answer path sees them as the recent window.
export async function injectTranscript(win: Page, turns: TranscriptTurn[]): Promise<{ ok: boolean; injected: number; error?: string }> {
  return win.evaluate(async (segs: TranscriptTurn[]) => {
    const api: any = (window as any).electronAPI;
    if (!api?.__evalInjectTranscript) return { ok: false, injected: 0, error: '__evalInjectTranscript bridge missing' };
    const base = Date.now() - segs.length * 1500;
    let injected = 0; let error: string | undefined;
    for (let i = 0; i < segs.length; i++) {
      const r = await api.__evalInjectTranscript({ speaker: segs[i].speaker, text: segs[i].text, timestamp: base + i * 1500, final: true })
        .catch((e: any) => ({ success: false, error: String(e?.message || e) }));
      if (r?.success) injected++; else error = r?.error;
    }
    return { ok: injected === segs.length, injected, error };
  }, turns);
}
