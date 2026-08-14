export function shouldAcceptIntelligenceIpc(params: {
  eventIntent: string;
  activeStreamIntent: string | null;
  hasActiveOpenStream: boolean;
}): boolean;
