/**
 * Phone ↔ desktop command contract for Phone Mirror WebSocket clients.
 *
 * Protocol note (ticket 17 — start session / modes / status):
 *
 * Commands (phone → desktop):
 *   { "type": "chat", "message": "<text>" }
 *   { "type": "action", "action": "<id>" }
 *   { "type": "screenshot" }
 *   { "type": "two-device-stealth", "op": "enter"|"exit"|"end" }
 *   { "type": "start-session" }
 *   { "type": "modes", "op": "list" }
 *   { "type": "modes", "op": "set", "modeId": "<id>" }
 *
 * Events (desktop → phone) — StreamEvent union in PhoneMirrorService:
 *   history | user | token | done | error | assistant | ack
 *   { "type": "status", "sessionActive": boolean, "stealthActive": boolean,
 *     "modeId"?: string|null, "modes"?: [{ "id", "name", "templateType" }] }
 *
 * Status is sent on WS connect and after start-session / modes / stealth changes.
 * Invalid mode set → ack { action: "modes:set", message: "…" } (no mode change).
 */

export type PhoneModeSummary = {
  id: string;
  name: string;
  templateType: string;
};

export type PhoneCommand =
  | { type: 'chat'; message: string }
  | { type: 'action'; action: string }
  | { type: 'screenshot' }
  | { type: 'two-device-stealth'; op: 'enter' | 'exit' | 'end' }
  | { type: 'start-session' }
  | { type: 'modes'; op: 'list' }
  | { type: 'modes'; op: 'set'; modeId: string };

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
    // Digits required for shortcut ids like dynamicAction4 (Recap / Brainstorm).
    /^[a-zA-Z0-9:_-]{1,64}$/.test(c.action)
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
  if (c.type === 'start-session') {
    return { type: 'start-session' };
  }
  if (c.type === 'modes' && c.op === 'list') {
    return { type: 'modes', op: 'list' };
  }
  if (
    c.type === 'modes' &&
    c.op === 'set' &&
    typeof c.modeId === 'string' &&
    c.modeId.trim().length > 0 &&
    c.modeId.length <= 128 &&
    /^[a-zA-Z0-9:_-]+$/.test(c.modeId)
  ) {
    return { type: 'modes', op: 'set', modeId: c.modeId.trim() };
  }
  return null;
}

/**
 * Resolve a modes:set request against a known mode list.
 * Pure helper for tests + IPC routing (invalid → clear error message).
 */
export function resolveModesSetCommand(
  modeId: string,
  modes: ReadonlyArray<{ id: string }>,
): { ok: true; modeId: string } | { ok: false; message: string } {
  const id = String(modeId || '').trim();
  if (!id) {
    return { ok: false, message: 'modeId is required' };
  }
  if (!modes.some((m) => m.id === id)) {
    return { ok: false, message: `Unknown mode: ${id}` };
  }
  return { ok: true, modeId: id };
}
