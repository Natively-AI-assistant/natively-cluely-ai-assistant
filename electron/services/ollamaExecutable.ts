/**
 * The `ollama` binary to start `ollama serve` with.
 *
 * spawn('ollama') searches the app's own PATH. An app opened from Finder or
 * the Dock gets launchd's PATH (/usr/bin:/bin:/usr/sbin:/sbin), which holds
 * neither Homebrew's bin nor the CLI link Ollama.app installs, so an installed
 * Ollama failed to start with ENOENT and the user was told to install it. On
 * Windows the installer adds its folder to the user PATH, which an app started
 * before the install does not see until it restarts.
 *
 * Known install locations first, then PATH. Nothing found: the bare name, as
 * before, so the error the caller reports is unchanged.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

export function ollamaExecutableCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string[] {
  switch (platform) {
    case 'darwin': {
      const p = path.posix;
      const fromPath = (env.PATH || '').split(':').filter(Boolean).map((dir) => p.join(dir, 'ollama'));
      return [
        '/opt/homebrew/bin/ollama',
        '/usr/local/bin/ollama',
        '/Applications/Ollama.app/Contents/Resources/ollama',
        ...(home ? [p.join(home, 'Applications', 'Ollama.app', 'Contents', 'Resources', 'ollama')] : []),
        ...fromPath,
      ];
    }
    case 'win32': {
      const w = path.win32;
      // Windows env names are case-insensitive; a ProcessEnv copy is not.
      const get = (name: string) => env[name] ?? env[Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase()) ?? ''];
      const local = get('LOCALAPPDATA');
      const programFiles = get('ProgramFiles');
      const fromPath = (get('Path') || '').split(';').filter(Boolean).map((dir) => w.join(dir.replace(/^"|"$/g, ''), 'ollama.exe'));
      return [
        ...(local ? [w.join(local, 'Programs', 'Ollama', 'ollama.exe')] : []),
        ...(programFiles ? [w.join(programFiles, 'Ollama', 'ollama.exe')] : []),
        ...fromPath,
      ];
    }
    default:
      return [];
  }
}

export function resolveOllamaExecutable(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = (file) => { try { return fs.statSync(file).isFile(); } catch { return false; } },
  home: string = os.homedir(),
): string {
  return ollamaExecutableCandidates(platform, env, home).find(exists) ?? 'ollama';
}
