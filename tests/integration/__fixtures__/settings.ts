export function createTestSettings() {
  return {
    isUndetectable: false,
    verboseLogging: false,
    disguiseMode: 'none' as const,
    actionButtonMode: 'assist' as const,
    selectedModel: 'gpt-4o-mini',
  }
}
