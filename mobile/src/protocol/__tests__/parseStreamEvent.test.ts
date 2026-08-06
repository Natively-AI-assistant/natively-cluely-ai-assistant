import { parseStreamEvent, parseStreamEventFromData } from '../parseStreamEvent';

describe('parseStreamEvent', () => {
  it('parses history messages', () => {
    const event = parseStreamEvent({
      type: 'history',
      messages: [
        {
          id: 'u:1',
          role: 'user',
          content: 'hi',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'a:1',
          role: 'assistant',
          content: 'hello',
          createdAt: '2026-01-01T00:00:01.000Z',
          label: 'What to Say',
        },
      ],
    });
    expect(event).toEqual({
      type: 'history',
      messages: [
        {
          id: 'u:1',
          role: 'user',
          content: 'hi',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'a:1',
          role: 'assistant',
          content: 'hello',
          createdAt: '2026-01-01T00:00:01.000Z',
          label: 'What to Say',
        },
      ],
    });
  });

  it('parses token / done / error / assistant / user', () => {
    expect(parseStreamEvent({ type: 'token', streamId: 's1', token: 'Hi' })).toEqual({
      type: 'token',
      streamId: 's1',
      token: 'Hi',
    });
    expect(
      parseStreamEvent({
        type: 'done',
        streamId: 's1',
        content: 'Hi there',
        createdAt: 't',
      }),
    ).toEqual({
      type: 'done',
      streamId: 's1',
      content: 'Hi there',
      createdAt: 't',
    });
    expect(
      parseStreamEvent({ type: 'error', streamId: 's1', message: 'boom' }),
    ).toEqual({ type: 'error', streamId: 's1', message: 'boom' });
    expect(
      parseStreamEvent({
        type: 'assistant',
        id: 'a2',
        content: 'tip',
        label: 'Code Hint',
        createdAt: 't2',
      }),
    ).toEqual({
      type: 'assistant',
      id: 'a2',
      content: 'tip',
      label: 'Code Hint',
      createdAt: 't2',
    });
    expect(
      parseStreamEvent({
        type: 'user',
        id: 'u2',
        content: 'q',
        createdAt: 't3',
      }),
    ).toEqual({ type: 'user', id: 'u2', content: 'q', createdAt: 't3' });
  });

  it('ignores unknown and malformed frames', () => {
    expect(parseStreamEvent({ type: 'status' })).toBeNull();
    expect(parseStreamEvent({ type: 'token' })).toBeNull();
    expect(parseStreamEvent(null)).toBeNull();
    expect(parseStreamEventFromData('not-json')).toBeNull();
  });

  it('parses JSON data strings', () => {
    expect(parseStreamEventFromData(JSON.stringify({ type: 'ack', action: 'screenshot', message: 'ok' }))).toEqual({
      type: 'ack',
      action: 'screenshot',
      message: 'ok',
    });
  });
});
