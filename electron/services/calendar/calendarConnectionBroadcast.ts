/**
 * Every window's calendar UI follows the connection: Settings can disconnect
 * (or a revoked grant can, mid-refresh) while the Launcher shows "Calendar
 * linked", and Settings can connect while it shows "Link your calendar".
 * CalendarManager re-announces "connected" on every token refresh, so only an
 * actual change goes out.
 */
export const CALENDAR_CONNECTION_CHANNEL = 'calendar-connection-changed';

interface ConnectionSource {
    getConnectionStatus(): { connected: boolean };
    on(event: 'connection-changed', listener: (connected: boolean) => void): unknown;
}

interface Target {
    isDestroyed(): boolean;
    webContents: { send(channel: string, ...args: unknown[]): void };
}

export function broadcastCalendarConnection(source: ConnectionSource, windows: () => Target[]): void {
    let connected = source.getConnectionStatus().connected;
    source.on('connection-changed', (next) => {
        if (next === connected) return;
        connected = next;
        for (const w of windows()) {
            if (!w.isDestroyed()) w.webContents.send(CALENDAR_CONNECTION_CHANNEL, next);
        }
    });
}
