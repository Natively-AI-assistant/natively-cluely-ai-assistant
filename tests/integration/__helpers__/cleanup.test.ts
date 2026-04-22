import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import { createTestEnv, destroyTestEnv } from './test-env'
import { createInMemoryDb } from './db-helpers'

describe('Test Helpers', () => {
  describe('createTestEnv', () => {
    it('creates isolated temp directories', () => {
      const env1 = createTestEnv()
      const env2 = createTestEnv()

      expect(env1.tmpDir).not.toBe(env2.tmpDir)
      expect(fs.existsSync(env1.tmpDir)).toBe(true)
      expect(fs.existsSync(env2.tmpDir)).toBe(true)

      destroyTestEnv(env1)
      destroyTestEnv(env2)

      expect(fs.existsSync(env1.tmpDir)).toBe(false)
      expect(fs.existsSync(env2.tmpDir)).toBe(false)
    })
  })

  describe('createInMemoryDb', () => {
    it('creates database with all required tables', () => {
      const db = createInMemoryDb()

      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      ).all()

      const tableNames = tables.map((t: any) => t.name)
      expect(tableNames).toContain('meetings')
      expect(tableNames).toContain('transcripts')
      expect(tableNames).toContain('chunks')
      expect(tableNames).toContain('chunk_summaries')
      expect(tableNames).toContain('embedding_queue')

      db.close()
    })

    it('enables foreign keys', () => {
      const db = createInMemoryDb()
      const result = db.pragma('foreign_keys')
      expect(result).toEqual([{ foreign_keys: 1 }])
      db.close()
    })
  })
})
