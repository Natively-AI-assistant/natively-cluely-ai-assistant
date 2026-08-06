import type { SessionControlCommand } from './types';

/** Phone → desktop: start desktop meeting/session without launcher. */
export function buildStartSessionCommand(): SessionControlCommand {
  return { type: 'start-session' };
}

/** Phone → desktop: request mode list (status usually already includes modes). */
export function buildModesListCommand(): SessionControlCommand {
  return { type: 'modes', op: 'list' };
}

/**
 * Phone → desktop: set active mode.
 * Caller should only pass ids from the last `status.modes` / modes:list.
 */
export function buildModesSetCommand(modeId: string): SessionControlCommand | null {
  const id = String(modeId || '').trim();
  if (!id || id.length > 128 || !/^[a-zA-Z0-9:_-]+$/.test(id)) {
    return null;
  }
  return { type: 'modes', op: 'set', modeId: id };
}
