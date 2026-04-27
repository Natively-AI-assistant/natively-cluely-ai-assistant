import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Cropper from '../../../src/components/Cropper'

// Import mock factory for consistent electronAPI mocking
import { installElectronAPIMock } from '../../mocks/electronAPI.mock'

// Mock canvas context
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  drawImage: vi.fn(),
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
  putImageData: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  fill: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 0,
  setTransform: vi.fn(),
  strokeRect: vi.fn(),
  arc: vi.fn(),
  rect: vi.fn(),
})) as any

// Mock window.devicePixelRatio
Object.defineProperty(window, 'devicePixelRatio', {
  writable: true,
  value: 1,
})

// Mock window.innerWidth and innerHeight
Object.defineProperty(window, 'innerWidth', {
  writable: true,
  value: 1920,
})

Object.defineProperty(window, 'innerHeight', {
  writable: true,
  value: 1080,
})

describe('Cropper', () => {
  beforeEach(() => {
    // Use installElectronAPIMock factory with method overrides
    installElectronAPIMock({
      cropperConfirmed: vi.fn(),
      cropperCancelled: vi.fn(),
      onResetCropper: vi.fn(() => () => {}),
    })
    // Set dark theme by default
    document.documentElement.setAttribute('data-theme', 'dark')
  })

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme')
    vi.clearAllMocks()
  })

  it('should render canvas element', () => {
    render(<Cropper />)
    const canvas = document.querySelector('canvas')
    expect(canvas).toBeInTheDocument()
  })

  it('should handle mouse down to start region selection', () => {
    render(<Cropper />)
    const container = document.querySelector('.cursor-default')
    expect(container).toBeInTheDocument()

    if (container) {
      fireEvent.mouseDown(container, { clientX: 100, clientY: 100 })
      const canvas = document.querySelector('canvas')
      expect(canvas).toBeInTheDocument()
      expect(
        (HTMLCanvasElement.prototype.getContext as any).mock.results[0].value
          .clearRect,
      ).toHaveBeenCalled()
    }
  })

  it('should handle mouse move after mouse down', () => {
    render(<Cropper />)
    const container = document.querySelector('.cursor-default')

    if (container) {
      fireEvent.mouseDown(container, { clientX: 100, clientY: 100 })
      fireEvent.mouseMove(container, { clientX: 200, clientY: 200 })
      const ctx = (HTMLCanvasElement.prototype.getContext as any).mock
        .results[0].value
      expect(ctx.clearRect).toHaveBeenCalled()
    }
  })

  it('should call cropperConfirmed IPC when selection is committed', () => {
    render(<Cropper />)
    const container = document.querySelector('.cursor-default')
    const cropperConfirmed = (window as any).electronAPI.cropperConfirmed

    if (container) {
      fireEvent.mouseDown(container, { clientX: 100, clientY: 100 })
      fireEvent.mouseMove(container, { clientX: 300, clientY: 300 })
      fireEvent.mouseUp(window)
    }

    expect(cropperConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
        width: expect.any(Number),
        height: expect.any(Number),
      }),
    )
  })

  it('should call cropperCancelled on ESC key press', () => {
    render(<Cropper />)
    const cropperCancelled = (window as any).electronAPI.cropperCancelled

    // Simulate ESC key press
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(cropperCancelled).toHaveBeenCalled()
  })

  it('should show HUD with instructions when no selection is active', () => {
    // Set up HUD position via IPC reset event
    const onResetCropperMock = vi.fn((callback: any) => {
      // Simulate receiving the IPC event with HUD position
      callback({ hudPosition: { x: 500, y: 300 } })
      return () => {}
    })

    // Use installElectronAPIMock factory with custom onResetCropper
    installElectronAPIMock({
      onResetCropper: onResetCropperMock,
      cropperConfirmed: vi.fn(),
      cropperCancelled: vi.fn(),
    })

    render(<Cropper />)

    // The HUD should show "Select area" text
    expect(screen.getByText('Select area')).toBeInTheDocument()
  })

  it('should render with light theme when data-theme is light', () => {
    document.documentElement.setAttribute('data-theme', 'light')
    render(<Cropper />)
    expect(document.querySelector('canvas')).toBeInTheDocument()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('should clean up event listeners on unmount', () => {
    const { unmount } = render(<Cropper />)
    // Should not throw on unmount
    expect(() => unmount()).not.toThrow()
  })
})
