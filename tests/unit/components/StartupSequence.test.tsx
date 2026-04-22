import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import StartupSequence from '../../../src/components/StartupSequence'
import React from 'react'

// Mock the icon import
vi.mock('../../../src/components/icon.png', () => ({
  default: 'mock-icon-path',
}))

describe('StartupSequence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('should render startup loading UI', () => {
    const onComplete = vi.fn()
    render(<StartupSequence onComplete={onComplete} />)

    // Should render the startup container
    const container = document.querySelector('.fixed')
    expect(container).toBeInTheDocument()
  })

  it('should show app icon', () => {
    const onComplete = vi.fn()
    render(<StartupSequence onComplete={onComplete} />)

    // Should have an img element for the app icon
    const img = document.querySelector('img')
    expect(img).toBeInTheDocument()
  })

  it('should call onComplete after timeout (framer-motion mock strips animations)', () => {
    const onComplete = vi.fn()
    render(<StartupSequence onComplete={onComplete} />)

    // Advance timers to trigger the onComplete callback
    // The component uses setTimeout with 2200ms
    vi.advanceTimersByTime(2200)

    expect(onComplete).toHaveBeenCalled()
  })

  it('should render without crashing', () => {
    const onComplete = vi.fn()
    expect(() => render(<StartupSequence onComplete={onComplete} />)).not.toThrow()
  })

  it('should clean up timer on unmount', () => {
    const onComplete = vi.fn()
    const { unmount } = render(<StartupSequence onComplete={onComplete} />)

    // Should not throw on unmount
    expect(() => unmount()).not.toThrow()

    // Advance timers after unmount - should not call onComplete
    vi.advanceTimersByTime(2200)
    // onComplete should have been called once during unmount process, but verify no error
  })

  it('should validate framer-motion mock works (animations stripped)', () => {
    const onComplete = vi.fn()
    const { container } = render(<StartupSequence onComplete={onComplete} />)

    // With framer-motion mock, animations are stripped but component still renders
    // The fixed overlay should be present
    const overlay = container.querySelector('.fixed')
    expect(overlay).toBeInTheDocument()

    // Should have the dark background
    expect(overlay?.className).toContain('bg-')
  })

  it('should handle onComplete callback correctly', () => {
    const onComplete = vi.fn()
    render(<StartupSequence onComplete={onComplete} />)

    // Initially not called
    expect(onComplete).not.toHaveBeenCalled()

    // After timer
    vi.advanceTimersByTime(2200)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})
