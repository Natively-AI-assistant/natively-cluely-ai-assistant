// Starts one UNMODIFIED natively-api instance per configuration, each with the provider shim
// preloaded. Server stdout/stderr go to benchmark/raw/server-logs/<config>.log.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const API_DIR = path.join(ROOT, 'natively-api')
export const BENCH = path.join(ROOT, 'benchmark')

// BENCH_CONFIG_PATH selects an alternate config file (e.g. the 2026-09-17
// deepseek-flash migration regression) without touching config.json.
export const CONFIG_FILE = process.env.BENCH_CONFIG_PATH ? path.resolve(process.env.BENCH_CONFIG_PATH) : path.join(BENCH, 'config.json')

export function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
}

export async function startServer(cfg, config, localTestToken) {
  fs.mkdirSync(path.join(BENCH, 'raw/server-logs'), { recursive: true })
  fs.mkdirSync(path.join(BENCH, 'raw/wire'), { recursive: true })
  const log = fs.openSync(path.join(BENCH, 'raw/server-logs', `${cfg.id}.log`), 'a')
  const env = {
    ...process.env,
    PORT: String(cfg.port),
    NODE_ENV: 'development',
    NATIVELY_LOCAL_TEST_AUTH: '1',
    NATIVELY_LOCAL_TEST_TOKEN: localTestToken,
    // Side-effect sinks disabled for the benchmark process only (.env untouched;
    // dotenv never overrides a variable that is already set, even to '').
    TG_TOKEN: '', TG_CHAT: '', POSTHOG_API_KEY: '', AXIOM_TOKEN: '', SENTRY_DSN: '', RESEND_API_KEY: '',
    // Production database fully disconnected: background jobs (request counter, usage
    // ledger, email watcher, billing sweeps, STT reaper) fail locally instead of writing
    // to production. The /v1/chat path under local-test auth never needs the database.
    SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_KEY: 'bench-disabled',
    DB_WATCHDOG_ENABLED: '0', USAGE_LEDGER_ENABLED: '0', LICENSE_LEDGER_ENABLED: '0',
    OPS_TELEMETRY_ENABLED: '0', BYOK_CLIENT_EVENTS_ENABLED: '0',
    DODO_PAYMENTS_API_KEY: '', TAVILY_API_KEY: '',
    ...config.benchmark_deadline_overrides.server_env,
    BENCH_API_DIR: API_DIR,
    BENCH_CONFIG_ID: cfg.id,
    BENCH_CONFIG_FILE: CONFIG_FILE,
    BENCH_WIRE_LOG: path.join(BENCH, 'raw/wire', `${cfg.id}.jsonl`),
    BENCH_ROOT_ENV: path.join(ROOT, '.env'),
  }
  delete env.RAILWAY_ENVIRONMENT
  const child = spawn(process.execPath, ['--import', path.join(BENCH, 'harness/provider-shim.mjs'), 'server.js'], {
    cwd: API_DIR, env, stdio: ['ignore', log, log],
  })
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${cfg.port}/health`)
      if (r.status < 500) return child
    } catch { }
    if (child.exitCode !== null) throw new Error(`server ${cfg.id} exited ${child.exitCode}`)
    await new Promise(r => setTimeout(r, 500))
  }
  child.kill()
  throw new Error(`server ${cfg.id} did not become healthy`)
}

export const newToken = () => crypto.randomBytes(18).toString('hex')
