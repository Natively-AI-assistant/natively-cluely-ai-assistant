// benchmark/harness/orchestrator.mjs
// Runs every conversation x configuration x run through the real pipeline.
//   node orchestrator.mjs [--conversations A,B] [--runs 3] [--retry-failed]
// Resumable: a job whose output file exists is skipped. Execution order is shuffled with a
// fixed seed (recorded) so provider load drift does not line up with one configuration.
import fs from 'node:fs'
import path from 'node:path'
import { spawn, execSync } from 'node:child_process'
import { startServer, loadConfig, newToken, BENCH } from './servers.mjs'

const args = process.argv.slice(2)
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const RETRY = args.includes('--retry-failed')
const config = loadConfig()
const RUNS = Number(arg('--runs', config.runs_per_pair))
const manifest = JSON.parse(fs.readFileSync(path.join(BENCH, 'manifest.json'), 'utf8'))
const convIds = (arg('--conversations', '') || manifest.conversations.map(c => c.id).join(',')).split(',').filter(Boolean)
const convMode = Object.fromEntries(manifest.conversations.map(c => [c.id, c.natively_mode]))
const cfgIds = (arg('--configs', '') || config.configs.map(c => c.id).join(',')).split(',')
const GLOBAL_CONCURRENCY = Number(arg('--concurrency', 14))
const PORT_OFFSET = Number(arg('--port-offset', 0))
for (const c of config.configs) c.port += PORT_OFFSET
const PER_CONFIG = { 'luna-max': 6, default: 3 }
const ELECTRON = path.resolve(BENCH, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const INDEX = path.join(BENCH, 'results/runs-index.jsonl')
const LOG = path.join(BENCH, 'raw/orchestrator.log')
const log = (...a) => { const l = `[${new Date().toISOString()}] ${a.join(' ')}`; fs.appendFileSync(LOG, l + '\n'); console.log(l) }

function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) }
const SEED = 20260917

function outPath(cfg, conv, runLabel) { return path.join(BENCH, 'outputs', cfg, conv, `${runLabel}.json`) }

function isFailed(file) {
  if (!fs.existsSync(file)) return true
  try {
    const r = JSON.parse(fs.readFileSync(file, 'utf8'))
    return !!(r.v3_failed || (r.contamination && r.contamination.length) || r.calls.some(c => c.error))
  } catch { return true }
}

let jobs = []
for (const conv of convIds) for (const cfg of cfgIds) for (let run = 1; run <= RUNS; run++) {
  const primary = outPath(cfg, conv, `run${run}`)
  if (!RETRY) {
    if (fs.existsSync(primary) || fs.existsSync(primary.replace(/\.json$/, '.crash.json'))) continue
    jobs.push({ cfg, conv, run, label: `run${run}` })
  } else {
    // retry only failed originals; the original failed output is kept alongside
    const crashed = fs.existsSync(primary.replace(/\.json$/, '.crash.json'))
    if ((crashed || (fs.existsSync(primary) && isFailed(primary))) && !fs.existsSync(outPath(cfg, conv, `run${run}-retry1`))) {
      jobs.push({ cfg, conv, run, label: `run${run}-retry1`, retry_of: `run${run}` })
    }
  }
}
const rnd = seeded(SEED + (RETRY ? 1 : 0))
for (let i = jobs.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [jobs[i], jobs[j]] = [jobs[j], jobs[i]] }
log(`jobs=${jobs.length} retry=${RETRY} runs=${RUNS} conversations=${convIds.join(',')} configs=${cfgIds.join(',')} seed=${SEED}`)
if (!jobs.length) process.exit(0)

const token = newToken()
const servers = {}
for (const id of new Set(jobs.map(j => j.cfg))) {
  const cfg = config.configs.find(c => c.id === id)
  servers[id] = await startServer(cfg, config, token)
  log(`server up ${id} :${cfg.port}`)
}

function freeMb() {
  try { return Number(execSync("df -m / | tail -1 | awk '{print $4}'").toString().trim()) } catch { return 99999 }
}

const running = new Map()
let started = 0, done = 0
function canStart(job) {
  const cap = PER_CONFIG[job.cfg] ?? PER_CONFIG.default
  const n = [...running.values()].filter(r => r.cfg === job.cfg).length
  return n < cap && running.size < GLOBAL_CONCURRENCY
}

function runJob(job) {
  const cfg = config.configs.find(c => c.id === job.cfg)
  const out = outPath(job.cfg, job.conv, job.label)
  fs.mkdirSync(path.join(BENCH, 'raw/jobs'), { recursive: true })
  const jobFile = path.join(BENCH, 'raw/jobs', `${job.cfg}__${job.conv}__${job.label}.json`)
  const spec = { config_id: job.cfg, conversation_id: job.conv, mode: convMode[job.conv], run: job.run, run_label: job.label, retry_of: job.retry_of || null, port: cfg.port, local_test_token: token, electron_timeout_ms: config.benchmark_deadline_overrides.electron_timeout_ms, output_path: out }
  fs.writeFileSync(jobFile, JSON.stringify(spec, null, 1))
  const t = Date.now()
  return new Promise(resolve => {
    const child = spawn(ELECTRON, [path.join(BENCH, 'harness/run-pipeline.cjs'), jobFile], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', d => stdout += d)
    child.stderr.on('data', d => stderr += d)
    const killer = setTimeout(() => child.kill('SIGKILL'), 3_600_000)
    child.on('exit', code => {
      clearTimeout(killer)
      const rec = { ...job, exit: code, wall_ms: Date.now() - t, worker: stdout.trim().split('\n').pop(), stderr_tail: stderr.split('\n').filter(l => l && !/Deprecation|trace-deprecation|ModesManager\] WARN/.test(l)).slice(-5).join(' | ').slice(0, 600), finished_at: new Date().toISOString() }
      fs.appendFileSync(INDEX, JSON.stringify(rec) + '\n')
      resolve(rec)
    })
  })
}

await new Promise(resolveAll => {
  const tick = () => {
    if (done === jobs.length) return resolveAll()
    while (started < jobs.length) {
      if (freeMb() < 150) { log(`LOW DISK ${freeMb()}MB — pausing new jobs`); break }
      const idx = jobs.findIndex((j, i) => !j._started && canStart(j))
      if (idx < 0) break
      const job = jobs[idx]
      job._started = true
      started++
      const key = `${job.cfg}/${job.conv}/${job.label}`
      running.set(key, job)
      runJob(job).then(rec => {
        running.delete(key)
        done++
        log(`done ${done}/${jobs.length} ${key} exit=${rec.exit} wall=${Math.round(rec.wall_ms / 1000)}s ${rec.worker || ''} ${rec.exit ? rec.stderr_tail : ''}`)
        tick()
      })
    }
    setTimeout(() => { if (done < jobs.length) tick() }, 30_000).unref?.()
  }
  tick()
  const keepAlive = setInterval(() => { if (done === jobs.length) clearInterval(keepAlive) }, 10_000)
})
log('all jobs finished')
for (const s of Object.values(servers)) s.kill()
process.exit(0)
