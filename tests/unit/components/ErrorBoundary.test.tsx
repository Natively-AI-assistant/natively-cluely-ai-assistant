import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../../../src/components/ErrorBoundary'

const ThrowError = ({ shouldThrow = true }: { shouldThrow?: boolean }) => {
  if (shouldThrow) {
    throw new Error('Test error')
  }
  return <div>No error</div>
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>Test content</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('Test content')).toBeInTheDocument()
  })

  it('renders fallback UI with all expected elements when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Application crashed')).toBeInTheDocument()
    expect(screen.getByText('Test error')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Try to recover' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Reload UI' }),
    ).toBeInTheDocument()
  })

  it('shows context-specific title when context prop is provided', () => {
    render(
      <ErrorBoundary context="Launcher">
        <ThrowError />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Launcher crashed')).toBeInTheDocument()
  })

  it('defaults to "Application" when no context provided', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Application crashed')).toBeInTheDocument()
  })

  it('logs error details to console with context prefix', () => {
    render(
      <ErrorBoundary context="TestContext">
        <ThrowError />
      </ErrorBoundary>,
    )
    expect(consoleErrorSpy).toHaveBeenCalled()
    const hasContextPrefix = consoleErrorSpy.mock.calls.some(
      (call) =>
        call[0] &&
        typeof call[0] === 'string' &&
        call[0].includes('ErrorBoundary:TestContext'),
    )
    expect(hasContextPrefix).toBe(true)
  })

  it('calls electronAPI.logErrorToMain with structured error report', () => {
    const logErrorToMain = vi.fn()
    const original = (window as any).electronAPI
    ;(window as any).electronAPI = { ...original, logErrorToMain }

    render(
      <ErrorBoundary context="TestContext">
        <ThrowError />
      </ErrorBoundary>,
    )

    expect(logErrorToMain).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'uncaught-render-error',
        context: 'TestContext',
        message: 'Test error',
      }),
    )

    ;(window as any).electronAPI = original
  })

  it('recovers when clicking "Try to recover" after child rerenders without error', async () => {
    const user = userEvent.setup()

    const Recoverable = ({ shouldThrow }: { shouldThrow: boolean }) => {
      if (shouldThrow) {
        throw new Error('Recoverable error')
      }
      return <div>Recovered content</div>
    }

    const { rerender } = render(
      <ErrorBoundary>
        <Recoverable shouldThrow={true} />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Recoverable error')).toBeInTheDocument()

    rerender(
      <ErrorBoundary>
        <Recoverable shouldThrow={false} />
      </ErrorBoundary>,
    )

    await user.click(screen.getByRole('button', { name: 'Try to recover' }))
    expect(screen.getByText('Recovered content')).toBeInTheDocument()
    expect(screen.queryByText('Recoverable error')).not.toBeInTheDocument()
  })

  it('calls window.location.reload when clicking "Reload UI"', async () => {
    const user = userEvent.setup()
    const reloadMock = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { reload: reloadMock },
      writable: true,
    })

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    )

    await user.click(screen.getByRole('button', { name: 'Reload UI' }))
    expect(reloadMock).toHaveBeenCalledOnce()
  })

  it('handles non-Error throws gracefully', () => {
    const ThrowStringError = () => {
      throw 'String error'
    }

    render(
      <ErrorBoundary>
        <ThrowStringError />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Application crashed')).toBeInTheDocument()
  })

  it('does not render children after error', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
        <div>Should not be visible</div>
      </ErrorBoundary>,
    )

    expect(screen.queryByText('Should not be visible')).not.toBeInTheDocument()
  })

  it('only catches errors from its own subtree', () => {
    const GoodChild = () => <div>Good child</div>

    render(
      <div>
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
        <GoodChild />
      </div>,
    )

    expect(screen.getByText('Application crashed')).toBeInTheDocument()
    expect(screen.getByText('Good child')).toBeInTheDocument()
  })
})
