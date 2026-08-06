import {
  QUICK_ACTIONS,
  buildActionCommand,
  buildChatCommand,
  buildScreenshotCommand,
  buildStealthCommand,
  interpretAck,
} from '../phoneCommands';

describe('phoneCommands builders', () => {
  it('builds chat with trimmed message', () => {
    expect(buildChatCommand('  hello  ')).toEqual({
      type: 'chat',
      message: 'hello',
    });
  });

  it('rejects empty or oversized chat', () => {
    expect(buildChatCommand('   ')).toBeNull();
    expect(buildChatCommand('x'.repeat(2001))).toBeNull();
  });

  it('builds action commands for desktop quick-action ids', () => {
    const ids = QUICK_ACTIONS.map((a) => a.id);
    expect(ids).toEqual([
      'whatToAnswer',
      'codeHint',
      'clarify',
      'brainstorm',
      'answer',
      'followUp',
      'dynamicAction4',
    ]);
    for (const id of ids) {
      expect(buildActionCommand(id)).toEqual({ type: 'action', action: id });
    }
  });

  it('rejects invalid action ids', () => {
    expect(buildActionCommand('')).toBeNull();
    expect(buildActionCommand('bad action')).toBeNull();
    expect(buildActionCommand('x'.repeat(65))).toBeNull();
  });

  it('builds screenshot and stealth commands', () => {
    expect(buildScreenshotCommand()).toEqual({ type: 'screenshot' });
    expect(buildStealthCommand('enter')).toEqual({
      type: 'two-device-stealth',
      op: 'enter',
    });
    expect(buildStealthCommand('exit')).toEqual({
      type: 'two-device-stealth',
      op: 'exit',
    });
    expect(buildStealthCommand('end')).toEqual({
      type: 'two-device-stealth',
      op: 'end',
    });
  });
});

describe('interpretAck', () => {
  it('marks screenshot success and failure', () => {
    expect(
      interpretAck({
        action: 'screenshot',
        message: 'Screenshot captured — queued for AI',
      }),
    ).toMatchObject({ kind: 'screenshot', ok: true });
    expect(
      interpretAck({ action: 'screenshot', message: 'Screenshot failed' }),
    ).toMatchObject({ kind: 'screenshot', ok: false });
  });

  it('maps stealth enter/exit/end and leaves noop state undefined', () => {
    expect(
      interpretAck({
        action: 'two-device-stealth:enter',
        message: 'Two-device stealth on — overlay hidden',
      }),
    ).toMatchObject({
      kind: 'stealth',
      ok: true,
      stealthActive: true,
      stealthOp: 'enter',
    });
    expect(
      interpretAck({
        action: 'two-device-stealth:exit',
        message: 'Two-device stealth off — overlay restored',
      }),
    ).toMatchObject({
      kind: 'stealth',
      ok: true,
      stealthActive: false,
      stealthOp: 'exit',
    });
    expect(
      interpretAck({
        action: 'two-device-stealth:end',
        message: 'Session ended',
      }),
    ).toMatchObject({
      kind: 'stealth',
      ok: true,
      stealthActive: false,
      stealthOp: 'end',
    });
    expect(
      interpretAck({
        action: 'two-device-stealth:noop',
        message: 'Already in two-device stealth',
      }),
    ).toMatchObject({
      kind: 'stealth',
      ok: true,
      stealthOp: 'noop',
    });
    expect(
      interpretAck({
        action: 'two-device-stealth:noop',
        message: 'Already in two-device stealth',
      }).stealthActive,
    ).toBeUndefined();
  });

  it('marks stealth failure from error message', () => {
    expect(
      interpretAck({
        action: 'two-device-stealth:enter',
        message: 'Two-device stealth failed',
      }),
    ).toMatchObject({ kind: 'stealth', ok: false, stealthActive: true });
  });
});
