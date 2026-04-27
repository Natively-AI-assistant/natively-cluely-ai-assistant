/**
 * Tests for meetingStateMachine.ts - pure state machine functions.
 */

import { describe, expect, it } from 'vitest'
import {
  canEndMeeting,
  canStartMeeting,
  getNextMeetingState,
} from '../../../electron/appState/meetingStateMachine'

describe('meetingStateMachine', () => {
  describe('canStartMeeting', () => {
    it('returns true when state is idle', () => {
      expect(canStartMeeting('idle')).toBe(true)
    })

    it('returns false when state is starting', () => {
      expect(canStartMeeting('starting')).toBe(false)
    })

    it('returns false when state is active', () => {
      expect(canStartMeeting('active')).toBe(false)
    })

    it('returns false when state is ending', () => {
      expect(canStartMeeting('ending')).toBe(false)
    })
  })

  describe('canEndMeeting', () => {
    it('returns false when state is idle', () => {
      expect(canEndMeeting('idle')).toBe(false)
    })

    it('returns false when state is starting', () => {
      expect(canEndMeeting('starting')).toBe(false)
    })

    it('returns true when state is active', () => {
      expect(canEndMeeting('active')).toBe(true)
    })

    it('returns false when state is ending', () => {
      expect(canEndMeeting('ending')).toBe(false)
    })
  })

  describe('getNextMeetingState', () => {
    it('returns active when starting from idle', () => {
      expect(getNextMeetingState('idle', 'start')).toBe('active')
    })

    it('returns idle when ending from active', () => {
      expect(getNextMeetingState('active', 'end')).toBe('idle')
    })

    it('throws when starting from non-idle state', () => {
      expect(() => getNextMeetingState('active', 'start')).toThrow()
    })

    it('throws when ending from non-active state', () => {
      expect(() => getNextMeetingState('idle', 'end')).toThrow()
    })
  })
})
