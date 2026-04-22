import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MeetingDetails from '../../../src/components/MeetingDetails'
import React from 'react'

import { installElectronAPIMock } from '../../mocks/electronAPI.mock'
import { createMockMeeting, createMockTranscript } from '../../fixtures'

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => React.createElement('div', null, children),
}))

vi.mock('remark-gfm', () => ({
  __esModule: true,
  default: () => null,
}))

vi.mock('react-syntax-highlighter', () => ({
  Prism: ({ children }: { children: string }) => React.createElement('pre', null, children),
}))

vi.mock('../../../src/components/icon.png', () => ({
  default: 'mock-icon-path',
}))

vi.mock('../../../src/hooks/useResolvedTheme', () => ({
  useResolvedTheme: () => 'dark',
}))

const mockMeeting: any = {
  ...createMockMeeting({
    date: '2024-01-15T10:00:00.000Z',
    duration: '30:00',
    summary: 'This is a test meeting summary.',
  }),
  detailedSummary: {
    overview: 'Meeting overview text',
    actionItems: ['Action item 1', 'Action item 2'],
    keyPoints: ['Key point 1', 'Key point 2'],
    actionItemsTitle: 'Action Items',
    keyPointsTitle: 'Key Points',
  },
  transcript: [
    createMockTranscript({ speaker: 'John', text: 'Hello everyone', timestamp: 1000 }),
    createMockTranscript({ speaker: 'Jane', text: 'Hi John', timestamp: 5000 }),
  ],
  usage: [],
}

describe('MeetingDetails', () => {
  beforeEach(() => {
    installElectronAPIMock({
      ragQueryMeeting: vi.fn(() => Promise.resolve({ results: [] })),
      ragQueryLive: vi.fn(() => Promise.resolve({ results: [] })),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders title and overview on the default summary tab', () => {
    render(
      <MeetingDetails meeting={mockMeeting} onBack={vi.fn()} onOpenSettings={vi.fn()} />
    )

    expect(screen.getByText('Test Meeting')).toBeInTheDocument()
    // Overview is rendered by our mocked ReactMarkdown as a plain div
    expect(screen.getByText('Meeting overview text')).toBeInTheDocument()
  })

  it('renders action items and key points on summary tab', () => {
    render(
      <MeetingDetails meeting={mockMeeting} onBack={vi.fn()} onOpenSettings={vi.fn()} />
    )

    expect(screen.getByText('Action item 1')).toBeInTheDocument()
    expect(screen.getByText('Action item 2')).toBeInTheDocument()
    expect(screen.getByText('Key point 1')).toBeInTheDocument()
    expect(screen.getByText('Key point 2')).toBeInTheDocument()
  })

  it('renders Summary, Transcript, and Usage tabs', () => {
    render(
      <MeetingDetails meeting={mockMeeting} onBack={vi.fn()} onOpenSettings={vi.fn()} />
    )

    const tabButtons = screen.getAllByRole('button')
    const tabLabels = tabButtons.map(btn => btn.textContent)

    expect(tabLabels).toContain('Summary')
    expect(tabLabels).toContain('Transcript')
    expect(tabLabels).toContain('Usage')
  })

  it('shows transcript content when Transcript tab is clicked', () => {
    render(
      <MeetingDetails meeting={mockMeeting} onBack={vi.fn()} onOpenSettings={vi.fn()} />
    )

    fireEvent.click(screen.getByText('Transcript'))

    // Transcript speakers render as "Them" (non-user speakers)
    expect(screen.getAllByText('Them').length).toBe(2)
    expect(screen.getByText('Hello everyone')).toBeInTheDocument()
    expect(screen.getByText('Hi John')).toBeInTheDocument()
  })

  it('does not show transcript content on the default summary tab', () => {
    render(
      <MeetingDetails meeting={mockMeeting} onBack={vi.fn()} onOpenSettings={vi.fn()} />
    )

    // Summary tab is active by default — transcript text should not be visible
    expect(screen.queryByText('Hello everyone')).not.toBeInTheDocument()
  })

  it('switches from summary to usage tab and back', () => {
    render(
      <MeetingDetails meeting={mockMeeting} onBack={vi.fn()} onOpenSettings={vi.fn()} />
    )

    // Overview visible on summary tab
    expect(screen.getByText('Meeting overview text')).toBeInTheDocument()

    // Switch to usage tab
    fireEvent.click(screen.getByText('Usage'))
    expect(screen.queryByText('Meeting overview text')).not.toBeInTheDocument()

    // Switch back to summary
    fireEvent.click(screen.getByText('Summary'))
    expect(screen.getByText('Meeting overview text')).toBeInTheDocument()
  })

  it('renders the tab navigation with Summary as default active tab', () => {
    render(
      <MeetingDetails meeting={mockMeeting} onBack={vi.fn()} onOpenSettings={vi.fn()} />
    )

    // Summary tab should be active — overview content visible
    expect(screen.getByText('Meeting overview text')).toBeInTheDocument()
    // Transcript content should NOT be visible on summary tab
    expect(screen.queryByText('Hello everyone')).not.toBeInTheDocument()
  })

  it('renders without crashing when meeting has minimal data', () => {
    const minimal = {
      id: 'm1',
      title: 'Quick Sync',
      date: '2024-06-01',
      duration: '5m',
      summary: '',
    }

    render(
      <MeetingDetails meeting={minimal as any} onBack={vi.fn()} onOpenSettings={vi.fn()} />
    )

    expect(screen.getByText('Quick Sync')).toBeInTheDocument()
    // No detailed summary sections
    expect(screen.queryByText('Action Items')).not.toBeInTheDocument()
  })

  it('renders transcript with "Me" label for user speaker', () => {
    const meetingWithUser = {
      ...mockMeeting,
      transcript: [
        createMockTranscript({ speaker: 'user', text: 'My message', timestamp: 1000 }),
        createMockTranscript({ speaker: 'Alice', text: 'Her message', timestamp: 2000 }),
      ],
    }

    render(
      <MeetingDetails meeting={meetingWithUser} onBack={vi.fn()} onOpenSettings={vi.fn()} />
    )

    fireEvent.click(screen.getByText('Transcript'))

    expect(screen.getByText('Me')).toBeInTheDocument()
    expect(screen.getByText('Her message')).toBeInTheDocument()
  })

  it('filters out system/ai/assistant speakers from transcript', () => {
    const meetingWithAI = {
      ...mockMeeting,
      transcript: [
        createMockTranscript({ speaker: 'user', text: 'Hello', timestamp: 1000 }),
        createMockTranscript({ speaker: 'assistant', text: 'AI response', timestamp: 2000 }),
        createMockTranscript({ speaker: 'John', text: 'Human reply', timestamp: 3000 }),
      ],
    }

    render(
      <MeetingDetails meeting={meetingWithAI} onBack={vi.fn()} onOpenSettings={vi.fn()} />
    )

    fireEvent.click(screen.getByText('Transcript'))

    expect(screen.getByText('Hello')).toBeInTheDocument()
    expect(screen.getByText('Human reply')).toBeInTheDocument()
    // Assistant messages are filtered out
    expect(screen.queryByText('AI response')).not.toBeInTheDocument()
  })

  it('calls updateMeetingTitle IPC when title is edited', async () => {
    const updateTitleMock = vi.fn(() => Promise.resolve())
    installElectronAPIMock({
      updateMeetingTitle: updateTitleMock,
    })

    render(
      <MeetingDetails meeting={mockMeeting} onBack={vi.fn()} onOpenSettings={vi.fn()} />
    )

    const titleEl = screen.getByText('Test Meeting')
    fireEvent.click(titleEl) // enter edit mode
    titleEl.innerText = 'New Title'
    fireEvent.input(titleEl)
    fireEvent.blur(titleEl)

    expect(updateTitleMock).toHaveBeenCalledWith('meeting-1', 'New Title')
  })

  it('calls updateMeetingSummary IPC when action item is edited', () => {
    const updateSummaryMock = vi.fn(() => Promise.resolve())
    installElectronAPIMock({
      updateMeetingSummary: updateSummaryMock,
    })

    render(
      <MeetingDetails meeting={mockMeeting} onBack={vi.fn()} onOpenSettings={vi.fn()} />
    )

    const actionItem = screen.getByText('Action item 1')
    fireEvent.click(actionItem)
    actionItem.innerText = 'Updated action'
    fireEvent.input(actionItem)
    fireEvent.blur(actionItem)

    expect(updateSummaryMock).toHaveBeenCalledWith('meeting-1', { actionItems: expect.arrayContaining(['Updated action']) })
  })

  it('calls updateMeetingSummary IPC when key point is edited', () => {
    const updateSummaryMock = vi.fn(() => Promise.resolve())
    installElectronAPIMock({
      updateMeetingSummary: updateSummaryMock,
    })

    render(
      <MeetingDetails meeting={mockMeeting} onBack={vi.fn()} onOpenSettings={vi.fn()} />
    )

    const keyPoint = screen.getByText('Key point 1')
    fireEvent.click(keyPoint)
    keyPoint.innerText = 'Updated key point'
    fireEvent.input(keyPoint)
    fireEvent.blur(keyPoint)

    expect(updateSummaryMock).toHaveBeenCalledWith('meeting-1', { keyPoints: expect.arrayContaining(['Updated key point']) })
  })

  it('copies summary content to clipboard when Copy button is clicked', async () => {
    const writeTextMock = vi.fn(() => Promise.resolve())
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    })

    render(
      <MeetingDetails meeting={mockMeeting} onBack={vi.fn()} onOpenSettings={vi.fn()} />
    )

    const copyBtn = screen.getByText(/Copy full summary/)
    fireEvent.click(copyBtn)

    expect(writeTextMock).toHaveBeenCalled()
    const copiedText = (writeTextMock.mock.calls as string[][])[0][0]
    expect(copiedText).toContain('Test Meeting')
    expect(copiedText).toContain('Meeting overview text')
    expect(copiedText).toContain('Action item 1')
  })

  it('shows "Copied" feedback after successful copy', async () => {
    const writeTextMock = vi.fn(() => Promise.resolve())
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    })

    render(
      <MeetingDetails meeting={mockMeeting} onBack={vi.fn()} onOpenSettings={vi.fn()} />
    )

    fireEvent.click(screen.getByText(/Copy full summary/))

    await waitFor(() => {
      expect(screen.getByText('Copied')).toBeInTheDocument()
    })
  })

  it('opens chat overlay when floating search bar submits', () => {
    render(
      <MeetingDetails meeting={mockMeeting} onBack={vi.fn()} onOpenSettings={vi.fn()} />
    )

    const input = screen.getByPlaceholderText('Ask about this meeting...')
    fireEvent.change(input, { target: { value: 'What were the decisions?' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // Input clears after submission
    expect(input).toHaveValue('')
  })

  it('shows empty transcript message when transcript is empty', () => {
    const meetingNoTranscript = {
      ...mockMeeting,
      transcript: [],
    }

    render(
      <MeetingDetails meeting={meetingNoTranscript} onBack={vi.fn()} onOpenSettings={vi.fn()} />
    )

    fireEvent.click(screen.getByText('Transcript'))

    expect(screen.getByText('No transcript available.')).toBeInTheDocument()
  })

  it('shows empty usage message when usage is empty', () => {
    render(
      <MeetingDetails meeting={mockMeeting} onBack={vi.fn()} onOpenSettings={vi.fn()} />
    )

    fireEvent.click(screen.getByText('Usage'))

    expect(screen.getByText('No usage history.')).toBeInTheDocument()
  })

  it('does not render action items section when actionItems is empty', () => {
    const meetingNoActions = {
      ...mockMeeting,
      detailedSummary: {
        ...mockMeeting.detailedSummary,
        actionItems: [],
      },
    }

    render(
      <MeetingDetails meeting={meetingNoActions} onBack={vi.fn()} onOpenSettings={vi.fn()} />
    )

    expect(screen.queryByText('Action item 1')).not.toBeInTheDocument()
  })

  it('renders usage tab with Q&A content', () => {
    const meetingWithUsage = {
      ...mockMeeting,
      usage: [
        {
          type: 'assist' as const,
          timestamp: 1000,
          question: 'How to improve performance?',
          answer: 'Use memoization and code splitting.',
        },
      ],
    }

    render(
      <MeetingDetails meeting={meetingWithUsage} onBack={vi.fn()} onOpenSettings={vi.fn()} />
    )

    fireEvent.click(screen.getByText('Usage'))

    expect(screen.getByText('How to improve performance?')).toBeInTheDocument()
    expect(screen.getByText('Use memoization and code splitting.')).toBeInTheDocument()
  })
})
