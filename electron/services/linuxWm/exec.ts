import { execFile } from 'node:child_process';
import type { Exec } from './types';

export const defaultExec: Exec = (argv, timeoutMs = 3000) =>
    new Promise((resolve) => {
        const [cmd, ...args] = argv;
        execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) =>
            resolve(err ? null : String(stdout)));
    });
