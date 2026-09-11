// Document-shape detection must recognise the layouts real users attach
// (2026-09-07).
//
// THE DEFECT, measured in Looking-for-Work with tests/fixtures/modes/
// looking-for-work attached: `lfw_jd.md` ("# Job description — AI Product
// Engineer @ Helio Labs", "Role: …", "Compensation range: 175–200k …") was
// typed REFERENCE_FILE — `\bjd\b` cannot see "jd" behind an underscore, and
// none of its lines were JD markers — so "What is the compensation range for
// the Helio Labs role?" planned JOB_DESCRIPTION, the file was dropped as
// PLANNED_TYPE_FILTER, and the profile's OTHER JD was quoted instead. The
// plain-text résumé (`lfw_resume.txt`, bare "Experience" / "Education" lines,
// no `#`) scored zero the same way.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { classifyDocShape, sourceTypeForFile } = await import(pathToFileURL(path.join(base, 'retrieval/mode-retrieval-port.js')).href);
const { MODE_POLICIES } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);

const FX = path.resolve(process.cwd(), 'tests/fixtures/modes');
const read = (p) => fs.readFileSync(path.join(FX, p), 'utf8');

describe('the shipped fixtures type correctly', () => {
  test('lfw_jd.md is a job description; lfw_resume.txt is a résumé', () => {
    assert.equal(classifyDocShape('lfw_jd.md', read('looking-for-work/lfw_jd.md')), 'job_description');
    assert.equal(classifyDocShape('lfw_resume.txt', read('looking-for-work/lfw_resume.txt')), 'resume');
    assert.equal(sourceTypeForFile('lfw_jd.md', read('looking-for-work/lfw_jd.md'), MODE_POLICIES['looking-for-work'].allowedSourceTypes), 'JOB_DESCRIPTION');
    assert.equal(sourceTypeForFile('lfw_resume.txt', read('looking-for-work/lfw_resume.txt'), MODE_POLICIES['looking-for-work'].allowedSourceTypes), 'RESUME');
  });
  test('recruiting_backend_jd.md is a job description', () => {
    assert.equal(classifyDocShape('recruiting_backend_jd.md', read('recruiting/recruiting_backend_jd.md')), 'job_description');
  });
  test('documents that are neither stay `other`', () => {
    for (const f of ['team-meet/team_meet_incident_postmortem.txt', 'sales/sales_playbook.txt', 'lecture/lecture_pde_syllabus.md', 'negotiation/neg_statement_of_work.txt', 'general/general_onboarding_checklist.txt']) {
      assert.equal(classifyDocShape(path.basename(f), read(f)), 'other', f);
    }
  });
  test('the interview-prep notes are not a résumé despite the mode', () => {
    assert.equal(classifyDocShape('lfw_interview_prep_notes.txt', read('looking-for-work/lfw_interview_prep_notes.txt')), 'other');
  });
});

describe('filename words behind underscores and content-only signals', () => {
  test('a name token wins when content does not contradict it', () => {
    assert.equal(classifyDocShape('acme_jd.pdf', 'Role: Engineer\nWe need someone great.'), 'job_description');
    assert.equal(classifyDocShape('john_smith_resume.pdf', 'John Smith\nExperience\nAcme, 2020'), 'resume');
  });
  test('content contradiction still overrides the name', () => {
    const jd = '# Job description\nMinimum qualifications\n- 3+ years of experience\nAbout the role';
    assert.equal(classifyDocShape('my_resume.md', jd), 'job_description');
  });
  test('a single stray word never retypes a document', () => {
    assert.equal(classifyDocShape('notes.md', 'Meeting notes\nWe discussed the experience of new hires.'), 'other');
    assert.equal(classifyDocShape('brief.md', 'Compensation for the vendor is discussed in section 3.'), 'other');
  });
});
