import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actionNeedsScreenCapture,
  appendScreenshotAttachment,
  mergePendingScreenshotAttachment,
} from '../screenshotAttachment.mjs';

describe('screenshotAttachment', () => {
  test('appendScreenshotAttachment dedupes by path and caps at five', () => {
    const existing = Array.from({ length: 5 }, (_, idx) => ({
      path: `/tmp/screenshot-${idx}.png`,
      preview: `preview-${idx}`,
    }));

    const duplicate = appendScreenshotAttachment(existing, {
      path: '/tmp/screenshot-2.png',
      preview: 'duplicate-preview',
    });
    assert.equal(duplicate, existing);

    const next = appendScreenshotAttachment(existing, {
      path: '/tmp/screenshot-new.png',
      preview: 'new-preview',
    });
    assert.equal(next.length, 5);
    assert.deepEqual(
      next.map(item => item.path),
      [
        '/tmp/screenshot-1.png',
        '/tmp/screenshot-2.png',
        '/tmp/screenshot-3.png',
        '/tmp/screenshot-4.png',
        '/tmp/screenshot-new.png',
      ],
    );
  });

  test('mergePendingScreenshotAttachment keeps immediate capture available before React state flush', () => {
    const merged = mergePendingScreenshotAttachment([], {
      path: '/tmp/fresh-capture.png',
      preview: 'data:image/png;base64,abc',
    });

    assert.deepEqual(merged, [
      {
        path: '/tmp/fresh-capture.png',
        preview: 'data:image/png;base64,abc',
      },
    ]);
  });

  test('actionNeedsScreenCapture recognizes screen action type and screen evidence', () => {
    assert.equal(actionNeedsScreenCapture({ type: 'screen_coding_problem' }), true);
    assert.equal(
      actionNeedsScreenCapture({
        type: 'coding_problem',
        evidenceRefs: [{ source: 'screen' }],
      }),
      true,
    );
    assert.equal(
      actionNeedsScreenCapture({
        type: 'coding_problem',
        evidenceRefs: [{ source: 'transcript' }],
      }),
      false,
    );
  });
});
