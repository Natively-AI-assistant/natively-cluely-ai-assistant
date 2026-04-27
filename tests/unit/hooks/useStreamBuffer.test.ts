import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStreamBuffer } from '../../../src/hooks/useStreamBuffer'

describe('useStreamBuffer', () => {
  let rafCallback: FrameRequestCallback | null = null
  let rafId = 0
  let rafSpy: ReturnType<typeof vi.spyOn>
  let cancelRafSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    rafCallback = null
    rafId = 0

    rafSpy = vi
      .spyOn(global, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        rafCallback = callback
        rafId++
        return rafId
      })

    cancelRafSpy = vi
      .spyOn(global, 'cancelAnimationFrame')
      .mockImplementation((id: number) => {
        if (id === rafId) {
          rafCallback = null
        }
      })
  })

  afterEach(() => {
    rafSpy.mockRestore()
    cancelRafSpy.mockRestore()
  })

  it('should return appendToken, getBufferedContent, and reset', () => {
    const { result } = renderHook(() => useStreamBuffer())

    expect(result.current.appendToken).toBeInstanceOf(Function)
    expect(result.current.getBufferedContent).toBeInstanceOf(Function)
    expect(result.current.reset).toBeInstanceOf(Function)
  })

  it('should start with empty buffer', () => {
    const { result } = renderHook(() => useStreamBuffer())

    expect(result.current.getBufferedContent()).toBe('')
  })

  it('should accumulate tokens in buffer', () => {
    const { result } = renderHook(() => useStreamBuffer())

    act(() => {
      result.current.appendToken('Hello', vi.fn())
      result.current.appendToken(' World', vi.fn())
    })

    expect(result.current.getBufferedContent()).toBe('Hello World')
  })

  it('should call onFlush with accumulated content on RAF', () => {
    const { result } = renderHook(() => useStreamBuffer())
    const onFlush = vi.fn()

    act(() => {
      result.current.appendToken('Hello', onFlush)
      result.current.appendToken(' World', onFlush)
    })

    // RAF hasn't fired yet
    expect(onFlush).not.toHaveBeenCalled()

    // Trigger RAF
    act(() => {
      if (rafCallback) {
        rafCallback(0)
      }
    })

    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith('Hello World')
  })

  it('should only schedule one RAF per batch of tokens', () => {
    const { result } = renderHook(() => useStreamBuffer())
    const onFlush = vi.fn()

    act(() => {
      result.current.appendToken('A', onFlush)
      result.current.appendToken('B', onFlush)
      result.current.appendToken('C', onFlush)
    })

    // Should have scheduled only one RAF
    expect(rafSpy).toHaveBeenCalledTimes(1)

    act(() => {
      if (rafCallback) {
        rafCallback(0)
      }
    })

    // After RAF fires, next append should schedule new RAF
    act(() => {
      result.current.appendToken('D', onFlush)
    })

    expect(rafSpy).toHaveBeenCalledTimes(2)
  })

  it('should reset buffer and cancel RAF', () => {
    const { result } = renderHook(() => useStreamBuffer())
    const onFlush = vi.fn()

    act(() => {
      result.current.appendToken('Hello', onFlush)
    })

    expect(result.current.getBufferedContent()).toBe('Hello')

    act(() => {
      result.current.reset()
    })

    expect(result.current.getBufferedContent()).toBe('')

    // RAF should have been cancelled
    expect(cancelRafSpy).toHaveBeenCalled()
  })

  it('should allow new RAF after reset', () => {
    const { result } = renderHook(() => useStreamBuffer())
    const onFlush = vi.fn()

    act(() => {
      result.current.appendToken('First', onFlush)
      result.current.reset()
      result.current.appendToken('Second', onFlush)
    })

    act(() => {
      if (rafCallback) {
        rafCallback(0)
      }
    })

    expect(onFlush).toHaveBeenCalledWith('Second')
  })

  it('should handle empty tokens', () => {
    const { result } = renderHook(() => useStreamBuffer())

    act(() => {
      result.current.appendToken('', vi.fn())
    })

    expect(result.current.getBufferedContent()).toBe('')
  })

  it('should handle multiple flushes', () => {
    const { result } = renderHook(() => useStreamBuffer())
    const onFlush = vi.fn()

    // First batch
    act(() => {
      result.current.appendToken('First', onFlush)
    })

    act(() => {
      if (rafCallback) {
        rafCallback(0)
      }
    })

    expect(onFlush).toHaveBeenCalledWith('First')

    // Second batch
    act(() => {
      result.current.appendToken(' Second', onFlush)
    })

    act(() => {
      if (rafCallback) {
        rafCallback(0)
      }
    })

    expect(onFlush).toHaveBeenCalledWith('First Second')
  })
})
