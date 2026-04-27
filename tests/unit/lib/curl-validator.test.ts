import { describe, expect, it, vi } from 'vitest'
import { validateCurl } from '../../../src/lib/curl-validator'

// Mock the @bany/curl-to-json module
vi.mock('@bany/curl-to-json', () => ({
  default: vi.fn((_curl: string) => {
    // Simple mock that returns an object for valid curl commands
    return { command: 'curl', args: [] }
  }),
}))

describe('curl-validator', () => {
  describe('validateCurl', () => {
    it('should return invalid for empty string', () => {
      const result = validateCurl('')
      expect(result.isValid).toBe(false)
      expect(result.message).toBe('Command cannot be empty.')
    })

    it('should return invalid for whitespace only', () => {
      const result = validateCurl('   ')
      expect(result.isValid).toBe(false)
      expect(result.message).toBe('Command cannot be empty.')
    })

    it('should return invalid when not starting with curl', () => {
      const result = validateCurl('wget http://example.com')
      expect(result.isValid).toBe(false)
      expect(result.message).toBe("The command must start with 'curl'.")
    })

    it('should return valid for curl starting with uppercase (case-insensitive)', () => {
      const result = validateCurl('CURL http://example.com -d "{{TEXT}}"')
      // The code uses toLowerCase() so uppercase curl is accepted
      expect(result.isValid).toBe(true)
      expect(result.json).toBeDefined()
    })

    it('should return invalid when {{TEXT}} placeholder is missing', () => {
      const result = validateCurl('curl http://example.com')
      expect(result.isValid).toBe(false)
      expect(result.message).toBe(
        'Your cURL must contain {{TEXT}} variable to inject the user message.',
      )
    })

    it('should return valid for valid curl with {{TEXT}}', () => {
      const result = validateCurl('curl http://example.com -d "{{TEXT}}"')
      expect(result.isValid).toBe(true)
      expect(result.json).toBeDefined()
    })

    it('should return valid for curl with -X flag and {{TEXT}}', () => {
      const result = validateCurl(
        'curl -X POST http://api.example.com -d "{{TEXT}}"',
      )
      expect(result.isValid).toBe(true)
      expect(result.json).toBeDefined()
    })

    it('should return valid for curl with headers and {{TEXT}}', () => {
      const result = validateCurl(
        'curl -H "Content-Type: application/json" -d "{{TEXT}}" http://api.example.com',
      )
      expect(result.isValid).toBe(true)
      expect(result.json).toBeDefined()
    })

    it('should handle curl with {{TEXT}} at end', () => {
      const result = validateCurl('curl http://example.com {{TEXT}}')
      // The mock returns success, so it passes validation
      expect(result.isValid).toBe(true)
    })
  })
})
