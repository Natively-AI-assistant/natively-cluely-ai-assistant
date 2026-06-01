// electron/llm/WhatToAnswerLLM.ts excerpt from a regression in the custom-mode hot-swap path

type TemporalContext = {
  recentTurns: string[];
};

export class WhatToAnswerLLM {
  private modesManager: {
    getActiveModeSystemPromptSuffix(): string;
  };
  private llmHelper?: {
    streamChat(
      message: string,
      imageData?: string,
      signal?: AbortSignal,
      systemPromptOverride?: string,
      stream?: boolean
    ): AsyncIterable<string>;
  };

  async *generateStream(transcript: string, temporalContext?: TemporalContext): AsyncIterable<string> {
    const modePromptSuffix = this.modesManager.getActiveModeSystemPromptSuffix();
    const contextBlock = temporalContext?.recentTurns.length
      ? `\n\n## RECENT CONTEXT\n${temporalContext.recentTurns.join('\n')}`
      : '';
    const basePrompt = `${UNIVERSAL_WHAT_TO_ANSWER_PROMPT}${contextBlock}`;
    const finalPromptOverride = `${basePrompt}\n\n## ACTIVE MODE\n${modePromptSuffix}`;

    yield* this.llmHelper.streamChat(transcript, undefined, undefined, finalPromptOverride, true);
  }
}
