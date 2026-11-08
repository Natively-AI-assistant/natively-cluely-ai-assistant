export interface ResumedChatEntry {
  type: string;
  timestamp: number;
  question: string;
  answer: string;
  source?: string;
  synthetic?: boolean;
  hasImages?: boolean;
}

export function resumedChatMessages(entries: unknown): Array<{
  id: string;
  role: 'user' | 'system';
  text: string;
  isQuickActionLabel?: boolean;
  hasScreenshot?: boolean;
}>;

export function resumedDirectHistory(entries: unknown): Array<{ role: 'user' | 'assistant'; content: string }>;
