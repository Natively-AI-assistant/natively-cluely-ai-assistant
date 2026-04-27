/**
 * Mock audio device enumeration for testing AudioDevices.
 *
 * Provides factory functions to create mock device arrays and
 * mock the native module's getInputDevices/getOutputDevices.
 */

import { vi } from 'vitest'

export interface MockAudioDevice {
  id: string
  name: string
}

export interface MockAudioDevicesOptions {
  /** Input devices to return */
  inputDevices?: MockAudioDevice[]
  /** Output devices to return */
  outputDevices?: MockAudioDevice[]
  /** Throw on device enumeration */
  error?: Error
  /** Return null module (simulates missing native binary) */
  missing?: boolean
}

/**
 * Create mock device arrays and native module functions for AudioDevices testing.
 */
export function createMockAudioDevices(options: MockAudioDevicesOptions = {}) {
  const inputDevices = options.inputDevices ?? [
    { id: 'input-1', name: 'Built-in Microphone' },
    { id: 'input-2', name: 'External USB Mic' },
  ]

  const outputDevices = options.outputDevices ?? [
    { id: 'output-1', name: 'Built-in Speakers' },
    { id: 'output-2', name: 'Bluetooth Headphones' },
  ]

  const getInputDevices = vi.fn(() => {
    if (options.error) throw options.error
    return [...inputDevices]
  })

  const getOutputDevices = vi.fn(() => {
    if (options.error) throw options.error
    return [...outputDevices]
  })

  const mockModule = options.missing
    ? null
    : { getInputDevices, getOutputDevices }

  return {
    inputDevices,
    outputDevices,
    getInputDevices,
    getOutputDevices,
    mockModule,
  }
}

export default createMockAudioDevices
