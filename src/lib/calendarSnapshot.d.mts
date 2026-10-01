export interface CalendarSnapshotStatus {
  connected: boolean;
  email?: string;
  name?: string;
}

export interface CalendarSnapshot {
  status: CalendarSnapshotStatus | null;
  events: any[] | null;
  calendars: any[] | null;
}

export interface CalendarSnapshotApi {
  getCalendarStatus?: () => Promise<CalendarSnapshotStatus>;
  getUpcomingEvents?: () => Promise<any[]>;
  getSyncedCalendars?: () => Promise<any[]>;
}

export function readCalendarSnapshot(): CalendarSnapshot;
export function writeCalendarSnapshot(patch: Partial<CalendarSnapshot>): void;
export function noteUpcomingEvents(events: any[] | null | undefined): void;
export function unfinishedEvents<T extends { startTime: string; endTime?: string }>(events: T[] | null | undefined, now: number): T[] | null;
export function warmCalendarSnapshot(api: CalendarSnapshotApi | undefined): Promise<void>;
export function resetCalendarSnapshotForTests(): void;
