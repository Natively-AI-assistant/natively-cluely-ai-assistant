// tests/e2e/data/models.ts
export interface E2EMockModel {
  id: string
  name: string
  provider: string
}

export const mockOllamaModelNames: string[] = [
  'llama3.2:latest',
  'mistral:latest',
  'codellama:latest',
]

export const mockProviderModels: E2EMockModel[] = [
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' },
  { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'claude' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'gemini' },
]

export const mockEmptyModels: E2EMockModel[] = []
