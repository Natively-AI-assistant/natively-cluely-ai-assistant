import { execFileSync } from 'child_process';

// We match against the *basename* of the executable path returned by `ps -Ao comm`,
// not the whole path. This avoids absurd false positives like "searchpartyd" containing
// "arc" or "TrialArchivingService" matching the Arc browser. Short tokens like "Arc",
// "Opera", "Zoom" use exact-basename match; longer specific tokens use substring match.
const EXACT_BASENAMES = new Set(
    [
        'Arc',
        'Opera',
        'Vivaldi',
        'Firefox',
        'Safari',
        'Chromium',
        'FaceTime',
        'Slack',
        'Discord',
        'Webex',
        'zoom.us',
    ].map((s) => s.toLowerCase()),
);

// Substring (case-insensitive) match against the basename. These are unambiguous
// because they always appear inside a longer compound name (Helper, Renderer, etc).
const BASENAME_SUBSTRINGS = [
    'google chrome',
    'brave browser',
    'microsoft edge',
    'microsoft teams',
].map((s) => s.toLowerCase());

export interface AudioSourceMatch {
    pid: number;
    command: string;
}

/**
 * Scan running processes on macOS for ones likely producing meeting audio.
 * Returns an empty array on Windows/Linux or if `ps` fails. Callers should treat
 * an empty result as "use whole-system tap" (the existing behavior).
 *
 * The PIDs we collect are *every* matching process (including helper subprocesses)
 * because Chromium-based apps run audio on a dedicated child process whose name
 * varies ("Google Chrome Helper (Renderer)", etc.). The CoreAudio tap silently
 * ignores PIDs that aren't producing audio, so over-inclusion is safe.
 */
export function scanAudioSourcePids(extraHints: string[] = []): AudioSourceMatch[] {
    if (process.platform !== 'darwin') return [];

    const extraLower = extraHints.map((h) => h.toLowerCase());

    let raw: string;
    try {
        // -A = all users; -o pid=,comm= = just pid + executable path/name, no header.
        // We intentionally use comm (full executable path on macOS) rather than args so
        // we don't accidentally match a CLI flag containing "chrome".
        raw = execFileSync('/bin/ps', ['-Ao', 'pid=,comm='], {
            encoding: 'utf8',
            timeout: 2000,
        });
    } catch (err) {
        console.warn('[audioSourcePidScanner] ps failed:', (err as Error).message);
        return [];
    }

    const matches: AudioSourceMatch[] = [];
    const seen = new Set<number>();

    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const spaceIdx = trimmed.indexOf(' ');
        if (spaceIdx < 1) continue;

        const pidStr = trimmed.slice(0, spaceIdx).trim();
        const command = trimmed.slice(spaceIdx + 1).trim();
        const pid = Number.parseInt(pidStr, 10);
        if (!Number.isFinite(pid) || pid <= 0) continue;
        if (seen.has(pid)) continue;

        const basename = (command.split('/').pop() || command).toLowerCase();
        const isMatch =
            EXACT_BASENAMES.has(basename) ||
            BASENAME_SUBSTRINGS.some((s) => basename.includes(s)) ||
            extraLower.some((h) => basename.includes(h));
        if (isMatch) {
            seen.add(pid);
            matches.push({ pid, command });
        }
    }

    return matches;
}

/**
 * Convenience: returns just the PID numbers in deterministic ascending order.
 */
export function scanAudioSourcePidsOnly(extraHints: string[] = []): number[] {
    return scanAudioSourcePids(extraHints).map((m) => m.pid).sort((a, b) => a - b);
}
