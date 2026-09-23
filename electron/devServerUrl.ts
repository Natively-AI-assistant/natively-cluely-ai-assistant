// electron/devServerUrl.ts
//
// Where the renderer's dev server lives.
//
// This used to be the literal `http://127.0.0.1:5180` written out in four
// window helpers. A second agent-driven instance needs its OWN renderer port,
// or two worktrees racing `--strictPort` means the second one simply fails to
// start — so the port became a value rather than a constant.
//
// Default stays 5180, so `npm start` and every existing script behave exactly
// as before. Only scripts/dev-agent.mjs sets the override.

const DEFAULT_DEV_PORT = 5180;

function resolvePort(): number {
  const raw = process.env.NATIVELY_RENDERER_PORT;
  if (!raw) return DEFAULT_DEV_PORT;
  const n = Number(raw);
  // A bad value must not silently point every window at port 0 or NaN — that
  // shows up as four blank chrome-error:// windows with no explanation.
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    console.warn(`[devServerUrl] ignoring NATIVELY_RENDERER_PORT=${raw}; using ${DEFAULT_DEV_PORT}`);
    return DEFAULT_DEV_PORT;
  }
  return n;
}

export const DEV_SERVER_PORT = resolvePort();
export const DEV_SERVER_URL = `http://127.0.0.1:${DEV_SERVER_PORT}`;
