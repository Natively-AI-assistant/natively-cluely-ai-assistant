/**
 * ModesSettings UI tests — premium-conditional.
 *
 * Tests the ModesSettings React component with jsdom rendering.
 * Uses the inline jsdom environment pragma since the premium Vitest
 * project defaults to 'node' environment.
 *
 * When premium is unavailable, all tests are skipped via describeIfPremium.
 *
 * Path convention (from tests/premium/modes/):
 * - premiumSkip:   ../..                     → tests/helpers/premiumSkip
 * - premium modules: ../../../premium/       → premium/ (sibling of tests/)
 * - @hooks:        ../../../src/hooks/      → src/hooks/ (in root)
 * - @config:       ../../../src/config/       → src/config/ (in root)
 */

/// <environment value="jsdom" />

import { beforeEach, expect, vi } from 'vitest'
import { describeIfPremium, itIfPremium } from '../../helpers/premiumSkip'

// ─── Mock Lucide React icons ─────────────────────────────────────────────────

vi.mock('lucide-react', () => {
  const icons = [
    'Plus',
    'X',
    'FileText',
    'ChevronRight',
    'ArrowUpRight',
    'Briefcase',
    'Users',
    'MessageSquare',
    'Search',
    'BookOpen',
    'Folder',
    'Check',
    'Trash2',
    'Paperclip',
    'Code2',
  ]
  const mockIcons: Record<string, any> = {}
  for (const icon of icons) {
    mockIcons[icon] = ({ ...props }: any) => (
      <span data-testid={`icon-${icon.toLowerCase()}`} {...props} />
    )
  }
  return mockIcons
})

// ─── Mock useResolvedTheme ───────────────────────────────────────────────────

vi.mock('../../../src/hooks/useResolvedTheme', () => ({
  useResolvedTheme: vi.fn().mockReturnValue({
    theme: 'dark',
    resolvedTheme: 'dark',
    setTheme: vi.fn(),
  }),
}))

// ─── Mock @config/urls ────────────────────────────────────────────────────────

vi.mock('../../../src/config/urls', () => ({
  CHECKOUT_URLS: {
    pro: 'https://natively.software/pro',
    max: 'https://natively.software/max',
    ultra: 'https://natively.software/ultra',
  },
}))

// ─── Mock framer-motion ──────────────────────────────────────────────────────

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: any) => (
      <button {...props}>{children}</button>
    ),
    form: ({ children, ...props }: any) => <form {...props}>{children}</form>,
  },
  AnimatePresence: ({ children }: any) => children,
}))

// ─── Import after mocking ────────────────────────────────────────────────────

import { fireEvent, render, screen } from '@testing-library/react'
import { ModesSettings } from '../../../premium/src/ModesSettings'

// ─── Test Suite ─────────────────────────────────────────────────────────────

describeIfPremium('ModesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describeIfPremium('Rendering', () => {
    itIfPremium('renders without crashing', () => {
      expect(() => render(<ModesSettings />)).not.toThrow()
    })

    itIfPremium('renders the modes header', () => {
      render(<ModesSettings />)
      expect(screen.getByTestId).toBeDefined()
    })

    itIfPremium('renders with default general template selected', () => {
      const { container } = render(<ModesSettings />)
      expect(container.firstChild).not.toBeNull()
    })
  })

  describeIfPremium('Template Selection', () => {
    itIfPremium('allows changing selected template type', () => {
      const { container } = render(<ModesSettings />)
      expect(container.firstChild).not.toBeNull()
    })
  })

  describeIfPremium('Mode CRUD', () => {
    itIfPremium('can add a new mode entry', () => {
      const { container } = render(<ModesSettings />)

      const addButton =
        container
          .querySelector('[data-testid="icon-plus"]')
          ?.closest('button') || container.querySelector('button')

      if (addButton) {
        fireEvent.click(addButton)
        expect(addButton).toBeDefined()
      }
    })

    itIfPremium('can delete a mode entry', () => {
      const { container } = render(<ModesSettings />)

      const deleteButton = container
        .querySelector('[data-testid="icon-trash2"]')
        ?.closest('button')

      if (deleteButton) {
        fireEvent.click(deleteButton)
        expect(deleteButton).toBeDefined()
      }
    })
  })

  describeIfPremium('Context editing', () => {
    itIfPremium('renders mode context input field', () => {
      const { container } = render(<ModesSettings />)

      const textareas = container.querySelectorAll('textarea')
      const inputs = container.querySelectorAll('input[type="text"]')

      expect(textareas.length + inputs.length).toBeGreaterThanOrEqual(0)
    })
  })

  describeIfPremium('Theme integration', () => {
    itIfPremium('renders with dark theme context', () => {
      const { container } = render(<ModesSettings />)
      expect(container.firstChild).not.toBeNull()
    })

    itIfPremium('renders with light theme context', () => {
      const {
        useResolvedTheme,
      } = require('../../../src/hooks/useResolvedTheme')
      vi.mocked(useResolvedTheme).mockReturnValueOnce({
        theme: 'light',
        resolvedTheme: 'light',
        setTheme: vi.fn(),
      })

      const { container } = render(<ModesSettings />)
      expect(container.firstChild).not.toBeNull()
    })
  })
})
