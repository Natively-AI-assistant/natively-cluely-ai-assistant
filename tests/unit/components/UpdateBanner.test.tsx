/**
 * Smoke tests for UpdateBanner component
 * Tests rendering and electronAPI event listener registration on mount
 */

import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '../../../tests/mocks/electronAPI.mock'
import '../../../tests/mocks/framer-motion.mock'

import UpdateBanner from '../../../src/components/UpdateBanner'

describe('UpdateBanner Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders without crashing', () => {
    render(<UpdateBanner />)
    // When not visible, component returns null so no DOM assertions needed
  })

  it('registers onUpdateAvailable listener on mount', () => {
    render(<UpdateBanner />)
    expect(window.electronAPI.onUpdateAvailable).toHaveBeenCalled()
  })

  it('registers onDownloadProgress listener on mount', () => {
    render(<UpdateBanner />)
    expect(window.electronAPI.onDownloadProgress).toHaveBeenCalled()
  })

  it('registers onUpdateDownloaded listener on mount', () => {
    render(<UpdateBanner />)
    expect(window.electronAPI.onUpdateDownloaded).toHaveBeenCalled()
  })

  it('registers onUpdateError listener on mount', () => {
    render(<UpdateBanner />)
    expect(window.electronAPI.onUpdateError).toHaveBeenCalled()
  })
})
