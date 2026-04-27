import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateMeetingPDF } from '../../../src/utils/pdfGenerator'

const { mockDoc, MockJsPDF } = vi.hoisted(() => {
  const mockDoc = {
    setFont: vi.fn(),
    setFontSize: vi.fn(),
    setTextColor: vi.fn(),
    text: vi.fn(),
    addPage: vi.fn(),
    save: vi.fn(),
    splitTextToSize: (text: string) => text.split('\n'),
    internal: {
      pageSize: {
        getWidth: () => 210,
        getHeight: () => 297,
      },
    },
  }

  const MockJsPDF = (() => mockDoc) as any
  MockJsPDF.prototype = mockDoc

  return { mockDoc, MockJsPDF }
})

vi.mock('jspdf', () => ({
  jsPDF: MockJsPDF,
  default: MockJsPDF,
}))

describe('pdfGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('generateMeetingPDF', () => {
    it('should render title, date, and summary into the PDF', () => {
      const meeting = {
        id: '1',
        title: 'Weekly Standup',
        date: '2024-01-15',
        duration: '30 minutes',
        summary: 'Team discussed sprint progress.',
      }

      generateMeetingPDF(meeting)

      // Title at 18pt bold — splitTextToSize returns arrays
      expect(mockDoc.text).toHaveBeenCalledWith(
        ['Weekly Standup'],
        20,
        expect.any(Number),
      )
      expect(mockDoc.setFontSize).toHaveBeenCalledWith(18)

      // Date + duration
      expect(mockDoc.text).toHaveBeenCalledWith(
        [expect.stringContaining('2024-01-15')],
        20,
        expect.any(Number),
      )
      expect(mockDoc.text).toHaveBeenCalledWith(
        [expect.stringContaining('30 minutes')],
        20,
        expect.any(Number),
      )

      // Summary section header + text
      expect(mockDoc.text).toHaveBeenCalledWith(
        ['Summary'],
        20,
        expect.any(Number),
      )
      expect(mockDoc.text).toHaveBeenCalledWith(
        ['Team discussed sprint progress.'],
        20,
        expect.any(Number),
      )
    })

    it('should include action items and key points when provided', () => {
      const meeting = {
        id: '1',
        title: 'Sprint Planning',
        date: '2024-01-15',
        duration: '45 min',
        summary: 'Sprint planning completed.',
        detailedSummary: {
          actionItems: ['Deploy v2', 'Write tests'],
          keyPoints: ['Velocity is up', 'No blockers'],
        },
      }

      generateMeetingPDF(meeting)

      // Action items section
      expect(mockDoc.text).toHaveBeenCalledWith(
        ['Action Items'],
        20,
        expect.any(Number),
      )
      expect(mockDoc.text).toHaveBeenCalledWith(
        ['• Deploy v2'],
        20,
        expect.any(Number),
      )
      expect(mockDoc.text).toHaveBeenCalledWith(
        ['• Write tests'],
        20,
        expect.any(Number),
      )

      // Key points section
      expect(mockDoc.text).toHaveBeenCalledWith(
        ['Key Points'],
        20,
        expect.any(Number),
      )
      expect(mockDoc.text).toHaveBeenCalledWith(
        ['• Velocity is up'],
        20,
        expect.any(Number),
      )
      expect(mockDoc.text).toHaveBeenCalledWith(
        ['• No blockers'],
        20,
        expect.any(Number),
      )
    })

    it('should render transcript entries with speaker and text', () => {
      const meeting = {
        id: '1',
        title: 'Meeting',
        date: '2024-01-01',
        duration: '30 min',
        summary: 'Summary',
        transcript: [
          { speaker: 'Alice', text: 'Hello team', timestamp: 1704067200000 },
          { speaker: 'Bob', text: 'Hi everyone', timestamp: 1704067201000 },
        ],
      }

      generateMeetingPDF(meeting)

      // Transcript section header
      expect(mockDoc.text).toHaveBeenCalledWith(
        ['Transcript'],
        20,
        expect.any(Number),
      )

      // Speaker lines contain speaker name
      expect(mockDoc.text).toHaveBeenCalledWith(
        [expect.stringContaining('Alice')],
        20,
        expect.any(Number),
      )
      expect(mockDoc.text).toHaveBeenCalledWith(
        [expect.stringContaining('Bob')],
        20,
        expect.any(Number),
      )

      // Speaker text lines
      expect(mockDoc.text).toHaveBeenCalledWith(
        ['Hello team'],
        20,
        expect.any(Number),
      )
      expect(mockDoc.text).toHaveBeenCalledWith(
        ['Hi everyone'],
        20,
        expect.any(Number),
      )
    })

    it('should render chat Q&A and assist interactions in usage section', () => {
      const meeting = {
        id: '1',
        title: 'Meeting',
        date: '2024-01-01',
        duration: '30 min',
        summary: 'Summary',
        usage: [
          {
            type: 'chat' as const,
            timestamp: 1704067200000,
            question: 'What changed?',
            answer: 'Everything.',
          },
          {
            type: 'assist' as const,
            timestamp: 1704067201000,
            answer: 'Consider adding tests.',
          },
        ],
      }

      generateMeetingPDF(meeting)

      // Section header
      expect(mockDoc.text).toHaveBeenCalledWith(
        ['AI Usage & Interactions'],
        20,
        expect.any(Number),
      )

      // Chat Q&A
      expect(mockDoc.text).toHaveBeenCalledWith(
        ['Q: What changed?'],
        20,
        expect.any(Number),
      )
      expect(mockDoc.text).toHaveBeenCalledWith(
        ['A: Everything.'],
        20,
        expect.any(Number),
      )

      // Assist
      expect(mockDoc.text).toHaveBeenCalledWith(
        ['Assist:'],
        20,
        expect.any(Number),
      )
      expect(mockDoc.text).toHaveBeenCalledWith(
        ['Consider adding tests.'],
        20,
        expect.any(Number),
      )
    })

    it('should save PDF with sanitized filename from title', () => {
      const meeting = {
        id: '1',
        title: 'Meeting: Review @2024!',
        date: '2024-01-01',
        duration: '30 min',
        summary: 'Done.',
      }

      generateMeetingPDF(meeting)

      expect(mockDoc.save).toHaveBeenCalledOnce()
      expect(mockDoc.save).toHaveBeenCalledWith('meeting__review__2024_.pdf')
    })

    it('should skip summary section when summary is empty', () => {
      const meeting = {
        id: '1',
        title: 'Empty Summary',
        date: '2024-01-01',
        duration: '5 min',
        summary: '',
      }

      generateMeetingPDF(meeting)

      // Should still render title
      expect(mockDoc.text).toHaveBeenCalledWith(
        ['Empty Summary'],
        20,
        expect.any(Number),
      )
      // Summary header should NOT appear
      const summaryHeaderCalls = mockDoc.text.mock.calls.filter(
        (args: any[]) => args[0][0] === 'Summary',
      )
      expect(summaryHeaderCalls.length).toBe(0)
    })

    it('should skip action items section when array is empty', () => {
      const meeting = {
        id: '1',
        title: 'No Actions',
        date: '2024-01-01',
        duration: '10 min',
        summary: 'Brief.',
        detailedSummary: {
          actionItems: [],
          keyPoints: ['Point 1'],
        },
      }

      generateMeetingPDF(meeting)

      const actionHeaderCalls = mockDoc.text.mock.calls.filter(
        (args: any[]) => args[0][0] === 'Action Items',
      )
      expect(actionHeaderCalls.length).toBe(0)
      // Key points should still be present
      expect(mockDoc.text).toHaveBeenCalledWith(
        ['Key Points'],
        20,
        expect.any(Number),
      )
    })

    it('should add a new page when content exceeds page height', () => {
      // Make page height very small to force page break
      Object.defineProperty(mockDoc.internal.pageSize, 'getHeight', {
        value: () => 50,
      })

      const meeting = {
        id: '1',
        title: 'Long Meeting',
        date: '2024-01-01',
        duration: '60 min',
        summary: 'A very long summary that should trigger page breaks.',
        detailedSummary: {
          actionItems: Array.from({ length: 20 }, (_, i) => `Task ${i + 1}`),
          keyPoints: Array.from({ length: 20 }, (_, i) => `Point ${i + 1}`),
        },
      }

      generateMeetingPDF(meeting)

      expect(mockDoc.addPage).toHaveBeenCalled()
    })
  })
})
