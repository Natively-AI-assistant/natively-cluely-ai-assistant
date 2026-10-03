export type CalendarConnectErrorTranslator = (text: string) => string;

export declare function getCalendarConnectErrorMessage(
    error?: unknown,
    translate?: CalendarConnectErrorTranslator,
): string;
