import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

function wireSttErrorStatus(stt, sendSttStatus) {
  const sttProvider = 'natively-pro';
  const speaker = 'interviewer';
  let consecutiveErrors = 0;

  stt.on('error', (err) => {
    const grpcCode = err?.code;
    if (grpcCode === 11 || /Audio Timeout Error/i.test(err.message || '')) {
      return;
    }

    let errorMessage = err.message;
    const axiosErr = err;
    const httpStatus = axiosErr?.response?.status || 0;
    if (axiosErr?.response?.data?.error) {
      const respErr = axiosErr.response.data.error;
      const respMsg = typeof respErr === 'string' ? respErr : (respErr.message || respErr.code || JSON.stringify(respErr));
      errorMessage = httpStatus ? `${httpStatus} ${respMsg}` : respMsg;
    } else if (httpStatus) {
      errorMessage = `${httpStatus} ${axiosErr.response.statusText}`;
    }

    const isRetryableDnsError = grpcCode === 'ENOTFOUND' || grpcCode === 'EAI_AGAIN';
    if (isRetryableDnsError) {
      sendSttStatus({
        state: 'reconnecting',
        provider: sttProvider,
        error: errorMessage,
        channel: speaker,
        reconnectAttempts: consecutiveErrors,
      });
      return;
    }

    const isAuthError = httpStatus === 401
      || err.message.toLowerCase().includes('auth_timeout')
      || err.message.toLowerCase().includes('invalid_key')
      || err.message.toLowerCase().includes('invalid api')
      || err.message.toLowerCase().includes('authentication');

    const isQuotaError = err.message.toLowerCase().includes('transcription_quota_exceeded')
      || err.message.toLowerCase().includes('quota');

    if (isAuthError) {
      consecutiveErrors = 0;
      sendSttStatus({ state: 'failed', provider: sttProvider, error: errorMessage, channel: speaker });
      return;
    }

    consecutiveErrors++;
    const maxErrors = 5;

    if (consecutiveErrors >= maxErrors || isQuotaError) {
      sendSttStatus({
        state: 'failed',
        provider: sttProvider,
        error: isQuotaError
          ? errorMessage
          : `STT provider failed (${consecutiveErrors} consecutive errors): ${errorMessage}`,
        channel: speaker,
        reconnectAttempts: consecutiveErrors,
      });
    } else {
      sendSttStatus({
        state: 'reconnecting',
        provider: sttProvider,
        error: errorMessage,
        channel: speaker,
        reconnectAttempts: consecutiveErrors,
      });
    }
  });
}

test('NativelyProSTT DNS retries must not trip terminal STT failure counter', () => {
  const stt = new EventEmitter();
  const statuses = [];
  wireSttErrorStatus(stt, (status) => statuses.push(status));

  for (let i = 0; i < 5; i++) {
    const err = new Error('getaddrinfo ENOTFOUND api.natively.software');
    err.code = 'ENOTFOUND';
    stt.emit('error', err);
  }

  assert.equal(
    statuses.some((status) => status.state === 'failed'),
    false,
    'ENOTFOUND must remain retryable and never become a terminal STT failure while NativelyProSTT owns reconnect',
  );
  assert.equal(statuses.length, 5);
  assert.deepEqual([...new Set(statuses.map((status) => status.state))], ['reconnecting']);
  assert.deepEqual([...new Set(statuses.map((status) => status.reconnectAttempts))], [0]);
});

test('NativelyProSTT temporary DNS failures must not trip terminal STT failure counter', () => {
  const stt = new EventEmitter();
  const statuses = [];
  wireSttErrorStatus(stt, (status) => statuses.push(status));

  for (let i = 0; i < 5; i++) {
    const err = new Error('getaddrinfo EAI_AGAIN api.natively.software');
    err.code = 'EAI_AGAIN';
    stt.emit('error', err);
  }

  assert.equal(
    statuses.some((status) => status.state === 'failed'),
    false,
    'EAI_AGAIN must remain retryable and never become a terminal STT failure while NativelyProSTT owns reconnect',
  );
  assert.equal(statuses.length, 5);
  assert.deepEqual([...new Set(statuses.map((status) => status.state))], ['reconnecting']);
  assert.deepEqual([...new Set(statuses.map((status) => status.reconnectAttempts))], [0]);
});

test('non-DNS provider errors still become terminal after repeated failures', () => {
  const stt = new EventEmitter();
  const statuses = [];
  wireSttErrorStatus(stt, (status) => statuses.push(status));

  for (let i = 0; i < 5; i++) {
    stt.emit('error', new Error('WebSocket closed unexpectedly'));
  }

  assert.equal(statuses.at(-1)?.state, 'failed');
  assert.equal(statuses.at(-1)?.reconnectAttempts, 5);
});
