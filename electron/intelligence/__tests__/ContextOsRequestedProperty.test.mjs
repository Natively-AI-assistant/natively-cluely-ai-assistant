// Context OS Phase 2 — RequestedProperty detector.
//
// Deterministic, no LLM. Ambiguity returns 'unknown', never guessed.
//
// Run with: npm run build:electron && node --test electron/intelligence/__tests__/ContextOsRequestedProperty.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const co = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/index.js'));
const { detectRequestedProperty, textCanProveProperty } = co;

// ── Question → property matrix ──────────────────────────────────────────────

const CASES = [
  // phase_or_stage
  ['What are the four main phases of the project?', 'phase_or_stage'],
  ['Walk me through the pipeline stages.', 'phase_or_stage'],
  ['What methodology steps did they follow?', 'phase_or_stage'],
  // funding_source
  ['Who funded this research?', 'funding_source'],
  ['Was the project sponsored by anyone?', 'funding_source'],
  ['Did they receive a grant?', 'funding_source'],
  ['Who paid for the study?', 'funding_source'],
  // cost_or_price
  ['How much did the robot cost?', 'cost_or_price'],
  ['What was the budget?', 'cost_or_price'],
  ['Is it expensive to build?', 'cost_or_price'],
  // processor_or_controller
  ['Which controller does the robot use?', 'processor_or_controller'],
  ['What processor powers the system?', 'processor_or_controller'],
  ['What MCU is on the control board?', 'processor_or_controller'],
  // dataset_size
  ['How many samples are in the dataset?', 'dataset_size'],
  ['What dataset was used?', 'dataset_size'],
  ['How many demonstrations did they collect?', 'dataset_size'],
  // training_time
  ['How long did it take to train the model?', 'training_time'],
  ['How many epochs did training run?', 'training_time'],
  ['How many GPU hours were needed?', 'training_time'],
  // cloud_provider
  ['Which cloud provider hosts the service?', 'cloud_provider'],
  ['Is it running on AWS?', 'cloud_provider'],
  // human_participants
  ['How many human participants were in the study?', 'human_participants'],
  ['Did they run a user study?', 'human_participants'],
  // result_metric
  ['What were the results?', 'result_metric'],
  ['What accuracy did the model reach?', 'result_metric'],
  ['What was the success rate?', 'result_metric'],
  // field-specific physical measurements
  ['What is the total weight of the robot?', 'physical_weight'],
  ['How much does the humanoid robot weigh?', 'physical_weight'],
  ['How much is the net weight of the drone?', 'physical_weight'],
  ['What are the device dimensions?', 'physical_dimensions'],
  ['What working voltage is listed for the robot?', 'working_voltage'],
  ['What is the rated power requirement of the device?', 'power_requirement'],
  // hardware_component
  ['What hardware does the system use?', 'hardware_component'],
  ['Which sensors are mounted on the robot?', 'hardware_component'],
  // software_stack
  ['What frameworks did they use?', 'software_stack'],
  ['What is the tech stack?', 'software_stack'],
  // candidate_*
  ['What is my best project?', 'candidate_project'],
  ['Tell me about the projects on my resume.', 'candidate_project'],
  ['What are my strongest skills?', 'candidate_experience'],
  ['Do I have experience with Kubernetes?', 'candidate_experience'],
  ['Why am I a good fit for this role?', 'candidate_experience'],
  ['What is my name?', 'candidate_identity'],
  ['What is my current status?', 'candidate_identity'],
  // role_requirement
  ['What does the job description require?', 'role_requirement'],
  ['What are the role requirements?', 'role_requirement'],
  // unknown — ambiguity is NOT guessed
  ['Tell me more.', 'unknown'],
  ['Interesting, go on.', 'unknown'],
  ['What do you think about that?', 'unknown'],
];

for (const [question, expected] of CASES) {
  test(`detects ${expected}: "${question}"`, () => {
    assert.equal(detectRequestedProperty(question), expected);
  });
}

test('empty/whitespace questions return unknown', () => {
  assert.equal(detectRequestedProperty(''), 'unknown');
  assert.equal(detectRequestedProperty('   '), 'unknown');
  assert.equal(detectRequestedProperty(null), 'unknown');
});

test('candidate possessive shape beats document reading of the same noun', () => {
  // "my project" → candidate_project even though "project" alone is neutral,
  // and "phases of the project" (no possessive) is a document property.
  assert.equal(detectRequestedProperty('What is my best project?'), 'candidate_project');
  assert.equal(detectRequestedProperty('What are the phases of the project?'), 'phase_or_stage');
});

test('detector is deterministic (same input → same output across calls)', () => {
  for (let i = 0; i < 3; i++) {
    assert.equal(detectRequestedProperty('Who funded this research?'), 'funding_source');
  }
});

// ── Evidence vocabulary (Phase 5 substrate sanity) ──────────────────────────

test('collaboration text CANNOT prove funding_source', () => {
  const collab = 'This research was conducted in collaboration with Huawei Munich Research Center.';
  assert.equal(textCanProveProperty(collab, 'funding_source'), false);
});

test('funding text CAN prove funding_source', () => {
  assert.equal(textCanProveProperty('The work was funded by the National Science Foundation.', 'funding_source'), true);
  assert.equal(textCanProveProperty('Supported through a grant from DARPA.', 'funding_source'), true);
});

test('generic hardware overview CANNOT prove processor_or_controller', () => {
  const generic = 'The robot has two arms, a mobile base, and a suite of tactile pads.';
  assert.equal(textCanProveProperty(generic, 'processor_or_controller'), false);
  assert.equal(textCanProveProperty('The system is controlled by an NVIDIA Jetson Orin Nano compute unit.', 'processor_or_controller'), true);
});

test('project description CANNOT prove cost_or_price', () => {
  const desc = 'The project delivers an autonomous delivery robot for campus environments.';
  assert.equal(textCanProveProperty(desc, 'cost_or_price'), false);
  assert.equal(textCanProveProperty('The total budget was $12,000 including sensors.', 'cost_or_price'), true);
});

test('physical measurement proof is field-specific and accepts ordinary spec prose', () => {
  const topical = 'The robot has a lightweight carbon fiber shell and a dual-arm structure.';
  assert.equal(textCanProveProperty(topical, 'physical_weight'), false);
  assert.equal(textCanProveProperty('Total weight: 1,250 kilograms.', 'physical_weight'), true);
  assert.equal(textCanProveProperty('The robot weighs approximately 55 kg.', 'physical_weight'), true);
  assert.equal(textCanProveProperty('Overall dimensions (L x W x H): 500 x 300 x 200 mm.', 'physical_dimensions'), true);
  assert.equal(textCanProveProperty('Working voltage (V): 24.', 'working_voltage'), true);
  assert.equal(textCanProveProperty('The unit operates at 24V and draws up to 150W.', 'working_voltage'), true);
  assert.equal(textCanProveProperty('The unit operates at 24V and draws up to 150W.', 'power_requirement'), true);
  assert.equal(textCanProveProperty('Total weight: 55 kg.', 'working_voltage'), false);
  assert.equal(textCanProveProperty('Working Voltage (V)', 'working_voltage'), false);
  assert.equal(textCanProveProperty('Working voltage: 24 V.', 'physical_weight'), false);
});

test('ambiguous ML measurement nouns remain unknown rather than physical facts', () => {
  assert.equal(detectRequestedProperty('What weight decay was used during training?'), 'unknown');
  assert.equal(detectRequestedProperty('What is the depth of the neural network?'), 'unknown');
  assert.equal(detectRequestedProperty('What is the embedding dimension of the model?'), 'unknown');
  assert.equal(detectRequestedProperty('What is the width of the sliding window?'), 'unknown');
});

test('unknown property accepts any text (degrades to legacy behavior)', () => {
  assert.equal(textCanProveProperty('anything at all', 'unknown'), true);
});
