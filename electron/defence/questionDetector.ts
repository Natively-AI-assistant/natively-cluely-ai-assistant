export interface DetectorResult {
  state: 'listening' | 'candidate' | 'complete' | 'duplicate';
  question?: string;
  confidence: number;
}

const QUESTION_HINT = /(?:\?|？|吗|呢|么|为什么|怎么|如何|哪些|什么|是否|能否|请(?:介绍|解释|说明)|how|why|what|when|where|which|who|can you|could you|would you|do you|did you|is it|are there)/i;
const FOLLOW_UP = /^(?:and|also|then|what about|how about|why|那|那么|还有|以及|另外|为什么|怎么)/i;

function normalized(value: string): string {
  return value.toLowerCase().replace(/[\s,.!?;:'"，。！？；：“”‘’]/g, '');
}

function similarity(a: string, b: string): number {
  const aa = normalized(a); const bb = normalized(b);
  if (!aa || !bb) return 0;
  if (aa === bb || aa.includes(bb) || bb.includes(aa)) return Math.min(aa.length, bb.length) / Math.max(aa.length, bb.length);
  const grams = (s: string) => new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)));
  const ag = grams(aa); const bg = grams(bb);
  let overlap = 0; for (const g of ag) if (bg.has(g)) overlap++;
  return overlap / Math.max(1, ag.size + bg.size - overlap);
}

export class QuestionDetector {
  private buffer = '';
  private lastStable = '';
  private lastAnswered = '';
  private stableCount = 0;

  push(text: string, options: { final?: boolean; silenceMs?: number; force?: boolean } = {}): DetectorResult {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return { state: 'listening', confidence: 0 };
    if (options.final) {
      if (!this.buffer || clean.startsWith(this.buffer) || this.buffer.startsWith(clean)) this.buffer = clean;
      else this.buffer = `${this.buffer} ${clean}`.trim();
    } else this.buffer = clean;
    if (normalized(this.buffer) === normalized(this.lastStable)) this.stableCount++;
    else { this.lastStable = this.buffer; this.stableCount = 1; }

    const hasHint = QUESTION_HINT.test(this.buffer);
    const ended = /[?？。.!！]$/.test(this.buffer);
    const quiet = (options.silenceMs || 0) >= 900;
    const compactLength = normalized(this.buffer).length;
    const longEnough = /[\u3400-\u9fff]/.test(this.buffer) ? compactLength >= 4 : compactLength >= 6;
    const confidence = Math.min(1, (hasHint ? .4 : 0) + (ended ? .2 : 0) + (quiet ? .25 : 0) + (this.stableCount >= 2 ? .15 : 0));
    const complete = options.force || (longEnough && hasHint && (ended || quiet || this.stableCount >= 2));
    if (!complete) return { state: hasHint ? 'candidate' : 'listening', confidence };

    if (similarity(this.buffer, this.lastAnswered) >= .86) {
      this.buffer = '';
      return { state: 'duplicate', confidence: 1 };
    }
    let question = this.buffer;
    if (FOLLOW_UP.test(question) && this.lastAnswered && normalized(question).length < 70) {
      question = `${this.lastAnswered} ${question}`;
    }
    this.lastAnswered = question;
    this.buffer = ''; this.lastStable = ''; this.stableCount = 0;
    return { state: 'complete', question, confidence: Math.max(.8, confidence) };
  }

  reset(): void { this.buffer = ''; this.lastStable = ''; this.stableCount = 0; this.lastAnswered = ''; }
}

export function detectLanguage(text: string): 'zh' | 'en' | 'mixed' {
  const zh = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const en = (text.match(/[a-z]/gi) || []).length;
  if (zh && en) return 'mixed';
  return zh ? 'zh' : 'en';
}
