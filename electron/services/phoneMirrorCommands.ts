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
 *   { "type": "listen-transport", "op": "toggle"|"pause"|"resume" }
 *   { "type": "end-meeting" }
 *   { "type": "ask-submit", "message"?: "<text>" }
 *   { "type": "phone-stt", "op": "arm"|"disarm" }
 *   { "type": "phone-stt-transcript", "text": "<text>", "final"?: boolean }
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
  | { type: 'modes'; op: 'set'; modeId: string }
  | { type: 'listen-transport'; op: 'toggle' | 'pause' | 'resume' }
  | { type: 'end-meeting' }
  | { type: 'ask-submit'; message?: string }
  | { type: 'phone-stt'; op: 'arm' | 'disarm' }
  | { type: 'phone-stt-transcript'; text: string; final?: boolean };

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
  if (
    c.type === 'listen-transport' &&
    (c.op === 'toggle' || c.op === 'pause' || c.op === 'resume')
  ) {
    return { type: 'listen-transport', op: c.op };
  }
  if (c.type === 'end-meeting') {
    return { type: 'end-meeting' };
  }
  if (c.type === 'ask-submit') {
    if (c.message === undefined) {
      return { type: 'ask-submit' };
    }
    if (typeof c.message !== 'string' || c.message.length > 2000) {
      return null;
    }
    const trimmed = c.message.trim();
    if (trimmed.length === 0) {
      return { type: 'ask-submit' };
    }
    return { type: 'ask-submit', message: trimmed };
  }
  if (c.type === 'phone-stt' && (c.op === 'arm' || c.op === 'disarm')) {
    return { type: 'phone-stt', op: c.op };
  }
  if (c.type === 'phone-stt-transcript') {
    if (typeof c.text !== 'string' || c.text.length > 2000) {
      return null;
    }
    const trimmed = c.text.trim();
    if (trimmed.length === 0) return null;
    if (c.final === undefined) {
      return { type: 'phone-stt-transcript', text: trimmed };
    }
    if (typeof c.final !== 'boolean') return null;
    return { type: 'phone-stt-transcript', text: trimmed, final: c.final };
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

/** Toast/ack payload for listen-transport phone commands (desktop remains host). */
export function formatListenTransportAck(
  op: 'toggle' | 'pause' | 'resume',
  state: string,
): { action: string; message: string } {
  const messages: Record<string, string> = {
    armed: 'Listen resumed',
    paused: 'Listen paused',
    unready: 'Listen unready — configure STT',
    idle: 'Listen idle',
  };
  return {
    action: `listen-transport:${op}`,
    message: messages[state] ?? `Listen ${state}`,
  };
}

/** Toast/ack payload for phone-stt arm/disarm (desktop remains LLM host). */
export function formatPhoneSttAck(
  op: 'arm' | 'disarm',
  source: string,
): { action: string; message: string } {
  if (op === 'arm') {
    return {
      action: 'phone-stt:arm',
      message: source === 'phone' ? 'Phone mic STT armed' : `User STT: ${source}`,
    };
  }
  return {
    action: 'phone-stt:disarm',
    message:
      source === 'desktop'
        ? 'Phone mic STT released — desktop mic'
        : `User STT: ${source}`,
  };
}
