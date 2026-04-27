import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EditableTextBlock from '../../../src/components/EditableTextBlock'

describe('EditableTextBlock', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('renders with initial value in the default div tag', () => {
    render(<EditableTextBlock initialValue="Hello World" onSave={vi.fn()} />)
    expect(screen.getByText('Hello World')).toBeInTheDocument()
    expect(screen.getByText('Hello World').tagName).toBe('DIV')
  })

  it('renders with a custom tag name', () => {
    render(
      <EditableTextBlock initialValue="Title" onSave={vi.fn()} tagName="h1" />,
    )
    expect(screen.getByText('Title').tagName).toBe('H1')
  })

  it('enters edit mode on click (contentEditable becomes true)', () => {
    render(<EditableTextBlock initialValue="Edit me" onSave={vi.fn()} />)
    const el = screen.getByText('Edit me')

    expect(el).toHaveAttribute('contenteditable', 'false')

    fireEvent.click(el)

    expect(el).toHaveAttribute('contenteditable', 'true')
  })

  it('calls onSave with trimmed value on blur when value changed', () => {
    const onSave = vi.fn()
    render(<EditableTextBlock initialValue="Old value" onSave={onSave} />)
    const el = screen.getByText('Old value')

    fireEvent.click(el)
    el.innerText = 'New value'
    fireEvent.input(el)
    fireEvent.blur(el)

    expect(onSave).toHaveBeenCalledWith('New value')
  })

  it('does not call onSave on blur when value is unchanged', () => {
    const onSave = vi.fn()
    render(<EditableTextBlock initialValue="Same value" onSave={onSave} />)
    const el = screen.getByText('Same value')

    fireEvent.click(el)
    fireEvent.blur(el)

    expect(onSave).not.toHaveBeenCalled()
  })

  it('reverts to original value on Escape key', () => {
    const onSave = vi.fn()
    render(<EditableTextBlock initialValue="Original" onSave={onSave} />)
    const el = screen.getByText('Original')

    fireEvent.click(el)
    el.innerText = 'Modified'
    fireEvent.input(el)
    fireEvent.keyDown(el, { key: 'Escape' })

    expect(el).toHaveAttribute('contenteditable', 'false')
    expect(el.innerText).toBe('Original')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('blurs (saves) on Enter key when multiline=false', () => {
    const onSave = vi.fn()
    render(
      <EditableTextBlock
        initialValue="Single line"
        onSave={onSave}
        multiline={false}
      />,
    )
    const el = screen.getByText('Single line')

    fireEvent.click(el)
    el.innerText = 'Updated line'
    fireEvent.keyDown(el, { key: 'Enter' })

    expect(onSave).toHaveBeenCalledWith('Updated line')
  })

  it('does not prevent default Enter key when multiline=true (allows newline)', () => {
    const onSave = vi.fn()
    render(
      <EditableTextBlock
        initialValue="Multi"
        onSave={onSave}
        multiline={true}
      />,
    )
    const el = screen.getByText('Multi')

    fireEvent.click(el)
    const _event = fireEvent.keyDown(el, { key: 'Enter' })

    // Default behavior not prevented for multiline
    expect(onSave).not.toHaveBeenCalled()
  })

  it('fires onEnter callback on double-Enter when multiline=true', () => {
    const onEnter = vi.fn()
    const onSave = vi.fn()
    render(
      <EditableTextBlock
        initialValue="Item"
        onSave={onSave}
        multiline={true}
        onEnter={onEnter}
      />,
    )
    const el = screen.getByText('Item')

    fireEvent.click(el)
    el.innerText = 'New item'

    // First Enter — just records timestamp
    fireEvent.keyDown(el, { key: 'Enter' })
    expect(onEnter).not.toHaveBeenCalled()

    // Second Enter within 500ms — triggers onEnter
    vi.advanceTimersByTime(200)
    fireEvent.keyDown(el, { key: 'Enter' })

    expect(onEnter).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('New item')
  })

  it('does not trigger onEnter if second Enter is after 500ms threshold', () => {
    const onEnter = vi.fn()
    render(
      <EditableTextBlock
        initialValue="Item"
        onSave={vi.fn()}
        multiline={true}
        onEnter={onEnter}
      />,
    )
    const el = screen.getByText('Item')

    fireEvent.click(el)

    // First Enter
    fireEvent.keyDown(el, { key: 'Enter' })

    // Wait more than 500ms
    vi.advanceTimersByTime(600)

    // Second Enter — too late, treated as first
    fireEvent.keyDown(el, { key: 'Enter' })

    expect(onEnter).not.toHaveBeenCalled()
  })

  it('autoFocus starts component in edit mode', () => {
    render(
      <EditableTextBlock
        initialValue="Auto focused"
        onSave={vi.fn()}
        autoFocus
      />,
    )
    const el = screen.getByText('Auto focused')

    expect(el).toHaveAttribute('contenteditable', 'true')
  })

  it('syncs external initialValue changes when not editing', () => {
    const { rerender } = render(
      <EditableTextBlock initialValue="Initial" onSave={vi.fn()} />,
    )

    expect(screen.getByText('Initial')).toBeInTheDocument()

    rerender(
      <EditableTextBlock initialValue="Updated external" onSave={vi.fn()} />,
    )

    expect(screen.getByText('Updated external')).toBeInTheDocument()
  })

  it('preserves edit mode when external initialValue changes', () => {
    const { rerender } = render(
      <EditableTextBlock initialValue="Initial" onSave={vi.fn()} />,
    )
    const el = screen.getByText('Initial')

    fireEvent.click(el) // Enter edit mode
    expect(el).toHaveAttribute('contenteditable', 'true')

    rerender(
      <EditableTextBlock initialValue="External change" onSave={vi.fn()} />,
    )

    // contentEditable state preserved — still in edit mode
    expect(el).toHaveAttribute('contenteditable', 'true')
  })

  it('clears debounce timeout on blur', () => {
    const onSave = vi.fn()
    render(<EditableTextBlock initialValue="Debounce test" onSave={onSave} />)
    const el = screen.getByText('Debounce test')

    fireEvent.click(el)
    el.innerText = 'Modified'
    fireEvent.input(el) // Starts 600ms debounce

    // Blur before debounce fires — should save immediately, not via timeout
    fireEvent.blur(el)

    expect(onSave).toHaveBeenCalledWith('Modified')

    // Advance past debounce — should not call onSave again
    vi.advanceTimersByTime(700)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('applies custom className', () => {
    render(
      <EditableTextBlock
        initialValue="Styled"
        onSave={vi.fn()}
        className="my-custom-class"
      />,
    )
    const el = screen.getByText('Styled')

    expect(el.className).toContain('my-custom-class')
  })
})
