#!/usr/bin/env node
/**
 * Spawn Electron. On Linux in development, disable the SUID chrome-sandbox
 * requirement so daily dev works without sudo (see README Linux section).
 * Production packaged builds keep the sandbox enabled.
 */
const { spawn } = require("child_process");
const http = require("http");

const DEV_SERVER_URL = "http://localhost:5180";
const DEV_SERVER_TIMEOUT_MS = 2000;

function checkDevServer(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function main() {
  const electronPath = require("electron");
  const args = process.argv.slice(2);
  if (args.length === 0) {
    args.push(".");
  }

  const launchDot = args.length === 1 && args[0] === ".";
  const isDev = process.env.NODE_ENV === "development";

  if (isDev && launchDot) {
    const up = await checkDevServer(DEV_SERVER_URL, DEV_SERVER_TIMEOUT_MS);
    if (!up) {
      console.error(
        "Vite dev server not running on :5180. Use: npm start   (or npm run app:dev)",
      );
      process.exit(1);
    }
  }

  const env = { ...process.env };
  const spawnArgs = [...args];

  const disableSandbox =
    process.platform === "linux" && process.env.NODE_ENV === "development";

  if (disableSandbox) {
    env.ELECTRON_DISABLE_SANDBOX = "1";
    if (!spawnArgs.includes("--no-sandbox")) {
      spawnArgs.unshift("--no-sandbox");
    }
  }

  const child = spawn(electronPath, spawnArgs, {
    stdio: "inherit",
    env,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });

  child.on("error", (err) => {
    console.error(err);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
