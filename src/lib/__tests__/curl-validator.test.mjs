// src/lib/__tests__/curl-validator.test.mjs
//
// Covers src/lib/curl-validator.ts — validateCurl(), the renderer-side check a
// custom-provider cURL template goes through before it can be saved. Exercised
// end to end through the real @bany/curl-to-json parser and the shared
// electron/utils/curlPlaceholderPolicy rules; nothing is mocked.
//
// Run: node --experimental-strip-types --test src/lib/__tests__/curl-validator.test.mjs
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCurl } from '../curl-validator.ts';

const EMPTY = 'Command cannot be empty.';
const NOT_CURL = "The command must start with 'curl'.";
const NO_TEXT = 'Your cURL must contain {{TEXT}} variable to inject the user message.';
const SYNTAX = 'Invalid cURL command syntax. Please check for typos.';

describe('validateCurl — empty input', () => {
  for (const [label, input] of [
    ['empty string', ''],
    ['spaces only', '    '],
    ['newlines and tabs only', '\n\t \n'],
    ['null', null],
    ['undefined', undefined],
  ]) {
    test(`${label} is rejected as empty`, () => {
      assert.deepEqual(validateCurl(input), { isValid: false, message: EMPTY });
    });
  }
});

describe('validateCurl — must be a curl command', () => {
  test('a different command is rejected even if it carries the placeholder', () => {
    assert.deepEqual(
      validateCurl(`wget https://api.example.com -d '{"p":"{{TEXT}}"}'`),
      { isValid: false, message: NOT_CURL },
    );
  });

  test('a bare URL is rejected', () => {
    assert.deepEqual(validateCurl('https://api.example.com/v1'), { isValid: false, message: NOT_CURL });
  });

  test('curl appearing later in the string does not count', () => {
    assert.deepEqual(validateCurl('sudo curl https://api.example.com'), { isValid: false, message: NOT_CURL });
  });

  test('the curl prefix is case-insensitive and tolerates leading whitespace', () => {
    const r = validateCurl(`  \n CURL https://api.example.com/v1 -d '{"p":"{{TEXT}}"}'`);
    assert.equal(r.isValid, true);
    assert.equal(r.json.url, 'https://api.example.com/v1');
  });
});

describe('validateCurl — {{TEXT}} placeholder presence', () => {
  test('a well-formed command without {{TEXT}} is rejected', () => {
    assert.deepEqual(
      validateCurl(`curl https://api.example.com/v1 -d '{"prompt":"hi"}'`),
      { isValid: false, message: NO_TEXT },
    );
  });

  test('another placeholder does not stand in for {{TEXT}}', () => {
    assert.deepEqual(
      validateCurl(`curl https://api.example.com/v1 -d '{"prompt":"{{PROMPT}}"}'`),
      { isValid: false, message: NO_TEXT },
    );
  });

  test('the placeholder name is case-sensitive', () => {
    assert.deepEqual(
      validateCurl(`curl https://api.example.com/v1 -d '{"prompt":"{{text}}"}'`),
      { isValid: false, message: NO_TEXT },
    );
  });

  test('single braces are not a placeholder', () => {
    assert.deepEqual(
      validateCurl(`curl https://api.example.com/v1 -d '{"prompt":"{TEXT}"}'`),
      { isValid: false, message: NO_TEXT },
    );
  });

  test('bare "curl" with nothing else is rejected', () => {
    const r = validateCurl('curl');
    assert.equal(r.isValid, false);
    assert.equal(r.json, undefined);
  });
});

describe('validateCurl — valid templates', () => {
  test('JSON body with {{TEXT}} is valid and returns the parsed request', () => {
    const r = validateCurl(
      `curl https://api.example.com/v1/chat -H "Content-Type: application/json" -H "Authorization: Bearer abc" -d '{"model":"m1","prompt":"{{TEXT}}"}'`,
    );
    assert.deepEqual(r, {
      isValid: true,
      json: {
        url: 'https://api.example.com/v1/chat',
        header: { 'Content-Type': 'application/json', Authorization: 'Bearer abc' },
        data: { model: 'm1', prompt: '{{TEXT}}' },
        method: 'POST',
      },
    });
    assert.equal('message' in r, false);
  });

  test('spacing inside the braces is tolerated ({{ TEXT }})', () => {
    const r = validateCurl(`curl https://api.example.com/v1 -d '{"prompt":"{{ TEXT }}"}'`);
    assert.equal(r.isValid, true);
    assert.deepEqual(r.json.data, { prompt: '{{ TEXT }}' });
  });

  test('placeholder nested deep inside the JSON body is valid', () => {
    const r = validateCurl(
      `curl -X POST https://api.example.com/v1 -d '{"messages":[{"role":"user","content":"{{TEXT}}"}]}'`,
    );
    assert.equal(r.isValid, true);
    assert.equal(r.json.method, 'POST');
    assert.deepEqual(r.json.data, { messages: [{ role: 'user', content: '{{TEXT}}' }] });
  });

  test('placeholder embedded in a longer string value is valid', () => {
    const r = validateCurl(`curl https://api.example.com/v1 -d '{"prompt":"Answer briefly: {{TEXT}}"}'`);
    assert.equal(r.isValid, true);
    assert.equal(r.json.data.prompt, 'Answer briefly: {{TEXT}}');
  });

  test('placeholder in a header reaches the wire, so it is valid', () => {
    const r = validateCurl(`curl https://api.example.com/v1 -H 'X-Prompt: {{TEXT}}'`);
    assert.equal(r.isValid, true);
    assert.deepEqual(r.json.header, { 'X-Prompt': '{{TEXT}}' });
  });

  test('multi-line command with backslash continuations is valid', () => {
    const r = validateCurl(
      [
        'curl https://api.example.com/v1 \\',
        '  -H "Content-Type: application/json" \\',
        `  -d '{"prompt":"{{TEXT}}"}'`,
      ].join('\n'),
    );
    assert.equal(r.isValid, true);
    assert.equal(r.json.url, 'https://api.example.com/v1');
    assert.deepEqual(r.json.data, { prompt: '{{TEXT}}' });
  });
});

describe('validateCurl — placeholder present in the text but never sent', () => {
  test('unquoted placeholder (invalid JSON body) gets the quoting diagnosis', () => {
    const r = validateCurl(`curl https://api.example.com/v1 -d '{"prompt": {{TEXT}}}'`);
    assert.equal(r.isValid, false);
    assert.match(r.message, /isn't valid JSON/);
    assert.match(r.message, /inside quotes/);
    assert.equal(r.json, undefined);
  });

  test('placeholder in a ?query= parameter gets the placement diagnosis', () => {
    const r = validateCurl(`curl 'https://api.example.com/v1?q={{TEXT}}'`);
    assert.equal(r.isValid, false);
    assert.match(r.message, /Put the prompt in a JSON body/);
    assert.match(r.message, /\?query= parameter is never sent/);
  });

  test('placeholder in a -F form field gets the placement diagnosis', () => {
    const r = validateCurl(`curl https://api.example.com/v1 -F 'prompt={{TEXT}}'`);
    assert.equal(r.isValid, false);
    assert.match(r.message, /Put the prompt in a JSON body/);
  });

  test('a lone % in the query string still yields the placement diagnosis, not a syntax error', () => {
    const r = validateCurl(`curl 'https://api.example.com/v1?discount=100%&q={{TEXT}}'`);
    assert.equal(r.isValid, false);
    assert.match(r.message, /Put the prompt in a JSON body/);
    assert.notEqual(r.message, SYNTAX);
  });
});

describe('validateCurl — parser failures', () => {
  test('a command the parser cannot handle reports a syntax error instead of throwing', () => {
    // No URL at all: the placeholder is the only positional argument.
    assert.deepEqual(validateCurl('curl {{TEXT}}'), { isValid: false, message: SYNTAX });
  });
});

describe('validateCurl — result shape', () => {
  test('every failure carries a non-empty message and no json', () => {
    const failures = [
      '',
      'wget x',
      `curl https://a.example -d '{"p":"hi"}'`,
      `curl https://a.example -d '{"p": {{TEXT}}}'`,
      `curl 'https://a.example?q={{TEXT}}'`,
      'curl {{TEXT}}',
    ];
    for (const input of failures) {
      const r = validateCurl(input);
      assert.equal(r.isValid, false, input);
      assert.equal(typeof r.message, 'string', input);
      assert.ok(r.message.length > 0, input);
      assert.equal('json' in r, false, input);
    }
  });

  test('validation is repeatable (no regex lastIndex state leaks between calls)', () => {
    const cmd = `curl https://api.example.com/v1 -d '{"prompt":"{{TEXT}}"}'`;
    for (let i = 0; i < 4; i++) assert.equal(validateCurl(cmd).isValid, true);
  });
});
