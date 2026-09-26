// The overlay's model selector shows at most 16 characters of a model name,
// spaces included, and hides the rest with no ellipsis.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { modelSelectorLabelText, MODEL_SELECTOR_MAX_CHARS } = await import('../modelSelectorLabelText.ts');

test('the limit is 16 characters', () => {
    assert.equal(MODEL_SELECTOR_MAX_CHARS, 16);
});

test('a longer name keeps its first 16 characters and gains no ellipsis', () => {
    assert.equal(modelSelectorLabelText('gemini-3.1-flash-lite-preview'), 'gemini-3.1-flash');
    assert.equal(modelSelectorLabelText('DeepSeek V4.1 Flash'), 'DeepSeek V4.1 Fl');
});

test('spaces count toward the 16', () => {
    assert.equal(modelSelectorLabelText('Gemini 3.1 Flash Lite'), 'Gemini 3.1 Flash');
});

test('a name of exactly 16 characters is shown whole', () => {
    assert.equal(modelSelectorLabelText('Gemini 3.8 Flash'), 'Gemini 3.8 Flash');
});

test('a shorter name is unchanged', () => {
    assert.equal(modelSelectorLabelText('GPT 5.4'), 'GPT 5.4');
    assert.equal(modelSelectorLabelText(''), '');
});

test('a cut that lands after a space does not leave a trailing space', () => {
    assert.equal(modelSelectorLabelText('Groq GPT-OSS 12 0B'), 'Groq GPT-OSS 12');
});

test('an astral character counts as one and is never split', () => {
    assert.equal(modelSelectorLabelText('🚀 local-model-xyz-long'), '🚀 local-model-xy');
});
