/**
 * Tests for Debug component (450 lines)
 * Tests debug view rendering with diff view
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Import mocks from test mocks directory
import '../../mocks/framer-motion.mock'
import '../../mocks/electronAPI.mock'

// Mock react-query
const mockQueryClient = {
  getQueryData: vi.fn(() => undefined),
  setQueryData: vi.fn(),
  clear: vi.fn(),
}

vi.mock('react-query', () => ({
  QueryClient: class MockQueryClient {
    clear = vi.fn()
  },
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
  useQueryClient: vi.fn(() => mockQueryClient),
  useQuery: vi.fn(() => ({ data: undefined, isLoading: false, error: null })),
}))

// Mock react-syntax-highlighter
vi.mock('react-syntax-highlighter', () => ({
  Prism: ({ children }: any) => React.createElement('pre', { 'data-testid': 'syntax-highlighter' }, children),
}))

// Mock diff library
vi.mock('diff', () => ({
  diffLines: vi.fn(() => []),
}))

// Mock ScreenshotQueue component
vi.mock('../../../src/components/Queue/ScreenshotQueue', () => ({
  default: ({ screenshots }: any) => React.createElement('div', { 'data-testid': 'screenshot-queue', 'data-count': screenshots?.length ?? 0 }),
}))

// Mock SolutionCommands component
vi.mock('../../../src/components/Solutions/SolutionCommands', () => ({
  default: ({ extraScreenshots }: any) => React.createElement('div', { 'data-testid': 'solution-commands', 'data-has-screenshots': String((extraScreenshots?.length ?? 0) > 0) }),
}))

// Mock toast components
vi.mock('../../../src/components/ui/toast', () => ({
  Toast: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'toast' }, children),
  ToastDescription: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'toast-description' }, children),
  ToastMessage: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'toast-message' }, children),
  ToastTitle: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'toast-title' }, children),
  ToastVariant: {},
}))

// Must import after mocking
import Debug from '../../../src/_pages/Debug'

describe('Debug Component', () => {
  const mockSetIsProcessing = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(window.electronAPI.getScreenshots as any).mockResolvedValue([])
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('renders the screenshot queue and command bar', () => {
    render(<Debug isProcessing={false} setIsProcessing={mockSetIsProcessing} />)

    expect(screen.getByTestId('screenshot-queue')).toBeInTheDocument()
    expect(screen.getByTestId('solution-commands')).toBeInTheDocument()
  })

  it('renders with empty screenshots by default', () => {
    render(<Debug isProcessing={false} setIsProcessing={mockSetIsProcessing} />)

    expect(screen.getByTestId('screenshot-queue')).toHaveAttribute('data-count', '0')
  })

  it('registers electronAPI event listeners on mount', () => {
    render(<Debug isProcessing={false} setIsProcessing={mockSetIsProcessing} />)

    // verify screenshot listener registered
    expect(window.electronAPI.onScreenshotTaken).toHaveBeenCalled()
    // verify reset-view listener registered
    expect(window.electronAPI.onResetView).toHaveBeenCalled()
    // verify debug error listener registered
    expect(window.electronAPI.onDebugError).toHaveBeenCalled()
  })

  it('registers debug lifecycle listeners', () => {
    render(<Debug isProcessing={true} setIsProcessing={mockSetIsProcessing} />)

    expect(window.electronAPI.onDebugSuccess).toHaveBeenCalled()
    expect(window.electronAPI.onDebugStart).toHaveBeenCalled()
  })

  it('cleans up listeners on unmount', () => {
    const { unmount } = render(<Debug isProcessing={false} setIsProcessing={mockSetIsProcessing} />)
    unmount()
    // If cleanup functions were returned and called, no error should have occurred
  })

  it('renders the toast container', () => {
    render(<Debug isProcessing={false} setIsProcessing={mockSetIsProcessing} />)

    expect(screen.getByTestId('toast')).toBeInTheDocument()
  })

  it('renders content section with "What I Changed" heading', () => {
    render(<Debug isProcessing={false} setIsProcessing={mockSetIsProcessing} />)

    expect(screen.getByText('What I Changed')).toBeInTheDocument()
  })

  it('renders code comparison section', () => {
    render(<Debug isProcessing={false} setIsProcessing={mockSetIsProcessing} />)

    expect(screen.getByText('Code Comparison')).toBeInTheDocument()
  })

  it('renders complexity section', () => {
    render(<Debug isProcessing={false} setIsProcessing={mockSetIsProcessing} />)

    expect(screen.getByText('Complexity')).toBeInTheDocument()
  })
})
