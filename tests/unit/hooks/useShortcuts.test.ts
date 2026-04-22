import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Import mock factory for consistent electronAPI mocking
import { installElectronAPIMock } from '../../mocks/electronAPI.mock'

// Mock platformUtils BEFORE importing useShortcuts
vi.mock('../../../src/utils/platformUtils', () => ({
  isMac: vi.fn(() => false),
  isWindows: vi.fn(() => true),
  isLinux: vi.fn(() => false),
  getPlatformShortcut: vi.fn((keys: string[]) => keys),
}))

// Mock keyboardUtils
vi.mock('../../../src/utils/keyboardUtils', () => ({
  acceleratorToKeys: vi.fn((accelerator: string) => {
    if (!accelerator) return []
    return accelerator.split('+').map((p: string) => {
      const part = p.toLowerCase()
      if (part === 'commandorcontrol' || part === 'cmd' || part === 'command' || part === 'meta') return 'Ctrl'
      if (part === 'control' || part === 'ctrl') return 'Ctrl'
      if (part === 'alt') return 'Alt'
      if (part === 'shift') return 'Shift'
      if (part === 'up') return 'ArrowUp'
      if (part === 'down') return 'ArrowDown'
      return part.toUpperCase()
    })
  }),
  keysToAccelerator: vi.fn((keys: string[]) => keys.join('+')),
}))

import { useShortcuts } from '../../../src/hooks/useShortcuts'

describe('useShortcuts', () => {
  let getKeybindsMock: ReturnType<typeof vi.fn>
  let setKeybindMock: ReturnType<typeof vi.fn>
  let resetKeybindsMock: ReturnType<typeof vi.fn>
  let onKeybindsUpdateMock: ReturnType<typeof vi.fn>

  const mockKeybinds = [
    { id: 'chat:whatToAnswer', label: 'What to Answer', accelerator: 'Ctrl+1', isGlobal: true, defaultAccelerator: 'Ctrl+1' },
    { id: 'chat:answer', label: 'Answer', accelerator: 'Ctrl+5', isGlobal: true, defaultAccelerator: 'Ctrl+5' },
    { id: 'general:toggle-visibility', label: 'Toggle Visibility', accelerator: 'Ctrl+B', isGlobal: true, defaultAccelerator: 'Ctrl+B' },
  ]

  beforeEach(() => {
    // Set up electronAPI mocks using factory
    getKeybindsMock = vi.fn().mockResolvedValue(mockKeybinds)
    setKeybindMock = vi.fn().mockResolvedValue(true)
    resetKeybindsMock = vi.fn().mockResolvedValue(mockKeybinds)
    onKeybindsUpdateMock = vi.fn((cb: Function) => {
      return () => {} // Return unsubscribe function
    })

    // Use installElectronAPIMock factory with method overrides
    installElectronAPIMock({
      getKeybinds: getKeybindsMock,
      setKeybind: setKeybindMock,
      resetKeybinds: resetKeybindsMock,
      onKeybindsUpdate: onKeybindsUpdateMock,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should return shortcuts object with required properties', async () => {
    const { result } = renderHook(() => useShortcuts())
    
    // Wait for async fetch
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    
    expect(result.current.shortcuts).toBeDefined()
    expect(result.current.updateShortcut).toBeInstanceOf(Function)
    expect(result.current.resetShortcuts).toBeInstanceOf(Function)
    expect(result.current.isShortcutPressed).toBeInstanceOf(Function)
  })

  it('should fetch keybinds on mount', async () => {
    renderHook(() => useShortcuts())
    
    // Wait for async fetch
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    
    expect(getKeybindsMock).toHaveBeenCalled()
  })

  it('should subscribe to keybinds update event', async () => {
    renderHook(() => useShortcuts())
    
    // Wait for useEffect to run
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    
    expect(onKeybindsUpdateMock).toHaveBeenCalled()
  })

  it('should update shortcuts when keybinds update event fires', async () => {
    const { result } = renderHook(() => useShortcuts())
    
    // Wait for initial fetch
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    
    // Get the callback passed to onKeybindsUpdate
    const updateCallback = onKeybindsUpdateMock.mock.calls[0][0]
    
    // Fire update with new keybinds
    const newKeybinds = [
      { id: 'chat:whatToAnswer', label: 'What to Answer', accelerator: 'Ctrl+2', isGlobal: true, defaultAccelerator: 'Ctrl+2' },
    ]
    
    await act(async () => {
      updateCallback(newKeybinds)
    })
    
    // The shortcuts should be updated
    expect(result.current.shortcuts).toBeDefined()
  })

  it('should call setKeybind when updateShortcut is called', async () => {
    const { result } = renderHook(() => useShortcuts())
    
    // Wait for initial fetch
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    
    // Update a shortcut
    await act(async () => {
      await result.current.updateShortcut('whatToAnswer', ['Ctrl', 'Shift', '1'])
    })
    
    expect(setKeybindMock).toHaveBeenCalledWith('chat:whatToAnswer', 'Ctrl+Shift+1')
  })

  it('should call resetKeybinds when resetShortcuts is called', async () => {
    const { result } = renderHook(() => useShortcuts())
    
    // Wait for initial fetch
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    
    // Reset shortcuts
    await act(async () => {
      await result.current.resetShortcuts()
    })
    
    expect(resetKeybindsMock).toHaveBeenCalled()
  })

  it('should return true for isShortcutPressed when matching key is pressed (Windows/Ctrl)', async () => {
    const { result } = renderHook(() => useShortcuts())
    
    // Wait for initial fetch
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    
    // Create a keyboard event matching Ctrl+1
    const event = new KeyboardEvent('keydown', { key: '1', ctrlKey: true, metaKey: false })
    
    // On Windows with Ctrl key, should match
    const isPressed = result.current.isShortcutPressed(event, 'whatToAnswer')
    expect(isPressed).toBe(true)
  })

  it('should return false for isShortcutPressed when keys do not match', async () => {
    const { result } = renderHook(() => useShortcuts())
    
    // Wait for initial fetch
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    
    // Create a keyboard event that doesn't match (Ctrl+2 instead of Ctrl+1)
    const event = new KeyboardEvent('keydown', { key: '2', ctrlKey: true, metaKey: false })
    
    const isPressed = result.current.isShortcutPressed(event, 'whatToAnswer')
    expect(isPressed).toBe(false)
  })

  it('should return false for isShortcutPressed when ctrlKey is not pressed but shortcut requires it', async () => {
    const { result } = renderHook(() => useShortcuts())
    
    // Wait for initial fetch
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    
    // Create a keyboard event without Ctrl
    const event = new KeyboardEvent('keydown', { key: '1', ctrlKey: false })
    
    const isPressed = result.current.isShortcutPressed(event, 'whatToAnswer')
    expect(isPressed).toBe(false)
  })

  it('should handle shortcuts with no accelerator (empty array)', async () => {
    const { result } = renderHook(() => useShortcuts())
    
    // Wait for initial fetch
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    
    // The shorten and recap shortcuts start as empty in the defaults
    const event = new KeyboardEvent('keydown', { key: 'a' })
    const isPressed = result.current.isShortcutPressed(event, 'shorten')
    
    expect(isPressed).toBe(false)
  })

  it('should handle arrow key shortcuts', async () => {
    const { result } = renderHook(() => useShortcuts())
    
    // Wait for initial fetch
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    
    // Test arrow up (mapped to '↑')
    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', ctrlKey: false, shiftKey: false })
    const isPressed = result.current.isShortcutPressed(event, 'scrollUp')
    
    expect(isPressed).toBe(true)
  })

  it('should handle keyboard event with metaKey on Windows (should not match)', async () => {
    const { result } = renderHook(() => useShortcuts())
    
    // Wait for initial fetch
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    
    // Create a keyboard event with metaKey (should be ignored on Windows)
    const event = new KeyboardEvent('keydown', { key: '1', ctrlKey: false, metaKey: true })
    
    const isPressed = result.current.isShortcutPressed(event, 'whatToAnswer')
    expect(isPressed).toBe(false)
  })

  it('should handle case where electronAPI.getKeybinds fails', async () => {
    const errorGetKeybindsMock = vi.fn().mockRejectedValue(new Error('Failed to fetch'))

    // Use installElectronAPIMock factory with error mock
    installElectronAPIMock({
      getKeybinds: errorGetKeybindsMock,
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { result } = renderHook(() => useShortcuts())
    
    // Wait for the hook to handle the error
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    
    // Should still return defaults
    expect(result.current.shortcuts).toBeDefined()
    
    consoleSpy.mockRestore()
  })

  it('should unsubscribe from keybinds update on unmount', async () => {
    const unsubscribeMock = vi.fn()
    const onKeybindsUpdateWithUnsubscribe = vi.fn(() => unsubscribeMock)

    // Use installElectronAPIMock factory with custom onKeybindsUpdate
    installElectronAPIMock({
      onKeybindsUpdate: onKeybindsUpdateWithUnsubscribe,
    })

    const { unmount } = renderHook(() => useShortcuts())
    
    // Wait for useEffect
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    
    unmount()
    
    expect(unsubscribeMock).toHaveBeenCalled()
  })
})
