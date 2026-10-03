// Unit tests for electron/audio/nvidiaNimSttModels.ts — the single source of
// truth for the hosted NVIDIA NIM speech models: the catalogue itself
// (NVIDIA_NIM_STT_MODELS / _CONFIG / DEFAULT_...), isNvidiaNimSttModel(), and
// allowedLanguageKeysForNvidiaModel() which decides which recognition
// languages Settings offers per model.
//
// The language table is injected by the caller, so these tests use small
// hand-built tables rather than the app's real one.
//
// Loads the compiled CommonJS output from dist-electron/ (build first).
// Run from the repo root:
//   node --test electron/audio/__tests__/NvidiaNimSttModels.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const {
  DEFAULT_NVIDIA_NIM_STT_MODEL,
  NVIDIA_NIM_STT_MODELS,
  NVIDIA_NIM_STT_MODEL_CONFIG,
  isNvidiaNimSttModel,
  allowedLanguageKeysForNvidiaModel,
} = require(path.join(repoRoot, 'dist-electron', 'electron', 'audio', 'nvidiaNimSttModels.js'));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BCP47_RE = /^[a-z]{2}-[A-Z]{2}$/;

const EN_ONLY = 'nemotron-asr-streaming';            // locales: ['en-US'], not multilingual
const NEMOTRON_ML = 'nemotron-3.5-asr-streaming-multilingual';
const PARAKEET_ML = 'parakeet-1.1b-rnnt-multilingual-asr';
const SPANISH = 'parakeet-ctc-0.6b-es';              // locales: ['es-US'], singleLocale
const CHINESE_TW = 'parakeet-ctc-0.6b-zh-tw';        // locales: ['zh-TW'], singleLocale

const sorted = (set) => [...set].sort();

describe('NVIDIA_NIM_STT_MODELS catalogue', () => {
  test('is a non-empty list with unique ids', () => {
    assert.ok(Array.isArray(NVIDIA_NIM_STT_MODELS));
    assert.ok(NVIDIA_NIM_STT_MODELS.length > 0);
    const ids = NVIDIA_NIM_STT_MODELS.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('every model has well-formed fields', () => {
    for (const m of NVIDIA_NIM_STT_MODELS) {
      assert.equal(typeof m.id, 'string', m.id);
      assert.ok(m.id.length > 0 && m.id === m.id.trim(), m.id);
      assert.ok(typeof m.label === 'string' && m.label.trim().length > 0, m.id);
      assert.ok(typeof m.description === 'string' && m.description.trim().length > 0, m.id);
      assert.match(m.functionId, UUID_RE, m.id);
      assert.equal(typeof m.multilingual, 'boolean', m.id);
      assert.ok(typeof m.languageCode === 'string' && m.languageCode.length > 0,
        `${m.id}: language_code is required by Riva and must not be empty`);
      assert.ok(Array.isArray(m.locales) && m.locales.length > 0, m.id);
      for (const locale of m.locales) assert.match(locale, BCP47_RE, `${m.id}: ${locale}`);
      assert.equal(new Set(m.locales).size, m.locales.length, `${m.id}: duplicate locale`);
    }
  });

  test("multilingual models send 'multi'; the rest send one of their own locales", () => {
    for (const m of NVIDIA_NIM_STT_MODELS) {
      if (m.multilingual) {
        assert.equal(m.languageCode, 'multi', m.id);
        assert.ok(m.locales.length > 1, m.id);
      } else {
        assert.ok(m.locales.includes(m.languageCode), `${m.id}: ${m.languageCode} not in its locales`);
      }
    }
  });

  test('singleLocale models document exactly one locale and are not multilingual', () => {
    const single = NVIDIA_NIM_STT_MODELS.filter((m) => m.singleLocale);
    assert.ok(single.length > 0);
    for (const m of single) {
      assert.equal(m.multilingual, false, m.id);
      assert.deepEqual([...m.locales], [m.languageCode], m.id);
    }
  });

  test('models sharing a function id are distinguished by language_code', () => {
    const byFunction = new Map();
    for (const m of NVIDIA_NIM_STT_MODELS) {
      const key = `${m.functionId}|${m.languageCode}`;
      assert.ok(!byFunction.has(key),
        `${m.id} and ${byFunction.get(key)} would send identical requests`);
      byFunction.set(key, m.id);
    }
    // The documented case: both Nemotron profiles live on one NIM.
    assert.equal(
      NVIDIA_NIM_STT_MODEL_CONFIG[EN_ONLY].functionId,
      NVIDIA_NIM_STT_MODEL_CONFIG[NEMOTRON_ML].functionId,
    );
    assert.notEqual(
      NVIDIA_NIM_STT_MODEL_CONFIG[EN_ONLY].languageCode,
      NVIDIA_NIM_STT_MODEL_CONFIG[NEMOTRON_ML].languageCode,
    );
  });

  test('the default model is in the catalogue', () => {
    assert.equal(typeof DEFAULT_NVIDIA_NIM_STT_MODEL, 'string');
    assert.ok(NVIDIA_NIM_STT_MODELS.some((m) => m.id === DEFAULT_NVIDIA_NIM_STT_MODEL));
    assert.ok(isNvidiaNimSttModel(DEFAULT_NVIDIA_NIM_STT_MODEL));
  });
});

describe('NVIDIA_NIM_STT_MODEL_CONFIG', () => {
  test('is keyed by id and holds the very same model objects', () => {
    assert.deepEqual(
      Object.keys(NVIDIA_NIM_STT_MODEL_CONFIG).sort(),
      NVIDIA_NIM_STT_MODELS.map((m) => m.id).sort(),
    );
    for (const m of NVIDIA_NIM_STT_MODELS) {
      assert.equal(NVIDIA_NIM_STT_MODEL_CONFIG[m.id], m);
    }
  });
});

describe('isNvidiaNimSttModel', () => {
  test('true for every catalogue id', () => {
    for (const m of NVIDIA_NIM_STT_MODELS) assert.equal(isNvidiaNimSttModel(m.id), true, m.id);
  });

  test('false for unknown ids, near-misses and the empty string', () => {
    assert.equal(isNvidiaNimSttModel(''), false);
    assert.equal(isNvidiaNimSttModel('whisper-large-v3'), false);
    assert.equal(isNvidiaNimSttModel('canary-1b-asr'), false);
    assert.equal(isNvidiaNimSttModel(EN_ONLY.toUpperCase()), false);
    assert.equal(isNvidiaNimSttModel(` ${EN_ONLY}`), false);
    assert.equal(isNvidiaNimSttModel(`${EN_ONLY} `), false);
  });

  test('false for inherited Object.prototype keys', () => {
    for (const key of ['toString', 'constructor', 'hasOwnProperty', '__proto__', 'valueOf']) {
      assert.equal(isNvidiaNimSttModel(key), false, key);
    }
  });

  test('always returns a strict boolean', () => {
    assert.equal(typeof isNvidiaNimSttModel(EN_ONLY), 'boolean');
    assert.equal(typeof isNvidiaNimSttModel('nope'), 'boolean');
  });
});

describe('allowedLanguageKeysForNvidiaModel — unknown model', () => {
  test('returns null ("no restriction")', () => {
    const table = { 'english-us': { bcp47: 'en-US', iso639: 'en' } };
    assert.equal(allowedLanguageKeysForNvidiaModel('not-a-model', table), null);
    assert.equal(allowedLanguageKeysForNvidiaModel('', table), null);
    assert.equal(allowedLanguageKeysForNvidiaModel('not-a-model', {}), null);
  });
});

describe('allowedLanguageKeysForNvidiaModel — exact locale match', () => {
  const table = {
    auto: { bcp47: 'en-US', iso639: 'en' },
    'english-us': { bcp47: 'en-US', iso639: 'en' },
    'english-uk': { bcp47: 'en-GB', iso639: 'en' },
    'english-au': { bcp47: 'en-AU', iso639: 'en' },
    spanish: { bcp47: 'es-ES', iso639: 'es' },
  };

  test('an en-US model offers only the en-US row, not other English accents', () => {
    const keys = allowedLanguageKeysForNvidiaModel(EN_ONLY, table);
    assert.ok(keys instanceof Set);
    assert.deepEqual(sorted(keys), ['english-us']);
  });

  test("a non-multilingual model never offers 'auto', even if the auto row's locale matches", () => {
    assert.equal(allowedLanguageKeysForNvidiaModel(EN_ONLY, table).has('auto'), false);
    assert.equal(allowedLanguageKeysForNvidiaModel(SPANISH, table).has('auto'), false);
  });

  test('bcp47 comparison is case-insensitive', () => {
    const keys = allowedLanguageKeysForNvidiaModel(EN_ONLY, {
      lower: { bcp47: 'en-us' },
      upper: { bcp47: 'EN-US' },
      other: { bcp47: 'en-GB' },
    });
    assert.deepEqual(sorted(keys), ['lower', 'upper']);
  });

  test('every row sharing the exact locale is offered', () => {
    const keys = allowedLanguageKeysForNvidiaModel(EN_ONLY, {
      a: { bcp47: 'en-US', iso639: 'en' },
      b: { bcp47: 'en-US' },
      c: { bcp47: 'en-IN', iso639: 'en' },
    });
    assert.deepEqual(sorted(keys), ['a', 'b']);
  });

  test('an exact row suppresses the subtag fallback for that locale', () => {
    const keys = allowedLanguageKeysForNvidiaModel(SPANISH, {
      'spanish-us': { bcp47: 'es-US', iso639: 'es' },
      'spanish-es': { bcp47: 'es-ES', iso639: 'es' },
    });
    assert.deepEqual(sorted(keys), ['spanish-us']);
  });
});

describe('allowedLanguageKeysForNvidiaModel — language-subtag fallback', () => {
  test('es-US with no exact row falls back to every Spanish row', () => {
    const keys = allowedLanguageKeysForNvidiaModel(SPANISH, {
      'english-us': { bcp47: 'en-US', iso639: 'en' },
      spanish: { bcp47: 'es-ES', iso639: 'es' },
      'spanish-mx': { bcp47: 'es-MX', iso639: 'es' },
    });
    assert.deepEqual(sorted(keys), ['spanish', 'spanish-mx']);
  });

  test('fallback works from bcp47 alone when iso639 is absent', () => {
    const keys = allowedLanguageKeysForNvidiaModel(CHINESE_TW, {
      mandarin: { bcp47: 'zh-CN' },
      japanese: { bcp47: 'ja-JP' },
    });
    assert.deepEqual(sorted(keys), ['mandarin']);
  });

  test('fallback works from iso639 alone, case-insensitively', () => {
    const keys = allowedLanguageKeysForNvidiaModel(SPANISH, {
      a: { iso639: 'es' },
      b: { iso639: 'ES' },
      c: { iso639: 'en' },
    });
    assert.deepEqual(sorted(keys), ['a', 'b']);
  });

  test('iso639 takes precedence over the bcp47 subtag in the fallback', () => {
    const keys = allowedLanguageKeysForNvidiaModel(SPANISH, {
      // bcp47 says Spanish (different region), iso639 says Catalan -> not offered.
      mismatched: { bcp47: 'es-AR', iso639: 'ca' },
      // bcp47 says Catalan, iso639 says Spanish -> offered.
      viaIso: { bcp47: 'ca-ES', iso639: 'es' },
    });
    assert.deepEqual(sorted(keys), ['viaIso']);
  });

  test('rows with neither bcp47 nor iso639 never match', () => {
    const keys = allowedLanguageKeysForNvidiaModel(SPANISH, {
      blank: {},
      empty: { bcp47: '', iso639: '' },
    });
    assert.equal(keys.size, 0);
  });

  test("the 'auto' row is excluded from the fallback too", () => {
    const keys = allowedLanguageKeysForNvidiaModel(SPANISH, {
      auto: { bcp47: 'es-ES', iso639: 'es' },
      spanish: { bcp47: 'es-ES', iso639: 'es' },
    });
    assert.deepEqual(sorted(keys), ['spanish']);
  });

  test('a model whose language is not in the table gets an empty set, not null', () => {
    const keys = allowedLanguageKeysForNvidiaModel(CHINESE_TW, {
      'english-us': { bcp47: 'en-US', iso639: 'en' },
    });
    assert.ok(keys instanceof Set);
    assert.equal(keys.size, 0);
  });

  test('an empty table yields an empty set for a non-multilingual model', () => {
    const keys = allowedLanguageKeysForNvidiaModel(EN_ONLY, {});
    assert.ok(keys instanceof Set);
    assert.equal(keys.size, 0);
  });
});

describe('allowedLanguageKeysForNvidiaModel — multilingual models', () => {
  const table = {
    auto: { bcp47: 'en-US', iso639: 'en' },
    'english-us': { bcp47: 'en-US', iso639: 'en' },
    'english-uk': { bcp47: 'en-GB', iso639: 'en' },
    'english-au': { bcp47: 'en-AU', iso639: 'en' },   // not a documented locale; en-US/en-GB have exact rows
    spanish: { bcp47: 'es-ES', iso639: 'es' },
    german: { bcp47: 'de-DE', iso639: 'de' },
    'portuguese-br': { bcp47: 'pt-BR', iso639: 'pt' },
    vietnamese: { bcp47: 'vi-VN', iso639: 'vi' },      // not supported by the multilingual models
    mandarin: { bcp47: 'zh-CN', iso639: 'zh' },        // not supported by the multilingual models
  };

  for (const id of [NEMOTRON_ML, PARAKEET_ML]) {
    test(`${id}: offers 'auto' plus every row matching a documented locale`, () => {
      const keys = allowedLanguageKeysForNvidiaModel(id, table);
      assert.deepEqual(sorted(keys), [
        'auto', 'english-uk', 'english-us', 'german', 'portuguese-br', 'spanish',
      ]);
    });
  }

  test("'auto' is offered even when the table has no auto row or is empty", () => {
    assert.deepEqual(sorted(allowedLanguageKeysForNvidiaModel(PARAKEET_ML, {})), ['auto']);
    assert.deepEqual(
      sorted(allowedLanguageKeysForNvidiaModel(PARAKEET_ML, { german: { bcp47: 'de-DE' } })),
      ['auto', 'german'],
    );
  });

  test('a locale with an exact row and a sibling locale without one are resolved independently', () => {
    // es-ES has an exact row; es-US (also documented) has none and falls back
    // to the `es` subtag, which pulls in the Mexican row as well.
    const keys = allowedLanguageKeysForNvidiaModel(PARAKEET_ML, {
      spanish: { bcp47: 'es-ES', iso639: 'es' },
      'spanish-mx': { bcp47: 'es-MX', iso639: 'es' },
    });
    assert.deepEqual(sorted(keys), ['auto', 'spanish', 'spanish-mx']);
  });
});

describe('allowedLanguageKeysForNvidiaModel — purity', () => {
  test('does not mutate the table and returns a fresh Set each call', () => {
    const table = {
      auto: { bcp47: 'en-US', iso639: 'en' },
      'english-us': { bcp47: 'en-US', iso639: 'en' },
    };
    const snapshot = JSON.parse(JSON.stringify(table));
    const a = allowedLanguageKeysForNvidiaModel(EN_ONLY, table);
    const b = allowedLanguageKeysForNvidiaModel(EN_ONLY, table);
    assert.deepEqual(table, snapshot);
    assert.notEqual(a, b);
    a.add('junk');
    assert.equal(allowedLanguageKeysForNvidiaModel(EN_ONLY, table).has('junk'), false);
  });

  test('every catalogue model resolves to a Set against a realistic table', () => {
    const table = {
      auto: { bcp47: 'en-US', iso639: 'en' },
      'english-us': { bcp47: 'en-US', iso639: 'en' },
      spanish: { bcp47: 'es-ES', iso639: 'es' },
      mandarin: { bcp47: 'zh-CN', iso639: 'zh' },
      vietnamese: { bcp47: 'vi-VN', iso639: 'vi' },
    };
    for (const m of NVIDIA_NIM_STT_MODELS) {
      const keys = allowedLanguageKeysForNvidiaModel(m.id, table);
      assert.ok(keys instanceof Set, m.id);
      assert.equal(keys.has('auto'), m.multilingual, m.id);
      assert.ok([...keys].some((k) => k !== 'auto'), `${m.id}: no concrete language offered`);
    }
  });
});
