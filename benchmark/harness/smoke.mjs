import { startServer, loadConfig, newToken, BENCH } from './servers.mjs'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
const config = loadConfig()
const [cfgId, conv, mode] = process.argv.slice(2)
const cfg = config.configs.find(c => c.id === cfgId)
const token = newToken()
const child = await startServer(cfg, config, token)
console.log('server up', cfg.id)
const jobPath = path.join(BENCH, 'raw', `smoke-${cfgId}-${conv}.job.json`)
const out = path.join(BENCH, 'raw', 'smoke', `${cfgId}-${conv}.json`)
fs.writeFileSync(jobPath, JSON.stringify({ config_id: cfgId, conversation_id: conv, mode, run: 0, port: cfg.port, local_test_token: token, electron_timeout_ms: config.benchmark_deadline_overrides.electron_timeout_ms, output_path: out }))
const r = spawnSync(path.resolve(BENCH, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [path.join(BENCH, 'harness/run-pipeline.cjs'), jobPath], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 1_800_000 })
console.log('worker exit', r.status, r.stdout, (r.stderr || '').split('\n').filter(l => !/DeprecationWarning|trace-deprecation/.test(l)).join('\n').slice(0, 2000))
child.kill()
