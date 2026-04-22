/**
 * Smoke tests for ModelSelectorWindow component
 * Tests rendering and electronAPI calls on mount
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import '../../../tests/mocks/electronAPI.mock'

vi.mock('../../../src/hooks/useResolvedTheme', () => ({
  useResolvedTheme: vi.fn(() => 'dark'),
}))

import ModelSelectorWindow from '../../../src/components/ModelSelectorWindow'

describe('ModelSelectorWindow Component', () => {
  let renderResult: ReturnType<typeof render> | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    ;(window.electronAPI.getStoredCredentials as any).mockResolvedValue({
      hasNativelyKey: false,
    })
    ;(window.electronAPI.getCustomProviders as any).mockResolvedValue([])
    ;(window.electronAPI.getAvailableOllamaModels as any).mockResolvedValue([])
    ;(window.electronAPI.getCurrentLlmConfig as any).mockResolvedValue({ model: '' })
    ;(window.electronAPI.onModelChanged as any).mockReturnValue(undefined)
  })

  afterEach(() => {
    renderResult?.unmount()
    renderResult = null
  })

  it('renders without crashing', () => {
    renderResult = render(<ModelSelectorWindow />)
    // Verify the model selector window renders
    expect(screen.getByText('Loading models...')).toBeInTheDocument()
  })

  it('loads credentials on mount via electronAPI.getStoredCredentials', async () => {
    renderResult = render(<ModelSelectorWindow />)

    await waitFor(() => {
      expect(window.electronAPI.getStoredCredentials).toHaveBeenCalled()
    })
  })

  it('loads custom providers on mount via electronAPI.getCustomProviders', async () => {
    renderResult = render(<ModelSelectorWindow />)

    await waitFor(() => {
      expect(window.electronAPI.getCustomProviders).toHaveBeenCalled()
    })
  })
})