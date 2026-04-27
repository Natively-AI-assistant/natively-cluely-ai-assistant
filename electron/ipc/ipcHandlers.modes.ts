/**
 * Modes handlers extracted from ipcHandlers.ts.
 * Handles modes management (requires premium for non-general modes).
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import type { AppState } from '../main'
import { safeHandle } from './safeHandle'

const isProOrTrialActive = (): boolean => {
  try {
    const {
      LicenseManager,
    } = require('../premium/electron/services/LicenseManager')
    if (LicenseManager.getInstance().isPremium()) return true
  } catch {
    /* premium module not available */
  }

  try {
    const { CredentialsManager } = require('../services/CredentialsManager')
    const cm = CredentialsManager.getInstance()
    const token = cm.getTrialToken()
    if (!token) return false
    const expiresAt = cm.getTrialExpiresAt()
    if (!expiresAt) return false
    return new Date(expiresAt).getTime() > Date.now()
  } catch {
    return false
  }
}

export function registerModesHandlers(_appState: AppState): void {
  safeHandle('modes:get-active', async () => {
    try {
      const { ModesManager } = require('../services/ModesManager')
      return ModesManager.getInstance().getActiveMode()
    } catch (e: any) {
      console.error('[IPC] modes:get-active error:', e)
      return null
    }
  })

  safeHandle('modes:get-all', async () => {
    try {
      const { ModesManager } = require('../services/ModesManager')
      const mgr = ModesManager.getInstance()
      const modes = mgr.getModes()
      return modes.map((m: any) => ({
        ...m,
        referenceFileCount: mgr.getReferenceFiles(m.id).length,
      }))
    } catch (e: any) {
      console.error('[IPC] modes:get-all error:', e)
      return []
    }
  })

  safeHandle(
    'modes:create',
    async (_, params: { name: string; templateType: string }) => {
      try {
        if (!isProOrTrialActive())
          return { success: false, error: 'pro_required' }
        const { ModesManager } = require('../services/ModesManager')
        const mode = ModesManager.getInstance().createMode({
          name: params.name,
          templateType: params.templateType as any,
        })
        return { success: true, mode }
      } catch (e: any) {
        console.error('[IPC] modes:create error:', e)
        return { success: false, error: e.message }
      }
    },
  )

  safeHandle(
    'modes:update',
    async (
      _,
      id: string,
      updates: { name?: string; templateType?: string; customContext?: string },
    ) => {
      try {
        const { ModesManager } = require('../services/ModesManager')
        const mgr = ModesManager.getInstance()
        if (!isProOrTrialActive()) {
          if (updates.templateType && updates.templateType !== 'general') {
            return { success: false, error: 'pro_required' }
          }
          const existing = mgr.getModes().find((m: any) => m.id === id)
          if (existing && existing.templateType !== 'general') {
            return { success: false, error: 'pro_required' }
          }
        }
        mgr.updateMode(id, updates)
        return { success: true }
      } catch (e: any) {
        console.error('[IPC] modes:update error:', e)
        return { success: false, error: e.message }
      }
    },
  )

  safeHandle('modes:delete', async (_, id: string) => {
    try {
      if (!isProOrTrialActive())
        return { success: false, error: 'pro_required' }
      const { ModesManager } = require('../services/ModesManager')
      ModesManager.getInstance().deleteMode(id)
      return { success: true }
    } catch (e: any) {
      console.error('[IPC] modes:delete error:', e)
      return { success: false, error: e.message }
    }
  })

  safeHandle('modes:set-active', async (_, id: string | null) => {
    try {
      if (id !== null) {
        const { ModesManager } = require('../services/ModesManager')
        const targetMode = ModesManager.getInstance()
          .getModes()
          .find((m: any) => m.id === id)
        if (
          targetMode &&
          targetMode.templateType !== 'general' &&
          !isProOrTrialActive()
        ) {
          return { success: false, error: 'pro_required' }
        }
      }
      const { ModesManager } = require('../services/ModesManager')
      ModesManager.getInstance().setActiveMode(id)
      const activeName = id
        ? (ModesManager.getInstance().getActiveMode()?.name ?? null)
        : null
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed())
          win.webContents.send('mode-changed', { id, name: activeName })
      })
      return { success: true }
    } catch (e: any) {
      console.error('[IPC] modes:set-active error:', e)
      return { success: false, error: e.message }
    }
  })

  safeHandle('modes:get-reference-files', async (_, modeId: string) => {
    try {
      const { ModesManager } = require('../services/ModesManager')
      return ModesManager.getInstance().getReferenceFiles(modeId)
    } catch (e: any) {
      console.error('[IPC] modes:get-reference-files error:', e)
      return []
    }
  })

  safeHandle('modes:upload-reference-file', async (_, modeId: string) => {
    try {
      if (!isProOrTrialActive())
        return { success: false, error: 'pro_required' }
      const result: any = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          {
            name: 'Text & Documents',
            extensions: ['txt', 'md', 'pdf', 'docx', 'doc'],
          },
          { name: 'All Files', extensions: ['*'] },
        ],
      })
      if (result.canceled || !result.filePaths.length) {
        return { success: false, cancelled: true }
      }
      const filePath = result.filePaths[0]
      const fileName = path.basename(filePath)
      const ext = path.extname(filePath).toLowerCase()

      let content = ''
      if (ext === '.pdf') {
        const pdfParse = require('pdf-parse')
        const buffer = fs.readFileSync(filePath)
        const data = await pdfParse(buffer)
        content = data.text
      } else if (ext === '.docx' || ext === '.doc') {
        const mammoth = require('mammoth')
        const result2 = await mammoth.extractRawText({ path: filePath })
        content = result2.value
      } else {
        content = fs.readFileSync(filePath, 'utf8')
      }

      const { ModesManager } = require('../services/ModesManager')
      const file = ModesManager.getInstance().addReferenceFile({
        modeId,
        fileName,
        content,
      })
      return { success: true, file }
    } catch (e: any) {
      console.error('[IPC] modes:upload-reference-file error:', e)
      return { success: false, error: e.message }
    }
  })

  safeHandle('modes:delete-reference-file', async (_, id: string) => {
    try {
      if (!isProOrTrialActive())
        return { success: false, error: 'pro_required' }
      const { ModesManager } = require('../services/ModesManager')
      ModesManager.getInstance().deleteReferenceFile(id)
      return { success: true }
    } catch (e: any) {
      console.error('[IPC] modes:delete-reference-file error:', e)
      return { success: false, error: e.message }
    }
  })

  safeHandle('modes:get-note-sections', async (_, modeId: string) => {
    try {
      const { ModesManager } = require('../services/ModesManager')
      return ModesManager.getInstance().getNoteSections(modeId)
    } catch (e: any) {
      console.error('[IPC] modes:get-note-sections error:', e)
      return []
    }
  })

  safeHandle(
    'modes:add-note-section',
    async (_, modeId: string, title: string, description: string) => {
      try {
        if (!isProOrTrialActive())
          return { success: false, error: 'pro_required' }
        const { ModesManager } = require('../services/ModesManager')
        const section = ModesManager.getInstance().addNoteSection({
          modeId,
          title,
          description,
        })
        return { success: true, section }
      } catch (e: any) {
        console.error('[IPC] modes:add-note-section error:', e)
        return { success: false, error: e.message }
      }
    },
  )

  safeHandle(
    'modes:update-note-section',
    async (
      _,
      id: string,
      updates: { title?: string; description?: string },
    ) => {
      try {
        if (!isProOrTrialActive())
          return { success: false, error: 'pro_required' }
        const { ModesManager } = require('../services/ModesManager')
        ModesManager.getInstance().updateNoteSection(id, updates)
        return { success: true }
      } catch (e: any) {
        console.error('[IPC] modes:update-note-section error:', e)
        return { success: false, error: e.message }
      }
    },
  )

  safeHandle('modes:delete-note-section', async (_, id: string) => {
    try {
      if (!isProOrTrialActive())
        return { success: false, error: 'pro_required' }
      const { ModesManager } = require('../services/ModesManager')
      ModesManager.getInstance().deleteNoteSection(id)
      return { success: true }
    } catch (e: any) {
      console.error('[IPC] modes:delete-note-section error:', e)
      return { success: false, error: e.message }
    }
  })

  safeHandle('modes:remove-all-note-sections', async (_, modeId: string) => {
    try {
      if (!isProOrTrialActive())
        return { success: false, error: 'pro_required' }
      const { ModesManager } = require('../services/ModesManager')
      ModesManager.getInstance().removeAllNoteSections(modeId)
      return { success: true }
    } catch (e: any) {
      console.error('[IPC] modes:remove-all-note-sections error:', e)
      return { success: false, error: e.message }
    }
  })
}
