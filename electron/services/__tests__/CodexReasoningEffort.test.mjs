import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseCodexModelsPayload, activateCodexModelCatalogForTest, resetCodexCatalogForTest } from '../../../dist-electron/electron/services/CodexModelCatalog.js';
import { resolveCodexReasoningEffort } from '../../../dist-electron/electron/services/CodexCliService.js';

describe('resolveCodexReasoningEffort — provider-derived capabilities', () => {
  test('accepts advertised values including future levels without a code change', () => {
    resetCodexCatalogForTest();
    const catalog = parseCodexModelsPayload({ models: [{
      slug: 'gpt-current', visibility: 'list', default_reasoning_level: 'medium',
      supported_reasoning_levels: [
        { effort: 'low' }, { effort: 'medium' }, { effort: 'xhigh' }, { effort: 'ultra' },
      ],
    }] });
    activateCodexModelCatalogForTest(catalog.models, 'test-account');
    assert.equal(resolveCodexReasoningEffort('gpt-current', 'low'), 'low');
    assert.equal(resolveCodexReasoningEffort('gpt-current', 'ultra'), 'ultra');
  });

  test('uses the provider default when a persisted value is no longer advertised', () => {
    resetCodexCatalogForTest();
    const catalog = parseCodexModelsPayload({ models: [{
      slug: 'gpt-current', visibility: 'list', default_reasoning_level: 'medium',
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }],
    }] });
    activateCodexModelCatalogForTest(catalog.models, 'test-account');
    assert.equal(resolveCodexReasoningEffort('gpt-current', 'retired-level'), 'medium');
  });

  test('uses the first reasoning level when the provider omits a default', () => {
    resetCodexCatalogForTest();
    const catalog = parseCodexModelsPayload({ models: [{
      slug: 'gpt-current', visibility: 'list',
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }],
    }] });
    activateCodexModelCatalogForTest(catalog.models, 'test-account');
    assert.equal(resolveCodexReasoningEffort('gpt-current', 'unsupported'), 'low');
  });

  test('unknown models and empty selections omit the override', () => {
    resetCodexCatalogForTest();
    assert.equal(resolveCodexReasoningEffort('future-model', 'ultra'), undefined);
    assert.equal(resolveCodexReasoningEffort('future-model', undefined), undefined);
    assert.equal(resolveCodexReasoningEffort('future-model', null), undefined);
    assert.equal(resolveCodexReasoningEffort('future-model', ''), undefined);
  });

  test('activating a new catalogue removes capabilities from the old account', () => {
    resetCodexCatalogForTest();
    const first = parseCodexModelsPayload({ models: [{ slug: 'account-a-model', visibility: 'list', supported_reasoning_levels: [{ effort: 'ultra' }] }] });
    activateCodexModelCatalogForTest(first.models, 'test-account');
    assert.equal(resolveCodexReasoningEffort('account-a-model', 'ultra'), 'ultra');
    const second = parseCodexModelsPayload({ models: [{ slug: 'account-b-model', visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }] }] });
    activateCodexModelCatalogForTest(second.models, 'test-account');
    assert.equal(resolveCodexReasoningEffort('account-a-model', 'ultra'), undefined);
  });
});
