import { describe, expect, it, vi } from 'vitest'

// Mock @bany/curl-to-json since it requires actual cURL parsing
vi.mock('@bany/curl-to-json', () => ({
  default: vi.fn((curl: string) => {
    if (!curl.includes('curl')) throw new Error('Invalid')
    return {
      url: 'https://api.example.com',
      method: 'POST',
      header: {},
      data: '{}',
    }
  }),
}))

import {
  deepVariableReplacer,
  getByPath,
  imageMimeTypeFromPath,
  injectImageIntoMessages,
  validateCurl,
} from '../../../electron/utils/curlUtils'

describe('curlUtils', () => {
  describe('validateCurl', () => {
    it('rejects empty string', () => {
      const result = validateCurl('')
      expect(result.isValid).toBe(false)
      expect(result.message).toBe('Command cannot be empty.')
    })

    it('rejects whitespace-only string', () => {
      const result = validateCurl('   ')
      expect(result.isValid).toBe(false)
    })

    it('rejects non-curl command', () => {
      const result = validateCurl('wget https://example.com')
      expect(result.isValid).toBe(false)
      expect(result.message).toBe("Command must start with 'curl'.")
    })

    it('requires {{TEXT}} placeholder', () => {
      const result = validateCurl('curl https://api.example.com')
      expect(result.isValid).toBe(false)
      expect(result.message).toContain('{{TEXT}}')
    })

    it('accepts valid cURL with placeholder', () => {
      const result = validateCurl(
        "curl -X POST https://api.example.com -d '{{TEXT}}'",
      )
      expect(result.isValid).toBe(true)
      expect(result.json).toBeDefined()
    })
  })

  describe('deepVariableReplacer', () => {
    it('replaces {{KEY}} in strings', () => {
      const result = deepVariableReplacer('Hello {{NAME}}', { NAME: 'World' })
      expect(result).toBe('Hello World')
    })

    it('replaces multiple variables in one string', () => {
      const result = deepVariableReplacer('{{GREETING}} {{NAME}}', {
        GREETING: 'Hi',
        NAME: 'Alice',
      })
      expect(result).toBe('Hi Alice')
    })

    it('replaces in nested objects', () => {
      const obj = { body: { text: '{{MESSAGE}}' } }
      const result = deepVariableReplacer(obj, { MESSAGE: 'Hello' })
      expect(result.body.text).toBe('Hello')
    })

    it('replaces in arrays', () => {
      const arr = ['{{A}}', '{{B}}']
      const result = deepVariableReplacer(arr, { A: '1', B: '2' })
      expect(result).toEqual(['1', '2'])
    })

    it('passes through numbers unchanged', () => {
      expect(deepVariableReplacer(42, {})).toBe(42)
    })

    it('passes through booleans unchanged', () => {
      expect(deepVariableReplacer(true, {})).toBe(true)
    })

    it('passes through null unchanged', () => {
      expect(deepVariableReplacer(null, {})).toBe(null)
    })

    it('passes through undefined unchanged', () => {
      expect(deepVariableReplacer(undefined, {})).toBe(undefined)
    })

    it('handles object with mixed types', () => {
      const obj = { text: '{{NAME}}', count: 5, active: true }
      const result = deepVariableReplacer(obj, { NAME: 'Test' })
      expect(result.text).toBe('Test')
      expect(result.count).toBe(5)
      expect(result.active).toBe(true)
    })
  })

  describe('getByPath', () => {
    it('returns obj for empty path', () => {
      const obj = { a: 1 }
      expect(getByPath(obj, '')).toBe(obj)
    })

    it('traverses simple dot path', () => {
      const obj = { a: { b: { c: 42 } } }
      expect(getByPath(obj, 'a.b.c')).toBe(42)
    })

    it('traverses array index with bracket notation', () => {
      const obj = { choices: [{ message: { content: 'hello' } }] }
      expect(getByPath(obj, 'choices[0].message.content')).toBe('hello')
    })

    it('returns undefined for missing path', () => {
      const obj = { a: 1 }
      expect(getByPath(obj, 'b.c.d')).toBeUndefined()
    })

    it('returns undefined for missing array index', () => {
      const obj = { items: [] }
      expect(getByPath(obj, 'items[5]')).toBeUndefined()
    })

    it('handles deeply nested paths', () => {
      const obj = { a: { b: { c: { d: { e: 'deep' } } } } }
      expect(getByPath(obj, 'a.b.c.d.e')).toBe('deep')
    })
  })

  describe('imageMimeTypeFromPath', () => {
    it('returns image/jpeg for .jpg', () => {
      expect(imageMimeTypeFromPath('photo.jpg')).toBe('image/jpeg')
    })

    it('returns image/jpeg for .jpeg', () => {
      expect(imageMimeTypeFromPath('photo.jpeg')).toBe('image/jpeg')
    })

    it('returns image/png for .png', () => {
      expect(imageMimeTypeFromPath('screenshot.png')).toBe('image/png')
    })

    it('returns image/gif for .gif', () => {
      expect(imageMimeTypeFromPath('animation.gif')).toBe('image/gif')
    })

    it('returns image/webp for .webp', () => {
      expect(imageMimeTypeFromPath('photo.webp')).toBe('image/webp')
    })

    it('returns image/png for unknown extension', () => {
      expect(imageMimeTypeFromPath('file.xyz')).toBe('image/png')
    })

    it('returns image/png for no extension', () => {
      expect(imageMimeTypeFromPath('noextension')).toBe('image/png')
    })

    it('handles Windows backslash paths', () => {
      expect(imageMimeTypeFromPath('C:\\Users\\photo.jpg')).toBe('image/jpeg')
    })

    it('handles full path with extension', () => {
      expect(imageMimeTypeFromPath('/home/user/images/photo.png')).toBe(
        'image/png',
      )
    })

    it('is case insensitive', () => {
      expect(imageMimeTypeFromPath('PHOTO.JPG')).toBe('image/jpeg')
      expect(imageMimeTypeFromPath('Photo.PNG')).toBe('image/png')
    })
  })

  describe('injectImageIntoMessages', () => {
    it('returns body unchanged if no base64Image', () => {
      const body = { messages: [{ role: 'user', content: 'hello' }] }
      const result = injectImageIntoMessages(body, '', 'photo.png')
      expect(result).toEqual(body)
    })

    it('returns body unchanged if messages is not array', () => {
      const body = { messages: 'not an array' }
      const result = injectImageIntoMessages(body, 'base64data', 'photo.png')
      expect(result).toEqual(body)
    })

    it('upgrades string content to multimodal array', () => {
      const body = {
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Describe this image' },
        ],
      }
      const result = injectImageIntoMessages(body, 'base64data', 'photo.png')
      const lastMsg = result.messages[result.messages.length - 1]
      expect(Array.isArray(lastMsg.content)).toBe(true)
      expect(lastMsg.content[0]).toEqual({
        type: 'text',
        text: 'Describe this image',
      })
      expect(lastMsg.content[1].type).toBe('image_url')
      expect(lastMsg.content[1].image_url.url).toContain('base64,base64data')
    })

    it('skips if already has image_url in array content', () => {
      const body = {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'hello' },
              {
                type: 'image_url',
                image_url: { url: 'data:image/png;base64,existing' },
              },
            ],
          },
        ],
      }
      const result = injectImageIntoMessages(body, 'newimage', 'photo.png')
      expect(result.messages[0].content).toHaveLength(2)
    })

    it('appends to multimodal array if no image present', () => {
      const body = {
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'hello' }],
          },
        ],
      }
      const result = injectImageIntoMessages(body, 'newimage', 'photo.png')
      expect(result.messages[0].content).toHaveLength(2)
      expect(result.messages[0].content[1].type).toBe('image_url')
    })

    it('does not modify original body', () => {
      const body = {
        messages: [{ role: 'user', content: 'hello' }],
      }
      const original = JSON.parse(JSON.stringify(body))
      injectImageIntoMessages(body, 'base64', 'photo.png')
      expect(body).toEqual(original)
    })

    it('returns body unchanged if no user message found', () => {
      const body = {
        messages: [{ role: 'system', content: 'system prompt' }],
      }
      const result = injectImageIntoMessages(body, 'base64', 'photo.png')
      expect(result).toEqual(body)
    })

    it('uses correct MIME type from path', () => {
      const body = {
        messages: [{ role: 'user', content: 'check this' }],
      }
      const result = injectImageIntoMessages(body, 'imgdata', 'photo.jpg')
      const imageUrl = result.messages[0].content[1].image_url.url
      expect(imageUrl).toContain('data:image/jpeg;base64,imgdata')
    })
  })
})
