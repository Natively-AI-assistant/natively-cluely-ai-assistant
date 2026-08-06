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

  it('applies connect-time status including modes', () => {
    const state = applyStreamEvent(initialFeedState, {
      type: 'status',
      sessionActive: true,
      stealthActive: true,
      modeId: 'behavioral',
      modes: [
        { id: 'behavioral', name: 'Behavioral', templateType: 'interview' },
        { id: 'coding', name: 'Coding', templateType: 'coding' },
      ],
    });
    expect(state.session).toEqual({
      sessionActive: true,
      stealthActive: true,
      modeId: 'behavioral',
      modes: [
        { id: 'behavioral', name: 'Behavioral', templateType: 'interview' },
        { id: 'coding', name: 'Coding', templateType: 'coding' },
      ],
    });
    expect(state.items).toEqual([]);
  });

  it('updates session/stealth on reconnect status without requiring stealth ack', () => {
    let state = applyStreamEvent(initialFeedState, {
      type: 'status',
      sessionActive: true,
      stealthActive: false,
      modeId: 'm1',
      modes: [{ id: 'm1', name: 'Mode One', templateType: 't' }],
    });
    // Reconnect snapshot: stealth already on; modes omitted → keep prior list.
    state = applyStreamEvent(state, {
      type: 'status',
      sessionActive: true,
      stealthActive: true,
      modeId: 'm1',
    });
    expect(state.session.stealthActive).toBe(true);
    expect(state.session.sessionActive).toBe(true);
    expect(state.session.modes).toHaveLength(1);
    expect(state.session.modeId).toBe('m1');
  });

  it('replaces modes when status includes a new list', () => {
    let state = applyStreamEvent(initialFeedState, {
      type: 'status',
      sessionActive: false,
      stealthActive: false,
      modeId: 'old',
      modes: [{ id: 'old', name: 'Old', templateType: 't' }],
    });
    state = applyStreamEvent(state, {
      type: 'status',
      sessionActive: false,
      stealthActive: false,
      modeId: 'new',
      modes: [{ id: 'new', name: 'New', templateType: 't' }],
    });
    expect(state.session.modeId).toBe('new');
    expect(state.session.modes).toEqual([
      { id: 'new', name: 'New', templateType: 't' },
    ]);
  });
});
