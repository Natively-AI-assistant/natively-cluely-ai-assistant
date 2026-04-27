/**
 * Smoke tests for SettingsPopup component
 * Tests rendering and electronAPI calls on mount
 */

import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '../../../tests/mocks/electronAPI.mock'
import '../../../tests/mocks/framer-motion.mock'

import { createMockCredentials } from '../../../tests/fixtures'

vi.mock('../../../src/premium', () => ({
  __esModule: true,
  PremiumUpgradeModal: () => (
    <div data-testid="premium-modal">PremiumUpgradeModal</div>
  ),
  ProfileVisualizer: () => (
    <div data-testid="profile-visualizer">ProfileVisualizer</div>
  ),
  PremiumPromoToaster: () => null,
  ProfileFeatureToaster: () => null,
  JDAwarenessToaster: () => null,
  RemoteCampaignToaster: () => null,
  NativelyApiPromoToaster: () => null,
  MaxUltraUpgradeToaster: () => null,
  useAdCampaigns: () => ({ activeAd: null, dismissAd: () => {} }),
  NegotiationCoachingCard: () => null,
  ModesSettings: () => null,
}))

import SettingsPopup from '../../../src/components/SettingsPopup'

vi.mock('../../../src/hooks/useShortcuts', () => ({
  useShortcuts: vi.fn(() => ({
    shortcuts: {
      toggleVisibility: ['⌘', 'B'],
      takeScreenshot: ['⌘', 'H'],
    },
    updateShortcut: vi.fn(),
    resetShortcuts: vi.fn(),
  })),
}))

vi.mock('../../../src/hooks/useResolvedTheme', () => ({
  useResolvedTheme: vi.fn(() => 'dark'),
}))

describe('SettingsPopup Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window.electronAPI.getStoredCredentials as any).mockResolvedValue(
      createMockCredentials(),
    )
    ;(window.electronAPI.profileGetStatus as any).mockResolvedValue({
      hasProfile: false,
      profileMode: false,
    })
    ;(window.electronAPI.licenseCheckPremium as any).mockResolvedValue({
      isPremium: false,
    })
    ;(window.electronAPI.getUndetectable as any).mockResolvedValue(false)
    ;(window.electronAPI.getActionButtonMode as any).mockResolvedValue('recap')
  })

  it('renders without crashing', () => {
    render(<SettingsPopup />)
    // Verify the settings popup renders with specific content elements
    expect(screen.getByText('Transcript')).toBeInTheDocument()
  })

  it('loads credentials on mount via electronAPI.getStoredCredentials', async () => {
    render(<SettingsPopup />)

    await waitFor(() => {
      expect(window.electronAPI.getStoredCredentials).toHaveBeenCalled()
    })
  })

  it('loads profile status on mount via electronAPI.profileGetStatus', async () => {
    render(<SettingsPopup />)

    await waitFor(() => {
      expect(window.electronAPI.profileGetStatus).toHaveBeenCalled()
    })
  })

  it('loads premium status on mount via electronAPI.licenseCheckPremium', async () => {
    render(<SettingsPopup />)

    await waitFor(() => {
      expect(window.electronAPI.licenseCheckPremium).toHaveBeenCalled()
    })
  })

  it('loads action button mode on mount via electronAPI.getActionButtonMode', async () => {
    render(<SettingsPopup />)

    await waitFor(() => {
      expect(window.electronAPI.getActionButtonMode).toHaveBeenCalled()
    })
  })
})
