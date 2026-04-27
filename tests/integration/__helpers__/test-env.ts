import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface TestEnv {
  userDataPath: string
  dbPath: string
  tmpDir: string
}

/**
 * Creates an isolated test environment with its own temp directory.
 * Call in beforeEach, destroy in afterEach.
 */
export function createTestEnv(): TestEnv {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-int-'))
  return {
    userDataPath: tmpDir,
    dbPath: path.join(tmpDir, 'test.db'),
    tmpDir,
  }
}

/**
 * Destroys a test environment, removing all temp files.
 */
export function destroyTestEnv(env: TestEnv): void {
  fs.rmSync(env.tmpDir, { recursive: true, force: true })
}
