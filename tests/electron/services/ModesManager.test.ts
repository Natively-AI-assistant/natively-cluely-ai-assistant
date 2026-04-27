import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElectronMock } from '../../mocks/electron.mock'

vi.mock('electron', () =>
  createElectronMock({
    app: {
      getPath: vi.fn(() => '/tmp/userdata'),
      isReady: vi.fn(() => true),
    },
  }),
)

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
}))

vi.mock('path', () => ({
  default: {
    join: (...args: string[]) => args.join('/'),
    dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
  },
}))

vi.mock('sqlite-vec', () => ({
  getLoadablePath: vi.fn(() => '/tmp/vec0.dylib'),
}))

// Use vi.hoisted so the real Database class and the array reference are captured
// before vi.mock processes the factory. The factory runs lazily when ModesManager
// first imports DatabaseManager, at which point vi.mock is already registered.
const { RealDatabase } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const RealDatabase = require('better-sqlite3')
  return { RealDatabase }
})

vi.mock('better-sqlite3', () => ({
  default: vi.fn((_path: string) => new RealDatabase(':memory:')),
}))

// NOTE: ModesManager and DatabaseManager are imported LAZILY inside beforeEach
// to ensure vi.mock has fully taken effect (vi.mock is lazy in vitest).
// Importing at the top of the file would bypass the mock.
import { MODE_TEMPLATES } from '../../../electron/services/ModesManager'

// Mutable ref to the current ModesManager instance
let mm: import('../../../electron/services/ModesManager').ModesManager

describe('ModesManager', () => {
  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    // Reset singletons so each test gets fresh state
    const { ModesManager } = await import(
      '../../../electron/services/ModesManager'
    )
    const { DatabaseManager } = await import(
      '../../../electron/db/DatabaseManager'
    )
    ;(ModesManager as any).instance = undefined
    ;(DatabaseManager as any).instance = undefined

    mm = ModesManager.getInstance()
  })

  afterEach(() => {
    vi.mocked(console.error).mockRestore()
  })

  // ── getInstance ─────────────────────────────────────────────────

  it('should return the same instance on multiple calls', async () => {
    const { ModesManager } = await import(
      '../../../electron/services/ModesManager'
    )
    const instance1 = ModesManager.getInstance()
    const instance2 = ModesManager.getInstance()
    expect(instance1).toBe(instance2)
  })

  // ── getModes ─────────────────────────────────────────────────────
  //
  // NOTE: DatabaseManager migrations auto-seed a 'general' mode on first init.

  describe('getModes', () => {
    it('should return at least the seeded General mode when database is fresh', () => {
      const modes = mm.getModes()

      expect(modes.length).toBeGreaterThanOrEqual(1)
      expect(modes[0].templateType).toBe('general')
      expect(modes[0].name).toBe('General')
    })

    it('should include newly created modes in the returned list', () => {
      mm.createMode({ name: 'Sales', templateType: 'sales' })

      const modes = mm.getModes()

      const sales = modes.find((m) => m.name === 'Sales')
      expect(sales).toBeDefined()
      expect(sales?.templateType).toBe('sales')
    })

    it('should sort non-general modes by createdAt ascending', () => {
      mm.createMode({ name: 'Recruiting', templateType: 'recruiting' })
      mm.createMode({ name: 'Sales', templateType: 'sales' })

      const modes = mm.getModes()

      const nonGeneral = modes.filter((m) => m.templateType !== 'general')
      expect(nonGeneral[0].templateType).toBe('recruiting')
      expect(nonGeneral[1].templateType).toBe('sales')
    })

    it('should return a Mode object with all required fields', () => {
      mm.createMode({ name: 'Lecture', templateType: 'lecture' })

      const mode = mm.getModes().find((m) => m.name === 'Lecture')!

      expect(mode).toHaveProperty('id')
      expect(mode.name).toBe('Lecture')
      expect(mode.templateType).toBe('lecture')
      expect(mode.customContext).toBe('')
      expect(mode.isActive).toBe(false)
      expect(mode).toHaveProperty('createdAt')
    })
  })

  // ── getActiveMode ────────────────────────────────────────────────
  //
  // NOTE: The migration seeds General with is_active=1.

  describe('getActiveMode', () => {
    it('should return the seeded General mode by default', () => {
      const active = mm.getActiveMode()

      expect(active).not.toBeNull()
      expect(active?.templateType).toBe('general')
      expect(active?.isActive).toBe(true)
    })

    it('should return the newly set active mode', () => {
      const sales = mm.createMode({
        name: 'Team Meet',
        templateType: 'team-meet',
      })
      mm.setActiveMode(sales.id)

      const active = mm.getActiveMode()

      expect(active).not.toBeNull()
      expect(active?.id).toBe(sales.id)
      expect(active?.templateType).toBe('team-meet')
    })

    it('should return null after clearing the active mode', () => {
      const sales = mm.createMode({ name: 'Sales', templateType: 'sales' })
      mm.setActiveMode(sales.id)
      mm.setActiveMode(null)

      expect(mm.getActiveMode()).toBeNull()
    })
  })

  // ── setActiveMode ────────────────────────────────────────────────

  describe('setActiveMode', () => {
    it('should set the active mode by id', () => {
      const mode = mm.createMode({ name: 'Sales', templateType: 'sales' })

      mm.setActiveMode(mode.id)

      expect(mm.getActiveMode()?.id).toBe(mode.id)
    })

    it('should accept null to clear the active mode', () => {
      mm.setActiveMode(null)

      expect(mm.getActiveMode()).toBeNull()
    })
  })

  // ── createMode ───────────────────────────────────────────────────

  describe('createMode', () => {
    it('should create a mode with the given name and template type', () => {
      const mode = mm.createMode({
        name: 'My Sales Mode',
        templateType: 'sales',
      })

      expect(mode.name).toBe('My Sales Mode')
      expect(mode.templateType).toBe('sales')
      expect(mode.id).toMatch(/^mode_/)
      expect(mode.customContext).toBe('')
      expect(mode.isActive).toBe(false)
      expect(mode.createdAt).toBeTruthy()
    })

    it('should persist the created mode to the database', () => {
      const mode = mm.createMode({
        name: 'Persisted',
        templateType: 'recruiting',
      })

      const found = mm.getModes().find((m) => m.id === mode.id)
      expect(found).toBeDefined()
      expect(found?.name).toBe('Persisted')
    })

    it('should seed 3 note sections for a general mode', () => {
      const general = mm.createMode({
        name: 'Custom General',
        templateType: 'general',
      })

      const sections = mm.getNoteSections(general.id)

      expect(sections).toHaveLength(3)
    })

    it('should seed 5 note sections for a recruiting mode', () => {
      const mode = mm.createMode({ name: 'Hiring', templateType: 'recruiting' })

      const sections = mm.getNoteSections(mode.id)

      expect(sections).toHaveLength(5)
    })

    it('should seed 4 note sections for a lecture mode', () => {
      const mode = mm.createMode({ name: 'CS101', templateType: 'lecture' })

      const sections = mm.getNoteSections(mode.id)

      expect(sections).toHaveLength(4)
    })
  })

  // ── updateMode ──────────────────────────────────────────────────

  describe('updateMode', () => {
    it('should update the mode name', () => {
      const mode = mm.createMode({ name: 'Original', templateType: 'sales' })

      mm.updateMode(mode.id, { name: 'Updated' })

      const updated = mm.getModes().find((m) => m.id === mode.id)
      expect(updated?.name).toBe('Updated')
    })

    it('should update the custom context', () => {
      const mode = mm.createMode({ name: 'Test', templateType: 'general' })

      mm.updateMode(mode.id, { customContext: 'my context' })

      const updated = mm.getModes().find((m) => m.id === mode.id)
      expect(updated?.customContext).toBe('my context')
    })

    it('should update multiple fields at once', () => {
      const mode = mm.createMode({ name: 'Test', templateType: 'general' })

      mm.updateMode(mode.id, { name: 'New', customContext: 'ctx' })

      const updated = mm.getModes().find((m) => m.id === mode.id)
      expect(updated?.name).toBe('New')
      expect(updated?.customContext).toBe('ctx')
    })
  })

  // ── deleteMode ───────────────────────────────────────────────────

  describe('deleteMode', () => {
    it('should remove the mode from the database', () => {
      const mode = mm.createMode({ name: 'ToDelete', templateType: 'sales' })

      mm.deleteMode(mode.id)

      const found = mm.getModes().find((m) => m.id === mode.id)
      expect(found).toBeUndefined()
    })
  })

  // ── MODE_TEMPLATES ───────────────────────────────────────────────

  describe('MODE_TEMPLATES', () => {
    it('should include all expected template types', () => {
      const expectedTypes = [
        'sales',
        'recruiting',
        'team-meet',
        'looking-for-work',
        'lecture',
      ]
      const actualTypes = MODE_TEMPLATES.map((t) => t.type)

      expectedTypes.forEach((type) => {
        expect(actualTypes).toContain(type)
      })
    })

    it('should have a label and description for each template', () => {
      MODE_TEMPLATES.forEach((template) => {
        expect(template.label).toBeTruthy()
        expect(template.description).toBeTruthy()
      })
    })

    it('should have exactly 5 templates', () => {
      expect(MODE_TEMPLATES).toHaveLength(5)
    })
  })

  // ── edge cases ───────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should return General mode when the database is fresh', () => {
      const modes = mm.getModes()

      expect(modes.some((m) => m.templateType === 'general')).toBe(true)
    })

    // rowToMode normalises null custom_context → '' (verified via getModes
    // returning the seeded General mode with an empty customContext).
    it('should expose customContext as a string on returned Mode objects', () => {
      const modes = mm.getModes()
      const generalMode = modes.find((m) => m.templateType === 'general')!

      expect(typeof generalMode.customContext).toBe('string')
      expect(generalMode.customContext).toBe('')
    })

    // is_active 1/0 mapping is verified by the seeded General mode:
    // the migration sets is_active=1 for it, and rowToMode maps it to isActive=true.
    it('should correctly expose isActive from the seeded General mode', () => {
      const modes = mm.getModes()
      const generalMode = modes.find((m) => m.templateType === 'general')!

      // The migration seeds General with is_active=1
      expect(generalMode.isActive).toBe(true)
    })
  })
})
