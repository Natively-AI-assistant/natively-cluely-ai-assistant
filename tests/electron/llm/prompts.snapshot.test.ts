/**
 * Snapshot tests for LLM prompt templates.
 * Catches accidental changes to prompts that affect AI behavior.
 */
import { describe, expect, it } from 'vitest'

describe('LLM Prompt Snapshots', () => {
  it('recap prompt matches snapshot', async () => {
    const { RECAP_MODE_PROMPT } = await import('../../../electron/llm/prompts')
    expect(RECAP_MODE_PROMPT).toMatchSnapshot('recap-prompt')
  })

  it('brainstorm prompt matches snapshot', async () => {
    const { BRAINSTORM_MODE_PROMPT } = await import(
      '../../../electron/llm/prompts'
    )
    expect(BRAINSTORM_MODE_PROMPT).toMatchSnapshot('brainstorm-prompt')
  })

  it('clarify prompt matches snapshot', async () => {
    const { CLARIFY_MODE_PROMPT } = await import(
      '../../../electron/llm/prompts'
    )
    expect(CLARIFY_MODE_PROMPT).toMatchSnapshot('clarify-prompt')
  })

  it('whatToAnswer prompt matches snapshot', async () => {
    const { WHAT_TO_ANSWER_PROMPT } = await import(
      '../../../electron/llm/prompts'
    )
    expect(WHAT_TO_ANSWER_PROMPT).toMatchSnapshot('whatToAnswer-prompt')
  })

  it('followUp prompt matches snapshot', async () => {
    const { FOLLOW_UP_QUESTIONS_MODE_PROMPT } = await import(
      '../../../electron/llm/prompts'
    )
    expect(FOLLOW_UP_QUESTIONS_MODE_PROMPT).toMatchSnapshot('followUp-prompt')
  })

  it('codeHint prompt matches snapshot', async () => {
    const { CODE_HINT_PROMPT } = await import('../../../electron/llm/prompts')
    expect(CODE_HINT_PROMPT).toMatchSnapshot('codeHint-prompt')
  })

  it('assist mode prompt matches snapshot', async () => {
    const { ASSIST_MODE_PROMPT } = await import('../../../electron/llm/prompts')
    expect(ASSIST_MODE_PROMPT).toMatchSnapshot('assist-mode-prompt')
  })

  it('answer mode prompt matches snapshot', async () => {
    const { ANSWER_MODE_PROMPT } = await import('../../../electron/llm/prompts')
    expect(ANSWER_MODE_PROMPT).toMatchSnapshot('answer-mode-prompt')
  })

  it('followup mode prompt matches snapshot', async () => {
    const { FOLLOWUP_MODE_PROMPT } = await import(
      '../../../electron/llm/prompts'
    )
    expect(FOLLOWUP_MODE_PROMPT).toMatchSnapshot('followup-mode-prompt')
  })

  it('groq system prompt matches snapshot', async () => {
    const { GROQ_SYSTEM_PROMPT } = await import('../../../electron/llm/prompts')
    expect(GROQ_SYSTEM_PROMPT).toMatchSnapshot('groq-system-prompt')
  })

  it('groq whatToAnswer prompt matches snapshot', async () => {
    const { GROQ_WHAT_TO_ANSWER_PROMPT } = await import(
      '../../../electron/llm/prompts'
    )
    expect(GROQ_WHAT_TO_ANSWER_PROMPT).toMatchSnapshot(
      'groq-whatToAnswer-prompt',
    )
  })

  it('openai system prompt matches snapshot', async () => {
    const { OPENAI_SYSTEM_PROMPT } = await import(
      '../../../electron/llm/prompts'
    )
    expect(OPENAI_SYSTEM_PROMPT).toMatchSnapshot('openai-system-prompt')
  })

  it('claude system prompt matches snapshot', async () => {
    const { CLAUDE_SYSTEM_PROMPT } = await import(
      '../../../electron/llm/prompts'
    )
    expect(CLAUDE_SYSTEM_PROMPT).toMatchSnapshot('claude-system-prompt')
  })
})
