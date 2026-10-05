export interface ShowingRecorder {
  start(card: string): void;
  outcome(outcome: 'acted' | 'later' | 'never', meta?: { until?: number }): void;
  end(): void;
}
export function createShowingRecorder(record: (card: string, outcome: string, meta?: { until?: number }) => void): ShowingRecorder;
