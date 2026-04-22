import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Mock react-query
vi.mock('react-query', () => ({
  QueryClient: class MockQueryClient {
    clear = vi.fn()
  },
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
}))

// Mock components used by App
vi.mock('../../src/components/NativelyInterface', () => ({
  default: ({ onEndMeeting }: any) => (
    <div data-testid="natively-interface">
      NativelyInterface
      <button data-testid="end-meeting-btn" onClick={onEndMeeting}>End Meeting</button>
    </div>
  ),
}))

vi.mock('../../src/components/SettingsPopup', () => ({
  default: () => <div data-testid="settings-popup">SettingsPopup</div>,
}))

vi.mock('../../src/components/Launcher', () => ({
  default: ({ onStartMeeting, onOpenSettings }: any) => (
    <div data-testid="launcher">
      Launcher
      <button data-testid="start-meeting-btn" onClick={onStartMeeting}>Start Meeting</button>
      <button data-testid="open-settings-btn" onClick={() => onOpenSettings('general')}>Settings</button>
    </div>
  ),
}))

vi.mock('../../src/components/ModelSelectorWindow', () => ({
  default: () => <div data-testid="model-selector">ModelSelectorWindow</div>,
}))

vi.mock('../../src/components/SettingsOverlay', () => ({
  default: ({ isOpen, onClose }: any) =>
    isOpen ? (
      <div data-testid="settings-overlay">
        SettingsOverlay
        <button data-testid="close-settings-btn" onClick={onClose}>Close</button>
      </div>
    ) : null,
}))

vi.mock('../../src/components/StartupSequence', () => ({
  default: ({ onComplete }: any) => (
    <div data-testid="startup-sequence">
      StartupSequence
      <button data-testid="startup-complete-btn" onClick={onComplete}>Complete</button>
    </div>
  ),
}))

vi.mock('../../src/components/UpdateBanner', () => ({
  default: () => <div data-testid="update-banner">UpdateBanner</div>,
}))

vi.mock('../../src/components/SupportToaster', () => ({
  SupportToaster: () => <div data-testid="support-toaster">SupportToaster</div>,
}))

vi.mock('../../src/components/ui/toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
  ToastViewport: () => <div data-testid="toast-viewport">ToastViewport</div>,
}))

vi.mock('../../src/lib/overlayAppearance', () => ({
  clampOverlayOpacity: (val: number) => val,
  OVERLAY_OPACITY_DEFAULT: 0.65,
  getDefaultOverlayOpacity: () => 0.65,
}))

vi.mock('../../src/premium', () => ({
  PremiumUpgradeModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="premium-modal">PremiumUpgradeModal</div> : null,
  useAdCampaigns: () => ({ activeAd: null, dismissAd: vi.fn() }),
  JDAwarenessToaster: () => null,
  ProfileFeatureToaster: () => null,
  PremiumPromoToaster: () => null,
  RemoteCampaignToaster: () => null,
  NativelyApiPromoToaster: () => null,
  MaxUltraUpgradeToaster: () => null,
}))

vi.mock('../../src/lib/analytics/analytics.service', () => ({
  analytics: {
    initAnalytics: vi.fn(),
    trackAppOpen: vi.fn(),
    trackAppClose: vi.fn(),
    trackAssistantStart: vi.fn(),
    trackAssistantStop: vi.fn(),
    trackMeetingStarted: vi.fn(),
    trackMeetingEnded: vi.fn(),
  },
}))

vi.mock('../../src/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('lucide-react', () => ({
  AlertCircle: () => <div data-testid="alert-circle">AlertCircle</div>,
}))

import App from '../../src/App'
import { analytics } from '../../src/lib/analytics/analytics.service'

function setSearch(search: string) {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, search },
    writable: true,
    configurable: true,
  })
}

describe('App', () => {
  beforeEach(() => {
    setSearch('')
    vi.mocked(analytics.initAnalytics).mockClear()
    vi.mocked(analytics.trackAppOpen).mockClear()
    vi.mocked(analytics.trackAppClose).mockClear()
    vi.mocked(analytics.trackAssistantStart).mockClear()
    vi.mocked(analytics.trackAssistantStop).mockClear()
    vi.mocked(analytics.trackMeetingStarted).mockClear()
    vi.mocked(analytics.trackMeetingEnded).mockClear()
  })

  describe('Rendering', () => {
    it('renders StartupSequence initially', () => {
      render(<App />)
      expect(screen.getByTestId('startup-sequence')).toBeInTheDocument()
    })

    it('renders Launcher after startup completes', async () => {
      render(<App />)
      fireEvent.click(screen.getByTestId('startup-complete-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('launcher')).toBeInTheDocument()
      })
    })

    it('renders UpdateBanner', () => {
      render(<App />)
      expect(screen.getByTestId('update-banner')).toBeInTheDocument()
    })

    it('renders ToastViewport', async () => {
      render(<App />)
      fireEvent.click(screen.getByTestId('startup-complete-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('toast-viewport')).toBeInTheDocument()
      })
    })
  })

  describe('Window mode detection', () => {
    it('renders SettingsPopup when window=settings', () => {
      setSearch('?window=settings')
      render(<App />)
      expect(screen.getByTestId('settings-popup')).toBeInTheDocument()
    })

    it('renders ModelSelectorWindow when window=model-selector', () => {
      setSearch('?window=model-selector')
      render(<App />)
      expect(screen.getByTestId('model-selector')).toBeInTheDocument()
    })

    it('renders NativelyInterface when window=overlay', () => {
      setSearch('?window=overlay')
      render(<App />)
      expect(screen.getByTestId('natively-interface')).toBeInTheDocument()
    })

    it('renders Launcher by default (no window param)', async () => {
      render(<App />)
      fireEvent.click(screen.getByTestId('startup-complete-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('launcher')).toBeInTheDocument()
      })
    })
  })

  describe('Interactions', () => {
    it('calls electronAPI.startMeeting when Start Meeting button is clicked', async () => {
      render(<App />)
      fireEvent.click(screen.getByTestId('startup-complete-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('launcher')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('start-meeting-btn'))

      await waitFor(() => {
        expect(window.electronAPI.startMeeting).toHaveBeenCalled()
      })
    })

    it('opens SettingsOverlay when Settings button is clicked', async () => {
      render(<App />)
      fireEvent.click(screen.getByTestId('startup-complete-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('launcher')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('open-settings-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('settings-overlay')).toBeInTheDocument()
      })
    })

    it('closes SettingsOverlay when close button is clicked', async () => {
      render(<App />)
      fireEvent.click(screen.getByTestId('startup-complete-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('launcher')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('open-settings-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('settings-overlay')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('close-settings-btn'))

      await waitFor(() => {
        expect(screen.queryByTestId('settings-overlay')).not.toBeInTheDocument()
      })
    })
  })

  describe('Analytics', () => {
    it('calls trackAppOpen on mount for launcher window', async () => {
      render(<App />)

      await waitFor(() => {
        expect(analytics.initAnalytics).toHaveBeenCalled()
        expect(analytics.trackAppOpen).toHaveBeenCalled()
      })
    })

    it('calls trackAssistantStart on mount for overlay window', async () => {
      setSearch('?window=overlay')
      render(<App />)

      await waitFor(() => {
        expect(analytics.initAnalytics).toHaveBeenCalled()
        expect(analytics.trackAssistantStart).toHaveBeenCalled()
      })
    })

    it('does not call trackAppOpen for overlay window', async () => {
      setSearch('?window=overlay')
      render(<App />)

      await waitFor(() => {
        expect(analytics.initAnalytics).toHaveBeenCalled()
      })

      expect(analytics.trackAppOpen).not.toHaveBeenCalled()
    })
  })
})
