// electron/utils/debugLogPath.mjs
//
// Where natively_debug.log lives. Kept pure and free of Electron so both
// branches are exercised on any OS; main.ts's getLogFile is the only consumer.

import path from 'node:path';

export const DEBUG_LOG_FILENAME = 'natively_debug.log';

/**
 * An agent instance (scripts/dev-agent.mjs) keeps its log inside its own
 * userData. Every launch truncates or rotates the log it opens, so a shared
 * ~/Documents/natively_debug.log let an agent instance wipe the log of the
 * developer's app, or of another agent's instance, mid-session.
 *
 * A packaged build ignores the variable, the same gate main.ts applies to
 * NATIVELY_AGENT_USER_DATA itself: a stray env var must never move a user's log.
 *
 * `documentsDir` is a function because app.getPath('documents') can throw
 * before app.ready; the agent branch never needs it.
 *
 * @param {{ isPackaged: boolean, agentUserData?: string | null, documentsDir: () => string }} opts
 * @returns {string}
 */
export function resolveDebugLogPath({ isPackaged, agentUserData, documentsDir }) {
  const agentDir = !isPackaged ? String(agentUserData ?? '').trim() : '';
  if (agentDir) return path.join(agentDir, DEBUG_LOG_FILENAME);
  return path.join(documentsDir(), DEBUG_LOG_FILENAME);
}
