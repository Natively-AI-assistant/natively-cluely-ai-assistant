/** Phone ↔ desktop command contract for Phone Mirror WebSocket clients. */

export type PhoneCommand =
  | { type: 'chat'; message: string }
  | { type: 'action'; action: string }
  | { type: 'screenshot' }
  | { type: 'two-device-stealth'; op: 'enter' | 'exit' | 'end' };

/**
 * Validate a phone WS JSON payload into a PhoneCommand.
 */
export function parsePhoneCommand(cmd: unknown): PhoneCommand | null {
  if (!cmd || typeof cmd !== 'object') return null;
  const c = cmd as Record<string, unknown>;
  if (
    c.type === 'chat' &&
    typeof c.message === 'string' &&
    c.message.trim().length > 0 &&
    c.message.length <= 2000
  ) {
    return { type: 'chat', message: c.message.trim() };
  }
  if (
    c.type === 'action' &&
    typeof c.action === 'string' &&
    /^[a-zA-Z:_-]{1,64}$/.test(c.action)
  ) {
    return { type: 'action', action: c.action };
  }
  if (c.type === 'screenshot') {
    return { type: 'screenshot' };
  }
  if (
    c.type === 'two-device-stealth' &&
    (c.op === 'enter' || c.op === 'exit' || c.op === 'end')
  ) {
    return { type: 'two-device-stealth', op: c.op };
  }
  return null;
}
