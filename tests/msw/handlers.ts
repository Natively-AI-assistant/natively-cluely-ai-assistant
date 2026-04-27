import { HttpResponse, http } from 'msw'

export const handlers = [
  // Ollama
  http.get('http://localhost:11434/api/tags', () => {
    return HttpResponse.json({
      models: [
        { name: 'llama3:latest', model: 'llama3:latest', size: 4661224496 },
        {
          name: 'nomic-embed-text:latest',
          model: 'nomic-embed-text:latest',
          size: 274302441,
        },
      ],
    })
  }),

  http.post('http://localhost:11434/api/generate', () => {
    return HttpResponse.json({
      model: 'llama3',
      response: 'Mock response',
      done: true,
    })
  }),

  http.post('http://localhost:11434/api/embeddings', () => {
    return HttpResponse.json({
      embedding: Array(768).fill(0.1),
    })
  }),

  // OpenAI
  http.post('https://api.openai.com/v1/chat/completions', () => {
    return HttpResponse.json({
      id: 'mock-openai-chat',
      choices: [
        {
          message: { role: 'assistant', content: 'Mock OpenAI response' },
          index: 0,
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    })
  }),

  http.post('https://api.openai.com/v1/embeddings', () => {
    return HttpResponse.json({
      data: [{ embedding: Array(1536).fill(0.1), index: 0 }],
      usage: { prompt_tokens: 5, total_tokens: 5 },
    })
  }),

  // Groq
  http.post('https://api.groq.com/openai/v1/chat/completions', () => {
    return HttpResponse.json({
      id: 'mock-groq-chat',
      choices: [
        {
          message: { role: 'assistant', content: 'Mock Groq response' },
          index: 0,
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    })
  }),

  // Anthropic
  http.post('https://api.anthropic.com/v1/messages', () => {
    return HttpResponse.json({
      id: 'mock-anthropic-msg',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Mock Claude response' }],
      model: 'claude-3-5-sonnet-20241022',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    })
  }),

  // Google Gemini
  http.post('https://generativelanguage.googleapis.com/*', () => {
    return HttpResponse.json({
      candidates: [
        {
          content: { parts: [{ text: 'Mock Gemini response' }], role: 'model' },
        },
      ],
    })
  }),

  // Deepgram
  http.post('https://api.deepgram.com/v1/listen', () => {
    return HttpResponse.json({
      results: {
        channels: [
          {
            alternatives: [
              { transcript: 'Mock Deepgram transcript', confidence: 0.95 },
            ],
          },
        ],
      },
    })
  }),

  // ElevenLabs
  http.post('https://api.elevenlabs.io/v1/speech-to-text/*', () => {
    return HttpResponse.json({
      text: 'Mock ElevenLabs transcript',
      words: [
        { text: 'Mock', start: 0, end: 0.5 },
        { text: 'ElevenLabs', start: 0.5, end: 1.0 },
        { text: 'transcript', start: 1.0, end: 1.5 },
      ],
    })
  }),
]
