// The overlay's model dropdown groups its flat list under provider headers and
// drops the "(Local)"-style tags the header now says.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { groupModelOptions, modelSelectorRowLabel, modelSelectorGroupLabel } = await import('../modelSelectorGroups.ts');

test('consecutive models of one provider form one section, in list order', () => {
    const groups = groupModelOptions([
        { id: 'natively', name: 'Natively API', type: 'cloud', provider: 'natively' },
        { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', type: 'cloud', provider: 'gemini' },
        { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', type: 'cloud', provider: 'gemini' },
        { id: 'ollama-llama3.2:3b', name: 'llama3.2:3b (Local)', type: 'ollama' },
    ]);
    assert.deepEqual(groups.map(g => [g.label, g.rows.map(r => r.label)]), [
        ['Natively', ['Natively API']],
        ['Google', ['Gemini 3.8 Flash', 'Gemini 3.1 Pro']],
        ['Ollama', ['llama3.2:3b']],
    ]);
});

test('a provider that reappears opens a new section rather than reordering', () => {
    const groups = groupModelOptions([
        { id: 'a', name: 'A', type: 'cloud', provider: 'openai' },
        { id: 'b', name: 'B', type: 'custom' },
        { id: 'c', name: 'C', type: 'cloud', provider: 'openai' },
    ]);
    assert.deepEqual(groups.map(g => g.key), ['openai', 'custom', 'openai']);
});

test('only the known host tag is stripped, never the model\'s own parenthesis', () => {
    assert.equal(modelSelectorRowLabel({ id: 'x', name: 'Claude Sonnet 5 (OpenRouter)', type: 'cloud', provider: 'openrouter' }, 'openrouter'), 'Claude Sonnet 5');
    assert.equal(modelSelectorRowLabel({ id: 'x', name: 'GPT-OSS 20B (Nvidia Nim)', type: 'cloud', provider: 'nvidia_nim' }, 'nvidia_nim'), 'GPT-OSS 20B');
    assert.equal(modelSelectorRowLabel({ id: 'x', name: 'gpt-4o (LiteLLM)', type: 'cloud', provider: 'litellm' }, 'litellm'), 'gpt-4o');
    assert.equal(modelSelectorRowLabel({ id: 'x', name: 'Gemini 3 Pro (Antigravity)', type: 'cloud', provider: 'antigravity' }, 'antigravity'), 'Gemini 3 Pro');
    // Not a host tag: stays.
    assert.equal(modelSelectorRowLabel({ id: 'x', name: 'Mixtral (8x7B)', type: 'custom' }, 'custom'), 'Mixtral (8x7B)');
    // A tag belonging to another provider: stays.
    assert.equal(modelSelectorRowLabel({ id: 'x', name: 'Thing (Local)', type: 'custom' }, 'custom'), 'Thing (Local)');
});

test('Groq rows drop the host prefix, other families keep their name', () => {
    assert.equal(modelSelectorRowLabel({ id: 'x', name: 'Groq Qwen 3.8', type: 'cloud', provider: 'groq' }, 'groq'), 'Qwen 3.8');
    assert.equal(modelSelectorRowLabel({ id: 'x', name: 'DeepSeek V4.1 Flash', type: 'cloud', provider: 'deepseek' }, 'deepseek'), 'DeepSeek V4.1 Flash');
});

test('a label is never emptied by stripping', () => {
    assert.equal(modelSelectorRowLabel({ id: 'x', name: 'Groq', type: 'cloud', provider: 'groq' }, 'groq'), 'Groq');
    assert.equal(modelSelectorRowLabel({ id: 'x', name: ' (Local)', type: 'ollama' }, 'ollama'), '(Local)');
});

test('the bare Codex entry reads as the default under its header', () => {
    assert.equal(modelSelectorRowLabel({ id: 'codex-cli', name: 'OpenAI Codex (GPT-5.5)', type: 'codex-cli', provider: 'codex-cli' }, 'codex-cli'), 'Default (GPT-5.5)');
});

test('an unmapped provider still gets a readable header', () => {
    assert.equal(modelSelectorGroupLabel('some_new-gateway'), 'Some New Gateway');
});

test('a header that only repeats its single row is hidden', () => {
    const groups = groupModelOptions([
        { id: 'natively', name: 'Natively API', type: 'cloud', provider: 'natively' },
        { id: 'gpt-5.4', name: 'GPT 5.4', type: 'cloud', provider: 'openai' },
        { id: 'd1', name: 'DeepSeek V4.1 Flash', type: 'cloud', provider: 'deepseek' },
        { id: 'd2', name: 'DeepSeek V4 Pro', type: 'cloud', provider: 'deepseek' },
    ]);
    assert.deepEqual(groups.map(g => [g.label, g.showHeader]), [
        ['Natively', false],
        ['OpenAI', true],
        ['DeepSeek', true],
    ]);
});
