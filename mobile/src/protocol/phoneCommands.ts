/**
 * Phone → desktop command builders (parity with electron/services/phoneMirrorCommands.ts).
 * Ticket 19 owns chat / action / screenshot / two-device-stealth.
 * start-session / modes are ticket 20 — not exported here.
 */

export type StealthOp = 'enter' | 'exit' | 'end';

export type PhoneCommand =
  | { type: 'chat'; message: string }
  | { type: 'action'; action: string }
  | { type: 'screenshot' }
  | { type: 'two-device-stealth'; op: StealthOp };

export interface QuickAction {
  id: string;
  label: string;
}

/** Desktop phoneMirrorClient quick-action ids (labels match web UI). */
export const QUICK_ACTIONS: readonly QuickAction[] = [
  { id: 'whatToAnswer', label: 'What to Say' },
  { id: 'codeHint', label: 'Code Hint' },
  { id: 'clarify', label: 'Clarify' },
  { id: 'brainstorm', label: 'Brainstorm' },
  { id: 'answer', label: 'Answer' },
  { id: 'followUp', label: 'Follow Up' },
  /** Mode-dependent on desktop (often Recap; may surface Brainstorm). */
  { id: 'dynamicAction4', label: 'Recap' },
] as const;

/** Digits allowed so `dynamicAction4` (Recap) matches desktop shortcut ids. */
const ACTION_ID_RE = /^[a-zA-Z0-9:_-]{1,64}$/;
const MAX_CHAT_LEN = 2000;

export function buildChatCommand(message: string): PhoneCommand | null {
  const trimmed = String(message || '').trim();
  if (!trimmed || trimmed.length > MAX_CHAT_LEN) return null;
  return { type: 'chat', message: trimmed };
}

export function buildActionCommand(action: string): PhoneCommand | null {
  const id = String(action || '').trim();
  if (!ACTION_ID_RE.test(id)) return null;
  return { type: 'action', action: id };
}

export function buildScreenshotCommand(): PhoneCommand {
  return { type: 'screenshot' };
}

export function buildStealthCommand(op: StealthOp): PhoneCommand {
  return { type: 'two-device-stealth', op };
}

export type AckKind = 'screenshot' | 'stealth' | 'other';

export interface InterpretedAck {
  kind: AckKind;
  ok: boolean;
  toast: string;
  /** When kind === 'stealth' and ack implies a known state. */
  stealthActive?: boolean;
  stealthOp?: StealthOp | 'noop';
}

/**
 * Map desktop ack frames into toast + optional stealth state for the RN UI.
 * Failures still arrive as ack with an error message (e.g. "Screenshot failed").
 */
export function interpretAck(ack: {
  action: string;
  message: string;
}): InterpretedAck {
  const action = String(ack.action || '');
  const message = String(ack.message || action || 'Done');
  const failed = /\bfail(ed|ure)?\b/i.test(message) || /\berror\b/i.test(message);

  if (action === 'screenshot') {
    return {
      kind: 'screenshot',
      ok: !failed,
      toast: message,
    };
  }

  if (action.startsWith('two-device-stealth:')) {
    const op = action.slice('two-device-stealth:'.length) as StealthOp | 'noop';
    let stealthActive: boolean | undefined;
    if (op === 'enter') stealthActive = true;
    else if (op === 'exit' || op === 'end') stealthActive = false;
    // noop: leave undefined so UI keeps prior local flag
    return {
      kind: 'stealth',
      ok: !failed,
      toast: message,
      stealthActive,
      stealthOp: op === 'enter' || op === 'exit' || op === 'end' || op === 'noop' ? op : undefined,
    };
  }

  return { kind: 'other', ok: !failed, toast: message };
}
