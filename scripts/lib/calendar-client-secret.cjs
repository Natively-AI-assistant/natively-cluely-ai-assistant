/**
 * Calendar sync's Google OAuth client secret, baked in at build time.
 *
 * The client is a Google "Desktop app" client, and Google refuses its token
 * requests without the secret ("client_secret is missing"). The secret is not
 * confidential for this client type, but it is kept OUT of the public repo:
 * GitHub's secret scanning would flag a committed GOCSPX- value, block pushes
 * and report it to Google.
 *
 * So scripts/build-electron.js reads GOOGLE_CALENDAR_CLIENT_SECRET from the
 * environment or .env and substitutes it for BAKED_EXPRESSION (an esbuild
 * `define`), and electron/services/CalendarManager.ts reads that expression.
 *
 * A packaged app never loads .env (main.ts gates dotenv on !app.isPackaged),
 * so a build made without the secret ships a calendar that can never connect.
 * That is exactly how every release before 2026-09-26 shipped without a
 * client ID. assertCalendarSecretBaked() is the gate that stops a release
 * build from doing it again.
 */
const fs = require('fs');
const path = require('path');

const ENV_NAME = 'GOOGLE_CALENDAR_CLIENT_SECRET';
const BAKED_EXPRESSION = 'process.env.NATIVELY_BAKED_CALENDAR_CLIENT_SECRET';

/** The secret from the environment, else from <rootDir>/.env, else ''. */
function resolveCalendarClientSecret(rootDir, env = process.env) {
    const fromEnv = (env[ENV_NAME] || '').trim();
    if (fromEnv) return fromEnv;
    const envFile = path.join(rootDir, '.env');
    if (!fs.existsSync(envFile)) return '';
    const parsed = require('dotenv').parse(fs.readFileSync(envFile));
    return (parsed[ENV_NAME] || '').trim();
}

/**
 * Why the compiled app would ship without the secret, or null when it carries
 * it. Checks the bundle the app actually runs: esbuild inlines CalendarManager
 * into main.js, so services/CalendarManager.js alone proves nothing.
 */
function calendarSecretProblem(rootDir, env = process.env) {
    const secret = resolveCalendarClientSecret(rootDir, env);
    if (!secret) {
        return `${ENV_NAME} is not set in the environment or .env. Every Google token request needs it, so calendar sync would never connect in this build.`;
    }
    const mainBundle = path.join(rootDir, 'dist-electron', 'electron', 'main.js');
    if (!fs.existsSync(mainBundle)) {
        return 'dist-electron/electron/main.js does not exist. Run `npm run build:electron` first.';
    }
    if (!fs.readFileSync(mainBundle, 'utf8').includes(secret)) {
        return `dist-electron was built without ${ENV_NAME}. Run \`npm run build:electron\` again with it set.`;
    }
    return null;
}

function assertCalendarSecretBaked(rootDir, env = process.env) {
    const problem = calendarSecretProblem(rootDir, env);
    if (problem) throw new Error(`[calendar] ${problem}`);
}

/**
 * True when electron-builder is asked for an unpacked directory only (`--dir`,
 * or `dir` as the target). Those are local and CI smoke builds, not
 * installers, and CI smoke jobs cannot see the secret.
 */
function isUnpackedDirBuild(builderArgs) {
    return builderArgs.includes('--dir') || builderArgs.includes('dir');
}

module.exports = {
    ENV_NAME,
    BAKED_EXPRESSION,
    resolveCalendarClientSecret,
    calendarSecretProblem,
    assertCalendarSecretBaked,
    isUnpackedDirBuild,
};
