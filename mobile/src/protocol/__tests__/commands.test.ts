import {
  buildModesListCommand,
  buildModesSetCommand,
  buildStartSessionCommand,
} from '../commands';

describe('session control command builders', () => {
  it('builds start-session', () => {
    expect(buildStartSessionCommand()).toEqual({ type: 'start-session' });
  });

  it('builds modes list', () => {
    expect(buildModesListCommand()).toEqual({ type: 'modes', op: 'list' });
  });

  it('builds modes set for valid ids', () => {
    expect(buildModesSetCommand('interview:behavioral')).toEqual({
      type: 'modes',
      op: 'set',
      modeId: 'interview:behavioral',
    });
    expect(buildModesSetCommand('  code_hint  ')).toEqual({
      type: 'modes',
      op: 'set',
      modeId: 'code_hint',
    });
  });

  it('rejects invalid mode ids', () => {
    expect(buildModesSetCommand('')).toBeNull();
    expect(buildModesSetCommand('   ')).toBeNull();
    expect(buildModesSetCommand('bad mode')).toBeNull();
    expect(buildModesSetCommand('a'.repeat(129))).toBeNull();
  });
});
