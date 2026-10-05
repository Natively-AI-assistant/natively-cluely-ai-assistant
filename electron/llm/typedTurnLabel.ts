// electron/llm/typedTurnLabel.ts
//
// The label, inside [..], of a line the user TYPED to the assistant when a
// conversation window is rendered for a prompt. One constant, because two
// formatters render that window (SessionTracker.formatContextItems and
// TemporalContextBuilder.formatTranscript) and two parsers split it back into
// turns (retrievalQueryPolicy, conversationHistoryPolicy).
//
// Upper-case words only: the label strippers match `[A-Z][A-Z0-9 _-]*`.
export const TYPED_TURN_LABEL = 'ME TYPED';
