export type AnswerThrottleReason = 'quota' | 'trigger' | null;

export function getAutomaticAnswerThrottleReason(options: {
  isAutomatic: boolean;
  hasImages: boolean;
  now: number;
  quotaCooldownUntil: number;
  lastTriggerTime: number;
  triggerCooldown: number;
}): AnswerThrottleReason {
  if (!options.isAutomatic || options.hasImages) return null;
  if (options.now < options.quotaCooldownUntil) return 'quota';
  if (options.now - options.lastTriggerTime < options.triggerCooldown) return 'trigger';
  return null;
}
