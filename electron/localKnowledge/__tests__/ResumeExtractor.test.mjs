// Tests for structured resume extraction (task 5).
//
// The model-backed path is exercised with an injected fetch, so these tests
// need no running Ollama and stay deterministic. What they mostly guard is the
// contract the free tree imposes on the stored profile, because breaking it
// fails silently rather than loudly: a date in the wrong format does not throw,
// it just makes every tenure answer disappear.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const dist = (rel) => path.join(repoRoot, 'dist-electron/electron/localKnowledge', rel);

const {
  normalizeYearMonth,
  isOngoing,
  sortExperienceMostRecentFirst,
  buildSkillsFlat,
  canonicalizeProfile,
  isUsableProfile,
} = require(dist('profileNormalization.js'));
const { extractStructuredProfile, heuristicExtract } = require(dist('ResumeExtractor.js'));
const { readLocalDocument } = require(dist('DocumentReader.js'));
const { DocType } = require(dist('types.js'));

const NOW = new Date('2026-08-17T00:00:00Z');
const CANONICAL_DATE = /^\d{4}-\d{2}$/;

/** Minimal fetch stub: maps a URL substring to a canned response. */
function stubFetch(routes) {
  return async (url) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) throw new Error(`unexpected request to ${url}`);
    const route = routes[key];
    if (typeof route === 'function') return route();
    return {
      ok: route.ok !== false,
      status: route.status ?? 200,
      json: async () => route.json,
      text: async () => route.text ?? JSON.stringify(route.json ?? ''),
    };
  };
}

const chatReply = (payload) => ({ json: { message: { content: typeof payload === 'string' ? payload : JSON.stringify(payload) } } });

describe('normalizeYearMonth', () => {
  test('accepts the formats resumes actually use', () => {
    assert.equal(normalizeYearMonth('2024-06'), '2024-06');
    assert.equal(normalizeYearMonth('2024-6'), '2024-06');
    assert.equal(normalizeYearMonth('2024-06-15'), '2024-06');
    assert.equal(normalizeYearMonth('2024/06'), '2024-06');
    assert.equal(normalizeYearMonth('06/2024'), '2024-06');
    assert.equal(normalizeYearMonth('6-2024'), '2024-06');
    assert.equal(normalizeYearMonth('June 2024'), '2024-06');
    assert.equal(normalizeYearMonth('Jun. 2024'), '2024-06');
    assert.equal(normalizeYearMonth('SEPT 2024'), '2024-09');
    assert.equal(normalizeYearMonth('2024 June'), '2024-06');
  });

  test('refuses a bare year rather than inventing a month', () => {
    // Inventing January would produce a tenure answer that reads as precise
    // and is wrong by up to 11 months.
    assert.equal(normalizeYearMonth('2024'), undefined);
  });

  test('rejects impossible and unparseable values', () => {
    assert.equal(normalizeYearMonth('2024-13'), undefined);
    assert.equal(normalizeYearMonth('Smarch 2024'), undefined);
    assert.equal(normalizeYearMonth(''), undefined);
    assert.equal(normalizeYearMonth(null), undefined);
    assert.equal(normalizeYearMonth(42), undefined);
  });

  test('treats ongoing markers as no date', () => {
    for (const word of ['Present', 'current', 'NOW', 'ongoing']) {
      assert.equal(isOngoing(word), true, word);
      assert.equal(normalizeYearMonth(word), undefined, word);
    }
    assert.equal(isOngoing('2024-06'), false);
  });
});

describe('sortExperienceMostRecentFirst', () => {
  test('puts the ongoing role first, because readers treat entry zero as current', () => {
    const sorted = sortExperienceMostRecentFirst(
      [
        { role: 'Older', start_date: '2019-01', end_date: '2021-01' },
        { role: 'Ongoing', start_date: '2024-01' },
        { role: 'Recent', start_date: '2022-01', end_date: '2023-06' },
      ],
      NOW,
    );
    assert.deepEqual(sorted.map((e) => e.role), ['Ongoing', 'Recent', 'Older']);
  });

  test('keeps undated entries last, in their original order', () => {
    const sorted = sortExperienceMostRecentFirst(
      [
        { role: 'NoDateA' },
        { role: 'Dated', start_date: '2020-01', end_date: '2021-01' },
        { role: 'NoDateB' },
      ],
      NOW,
    );
    assert.deepEqual(sorted.map((e) => e.role), ['Dated', 'NoDateA', 'NoDateB']);
  });
});

describe('buildSkillsFlat', () => {
  test('flattens categories and removes case-insensitive duplicates', () => {
    const flat = buildSkillsFlat({ languages: ['Python', 'Go'], tools: ['go', 'Docker'] });
    assert.deepEqual(flat, ['Python', 'Go', 'Docker']);
  });
});

describe('canonicalizeProfile', () => {
  test('accepts the field aliases a local model emits', () => {
    const profile = canonicalizeProfile(
      {
        name: 'Ada Lovelace',
        experience: [{ title: 'Staff Engineer', employer: 'Acme', start_date: 'March 2022', end_date: 'Present' }],
        projects: [{ title: 'Analytical Engine', summary: 'A machine', techStack: ['Gears'] }],
        education: [{ qualification: 'BSc', school: 'Example University', major: 'Mathematics' }],
      },
      { now: NOW, extractionMode: 'local_llm' },
    );

    assert.equal(profile.experience[0].role, 'Staff Engineer');
    assert.equal(profile.experience[0].company, 'Acme');
    assert.equal(profile.projects[0].name, 'Analytical Engine');
    assert.deepEqual(profile.projects[0].technologies, ['Gears']);
    assert.equal(profile.education[0].degree, 'BSc');
    assert.equal(profile.education[0].institution, 'Example University');
    assert.equal(profile.education[0].field, 'Mathematics');
  });

  test('omits end_date for an ongoing role instead of writing Present', () => {
    // The readers resolve a missing end to now. The literal string "Present"
    // fails the strict date parse and would disable the tenure answer.
    const profile = canonicalizeProfile(
      { experience: [{ role: 'Engineer', company: 'Acme', start_date: '2022-03', end_date: 'Present' }] },
      { now: NOW, extractionMode: 'local_llm' },
    );
    assert.equal(profile.experience[0].start_date, '2022-03');
    assert.equal('end_date' in profile.experience[0], false);
  });

  test('writes the name at both places the readers look', () => {
    const profile = canonicalizeProfile({ identity: { name: 'Ada Lovelace' } }, { now: NOW, extractionMode: 'local_llm' });
    assert.equal(profile.identity.name, 'Ada Lovelace');
    assert.equal(profile.name, 'Ada Lovelace');
  });

  test('records no duration or years-of-experience field', () => {
    // Durations are computed at query time from the dates. A stored number
    // would be a second source of truth that goes stale the next month.
    const profile = canonicalizeProfile(
      { name: 'Ada', experience: [{ role: 'Engineer', company: 'Acme', start_date: '2020-01', end_date: '2022-01' }], years_of_experience: 12 },
      { now: NOW, extractionMode: 'local_llm' },
    );
    const serialized = JSON.stringify(profile);
    assert.ok(!serialized.includes('years_of_experience'), 'must not store a derived duration');
    assert.ok(!serialized.includes('"12"') && !serialized.includes(':12'), 'must not carry the derived number');
  });

  test('drops entries with neither a role nor a company', () => {
    const profile = canonicalizeProfile(
      { experience: [{ bullets: ['did things'] }, { role: 'Engineer' }] },
      { now: NOW, extractionMode: 'local_llm' },
    );
    assert.equal(profile.experience.length, 1);
  });

  test('survives junk input without throwing', () => {
    for (const junk of [null, undefined, 'a string', 42, [], { experience: 'not an array' }]) {
      const profile = canonicalizeProfile(junk, { now: NOW, extractionMode: 'heuristic' });
      assert.equal(isUsableProfile(profile), false);
    }
  });

  test('every emitted date is in the strict format the readers parse', () => {
    const profile = canonicalizeProfile(
      {
        name: 'Ada',
        experience: [
          { role: 'A', company: 'X', start_date: 'June 2024', end_date: 'Present' },
          { role: 'B', company: 'Y', start_date: '01/2020', end_date: '2021-12-31' },
          { role: 'C', company: 'Z', start_date: '2019', end_date: 'garbage' },
        ],
      },
      { now: NOW, extractionMode: 'local_llm' },
    );
    for (const entry of profile.experience) {
      if (entry.start_date) assert.match(entry.start_date, CANONICAL_DATE);
      if (entry.end_date) assert.match(entry.end_date, CANONICAL_DATE);
    }
  });
});

describe('extractStructuredProfile with a local model', () => {
  const resume = { content: 'Ada Lovelace\nStaff Engineer at Acme, March 2022 - Present\n' };

  test('uses the model output when it is usable', async () => {
    const result = await extractStructuredProfile(resume, {
      now: NOW,
      model: 'llama3',
      fetchImpl: stubFetch({
        '/api/chat': chatReply({
          name: 'Ada Lovelace',
          experience: [{ role: 'Staff Engineer', company: 'Acme', start_date: '2022-03', end_date: 'Present' }],
        }),
      }),
    });

    assert.equal(result.extractionMode, 'local_llm');
    assert.equal(result.structured_data.name, 'Ada Lovelace');
    assert.equal(result.structured_data._extraction_mode, 'local_llm');
    assert.deepEqual(result.warnings, []);
  });

  test('recovers JSON wrapped in a code fence', async () => {
    const result = await extractStructuredProfile(resume, {
      now: NOW,
      model: 'llama3',
      fetchImpl: stubFetch({
        '/api/chat': chatReply('Here you go:\n```json\n{"name":"Ada Lovelace"}\n```'),
      }),
    });
    assert.equal(result.extractionMode, 'local_llm');
    assert.equal(result.structured_data.name, 'Ada Lovelace');
  });

  test('picks the first installed model when none is specified', async () => {
    let chatModel = null;
    const result = await extractStructuredProfile(resume, {
      now: NOW,
      fetchImpl: async (url, init) => {
        if (String(url).includes('/api/tags')) {
          return { ok: true, json: async () => ({ models: [{ name: 'qwen3:8b' }, { name: 'llama3' }] }) };
        }
        chatModel = JSON.parse(init.body).model;
        return { ok: true, json: async () => ({ message: { content: '{"name":"Ada Lovelace"}' } }) };
      },
    });
    assert.equal(chatModel, 'qwen3:8b');
    assert.equal(result.extractionMode, 'local_llm');
  });

  test('sends JSON mode and a zero temperature, so re-ingesting is reproducible', async () => {
    let body = null;
    await extractStructuredProfile(resume, {
      now: NOW,
      model: 'llama3',
      fetchImpl: async (url, init) => {
        body = JSON.parse(init.body);
        return { ok: true, json: async () => ({ message: { content: '{"name":"Ada Lovelace"}' } }) };
      },
    });
    assert.equal(body.format, 'json');
    assert.equal(body.stream, false);
    assert.equal(body.options.temperature, 0);
  });
});

describe('extractStructuredProfile without a usable model', () => {
  const resume = {
    content: [
      'Ada Lovelace',
      'ada@example.com | +1 555 0100',
      '',
      'EXPERIENCE',
      'Staff Engineer, Acme Corp    March 2022 - Present',
      '- Built the analytical engine pipeline',
      '- Cut latency by half',
      'Senior Engineer, Difference Ltd    Jan 2019 - Feb 2022',
      '- Led the punch card migration',
      '',
      'EDUCATION',
      'BSc Mathematics, Example University',
      '',
      'SKILLS',
      'Languages: Python, Go, Rust',
      'Tools: Docker, Kubernetes',
    ].join('\n'),
  };

  test('falls back to deterministic parsing when the model call fails', async () => {
    const result = await extractStructuredProfile(resume, {
      now: NOW,
      model: 'llama3',
      fetchImpl: stubFetch({ '/api/chat': { ok: false, status: 500, text: 'boom' } }),
    });

    assert.equal(result.extractionMode, 'heuristic');
    assert.equal(result.structured_data.name, 'Ada Lovelace');
    assert.equal(result.structured_data._extraction_mode, 'heuristic');
    assert.match(result.warnings.join(' '), /deterministic parsing/);
  });

  test('falls back when no model is installed', async () => {
    const result = await extractStructuredProfile(resume, {
      now: NOW,
      fetchImpl: stubFetch({ '/api/tags': { json: { models: [] } } }),
    });
    assert.equal(result.extractionMode, 'heuristic');
    assert.match(result.warnings.join(' '), /No local chat model is installed/);
  });

  test('deterministic parsing finds the name, roles, dates, and skills', async () => {
    const result = await extractStructuredProfile(resume, {
      now: NOW,
      fetchImpl: stubFetch({ '/api/tags': { json: { models: [] } } }),
    });
    const profile = result.structured_data;

    assert.equal(profile.name, 'Ada Lovelace');
    assert.ok(profile.experience.length >= 2, 'expected both roles');
    // The ongoing role sorts first and carries no end_date.
    assert.equal(profile.experience[0].start_date, '2022-03');
    assert.equal('end_date' in profile.experience[0], false);
    assert.ok(profile.experience[0].bullets.length >= 2);
    assert.ok(profile.skills_flat.includes('Python'));
    assert.ok(profile.skills_flat.includes('Docker'));
    assert.equal(profile.education[0].institution, 'Example University');
  });

  test('returns an empty profile with a reason rather than throwing on unreadable text', async () => {
    const result = await extractStructuredProfile(
      { content: 'zzz\nqqq\n' },
      { now: NOW, fetchImpl: stubFetch({ '/api/tags': { json: { models: [] } } }) },
    );
    assert.equal(result.extractionMode, 'heuristic');
    assert.equal(isUsableProfile(result.structured_data), false);
    assert.match(result.warnings.join(' '), /No profile fields could be read/);
  });
});

describe('extractStructuredProfile on a real resume file', () => {
  test('deterministic parsing of the PDF fixture emits only canonical dates', async () => {
    const fixture = path.join(repoRoot, 'test-fixtures/profiles/p01/resume.pdf');
    const read = await readLocalDocument(fixture, DocType.RESUME);
    assert.equal(read.success, true, read.error);

    const result = await extractStructuredProfile(read.document, {
      now: NOW,
      fetchImpl: stubFetch({ '/api/tags': { json: { models: [] } } }),
    });

    // The fixture's contents are not asserted, because a heuristic parser's
    // recall on an arbitrary layout is not a contract. The date format is.
    for (const entry of result.structured_data.experience ?? []) {
      if (entry.start_date) assert.match(entry.start_date, CANONICAL_DATE);
      if (entry.end_date) assert.match(entry.end_date, CANONICAL_DATE);
    }
    assert.equal(result.extractionMode, 'heuristic');
  });
});

describe('local model selection', () => {
  test('skips an embedding model and picks a chat model', async () => {
    // Verified against a real install: nomic-embed-text sits in the same list
    // as the chat models, and sending it a chat request fails.
    let chatModel = null;
    await extractStructuredProfile({ content: 'Ada Lovelace' }, {
      now: NOW,
      fetchImpl: async (url, init) => {
        if (String(url).includes('/api/tags')) {
          return {
            ok: true,
            json: async () => ({
              models: [
                { name: 'nomic-embed-text:latest', capabilities: ['embedding'] },
                { name: 'gemma4:12b', capabilities: ['completion', 'tools'] },
              ],
            }),
          };
        }
        chatModel = JSON.parse(init.body).model;
        return { ok: true, json: async () => ({ message: { content: '{"name":"Ada Lovelace"}' } }) };
      },
    });
    assert.equal(chatModel, 'gemma4:12b');
  });

  test('reports no chat model when only an embedding model is installed', async () => {
    const result = await extractStructuredProfile({ content: 'Ada Lovelace' }, {
      now: NOW,
      fetchImpl: stubFetch({
        '/api/tags': { json: { models: [{ name: 'nomic-embed-text:latest', capabilities: ['embedding'] }] } },
      }),
    });
    assert.equal(result.extractionMode, 'heuristic');
    assert.match(result.warnings.join(' '), /No local chat model is installed/);
  });

  test('turns thinking off for a reasoning model, and omits the field otherwise', async () => {
    // A reasoning model spends its whole budget thinking before emitting the
    // object: gemma4:12b-mlx hit the 120s timeout on a 335-character resume.
    const bodies = [];
    const runWith = async (capabilities) => {
      await extractStructuredProfile({ content: 'Ada Lovelace' }, {
        now: NOW,
        fetchImpl: async (url, init) => {
          if (String(url).includes('/api/tags')) {
            return { ok: true, json: async () => ({ models: [{ name: 'm', capabilities }] }) };
          }
          bodies.push(JSON.parse(init.body));
          return { ok: true, json: async () => ({ message: { content: '{"name":"Ada Lovelace"}' } }) };
        },
      });
    };

    await runWith(['completion', 'thinking']);
    assert.equal(bodies[0].think, false);

    await runWith(['completion']);
    assert.equal('think' in bodies[1], false);
  });
});

describe('date precision reporting', () => {
  test('warns when a role has no month-level dates instead of failing silently', async () => {
    const result = await extractStructuredProfile({ content: 'x' }, {
      now: NOW,
      model: 'llama3',
      fetchImpl: stubFetch({
        '/api/chat': chatReply({
          name: 'Ada Lovelace',
          // A year-only range, which is what the real PDF fixture contains.
          experience: [{ role: 'Engineer', company: 'Acme', start_date: '2021', end_date: '2026' }],
        }),
      }),
    });

    assert.equal(result.structured_data.experience[0].company, 'Acme');
    assert.equal('start_date' in result.structured_data.experience[0], false);
    assert.match(result.warnings.join(' '), /no month-level dates/);
  });
});

describe('heuristic parsing details', () => {
  test('does not keep the brackets that wrapped a date range', async () => {
    // Real regression: "Northwind Systems (2021-2026)" was stored as the
    // company "Northwind Systems ()".
    const parsed = heuristicExtract(
      ['EXPERIENCE', 'Staff Engineer, Northwind Systems (2021-2026)', '- Did the work'].join('\n'),
    );
    assert.equal(parsed.experience[0].company, 'Northwind Systems');
    assert.equal(parsed.experience[0].role, 'Staff Engineer');
  });
});

describe('skill category handling', () => {
  test('collapses a category-per-skill result into one list', () => {
    // Observed from a real local model: a resume with no skill headings came
    // back as {"SQL":["SQL"],"Tableau":["Tableau"],"Python":["Python"]}.
    const profile = canonicalizeProfile(
      { name: 'Ada', skills: { SQL: ['SQL'], Tableau: ['Tableau'], Python: ['Python'] } },
      { now: NOW, extractionMode: 'local_llm' },
    );
    assert.deepEqual(Object.keys(profile.skills), ['skills']);
    assert.deepEqual(profile.skills.skills, ['SQL', 'Tableau', 'Python']);
    assert.deepEqual(profile.skills_flat, ['SQL', 'Tableau', 'Python']);
  });

  test('keeps genuine categories intact', () => {
    const profile = canonicalizeProfile(
      { name: 'Ada', skills: { languages: ['Python', 'Go'], tools: ['Docker'] } },
      { now: NOW, extractionMode: 'local_llm' },
    );
    assert.deepEqual(Object.keys(profile.skills).sort(), ['languages', 'tools']);
  });
});
