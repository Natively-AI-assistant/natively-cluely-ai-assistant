/**
 * RAG/Database handlers extracted from ipcHandlers.ts.
 * Handles meeting details, donations.
 */

import { DatabaseManager } from '../db/DatabaseManager'
import type { AppState } from '../main'
import { safeHandle } from './safeHandle'

interface RAGQueryEntry {
  abortController: AbortController
  senderId: number
}

const activeRAGQueries = new Map<string, RAGQueryEntry>()

function cleanupQueriesForSender(senderId: number): void {
  for (const [key, entry] of activeRAGQueries.entries()) {
    if (entry.senderId === senderId) {
      entry.abortController.abort()
      activeRAGQueries.delete(key)
    }
  }
}

export function registerRAGHandlers(appState: AppState): void {
  // Meeting handlers
  safeHandle('delete-meeting', async (_, id: string) => {
    return DatabaseManager.getInstance().deleteMeeting(id)
  })

  safeHandle('get-meeting-details', async (_, id: string) => {
    return DatabaseManager.getInstance().getMeetingDetails(id)
  })

  // Donation handlers
  safeHandle('get-donation-status', async () => {
    const { DonationManager } = require('../DonationManager')
    const manager = DonationManager.getInstance()
    return {
      shouldShow: manager.shouldShowToaster(),
      hasDonated: manager.getDonationState().hasDonated,
      lifetimeShows: manager.getDonationState().lifetimeShows,
    }
  })

  safeHandle('mark-donation-toast-shown', async () => {
    const { DonationManager } = require('../DonationManager')
    DonationManager.getInstance().markAsShown()
    return { success: true }
  })

  safeHandle('set-donation-complete', async () => {
    const { DonationManager } = require('../DonationManager')
    DonationManager.getInstance().setHasDonated(true)
    return { success: true }
  })

  safeHandle(
    'rag:query-meeting',
    async (
      event,
      { meetingId, query }: { meetingId: string; query: string },
    ) => {
      const ragManager = appState.getRAGManager()
      if (!ragManager || !ragManager.isReady()) {
        return { fallback: true }
      }
      if (
        !ragManager.isMeetingProcessed(meetingId) &&
        !ragManager.isLiveIndexingActive(meetingId)
      ) {
        return { fallback: true }
      }
      const abortController = new AbortController()
      const queryKey = `meeting-${meetingId}`
      const senderId = event.sender.id
      activeRAGQueries.set(queryKey, { abortController, senderId })

      const sender = event.sender
      const cleanup = () => cleanupQueriesForSender(senderId)
      sender.on('did-disconnect', cleanup)

      try {
        const stream = ragManager.queryMeeting(
          meetingId,
          query,
          abortController.signal,
        )
        for await (const chunk of stream) {
          if (abortController.signal.aborted) break
          event.sender.send('rag:stream-chunk', { meetingId, chunk })
        }
        event.sender.send('rag:stream-complete', { meetingId })
        return { success: true }
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          const msg = error.message || ''
          if (
            msg.includes('NO_RELEVANT_CONTEXT') ||
            msg.includes('NO_MEETING_EMBEDDINGS')
          ) {
            return { fallback: true }
          }
          event.sender.send('rag:stream-error', { meetingId, error: msg })
        }
        return { success: false, error: error.message }
      } finally {
        sender.off('did-disconnect', cleanup)
        activeRAGQueries.delete(queryKey)
      }
    },
  )

  safeHandle('rag:query-live', async (event, { query }: { query: string }) => {
    const ragManager = appState.getRAGManager()
    if (!ragManager || !ragManager.isReady()) {
      return { fallback: true }
    }
    if (!ragManager.isLiveIndexingActive('live-meeting-current')) {
      return { fallback: true }
    }
    const abortController = new AbortController()
    const queryKey = `live-${Date.now()}`
    const senderId = event.sender.id
    activeRAGQueries.set(queryKey, { abortController, senderId })

    const sender = event.sender
    const cleanup = () => cleanupQueriesForSender(senderId)
    sender.on('did-disconnect', cleanup)

    try {
      const stream = ragManager.queryMeeting(
        'live-meeting-current',
        query,
        abortController.signal,
      )
      for await (const chunk of stream) {
        if (abortController.signal.aborted) break
        event.sender.send('rag:stream-chunk', { live: true, chunk })
      }
      event.sender.send('rag:stream-complete', { live: true })
      return { success: true }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        const msg = error.message || ''
        if (
          msg.includes('NO_RELEVANT_CONTEXT') ||
          msg.includes('NO_MEETING_EMBEDDINGS')
        ) {
          return { fallback: true }
        }
        event.sender.send('rag:stream-error', { live: true, error: msg })
      }
      return { success: false, error: error.message }
    } finally {
      sender.off('did-disconnect', cleanup)
      activeRAGQueries.delete(queryKey)
    }
  })

  safeHandle(
    'rag:query-global',
    async (event, { query }: { query: string }) => {
      const ragManager = appState.getRAGManager()
      if (!ragManager || !ragManager.isReady()) {
        return { fallback: true }
      }
      const abortController = new AbortController()
      const queryKey = `global-${Date.now()}`
      const senderId = event.sender.id
      activeRAGQueries.set(queryKey, { abortController, senderId })

      const sender = event.sender
      const cleanup = () => cleanupQueriesForSender(senderId)
      sender.on('did-disconnect', cleanup)

      try {
        const stream = ragManager.queryGlobal(query, abortController.signal)
        for await (const chunk of stream) {
          if (abortController.signal.aborted) break
          event.sender.send('rag:stream-chunk', { global: true, chunk })
        }
        event.sender.send('rag:stream-complete', { global: true })
        return { success: true }
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          const msg = error.message || ''
          if (
            msg.includes('NO_RELEVANT_CONTEXT') ||
            msg.includes('NO_MEETING_EMBEDDINGS')
          ) {
            return { fallback: true }
          }
          event.sender.send('rag:stream-error', { global: true, error: msg })
        }
        return { success: false, error: error.message }
      } finally {
        sender.off('did-disconnect', cleanup)
        activeRAGQueries.delete(queryKey)
      }
    },
  )

  safeHandle(
    'rag:cancel-query',
    async (
      _,
      { meetingId, global }: { meetingId?: string; global?: boolean } = {},
    ) => {
      if (meetingId) {
        activeRAGQueries.get(`meeting-${meetingId}`)?.abortController.abort()
        activeRAGQueries.delete(`meeting-${meetingId}`)
      } else if (global) {
        activeRAGQueries.forEach((entry, key) => {
          if (key.startsWith('global-')) {
            entry.abortController.abort()
            activeRAGQueries.delete(key)
          }
        })
      } else {
        activeRAGQueries.forEach((entry) => {
          entry.abortController.abort()
        })
        activeRAGQueries.clear()
      }
      return { success: true }
    },
  )

  safeHandle('rag:get-queue-status', async () => {
    const ragManager = appState.getRAGManager()
    if (!ragManager)
      return { pending: 0, processing: 0, completed: 0, failed: 0 }
    const status = ragManager.getQueueStatus()
    return {
      pending: status.pending || 0,
      processing: status.processing || 0,
      completed: status.completed || 0,
      failed: status.failed || 0,
    }
  })

  safeHandle('rag:retry-embeddings', async () => {
    const ragManager = appState.getRAGManager()
    if (!ragManager) return { success: false }
    const result = await ragManager.retryPendingEmbeddings()
    return { success: result }
  })

  safeHandle('rag:is-meeting-processed', async (_, meetingId: string) => {
    const ragManager = appState.getRAGManager()
    if (!ragManager) return false
    return ragManager.isMeetingProcessed(meetingId)
  })

  safeHandle('rag:reindex-incompatible-meetings', async () => {
    const ragManager = appState.getRAGManager()
    if (!ragManager) return { success: false }
    await ragManager.reindexIncompatibleMeetings()
    return { success: true }
  })
}
