import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useResolvedTheme } from '../../../src/hooks/useResolvedTheme'

// Import mock factory for consistent electronAPI mocking
import { installElectronAPIMock } from '../../mocks/electronAPI.mock'

describe('useResolvedTheme', () => {
  let observeMock: ReturnType<typeof vi.fn>
  let disconnectMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Set up initial theme attribute
    document.documentElement.setAttribute('data-theme', 'light')
    
    // Create mocks
    observeMock = vi.fn()
    disconnectMock = vi.fn()
    
    // Mock MutationObserver class
    class MockMutationObserver {
      observe = observeMock
      disconnect = disconnectMock
      takeRecords(): MutationRecord[] {
        return []
      }
    }
    window.MutationObserver = MockMutationObserver as any
  })

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme')
  })

  it('should return light theme when data-theme is light', () => {
    document.documentElement.setAttribute('data-theme', 'light')
    const { result } = renderHook(() => useResolvedTheme())
    expect(result.current).toBe('light')
  })

  it('should return dark theme when data-theme is dark', () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    const { result } = renderHook(() => useResolvedTheme())
    expect(result.current).toBe('dark')
  })

  it('should observe document element for theme changes', () => {
    renderHook(() => useResolvedTheme())
    
    // Verify observer was created and observe was called
    expect(observeMock).toHaveBeenCalled()
    expect(observeMock).toHaveBeenCalledWith(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
  })

  it('should respond to IPC theme change event', async () => {
    // Use fireIPCEvent from electronAPI mock to trigger the event
    const { fireIPCEvent } = await import('../../mocks/electronAPI.mock')
    
    document.documentElement.setAttribute('data-theme', 'light')
    
    // Render hook - it will subscribe to onThemeChanged
    const { result } = renderHook(() => useResolvedTheme())
    
    // Initial state should be light
    expect(result.current).toBe('light')
    
    // Fire IPC event with dark theme
    act(() => {
      fireIPCEvent('onThemeChanged', { resolved: 'dark' })
    })
    
    // State should update to dark
    expect(result.current).toBe('dark')
  })

  it('should handle case where electronAPI is undefined', () => {
    // Save original electronAPI
    const originalElectronAPI = (window as any).electronAPI
    delete (window as any).electronAPI

    const { result } = renderHook(() => useResolvedTheme())
    
    // Should still return a valid theme from the DOM
    expect(result.current).toBeDefined()
    expect(['light', 'dark']).toContain(result.current)
    
    // Restore electronAPI
    ;(window as any).electronAPI = originalElectronAPI
  })

  it('should handle case where onThemeChanged is undefined', () => {
    // Use installElectronAPIMock factory without onThemeChanged
    installElectronAPIMock({
      onThemeChanged: undefined,
    })

    const { result } = renderHook(() => useResolvedTheme())
    
    // Should still return a valid theme
    expect(result.current).toBeDefined()
  })

  it('should clean up observer on unmount', () => {
    const { unmount } = renderHook(() => useResolvedTheme())
    
    unmount()
    
    expect(disconnectMock).toHaveBeenCalled()
  })

  it('should unsubscribe from IPC event on unmount', async () => {
    const unsubscribeMock = vi.fn()
    const onThemeChangedMock = vi.fn(() => unsubscribeMock)

    // Use installElectronAPIMock factory with custom onThemeChanged
    installElectronAPIMock({
      onThemeChanged: onThemeChangedMock,
    })

    const { unmount } = renderHook(() => useResolvedTheme())
    
    // Wait for useEffect to run
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    
    unmount()
    
    expect(unsubscribeMock).toHaveBeenCalled()
  })
})
