/**
 * Finding and stopping a wedged Ollama daemon that holds its port, for
 * LLMHelper.forceRestartOllama.
 *
 * The restart used to run `lsof -t -i:11434` and `kill -9` every PID it printed:
 *  - Windows has neither command, so the restart never stopped anything there
 *    and the new `ollama serve` failed to bind the port.
 *  - `lsof -i` lists every process with ANY socket on the port, including the
 *    clients connected to it: Natively itself (its fetches to Ollama) and any
 *    other app using Ollama, which were killed too.
 *
 * Now only the process LISTENING on the port is considered, only when it is
 * Ollama, never this process. Commands run without a shell, arguments as arrays.
 *  - macOS: `lsof -nP -iTCP:<port> -sTCP:LISTEN -Fpc` (pid + command), SIGKILL.
 *  - Windows: `netstat -ano -p TCP` (a listening socket's foreign address is
 *    0.0.0.0:0 or [::]:0, which does not depend on the display language, unlike
 *    the LISTENING column), `tasklist` for the image name, `taskkill /T /F` so
 *    the model runner child processes go with it.
 */
import { execFile } from 'child_process';

export type RunCommand = (file: string, args: string[]) => Promise<string>;

export interface PortProcessDeps {
  platform?: NodeJS.Platform;
  run?: RunCommand;
  selfPid?: number;
  kill?: (pid: number) => void;
}

const defaultRun: RunCommand = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 5000, encoding: 'utf8' }, (err, stdout) => {
      // lsof exits 1 when nothing matches; that is an empty answer, not a failure.
      if (err && !(typeof stdout === 'string' && (err as any).code === 1)) reject(err);
      else resolve(stdout || '');
    });
  });

const isOllama = (name: string) => /^ollama/i.test(name.trim());

/** Parses `lsof -Fpc` output into the PIDs whose command is Ollama. */
export function parseLsofListeners(output: string): number[] {
  const pids: number[] = [];
  let pid: number | null = null;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('c') && pid !== null && Number.isInteger(pid) && pid > 0 && isOllama(line.slice(1))) {
      if (!pids.includes(pid)) pids.push(pid);
    }
  }
  return pids;
}

/** Parses `netstat -ano -p TCP` into the PIDs listening on `port`. */
export function parseNetstatListeners(output: string, port: number): number[] {
  const pids: number[] = [];
  for (const line of output.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    // Proto  Local  Foreign  State  PID
    if (cols.length < 5 || !/^TCP$/i.test(cols[0])) continue;
    const local = cols[1];
    const foreign = cols[2];
    const pid = Number(cols[cols.length - 1]);
    if (!local.endsWith(`:${port}`)) continue;
    if (foreign !== '0.0.0.0:0' && foreign !== '[::]:0') continue;
    if (Number.isInteger(pid) && pid > 0 && !pids.includes(pid)) pids.push(pid);
  }
  return pids;
}

/** The image name in `tasklist /FO CSV /NH` output, or null. */
export function parseTasklistImageName(output: string): string | null {
  const m = /^"([^"]+)"/m.exec(output.trim());
  return m ? m[1] : null;
}

export async function ollamaPidsListeningOn(port: number, deps: PortProcessDeps = {}): Promise<number[]> {
  const platform = deps.platform ?? process.platform;
  const run = deps.run ?? defaultRun;
  const selfPid = deps.selfPid ?? process.pid;
  let pids: number[];
  switch (platform) {
    case 'darwin':
      pids = parseLsofListeners(await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc']));
      break;
    case 'win32': {
      pids = [];
      for (const pid of parseNetstatListeners(await run('netstat', ['-ano', '-p', 'TCP']), port)) {
        const name = parseTasklistImageName(await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']));
        if (name && isOllama(name)) pids.push(pid);
      }
      break;
    }
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
  return pids.filter((pid) => pid !== selfPid);
}

export async function stopOllamaPid(pid: number, deps: PortProcessDeps = {}): Promise<void> {
  const platform = deps.platform ?? process.platform;
  switch (platform) {
    case 'darwin':
      (deps.kill ?? ((p: number) => process.kill(p, 'SIGKILL')))(pid);
      return;
    case 'win32':
      await (deps.run ?? defaultRun)('taskkill', ['/PID', String(pid), '/T', '/F']);
      return;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}
