import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../../mocks/framer-motion.mock'
import '../../mocks/electronAPI.mock'

vi.mock('react-query', () => ({
  QueryClient: class MockQueryClient {
    clear = vi.fn()
  },
  QueryClientProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}))

vi.mock('react-syntax-highlighter', () => ({
  Prism: ({ children }: any) =>
    React.createElement(
      'pre',
      { 'data-testid': 'syntax-highlighter' },
      children,
    ),
}))

import SolutionCommands from '../../../src/components/Solutions/SolutionCommands'

describe('SolutionCommands Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('renders toolbar labels and shortcut keys', () => {
    render(<SolutionCommands extraScreenshots={[]} />)
    expect(screen.getByText('Show/Hide')).toBeInTheDocument()
    expect(screen.getByText('Screenshot your code')).toBeInTheDocument()
    expect(screen.getByText('Start over')).toBeInTheDocument()
    expect(screen.getByText('?')).toBeInTheDocument()
  })

  it('shows "Screenshot your code" when no screenshots, "Screenshot" when screenshots exist', () => {
    const { rerender } = render(<SolutionCommands extraScreenshots={[]} />)
    expect(screen.getByText('Screenshot your code')).toBeInTheDocument()

    rerender(
      <SolutionCommands
        extraScreenshots={[{ id: '1', preview: 'data:image/png;base64,test' }]}
      />,
    )
    expect(screen.getByText('Screenshot')).toBeInTheDocument()
    expect(screen.queryByText('Screenshot your code')).not.toBeInTheDocument()
  })

  it('calls onCodeHint when Hint button is clicked', () => {
    const mockCodeHint = vi.fn()
    render(<SolutionCommands extraScreenshots={[]} onCodeHint={mockCodeHint} />)
    fireEvent.click(screen.getByText('💡 Hint'))
    expect(mockCodeHint).toHaveBeenCalledTimes(1)
  })

  it('calls onBrainstorm when Brainstorm button is clicked', () => {
    const mockBrainstorm = vi.fn()
    render(
      <SolutionCommands extraScreenshots={[]} onBrainstorm={mockBrainstorm} />,
    )
    fireEvent.click(screen.getByText('🧠 Brainstorm'))
    expect(mockBrainstorm).toHaveBeenCalledTimes(1)
  })

  it('calls onTooltipVisibilityChange when hovering over question mark', () => {
    const mockTooltip = vi.fn()
    render(
      <SolutionCommands
        extraScreenshots={[]}
        onTooltipVisibilityChange={mockTooltip}
      />,
    )
    const questionMark = screen.getByText('?').closest('div')!
    fireEvent.mouseEnter(questionMark)
    expect(mockTooltip).toHaveBeenCalledWith(true, expect.any(Number))
    fireEvent.mouseLeave(questionMark)
    expect(mockTooltip).toHaveBeenCalledWith(false, 0)
  })

  it('renders Debug section only when screenshots are provided', () => {
    const { rerender } = render(<SolutionCommands extraScreenshots={[]} />)
    expect(screen.queryByText('Debug')).not.toBeInTheDocument()

    rerender(
      <SolutionCommands
        extraScreenshots={[{ id: '1', preview: 'data:image/png;base64,test' }]}
      />,
    )
    expect(screen.getByText('Debug')).toBeInTheDocument()
  })

  it('renders Sign Out button', () => {
    render(<SolutionCommands extraScreenshots={[]} />)
    expect(screen.getByTitle('Sign Out')).toBeInTheDocument()
  })
})
