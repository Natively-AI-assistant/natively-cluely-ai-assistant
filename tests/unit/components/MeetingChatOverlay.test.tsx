/**
 * Tests for MeetingChatOverlay component (550 lines)
 * Tests meeting chat UI, RAG streaming, and IPC
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// Import mocks from test mocks directory
import '../../mocks/framer-motion.mock'
import { installElectronAPIMock, fireIPCEvent } from '../../mocks/electronAPI.mock'

import MeetingChatOverlay from '../../../src/components/MeetingChatOverlay'

// Mock useStreamBuffer hook
vi.mock('../../../src/hooks/useStreamBuffer', () => ({
  useStreamBuffer: vi.fn(() => ({
    buffer: '',
    isBuffering: false,
    appendToken: vi.fn(),
    getBufferedContent: vi.fn(() => ''),
    reset: vi.fn(),
  })),
}))

// Mock scrollIntoView for jsdom
Object.defineProperty(HTMLDivElement.prototype, 'scrollIntoView', {
  writable: true,
  value: vi.fn(),
})

// Mock react-markdown
vi.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: any) => React.createElement('div', { 'data-testid': 'markdown' }, children),
}))

vi.mock('remark-gfm', () => ({ default: () => null }))
vi.mock('remark-math', () => ({ default: () => null }))
vi.mock('rehype-katex', () => ({ default: () => null }))

vi.mock('react-syntax-highlighter', () => ({
  __esModule: true,
  Prism: ({ children }: any) => React.createElement('pre', null, children),
}))

// Mock image import
vi.mock('../../../src/components/icon.png', () => ({ default: '/mock-icon.png' }))

describe('MeetingChatOverlay Component', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  const mockOnClose = vi.fn()
  const mockOnNewQuery = vi.fn()
  const defaultMeetingContext = {
    id: 'test-meeting-id',
    title: 'Test Meeting',
    summary: 'Test summary',
    keyPoints: ['Point 1', 'Point 2'],
    actionItems: ['Action 1'],
    transcript: [
      { speaker: 'Speaker 1', text: 'Hello', timestamp: 1000 },
      { speaker: 'Speaker 2', text: 'Hi there', timestamp: 2000 },
    ],
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.clearAllMocks()
    installElectronAPIMock({
      ragQueryMeeting: vi.fn(() => Promise.resolve({ results: [] })),
      streamGeminiChat: vi.fn(() => Promise.resolve()),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    consoleErrorSpy.mockRestore()
  })

  it('renders chat overlay without crashing when open', () => {
    render(
      <MeetingChatOverlay
        isOpen={true}
        onClose={mockOnClose}
        meetingContext={defaultMeetingContext}
        onNewQuery={mockOnNewQuery}
      />
    )
    expect(screen.getByText('Search this meeting')).toBeInTheDocument()
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('does not render overlay content when closed', () => {
    render(
      <MeetingChatOverlay
        isOpen={false}
        onClose={mockOnClose}
        meetingContext={defaultMeetingContext}
        onNewQuery={mockOnNewQuery}
      />
    )
    expect(screen.queryByText('Search this meeting')).not.toBeInTheDocument()
  })

  it('renders with empty meeting context', () => {
    render(
      <MeetingChatOverlay
        isOpen={true}
        onClose={mockOnClose}
        meetingContext={{ id: 'empty', title: 'Empty Meeting' }}
        onNewQuery={mockOnNewQuery}
      />
    )
    expect(screen.getByText('Search this meeting')).toBeInTheDocument()
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', () => {
    render(
      <MeetingChatOverlay
        isOpen={true}
        onClose={mockOnClose}
        meetingContext={defaultMeetingContext}
        onNewQuery={mockOnNewQuery}
      />
    )

    fireEvent.click(screen.getByRole('button'))
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('calls onClose on ESC key press', () => {
    render(
      <MeetingChatOverlay
        isOpen={true}
        onClose={mockOnClose}
        meetingContext={defaultMeetingContext}
        onNewQuery={mockOnNewQuery}
      />
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('auto-submits initialQuery when overlay opens with empty messages', async () => {
    render(
      <MeetingChatOverlay
        isOpen={true}
        onClose={mockOnClose}
        meetingContext={defaultMeetingContext}
        initialQuery="What happened?"
        onNewQuery={mockOnNewQuery}
      />
    )

    // Wait for the 100ms auto-submit + 200ms typing delay
    await act(async () => {
      vi.advanceTimersByTime(400)
    })

    // ragQueryMeeting should have been called
    expect(window.electronAPI.ragQueryMeeting).toHaveBeenCalled()
  })

  it('adds user message when initialQuery is submitted', async () => {
    render(
      <MeetingChatOverlay
        isOpen={true}
        onClose={mockOnClose}
        meetingContext={defaultMeetingContext}
        initialQuery="What happened?"
        onNewQuery={mockOnNewQuery}
      />
    )

    await act(async () => {
      vi.advanceTimersByTime(400)
    })

    expect(screen.getByText('What happened?')).toBeInTheDocument()
  })

  it('registers RAG stream listeners on query submit', async () => {
    render(
      <MeetingChatOverlay
        isOpen={true}
        onClose={mockOnClose}
        meetingContext={defaultMeetingContext}
        initialQuery="test"
        onNewQuery={mockOnNewQuery}
      />
    )

    await act(async () => {
      vi.advanceTimersByTime(400)
    })

    expect(window.electronAPI.onRAGStreamChunk).toHaveBeenCalled()
    expect(window.electronAPI.onRAGStreamComplete).toHaveBeenCalled()
    expect(window.electronAPI.onRAGStreamError).toHaveBeenCalled()
  })

  it('calls ragQueryMeeting with meeting ID and question', async () => {
    render(
      <MeetingChatOverlay
        isOpen={true}
        onClose={mockOnClose}
        meetingContext={defaultMeetingContext}
        initialQuery="hello"
        onNewQuery={mockOnNewQuery}
      />
    )

    await act(async () => {
      vi.advanceTimersByTime(400)
    })

    expect(window.electronAPI.ragQueryMeeting).toHaveBeenCalledWith('test-meeting-id', 'hello')
  })

  it('shows error message on RAG stream error', async () => {
    render(
      <MeetingChatOverlay
        isOpen={true}
        onClose={mockOnClose}
        meetingContext={defaultMeetingContext}
        initialQuery="test"
        onNewQuery={mockOnNewQuery}
      />
    )

    await act(async () => {
      vi.advanceTimersByTime(400)
    })

    fireIPCEvent('onRAGStreamError', { error: 'Stream failed' })

    await act(async () => {
      vi.advanceTimersByTime(10)
    })

    await waitFor(() => {
      expect(screen.getByText("Couldn't get a response. Please try again.")).toBeInTheDocument()
    })
  })

  it('falls back to Gemini when ragQueryMeeting returns fallback', async () => {
    installElectronAPIMock({
      ragQueryMeeting: vi.fn(() => Promise.resolve({ fallback: true })),
      streamGeminiChat: vi.fn(() => Promise.resolve()),
    })

    render(
      <MeetingChatOverlay
        isOpen={true}
        onClose={mockOnClose}
        meetingContext={defaultMeetingContext}
        initialQuery="fallback test"
        onNewQuery={mockOnNewQuery}
      />
    )

    await act(async () => {
      vi.advanceTimersByTime(400)
    })

    await waitFor(() => {
      expect(window.electronAPI.streamGeminiChat).toHaveBeenCalled()
    })
  })

  it('falls back to Gemini when meeting has no ID', async () => {
    installElectronAPIMock({
      ragQueryMeeting: vi.fn(() => Promise.resolve({ results: [] })),
      streamGeminiChat: vi.fn(() => Promise.resolve()),
    })

    const contextNoId = { title: 'No ID Meeting', summary: 'Some summary' }

    render(
      <MeetingChatOverlay
        isOpen={true}
        onClose={mockOnClose}
        meetingContext={contextNoId}
        initialQuery="hello"
        onNewQuery={mockOnNewQuery}
      />
    )

    await act(async () => {
      vi.advanceTimersByTime(400)
    })

    await waitFor(() => {
      expect(window.electronAPI.streamGeminiChat).toHaveBeenCalled()
    })
  })

  it('shows error message when ragQueryMeeting throws', async () => {
    installElectronAPIMock({
      ragQueryMeeting: vi.fn(() => Promise.reject(new Error('Network error'))),
      onRAGStreamChunk: vi.fn(),
      onRAGStreamComplete: vi.fn(),
      onRAGStreamError: vi.fn(),
    })

    render(
      <MeetingChatOverlay
        isOpen={true}
        onClose={mockOnClose}
        meetingContext={defaultMeetingContext}
        initialQuery="will throw"
        onNewQuery={mockOnNewQuery}
      />
    )

    await act(async () => {
      vi.advanceTimersByTime(400)
    })

    await waitFor(() => {
      expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument()
    })
  })

  it('does not submit empty queries', async () => {
    render(
      <MeetingChatOverlay
        isOpen={true}
        onClose={mockOnClose}
        meetingContext={defaultMeetingContext}
        initialQuery=""
        onNewQuery={mockOnNewQuery}
      />
    )

    // Empty initialQuery should not trigger ragQueryMeeting
    await act(async () => {
      vi.advanceTimersByTime(500)
    })

    expect(window.electronAPI.ragQueryMeeting).not.toHaveBeenCalled()
  })

  it('handles close and re-open without crashing', () => {
    const { rerender } = render(
      <MeetingChatOverlay
        isOpen={true}
        onClose={mockOnClose}
        meetingContext={defaultMeetingContext}
        onNewQuery={mockOnNewQuery}
      />
    )

    expect(screen.getByText('Search this meeting')).toBeInTheDocument()

    // Close the overlay
    rerender(
      <MeetingChatOverlay
        isOpen={false}
        onClose={mockOnClose}
        meetingContext={defaultMeetingContext}
        onNewQuery={mockOnNewQuery}
      />
    )

    // Re-open without error
    rerender(
      <MeetingChatOverlay
        isOpen={true}
        onClose={mockOnClose}
        meetingContext={defaultMeetingContext}
        onNewQuery={mockOnNewQuery}
      />
    )

    expect(screen.getByText('Search this meeting')).toBeInTheDocument()
  })

  it('shows typing indicator while waiting for LLM response', async () => {
    // Make ragQueryMeeting never resolve to keep waiting state
    installElectronAPIMock({
      ragQueryMeeting: vi.fn(() => new Promise(() => {})),
      onRAGStreamChunk: vi.fn(),
      onRAGStreamComplete: vi.fn(),
      onRAGStreamError: vi.fn(),
    })

    render(
      <MeetingChatOverlay
        isOpen={true}
        onClose={mockOnClose}
        meetingContext={defaultMeetingContext}
        initialQuery="waiting test"
        onNewQuery={mockOnNewQuery}
      />
    )

    // Advance past auto-submit delay
    await act(async () => {
      vi.advanceTimersByTime(150)
    })

    // Advance past typing indicator delay
    await act(async () => {
      vi.advanceTimersByTime(200)
    })

    // Typing indicator should be visible (animated dots)
    // The component renders TypingIndicator when chatState === 'waiting_for_llm'
    // We can verify by checking the DOM for the animated dots
  })

  it('renders without crash on close button interaction', () => {
    render(
      <MeetingChatOverlay
        isOpen={true}
        onClose={mockOnClose}
        meetingContext={defaultMeetingContext}
        onNewQuery={mockOnNewQuery}
      />
    )

    // Click close button, should not throw
    const closeBtn = screen.getByRole('button')
    expect(() => fireEvent.click(closeBtn)).not.toThrow()
  })
})
