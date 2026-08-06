import { buildPhoneMirrorWsUrl, parsePairingUrl } from '../wsUrl';

describe('wsUrl', () => {
  it('builds phone-token WS URL', () => {
    expect(
      buildPhoneMirrorWsUrl({
        host: '100.64.0.2',
        port: '4123',
        phoneToken: 'abc+/=',
      }),
    ).toBe('ws://100.64.0.2:4123/ws?t=abc%2B%2F%3D');
  });

  it('parses desktop pairing URL', () => {
    expect(parsePairingUrl('http://192.168.1.10:4123/?t=tok123')).toEqual({
      host: '192.168.1.10',
      port: '4123',
      phoneToken: 'tok123',
    });
  });
});
