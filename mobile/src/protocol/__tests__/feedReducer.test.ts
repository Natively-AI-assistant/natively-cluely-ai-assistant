import {
  applyStreamEvent,
  feedItemsForDisplay,
  initialFeedState,
} from '../feedReducer';

describe('feedReducer', () => {
  it('replaces feed on history and clears live', () => {
    const withLive = applyStreamEvent(initialFeedState, {
      type: 'token',
      streamId: 's',
      token: 'partial',
    });
    const next = applyStreamEvent(withLive, {
      type: 'history',
      messages: [
        {
          id: 'u:1',
          role: 'user',
          content: 'Q',
          createdAt: 't0',
        },
      ],
    });
    expect(next.live).toBeNull();
    expect(next.items).toHaveLength(1);
    expect(next.items[0]).toMatchObject({ kind: 'message', role: 'user', content: 'Q' });
  });

  it('appends streaming tokens then finalizes on done', () => {
    let state = applyStreamEvent(initialFeedState, {
      type: 'token',
      streamId: 's1',
      token: 'Hel',
    });
    state = applyStreamEvent(state, { type: 'token', streamId: 's1', token: 'lo' });
    expect(feedItemsForDisplay(state).at(-1)).toMatchObject({
      live: true,
      content: 'Hello',
    });
    state = applyStreamEvent(state, {
      type: 'done',
      streamId: 's1',
      content: 'Hello!',
      createdAt: 't1',
    });
    expect(state.live).toBeNull();
    expect(state.items.at(-1)).toMatchObject({
      kind: 'message',
      role: 'assistant',
      content: 'Hello!',
    });
  });

  it('records assistant and error events', () => {
    let state = applyStreamEvent(initialFeedState, {
      type: 'assistant',
      id: 'a1',
      content: 'hint',
      label: 'Code Hint',
      createdAt: 't',
    });
    state = applyStreamEvent(state, {
      type: 'error',
      streamId: 's2',
      message: 'failed',
    });
    expect(state.items[0]).toMatchObject({ kind: 'message', label: 'Code Hint' });
    expect(state.items[1]).toMatchObject({ kind: 'error', message: '[error: failed]' });
  });
});
