import type { TestEnv } from './test-env'
import { destroyTestEnv } from './test-env'

/**
 * Registers cleanup handlers for a test environment.
 * Use instead of manual afterEach with vi.resetModules().
 */
export function setupTestCleanup(
  env: TestEnv,
  extraCleanup?: () => void,
): () => void {
  return () => {
    extraCleanup?.()
    destroyTestEnv(env)
  }
}

/**
 * Resets all known singletons in the codebase.
 * Call in beforeEach before creating new instances,
 * and in afterEach to prevent cross-test pollution.
 *
 * Accepts class constructors to avoid module boundary issues.
 */
export function resetSingletons(
  DatabaseManager: any,
  SettingsManager: any,
): void {
  resetDatabaseManager(DatabaseManager)
  resetSettingsManager(SettingsManager)
}

/**
 * Safely resets the DatabaseManager singleton.
 * Closes any open database connection before clearing the instance.
 */
export function resetDatabaseManager(DatabaseManager: any): void {
  try {
    const dbInstance = DatabaseManager.instance
    if (dbInstance) {
      try {
        const db = dbInstance.getDb()
        db?.close()
      } catch {
        /* db may already be closed */
      }
      DatabaseManager.instance = undefined
    }
  } catch {
    /* no-op */
  }
}

/**
 * Safely resets the SettingsManager singleton.
 * Flushes any pending writes before clearing the instance.
 */
export function resetSettingsManager(SettingsManager: any): void {
  try {
    const instance = SettingsManager.instance
    if (instance) {
      try {
        instance.getSettings?.()
      } catch {
        /* no-op */
      }
      SettingsManager.instance = undefined
    }
  } catch {
    /* no-op */
  }
}
