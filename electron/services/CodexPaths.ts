import os from 'os';
import path from 'path';

export const CODEX_MODELS_CACHE_FILE = 'models_cache.json';

type PathImpl = Pick<typeof path, 'join' | 'resolve'>;

export function resolveCodexHome(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
  pathImpl: PathImpl = path,
): string {
  const override = env.CODEX_HOME?.trim();
  return override ? pathImpl.resolve(override) : pathImpl.join(homeDir, '.codex');
}
