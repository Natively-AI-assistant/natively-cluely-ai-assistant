// tests/utils/createModeTestFixtures.mjs
// Build a fully-seeded in-memory mock DatabaseManager surface for ModesManager
// tests. The surface matches the methods ModesManager actually calls (see
// electron/services/ModesManager.ts: getModes, getActiveMode, getReferenceFiles,
// createMode, updateMode, deleteMode, setActiveMode, addReferenceFile,
// deleteReferenceFile, addNoteSection, getNoteSections, updateNoteSection,
// deleteNoteSection, deleteAllNoteSections).

const BASE_TIME = '2026-05-15T00:00:00.000Z';

function makeRow({ id, template_type, name = template_type, custom_context = '', is_active = 0, created_at = BASE_TIME }) {
  return { id, name, template_type, custom_context, is_active, created_at };
}

export function makeMockDb() {
  const state = {
    modes: [],
    files: [],
    sections: [],
  };
  return {
    state,
    getModes() {
      return state.modes;
    },
    getActiveMode() {
      return state.modes.find(m => m.is_active === 1) ?? null;
    },
    getReferenceFiles(modeId) {
      return state.files.filter(f => f.mode_id === modeId);
    },
    createMode({ id, name, templateType, customContext }) {
      state.modes.push(makeRow({ id, template_type: templateType, name, custom_context: customContext ?? '' }));
    },
    updateMode(id, updates) {
      const m = state.modes.find(r => r.id === id);
      if (!m) return;
      if (updates.name !== undefined) m.name = updates.name;
      if (updates.templateType !== undefined) m.template_type = updates.templateType;
      if (updates.customContext !== undefined) m.custom_context = updates.customContext;
    },
    deleteMode(id) {
      state.modes = state.modes.filter(m => m.id !== id);
      state.files = state.files.filter(f => f.mode_id !== id);
      state.sections = state.sections.filter(s => s.mode_id !== id);
    },
    setActiveMode(id) {
      for (const m of state.modes) m.is_active = m.id === id ? 1 : 0;
    },
    addReferenceFile({ id, modeId, fileName, content }) {
      state.files.push({ id, mode_id: modeId, file_name: fileName, content, created_at: BASE_TIME });
    },
    deleteReferenceFile(id) {
      state.files = state.files.filter(f => f.id !== id);
    },
    addNoteSection(section) {
      state.sections.push({ ...section, mode_id: section.modeId, created_at: BASE_TIME });
    },
    getNoteSections(modeId) {
      return state.sections.filter(s => s.mode_id === modeId);
    },
    updateNoteSection() {},
    deleteNoteSection() {},
    deleteAllNoteSections(modeId) {
      state.sections = state.sections.filter(s => s.mode_id !== modeId);
    },
  };
}

/**
 * Wire a ModesManager singleton against a mock DB. Returns the manager
 * and the mock DB. Caller is responsible for calling reset between tests
 * because ModesManager is a singleton.
 */
export function installModesManager(ModesManager, mockDb) {
  const manager = ModesManager.getInstance();
  manager.getActiveMode = () => {
    const row = mockDb.getActiveMode();
    return row ? rowToMode(row) : null;
  };
  manager.getReferenceFiles = modeId => mockDb.getReferenceFiles(modeId).map(rowToFile);
  manager.getModes = () => mockDb.getModes().map(rowToMode);
  // Wrap setters so they go to the mock DB.
  manager.createMode = ({ name, templateType }) => {
    const id = `mode_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    mockDb.createMode({ id, name, templateType, customContext: '' });
    return rowToMode(mockDb.getModes().find(m => m.id === id));
  };
  manager.setActiveMode = id => mockDb.setActiveMode(id);
  manager.addReferenceFile = ({ modeId, fileName, content }) => {
    const id = `ref_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    mockDb.addReferenceFile({ id, modeId, fileName, content });
    return { id, modeId, fileName, content, createdAt: BASE_TIME };
  };
  manager.deleteReferenceFile = id => mockDb.deleteReferenceFile(id);
  manager.updateMode = (id, updates) => mockDb.updateMode(id, updates);
  return manager;
}

function rowToMode(row) {
  return {
    id: row.id,
    name: row.name,
    templateType: row.template_type,
    customContext: row.custom_context ?? '',
    isActive: row.is_active === 1,
    createdAt: row.created_at,
  };
}

function rowToFile(row) {
  return {
    id: row.id,
    modeId: row.mode_id,
    fileName: row.file_name,
    content: row.content ?? '',
    createdAt: row.created_at,
  };
}
