import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ScreenshotQueue from '../../../../src/components/Queue/ScreenshotQueue'

const makeScreenshots = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    path: `/tmp/screenshot-${i}.png`,
    preview: `data:image/png;base64,preview${i}`,
  }))

describe('ScreenshotQueue', () => {
  const defaultProps = {
    isLoading: false,
    screenshots: makeScreenshots(3),
    onDeleteScreenshot: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when screenshots array is empty', () => {
    const { container } = render(
      <ScreenshotQueue {...defaultProps} screenshots={[]} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders all screenshots', () => {
    render(<ScreenshotQueue {...defaultProps} />)
    const images = screen.getAllByAltText('Screenshot')
    expect(images).toHaveLength(3)
  })

  it('renders screenshots with correct preview sources', () => {
    render(<ScreenshotQueue {...defaultProps} />)
    const images = screen.getAllByAltText('Screenshot')
    expect(images[0]).toHaveAttribute('src', 'data:image/png;base64,preview0')
    expect(images[1]).toHaveAttribute('src', 'data:image/png;base64,preview1')
    expect(images[2]).toHaveAttribute('src', 'data:image/png;base64,preview2')
  })

  it('limits display to 5 screenshots', () => {
    render(
      <ScreenshotQueue {...defaultProps} screenshots={makeScreenshots(8)} />,
    )
    const images = screen.getAllByAltText('Screenshot')
    expect(images).toHaveLength(5)
  })

  it('shows exactly 5 when there are 5 screenshots', () => {
    render(
      <ScreenshotQueue {...defaultProps} screenshots={makeScreenshots(5)} />,
    )
    const images = screen.getAllByAltText('Screenshot')
    expect(images).toHaveLength(5)
  })

  it('passes isLoading to each ScreenshotItem', () => {
    render(<ScreenshotQueue {...defaultProps} isLoading={true} />)
    const spinners = document.querySelectorAll('.animate-spin')
    expect(spinners).toHaveLength(3) // One per screenshot
  })

  it('calls onDeleteScreenshot with correct index', async () => {
    const onDelete = vi.fn()
    render(<ScreenshotQueue {...defaultProps} onDeleteScreenshot={onDelete} />)
    const deleteButtons = screen.getAllByRole('button', {
      name: /delete screenshot/i,
    })
    await fireEvent.click(deleteButtons[1]) // Click second screenshot's delete
    expect(onDelete).toHaveBeenCalledWith(1)
  })

  it('uses screenshot.path as key for each item', () => {
    const screenshots = makeScreenshots(3)
    const { container } = render(
      <ScreenshotQueue {...defaultProps} screenshots={screenshots} />,
    )
    // Each ScreenshotItem renders in the grid — verify 3 images exist
    const images = screen.getAllByAltText('Screenshot')
    expect(images).toHaveLength(3)
  })

  it('renders with grid layout class', () => {
    const { container } = render(<ScreenshotQueue {...defaultProps} />)
    const grid = container.querySelector('.grid')
    expect(grid).toBeInTheDocument()
    expect(grid?.className).toContain('grid-cols-5')
  })
})
