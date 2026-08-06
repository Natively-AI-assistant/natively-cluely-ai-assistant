import { parseStreamEventFromData } from '../protocol/parseStreamEvent';
import {
  INITIAL_RECONNECT_DELAY_MS,
  classifyClose,
  classifyConnectFailure,
  nextReconnectDelay,
  shouldAutoReconnect,
  type CloseReason,
} from '../protocol/reconnectPolicy';
import type { PhoneCommand } from '../protocol/phoneCommands';
import type { PairingConfig, StreamEvent } from '../protocol/types';
import { buildPhoneMirrorWsUrl } from '../protocol/wsUrl';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'stopped';

export interface PhoneMirrorConnectionHandlers {
  onStatus: (status: ConnectionStatus) => void;
  onEvent: (event: StreamEvent) => void;
  onFatalError: (reason: CloseReason) => void;
  onTransientNotice?: (message: string) => void;
}

/**
 * Phone Mirror WS client with reconnect backoff.
 * Stops permanently on 4401 (token rotated) / auth rejection — no reconnect storm.
 */
export class PhoneMirrorConnection {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  private intentionalStop = false;
  private url: string | null = null;
  private status: ConnectionStatus = 'idle';

  constructor(private readonly handlers: PhoneMirrorConnectionHandlers) {}

  getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * Send a validated phone command when the socket is open.
   * Returns false if disconnected / send throws (caller may toast).
   */
  sendCommand(cmd: PhoneCommand): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(JSON.stringify(cmd));
      return true;
    } catch {
      return false;
    }
  }

  connect(config: PairingConfig): void {
    this.intentionalStop = false;
    this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
    try {
      this.url = buildPhoneMirrorWsUrl(config);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid pairing config';
      this.handlers.onFatalError({ kind: 'auth_rejected', message });
      this.setStatus('stopped');
      return;
    }
    this.openSocket();
  }

  /** User-initiated disconnect — do not auto-reconnect. */
  disconnect(): void {
    this.intentionalStop = true;
    this.clearReconnectTimer();
    this.closeSocket();
    this.setStatus('stopped');
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.handlers.onStatus(status);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private closeSocket(): void {
    if (!this.socket) return;
    try {
      this.socket.onopen = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.onmessage = null;
      this.socket.close();
    } catch {
      // ignore
    }
    this.socket = null;
  }

  private openSocket(): void {
    if (!this.url || this.intentionalStop) return;
    this.clearReconnectTimer();
    this.closeSocket();
    this.setStatus(this.status === 'idle' || this.status === 'stopped' ? 'connecting' : 'reconnecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open WebSocket';
      this.handleFailure(classifyConnectFailure({ message }));
      return;
    }

    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      this.setStatus('connected');
    };

    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      const data = typeof event.data === 'string' ? event.data : String(event.data);
      const parsed = parseStreamEventFromData(data);
      if (parsed) this.handlers.onEvent(parsed);
    };

    socket.onerror = () => {
      // RN often follows with onclose; do not double-schedule here.
    };

    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.intentionalStop) {
        this.setStatus('stopped');
        return;
      }
      const reason = classifyClose(event.code, event.reason);
      this.handleFailure(reason);
    };
  }

  private handleFailure(reason: CloseReason): void {
    if (!shouldAutoReconnect(reason)) {
      this.intentionalStop = true;
      this.clearReconnectTimer();
      this.setStatus('stopped');
      this.handlers.onFatalError(reason);
      return;
    }

    this.handlers.onTransientNotice?.(reason.message);
    this.setStatus('reconnecting');
    this.clearReconnectTimer();
    const wait = Math.min(this.reconnectDelay, 8000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, wait);
    this.reconnectDelay = nextReconnectDelay(this.reconnectDelay);
  }
}
