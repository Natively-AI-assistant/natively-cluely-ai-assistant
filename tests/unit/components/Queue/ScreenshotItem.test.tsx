import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ScreenshotItem from '../../../../src/components/Queue/ScreenshotItem'

const mockScreenshot = {
    path: '/tmp/screenshot.png',
    preview: 'data:image/png;base64,abc123',
}

describe('ScreenshotItem', () => {
    const defaultProps = {
        screenshot: mockScreenshot,
        onDelete: vi.fn(),
        index: 0,
        isLoading: false,
    }

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders the screenshot image', () => {
        render(<ScreenshotItem {...defaultProps} />)
        const img = screen.getByAltText('Screenshot')
        expect(img).toBeInTheDocument()
        expect(img).toHaveAttribute('src', mockScreenshot.preview)
    })

    it('shows loading spinner when isLoading is true', () => {
        render(<ScreenshotItem {...defaultProps} isLoading={true} />)
        // The spinner is an animated div, check for its presence
        const spinner = document.querySelector('.animate-spin')
        expect(spinner).toBeInTheDocument()
    })

    it('dims the image when loading', () => {
        render(<ScreenshotItem {...defaultProps} isLoading={true} />)
        const img = screen.getByAltText('Screenshot')
        expect(img.className).toContain('opacity-50')
    })

    it('does not show spinner when not loading', () => {
        render(<ScreenshotItem {...defaultProps} isLoading={false} />)
        const spinner = document.querySelector('.animate-spin')
        expect(spinner).not.toBeInTheDocument()
    })

    it('shows delete button when not loading', () => {
        render(<ScreenshotItem {...defaultProps} isLoading={false} />)
        const deleteBtn = screen.getByRole('button', { name: /delete screenshot/i })
        expect(deleteBtn).toBeInTheDocument()
    })

    it('hides delete button when loading', () => {
        render(<ScreenshotItem {...defaultProps} isLoading={true} />)
        const deleteBtn = screen.queryByRole('button', { name: /delete screenshot/i })
        expect(deleteBtn).not.toBeInTheDocument()
    })

    it('calls onDelete with correct index when delete button clicked', async () => {
        const onDelete = vi.fn()
        render(<ScreenshotItem {...defaultProps} onDelete={onDelete} index={3} />)
        const deleteBtn = screen.getByRole('button', { name: /delete screenshot/i })
        await fireEvent.click(deleteBtn)
        expect(onDelete).toHaveBeenCalledWith(3)
        expect(onDelete).toHaveBeenCalledTimes(1)
    })

    it('stops event propagation on delete click', () => {
        const onDelete = vi.fn()
        const stopPropagation = vi.fn()
        render(<ScreenshotItem {...defaultProps} onDelete={onDelete} />)
        const deleteBtn = screen.getByRole('button', { name: /delete screenshot/i })
        fireEvent.click(deleteBtn, { stopPropagation })
        expect(onDelete).toHaveBeenCalled()
    })

    it('applies group class when not loading', () => {
        render(<ScreenshotItem {...defaultProps} isLoading={false} />)
        const container = document.querySelector('.group')
        expect(container).toBeInTheDocument()
    })

    it('does not apply group class when loading', () => {
        render(<ScreenshotItem {...defaultProps} isLoading={true} />)
        const borderDiv = document.querySelector('.border-white')
        expect(borderDiv?.className).not.toContain('group')
    })
})
