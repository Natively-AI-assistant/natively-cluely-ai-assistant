import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GlobalChatOverlay from '../../../src/components/GlobalChatOverlay'

import {
  fireIPCEvent,
  installElectronAPIMock,
} from '../../mocks/electronAPI.mock'

// Mock scrollIntoView for refs
Element.prototype.scrollIntoView = vi.fn()

// Mock useStreamBuffer hook
vi.mock('../../../src/hooks/useStreamBuffer', () => ({
  useStreamBuffer: () => ({
    appendToken: vi.fn((token: string, onFlush: (content: string) => void) => {
      onFlush(token)
    }),
    getBufferedContent: vi.fn(() => ''),
    reset: vi.fn(),
  }),
}))

// Mock the icon import
vi.mock('../../../src/components/icon.png', () => ({
  default: 'mock-icon-path',
}))

describe('GlobalChatOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    installElectronAPIMock({
      ragQueryGlobal: vi.fn(() => Promise.resolve({ results: [] })),
      streamGeminiChat: vi.fn(() => Promise.resolve()),
      ragCancelQuery: vi.fn(() => Promise.resolve({ success: true })),
      // Use default listenerMock for stream listeners (from installElectronAPIMock)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('should render chat overlay UI elements when open', () => {
    const onClose = vi.fn()
    render(<GlobalChatOverlay isOpen={true} onClose={onClose} />)

    const input = document.querySelector('input')
    expect(input).toBeInTheDocument()

    const button = document.querySelector('button')
    expect(button).toBeInTheDocument()
  })

  it('should render input field for querying', () => {
    const onClose = vi.fn()
    render(<GlobalChatOverlay isOpen={true} onClose={onClose} />)

    const input = document.querySelector('input')
    expect(input).toBeInTheDocument()
  })

  it('should call onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<GlobalChatOverlay isOpen={true} onClose={onClose} />)

    const closeButton = document.querySelector('button')
    expect(closeButton).toBeTruthy()
    fireEvent.click(closeButton!)
    expect(onClose).toHaveBeenCalled()
  })

  it('should clear input after submitting a query via Enter', () => {
    const onClose = vi.fn()
    render(<GlobalChatOverlay isOpen={true} onClose={onClose} />)

    const input = document.querySelector('input') as HTMLInputElement
    expect(input).toBeTruthy()
    fireEvent.change(input, { target: { value: 'test query' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(input.value).toBe('')
  })

  it('should handle ESC key to close', () => {
    const onClose = vi.fn()
    render(<GlobalChatOverlay isOpen={true} onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })

  it('should render nothing when isOpen is false', () => {
    const onClose = vi.fn()
    const { container } = render(
      <GlobalChatOverlay isOpen={false} onClose={onClose} />,
    )

    expect(container.querySelector('input')).not.toBeInTheDocument()
    expect(container.querySelector('button')).not.toBeInTheDocument()
  })

  it('should auto-submit initialQuery on open', async () => {
    const onClose = vi.fn()
    render(
      <GlobalChatOverlay
        isOpen={true}
        onClose={onClose}
        initialQuery="initial search"
      />,
    )

    // Wait for the 100ms setTimeout + 200ms typing indicator delay
    await act(async () => {
      vi.advanceTimersByTime(400)
    })

    // ragQueryGlobal should have been called
    expect(window.electronAPI.ragQueryGlobal).toHaveBeenCalled()
  })

  it('should clean up on unmount', () => {
    const onClose = vi.fn()
    const { unmount } = render(
      <GlobalChatOverlay isOpen={true} onClose={onClose} />,
    )

    expect(() => unmount()).not.toThrow()
  })

  it('should add user message when query is submitted via Enter', () => {
    const onClose = vi.fn()
    render(<GlobalChatOverlay isOpen={true} onClose={onClose} />)

    const input = document.querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Hello world' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('should show typing indicator after submitting query', () => {
    const onClose = vi.fn()
    render(<GlobalChatOverlay isOpen={true} onClose={onClose} />)

    const input = document.querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'test' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // Typing indicator should appear (3 animated dots)
    // After 200ms, assistant placeholder appears
  })

  it('should register RAG stream listeners on query submit', async () => {
    const onClose = vi.fn()
    render(<GlobalChatOverlay isOpen={true} onClose={onClose} />)

    const input = document.querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'test' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // Wait for async setup
    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(window.electronAPI.onRAGStreamChunk).toHaveBeenCalled()
    expect(window.electronAPI.onRAGStreamComplete).toHaveBeenCalled()
    expect(window.electronAPI.onRAGStreamError).toHaveBeenCalled()
  })

  it('should call ragQueryGlobal with the query text', async () => {
    const onClose = vi.fn()
    render(<GlobalChatOverlay isOpen={true} onClose={onClose} />)

    const input = document.querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'search for meetings' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(window.electronAPI.ragQueryGlobal).toHaveBeenCalledWith(
      'search for meetings',
    )
  })

  it('should not submit empty queries', () => {
    const onClose = vi.fn()
    render(<GlobalChatOverlay isOpen={true} onClose={onClose} />)

    const input = document.querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // Empty query should not add messages or call ragQueryGlobal
    expect(window.electronAPI.ragQueryGlobal).not.toHaveBeenCalled()
  })

  it('should show error message when RAG stream error occurs', async () => {
    const onClose = vi.fn()
    render(<GlobalChatOverlay isOpen={true} onClose={onClose} />)

    const input = document.querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'test' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // Advance past the 100ms auto-submit delay + 200ms typing indicator
    await act(async () => {
      vi.advanceTimersByTime(400)
    })

    // Simulate RAG stream error
    fireIPCEvent('onRAGStreamError', { error: 'RAG failed' })

    // Wait for React to process the state update
    await act(async () => {
      vi.advanceTimersByTime(10)
    })

    await waitFor(() => {
      expect(
        screen.getByText("Couldn't get a response. Please try again."),
      ).toBeInTheDocument()
    })
  })

  it('should submit query via submit button click', () => {
    const onClose = vi.fn()
    render(<GlobalChatOverlay isOpen={true} onClose={onClose} />)

    const input = document.querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'button query' } })

    // Click the submit button (second button in the overlay)
    const buttons = document.querySelectorAll('button')
    const submitButton = buttons[buttons.length - 1] // Last button is submit
    fireEvent.click(submitButton)

    expect(screen.getByText('button query')).toBeInTheDocument()
  })

  it('should handle fallback to Gemini when ragQueryGlobal returns fallback', async () => {
    installElectronAPIMock({
      ragQueryGlobal: vi.fn(() => Promise.resolve({ fallback: true })),
      streamGeminiChat: vi.fn(() => Promise.resolve()),
      onRAGStreamChunk: vi.fn(() => () => {}),
      onRAGStreamComplete: vi.fn(() => () => {}),
      onRAGStreamError: vi.fn(() => () => {}),
      onGeminiStreamToken: vi.fn(() => () => {}),
      onGeminiStreamDone: vi.fn(() => () => {}),
      onGeminiStreamError: vi.fn(() => () => {}),
    })

    const onClose = vi.fn()
    render(<GlobalChatOverlay isOpen={true} onClose={onClose} />)

    const input = document.querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'fallback test' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await act(async () => {
      vi.advanceTimersByTime(400)
    })

    await waitFor(() => {
      expect(window.electronAPI.streamGeminiChat).toHaveBeenCalled()
    })
  })

  it('should show error message when ragQueryGlobal throws', async () => {
    installElectronAPIMock({
      ragQueryGlobal: vi.fn(() => Promise.reject(new Error('Network error'))),
      onRAGStreamChunk: vi.fn(() => () => {}),
      onRAGStreamComplete: vi.fn(() => () => {}),
      onRAGStreamError: vi.fn(() => () => {}),
    })

    const onClose = vi.fn()
    render(<GlobalChatOverlay isOpen={true} onClose={onClose} />)

    const input = document.querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'will throw' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await act(async () => {
      vi.advanceTimersByTime(400)
    })

    await waitFor(() => {
      expect(
        screen.getByText('Something went wrong. Please try again.'),
      ).toBeInTheDocument()
    })
  })

  it('should display "Search all meetings" header text', () => {
    const onClose = vi.fn()
    render(<GlobalChatOverlay isOpen={true} onClose={onClose} />)

    expect(screen.getByText('Search all meetings')).toBeInTheDocument()
  })

  it('should not submit query when chat is already processing', async () => {
    const ragMock = vi.fn(() => new Promise(() => {})) // Never resolves
    installElectronAPIMock({
      ragQueryGlobal: ragMock,
      onRAGStreamChunk: vi.fn(() => () => {}),
      onRAGStreamComplete: vi.fn(() => () => {}),
      onRAGStreamError: vi.fn(() => () => {}),
    })

    const onClose = vi.fn()
    render(<GlobalChatOverlay isOpen={true} onClose={onClose} />)

    const input = document.querySelector('input') as HTMLInputElement

    // First submission
    fireEvent.change(input, { target: { value: 'first' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    // Second submission while first is still processing
    fireEvent.change(input, { target: { value: 'second' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    // ragQueryGlobal should only be called once (second blocked)
    expect(ragMock).toHaveBeenCalledTimes(1)
  })
})
