import { HttpResponse, http } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { server } from './server'

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('MSW Setup', () => {
  it('intercepts fetch to Ollama /api/tags', async () => {
    const res = await fetch('http://localhost:11434/api/tags')
    const data = await res.json()
    expect(data.models).toHaveLength(2)
    expect(data.models[0].name).toBe('llama3:latest')
  })

  it('returns mock model list from Ollama', async () => {
    const res = await fetch('http://localhost:11434/api/tags')
    const data = await res.json()
    expect(data.models[0]).toHaveProperty('model')
    expect(data.models[0]).toHaveProperty('size')
  })

  it('supports custom handler override per-test', async () => {
    server.use(
      http.get('http://localhost:11434/api/tags', () => {
        return HttpResponse.json({ models: [{ name: 'custom-model' }] })
      }),
    )
    const res = await fetch('http://localhost:11434/api/tags')
    const data = await res.json()
    expect(data.models[0].name).toBe('custom-model')
  })
})
