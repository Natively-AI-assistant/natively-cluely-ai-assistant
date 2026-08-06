import {
  INITIAL_RECONNECT_DELAY_MS,
  MAX_RECONNECT_DELAY_MS,
  classifyClose,
  classifyConnectFailure,
  nextReconnectDelay,
  shouldAutoReconnect,
} from '../reconnectPolicy';
import { TOKEN_ROTATED_CLOSE_CODE } from '../types';

describe('reconnectPolicy', () => {
  it('stops auto-reconnect on 4401 token rotated', () => {
    const reason = classifyClose(TOKEN_ROTATED_CLOSE_CODE, 'Token rotated');
    expect(reason.kind).toBe('token_rotated');
    expect(shouldAutoReconnect(reason)).toBe(false);
    expect(reason.message).toMatch(/token/i);
  });

  it('stops auto-reconnect on auth-style close codes', () => {
    expect(shouldAutoReconnect(classifyClose(1008))).toBe(false);
    expect(shouldAutoReconnect(classifyClose(4001))).toBe(false);
  });

  it('allows reconnect for transient closes', () => {
    const reason = classifyClose(1006);
    expect(reason.kind).toBe('transient');
    expect(shouldAutoReconnect(reason)).toBe(true);
  });

  it('treats HTTP 401 connect failure as fatal (no storm)', () => {
    const reason = classifyConnectFailure({ httpStatus: 401 });
    expect(reason.kind).toBe('auth_rejected');
    expect(shouldAutoReconnect(reason)).toBe(false);
  });

  it('grows reconnect delay with an 8s cap (web parity)', () => {
    let delay = INITIAL_RECONNECT_DELAY_MS;
    const seen: number[] = [delay];
    for (let i = 0; i < 10; i += 1) {
      delay = nextReconnectDelay(delay);
      seen.push(delay);
    }
    expect(seen[0]).toBe(800);
    expect(seen[1]).toBe(1280);
    expect(Math.max(...seen)).toBe(MAX_RECONNECT_DELAY_MS);
    expect(nextReconnectDelay(MAX_RECONNECT_DELAY_MS)).toBe(MAX_RECONNECT_DELAY_MS);
  });
});
