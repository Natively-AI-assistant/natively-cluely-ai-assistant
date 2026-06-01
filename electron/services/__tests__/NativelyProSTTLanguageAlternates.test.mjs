import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RECOGNITION_LANGUAGES } from '../../../dist-electron/electron/config/languages.js';

test('auto recognition includes Russian as a detection alternate', () => {
  const alternates = RECOGNITION_LANGUAGES.auto.alternates ?? [];

  assert.ok(
    alternates.includes(RECOGNITION_LANGUAGES.russian.bcp47),
    'Auto language detection must include ru-RU so Russian speech is considered without manually selecting Russian',
  );
});
