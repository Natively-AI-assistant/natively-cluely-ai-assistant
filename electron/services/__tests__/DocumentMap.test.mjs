// Tests for the Document Map (round-6 rebuild, 2026-06-29).
//
// buildDocumentMap parses + excludes the Table of Contents, detects real
// section headings (not ToC lines, not table rows, not bibliography), and
// returns a section tree with page ranges. resolveTargetSections maps a
// question to target section numbers from the section titles.
//
// These are BEHAVIOURAL tests against the compiled module — they exercise the
// real parser, not a source grep. They encode the exact failures round 6
// found on the real thesis PDF: ToC dotted-leader lines must NOT become
// sections; chapter numbers >12 must be detected; bibliography lines and prose
// ending in a number must NOT be mistaken for headings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

async function loadMap() {
  const p = path.resolve(repoRoot, 'dist-electron/electron/services/modes/DocumentMap.js');
  return import(pathToFileURL(p).href);
}

// A miniature thesis with a ToC + real sections + the failure modes.
const THESIS = [
  '[Page 1]',
  'Towards Connected Intelligence',
  'Master Thesis 2025',
  '[Page 5]',
  'Contents',
  '1 Introduction . . . . . . . . . . . . . . . . . . . . 7',
  '1.1 Research Questions . . . . . . . . . . . . . . . 8',
  '2.1.2 OpenVLA-OFT . . . . . . . . . . . . . . . . . 13',
  '2.4.2 ROS# . . . . . . . . . . . . . . . . . . . . . 20',
  '4.1 Evaluation metrics . . . . . . . . . . . . . . . 44',
  '[Page 7]',
  '1 Introduction',
  'This thesis studies Agentic AI frameworks with Vision-Language-Action models for embodied robotic systems.',
  '[Page 8]',
  '1.1 Research Questions',
  'RQ1: Can an Agentic AI Framework be combined with a Vision-Language-Action Model towards achieving AGI?',
  'RQ2: Can a network of AI Agents improve perception and decision-making of autonomous robots?',
  '[Page 13]',
  '2.1.2 OpenVLA-OFT',
  'OpenVLA-OFT is an improved version of OpenVLA that uses parallel decoding and action chunking and achieves 43x faster throughput.',
  '[Page 20]',
  '2.4.2 ROS#',
  'ROS# is a set of open-source C# libraries for communicating with ROS from .NET applications, in particular Unity.',
  '[Page 44]',
  '4.1 Evaluation metrics',
  'Success Rate and MSE were used as the primary evaluation metrics.',
].join('\n');

test('buildDocumentMap excludes the ToC and detects real sections', async () => {
  const { buildDocumentMap } = await loadMap();
  const map = buildDocumentMap(THESIS);
  assert.equal(map.hasToc, true, 'a thesis with dotted-leader ToC must set hasToc');
  assert.ok(map.tocLinesRemoved >= 5, `expected >=5 ToC lines removed, got ${map.tocLinesRemoved}`);
  const nums = map.sections.filter(s => s.num).map(s => s.num);
  assert.ok(nums.includes('1.1'), 'Research Questions section detected');
  assert.ok(nums.includes('2.1.2'), 'OpenVLA-OFT section detected');
  assert.ok(nums.includes('2.4.2'), 'ROS# section detected');
  assert.ok(nums.includes('4.1'), 'Evaluation metrics section detected');
});

test('ToC dotted-leader lines never become section bodies', async () => {
  const { buildDocumentMap } = await loadMap();
  const map = buildDocumentMap(THESIS);
  // The OpenVLA-OFT section body must be the REAL body, not the ToC line.
  const oft = map.sections.find(s => s.num === '2.1.2');
  assert.ok(oft, 'OpenVLA-OFT section exists');
  assert.match(oft.body, /parallel decoding|action chunking|43x/, 'body is the real section, not the ToC entry');
  assert.doesNotMatch(oft.body, /\.\s?\.\s?\.\s?\./, 'body must not contain ToC dotted leaders');
});

test('section bodies carry correct page ranges', async () => {
  const { buildDocumentMap } = await loadMap();
  const map = buildDocumentMap(THESIS);
  const rq = map.sections.find(s => s.num === '1.1');
  assert.equal(rq.pageStart, 8, 'Research Questions starts on page 8');
  const oft = map.sections.find(s => s.num === '2.1.2');
  assert.equal(oft.pageStart, 13, 'OpenVLA-OFT starts on page 13');
});

test('chapter numbers >12 are detected (no firstNum<=12 cap)', async () => {
  const { buildDocumentMap } = await loadMap();
  const map = buildDocumentMap('[Page 1]\n13 Future Work\nFuture directions.\n13.2 Limitations\nSeveral limitations exist.');
  const nums = map.sections.filter(s => s.num).map(s => s.num);
  assert.ok(nums.includes('13'), 'chapter 13 detected');
  assert.ok(nums.includes('13.2'), 'section 13.2 detected');
});

test('bibliography lines are NOT mistaken for headings', async () => {
  const { buildDocumentMap } = await loadMap();
  const map = buildDocumentMap('[Page 60]\n12 Smith et al 2021 Robotics survey\nsome reference text\n5 Doe and Roe 2019 Vision models');
  const nums = map.sections.filter(s => s.num).map(s => s.num);
  assert.equal(nums.length, 0, `bibliography lines must not become headings, got [${nums.join(',')}]`);
});

test('real headings with "pose" or a year survive (review HIGH fixes)', async () => {
  const { buildDocumentMap } = await loadMap();
  // "Pose Estimation" was dropped by an unbounded `pose` substring guard.
  const poseMap = buildDocumentMap('[Page 1]\n3.2 Pose Estimation\nWe estimate the 6-DOF pose of the gripper.');
  assert.ok(poseMap.sections.some(s => s.num === '3.2'), '"3.2 Pose Estimation" must be a section');
  // A pose DATA row (brackets/coords) must still be rejected.
  const poseRow = buildDocumentMap('[Page 1]\n24 Right arm pose [x, y, z, rx]\ndata');
  assert.ok(!poseRow.sections.some(s => s.num === '24'), 'pose data rows must not become sections');
  // Headings containing a year were dropped by a bare-year bibliography guard.
  const yearMap = buildDocumentMap('[Page 1]\n3.1 The 2020 Dataset\nWe used it.\n2.4 ImageNet-2012 Pretraining\nWe pretrain.');
  assert.ok(yearMap.sections.some(s => s.num === '3.1'), '"3.1 The 2020 Dataset" must survive');
  assert.ok(yearMap.sections.some(s => s.num === '2.4'), '"2.4 ImageNet-2012 Pretraining" must survive');
});

test('sectionAwareChunksFromMap keeps ToC navigation in one labelled chunk and excludes it from section bodies', async () => {
  const { buildDocumentMap, sectionAwareChunksFromMap } = await loadMap();
  const map = buildDocumentMap(THESIS);
  const chunks = sectionAwareChunksFromMap(map, 140, 30);
  assert.ok(Array.isArray(chunks) && chunks.length > 0, 'structured doc must yield section chunks');
  const tocChunks = chunks.filter(c => c.startsWith('[Table of Contents |'));
  assert.equal(tocChunks.length, 1, 'the full ToC is retained as one dedicated navigation chunk');
  assert.match(tocChunks[0], /2\.1\.2 OpenVLA-OFT/, 'navigation chunk retains structural entries');
  assert.ok(
    chunks.filter(c => !c.startsWith('[Table of Contents |')).every(c => !/\.\s?\.\s?\.\s?\./.test(c)),
    'ToC dotted leaders never leak into normal section chunks',
  );
  assert.ok(chunks.every(c => /^\[(Table of Contents|Section [\d.]+|p\d)/.test(c)), 'every chunk carries a provenance tag');
  // A flat-prose doc (no ToC) returns null so the caller keeps its word chunker.
  const flat = buildDocumentMap('Mercury X1 has 19 DOF. Sensors include LiDAR.');
  assert.equal(sectionAwareChunksFromMap(flat, 140, 30), null, 'flat prose → null (no section chunking)');
});

test('Table of Contents remains retrievable without becoming a document section', async () => {
  const { buildDocumentMap } = await loadMap();
  const map = buildDocumentMap(THESIS);
  assert.deepEqual(map.sections.filter(s => s.num === '2.1.2').map(s => s.heading), ['2.1.2 OpenVLA-OFT'], 'ToC entries do not create duplicate sections');
  assert.ok(map.tableOfContents, 'classic ToC documents retain a navigation representation');
  assert.match(map.tableOfContents.entries.join('\n'), /2\.1\.2 OpenVLA-OFT/, 'ToC entries retain their text');
  assert.equal(map.tableOfContents.pageStart, 5, 'ToC page provenance is retained');
});

test('selectTableOfContentsEntries returns direct structural navigation without leaking into topical routing', async () => {
  const { buildDocumentMap, selectTableOfContentsEntries } = await loadMap();
  const map = buildDocumentMap(THESIS);
  assert.match(
    selectTableOfContentsEntries('What is the title of Chapter 1?', map).join('\n'),
    /^1 Introduction/m,
    'chapter ordinal selects its explicit navigation entry',
  );
  assert.match(
    selectTableOfContentsEntries('According to the table of contents, what page begins ROS#?', map).join('\n'),
    /^2\.4\.2 ROS#/m,
    'section-title query selects its navigation entry',
  );
  assert.deepEqual(
    selectTableOfContentsEntries('What controller does the robot use?', map),
    [],
    'ordinary topical questions do not promote the Table of Contents',
  );
});

// Regression (2026-07-13): a top-level chapter entry printed with a SHORT title
// often carries no dotted leader — e.g. "1 Introduction 7" sitting directly above
// "1.1 Research Questions . . . 8". The ToC region previously began at the first
// dotted-leader line, so that chapter entry fell OUTSIDE it, was mis-parsed as a
// section heading, and never entered the navigation set — leaving "the title of
// Chapter 1" unanswerable while chapters 2+ (inside the region) resolved. The
// region must extend backward across contiguous "N Title <page>" navigation lines.
test('leading chapter entry with no dotted leader is captured as ToC navigation (Chapter-1 regression)', async () => {
  const { buildDocumentMap, selectTableOfContentsEntries } = await loadMap();
  const doc = [
    '[Page 5]',
    'Contents',
    '1 Introduction 7',                                   // no dotted leader — the failing shape
    '1.1 Research Questions . . . . . . . . . . . . . . 8',
    '1.2 Thesis Objectives . . . . . . . . . . . . . . . 8',
    '2 State of The Art and Background Overview 10',       // also leaderless, inside the block
    '2.1 Visual-Language-Action Models . . . . . . . . 10',
    '2.1.1 OpenVLA . . . . . . . . . . . . . . . . . . 12',
    '3 Research Methodology 25',
    '3.1 Robotic Raw Data Acquisition . . . . . . . . . 27',
    // Real section BODIES follow the ToC (as in any document) so the numbered-
    // section count reflects a real corpus, not just the navigation block.
    '[Page 7]',
    '1 Introduction',
    'This thesis studies Agentic AI frameworks for embodied robotic systems.',
    '[Page 10]',
    '2 State of The Art and Background Overview',
    'Prior work spans vision-language-action models and agentic systems.',
    '[Page 25]',
    '3 Research Methodology',
    'We describe the data acquisition and finetuning procedure.',
  ].join('\n');
  const map = buildDocumentMap(doc);
  const entries = map.tableOfContents?.entries ?? [];
  assert.ok(entries.some(e => /^1 Introduction 7$/.test(e)), 'the leaderless "1 Introduction 7" chapter entry must be captured as navigation');
  const chapter1 = selectTableOfContentsEntries('What is the title of Chapter 1?', map).join('\n');
  assert.match(chapter1, /^1 Introduction 7$/m, 'chapter-1 ordinal must select its own explicit navigation entry, not only subsections');
  // The real §1 Introduction body on page 7 must NOT be swallowed into the ToC.
  const introBody = map.sections.find(s => /Introduction/i.test(s.heading) && s.pageStart === 7);
  assert.ok(introBody && /Agentic AI frameworks/.test(introBody.body), 'the real chapter-1 body on page 7 must remain a section, not a ToC entry');
});

test('prose ending in a number is NOT dropped as a ToC line', async () => {
  const { buildDocumentMap } = await loadMap();
  // No ToC region here → the "N.N Title <page>" rule must not fire.
  const map = buildDocumentMap('[Page 2]\nThe Mercury X1 Robot has 19 degrees of freedom\nIt uses LiDAR and ultrasonic sensors');
  // Content must survive (be in some section body).
  const allBody = map.sections.map(s => s.body).join(' ');
  assert.match(allBody, /19 degrees of freedom/, 'prose ending in a number must survive');
  assert.match(allBody, /LiDAR and ultrasonic/, 'sensor prose must survive');
});

test('flat-prose doc with no ToC does NOT set hasToc', async () => {
  const { buildDocumentMap } = await loadMap();
  // The seminar fixtures are flat prose — no dotted ToC. hasToc must be false so
  // the retriever keeps the existing fineChunk path (no regression).
  const map = buildDocumentMap('Mercury X1 has 19 degrees of freedom. Sensors include LiDAR, ultrasonic, and 2D vision. OpenVLA-OFT uses parallel decoding.');
  assert.equal(map.hasToc, false, 'flat prose with no ToC must not trigger section-chunking');
});

// Round-6 generalization (2026-07-01): PDFs WITHOUT a dotted-leader Table of
// Contents but WITH ≥5 inline numbered section headings (modern two-column
// journals, slide-deck-derived PDFs, academic papers with numbered headings
// only) must also enter the section-aware chunking path. Without this, all
// such documents would fall through to the flat chunkText and lose section
// provenance + page-range fidelity.
test('numbered-headings-only doc (no ToC) sets hasToc when ≥5 sections exist (PATH B)', async () => {
  const { buildDocumentMap, sectionAwareChunksFromMap } = await loadMap();
  const doc = [
    '[Page 1]', '3.1 Methodology',
    'We used a randomized controlled trial design.',
    '[Page 3]', '3.2 Participants',
    '32 participants were recruited across three sites.',
    '[Page 5]', '3.3 Materials',
    'Standardized questionnaires were administered.',
    '[Page 7]', '3.4 Procedure',
    'Each session lasted approximately 45 minutes.',
    '[Page 9]', '3.5 Data Analysis',
    'Mixed-effects models were fitted using lme4.',
  ].join('\n');
  const map = buildDocumentMap(doc);
  assert.equal(map.hasToc, true, 'numbered-headings-only doc with ≥5 sections must set hasToc (round-6 PATH B)');
  assert.equal(map.tocLinesRemoved, 0, 'no dotted-leader lines means tocLinesRemoved stays 0 (PATH B is via numberedSections only)');
  const chunks = sectionAwareChunksFromMap(map, 140, 30);
  assert.ok(Array.isArray(chunks) && chunks.length > 0, 'numbered-headings-only doc must yield section chunks');
});

test('numbered-headings-only doc with 4 sections does NOT set hasToc (conservative threshold)', async () => {
  const { buildDocumentMap } = await loadMap();
  // 4 numbered sections falls below the ≥5 threshold — must stay flat so the
  // strict threshold doesn't false-positive on small docs with stray numbers.
  const doc = [
    '[Page 1]', '1 Introduction', 'intro text',
    '[Page 3]', '2 Background', 'background text',
    '[Page 5]', '3 Methods', 'methods text',
    '[Page 7]', '4 Results', 'results text',
  ].join('\n');
  const map = buildDocumentMap(doc);
  assert.equal(map.hasToc, false, '4-section numbered-only doc must NOT set hasToc (≥5 threshold)');
});

test('classic dotted-leader ToC path A still works after PATH B generalization', async () => {
  const { buildDocumentMap } = await loadMap();
  const map = buildDocumentMap(THESIS);
  assert.equal(map.hasToc, true, 'classic ToC path A still triggers hasToc');
  assert.ok(map.tocLinesRemoved >= 5, `PATH A still requires ≥5 ToC lines removed (got ${map.tocLinesRemoved})`);
});

test('PATH B rejects flat depth-1 lists (5+ single-digit headings → hasToc=false)', async () => {
  const { buildDocumentMap } = await loadMap();
  // A flat to-do list / FAQ format with 5+ single-digit numbered entries has
  // no multi-level depth, so PATH B's `&& hasMultiLevel` guard rejects it.
  // The user-facing harm of false-positives is bounded (graceful degrade), but
  // this guard eliminates the false-positive entirely.
  const todo = [
    '[Page 1]',
    '1 Buy groceries',
    '2 Walk the dog',
    '3 Call mom',
    '4 Pay bills',
    '5 Read thesis chapter',
    '6 Submit to advisor',
  ].join('\n');
  const map = buildDocumentMap(todo);
  assert.equal(map.hasToc, false, 'flat depth-1 list with 5+ entries must NOT set hasToc');
});

// Senior-review observability 2026-07-01: hasTocPath tells downstream
// telemetry whether the classic ToC path A triggered or the generalized
// PATH B triggered, so support can distinguish misclassification causes.
test('hasTocPath is "A" for classic dotted-leader ToC and "B" for numbered-headings-only', async () => {
  const { buildDocumentMap } = await loadMap();
  // PATH A: classic thesis with dotted-leader ToC
  const pathAMap = buildDocumentMap(THESIS);
  assert.equal(pathAMap.hasTocPath, 'A', 'THESIS fixture should set hasTocPath = "A" (classic ToC)');
  // PATH B: numbered-headings-only doc with multi-level depth
  const pathBMap = buildDocumentMap([
    '[Page 1]', '3.1 Methodology', 'methodology text',
    '[Page 3]', '3.2 Participants', 'participants text',
    '[Page 5]', '3.3 Materials', 'materials text',
    '[Page 7]', '3.4 Procedure', 'procedure text',
    '[Page 9]', '3.5 Data Analysis', 'analysis text',
  ].join('\n'));
  assert.equal(pathBMap.hasTocPath, 'B', 'multi-level numbered-only doc should set hasTocPath = "B"');
  // hasToc=false → hasTocPath=null
  const flatMap = buildDocumentMap('Mercury X1 has 19 degrees of freedom. Sensors include LiDAR.');
  assert.equal(flatMap.hasTocPath, null, 'flat prose should set hasTocPath = null');
});

test('resolveTargetSections maps questions to the right sections', async () => {
  const { buildDocumentMap, resolveTargetSections } = await loadMap();
  const map = buildDocumentMap(THESIS);
  assert.deepEqual(
    resolveTargetSections('What is OpenVLA-OFT?', map).slice(0, 1),
    ['2.1.2'],
    'OpenVLA-OFT question targets §2.1.2',
  );
  assert.ok(
    resolveTargetSections('What is the role of ROS#?', map).includes('2.4.2'),
    'ROS# question targets §2.4.2',
  );
  assert.ok(
    resolveTargetSections('What evaluation metrics were used?', map).includes('4.1'),
    'metrics question targets §4.1',
  );
  assert.ok(
    resolveTargetSections('What are the two research questions?', map).includes('1.1'),
    'research questions target §1.1',
  );
});

test('a single DISTINCTIVE title word targets strongly; a single GENERIC word does not steal targeting', async () => {
  const { buildDocumentMap, resolveTargetSections } = await loadMap();
  // Two sections share the generic word "robot"; only one has the distinctive
  // entity "ROS#". A query naming the distinctive word must hit its section.
  const doc = [
    '[Page 1]', 'Contents',
    '2.3 Robot Hardware . . . . . . . 16',
    '2.4 ROS# . . . . . . . . . . . . 20',
    '3.1 Robot Task Structure . . . . 30',
    '[Page 16]', '2.3 Robot Hardware',
    'The robot platform has a mobile base and arms.',
    '[Page 20]', '2.4 ROS#',
    'ROS# connects Unity to ROS nodes and topics.',
    '[Page 30]', '3.1 Robot Task Structure',
    'The robot performs a pick and place task in each episode.',
  ].join('\n');
  const map = buildDocumentMap(doc);
  // Distinctive single word "ros#" → its section.
  assert.ok(resolveTargetSections('What is the role of ROS#?', map).includes('2.4'), 'ROS# (distinctive) targets §2.4');
  // A query about the TASK must reach the task-body section via resolveByContent
  // (§3.1 "Robot Task Structure" — the body says "pick and place task"), NOT
  // be monopolised by a generic "robot" title match (§2.3/§3.1 share "robot",
  // df=1 per section only because one says "Robot" and the other "Robotic" —
  // spelling variation, not an entity signal). The hasSignalShape gate ensures
  // plain alphabetic df=1 tokens don't count as distinctive.
  const taskTargets = resolveTargetSections('What task did the robot perform?', map);
  assert.ok(taskTargets.includes('3.1'), `task query must target §3.1 (Robot Task Structure), got: [${taskTargets.join(',')}]`);
});

test('all-caps acronym in section title triggers distinctiveHit (RLDS, DOF, VLA)', async () => {
  const { buildDocumentMap, resolveTargetSections } = await loadMap();
  // Pure-alpha all-caps acronym RLDS should be treated as distinctive despite
  // tokenizeTitle lowercasing it to "rlds" (which has no non-[a-z] char).
  // Fix: tokenizeTitleOrigCase preserves case → /^[A-Z]{2,}$/ detects it.
  const doc = [
    '[Page 1]', 'Contents',
    '3.2.2 Data Collection . . . . . . 33',
    '3.2.3 Dataset Structure and Format . . . 34',
    '3.3 Training Pipeline . . . . . 36',
    '[Page 33]', '3.2.2 Data Collection',
    'Data was recorded during teleoperation sessions using the robotic arm.',
    '[Page 34]', '3.2.3 Dataset Structure and Format',
    'During data collection 1000 episodes were recorded. The data follows the Reinforcement Learning Dataset (RLDS) format. Each episode stores joint states, Cartesian position, and action arrays.',
    '[Page 36]', '3.3 Training Pipeline',
    'The training pipeline fine-tunes the model on collected data. Format and structure are preserved.',
  ].join('\n');
  const map = buildDocumentMap(doc);
  // §3.2.3 title has 2 content words ('dataset', 'format') → wordHits=2 → strongTitleTarget
  const formatTargets = resolveTargetSections('What format was the dataset stored in?', map);
  assert.ok(formatTargets.includes('3.2.3'), `format query must target §3.2.3, got: [${formatTargets.join(',')}]`);

  // All-caps DOF acronym in title §2.3.2 must also get distinctiveHit
  const doc2 = [
    '[Page 1]', 'Contents',
    '2.3.1 Robot Overview . . . . . 15',
    '2.3.2 DOF Specifications . . . 17',
    '2.4 Software . . . . . . . . . 20',
    '[Page 15]', '2.3.1 Robot Overview',
    'The Mercury X1 robot is a humanoid platform used for manipulation tasks.',
    '[Page 17]', '2.3.2 DOF Specifications',
    'The Mercury X1 has 19 DOF: 7 per arm, 2 in the waist, 3 in the head.',
    '[Page 20]', '2.4 Software',
    'Software stack uses ROS2 for robot control and communication.',
  ].join('\n');
  const map2 = buildDocumentMap(doc2);
  const dofTargets = resolveTargetSections('How many DOF does Mercury X1 have?', map2);
  assert.ok(dofTargets.includes('2.3.2'), `DOF query must target §2.3.2, got: [${dofTargets.join(',')}]`);
});

test('resolveByContent routes "many parameters" to intro section not fine-tuning (Q17 regression guard)', async () => {
  const { buildDocumentMap, resolveTargetSections } = await loadMap();
  // "many" must NOT be a content word — it appears in every large section body.
  // If it leaks through STOPWORDS, §3.3 wins because it says "many parameters,
  // many epochs" many times. The fix: add 'many' to STOPWORDS in resolveByContent.
  const doc = [
    '[Page 1]', 'Contents',
    '2.1 OpenVLA . . . . . . . . . 12',
    '2.1.1 OpenVLA Architecture . . 13',
    '3.3 Training Pipeline . . . . . 36',
    '[Page 12]', '2.1 OpenVLA',
    'OpenVLA is a 7B-parameter open-source vision-language-action model.',
    '[Page 13]', '2.1.1 OpenVLA Architecture',
    'The OpenVLA model has 7 billion parameters and is pretrained on BridgeData.',
    '[Page 36]', '3.3 Training Pipeline',
    'The fine-tuning pipeline adjusts many parameters over many epochs. Many samples were used. Many hyperparameters were tuned.',
  ].join('\n');
  const map = buildDocumentMap(doc);
  const targets = resolveTargetSections('How many parameters does OpenVLA have?', map);
  assert.ok(
    targets.some(t => t.startsWith('2.1')),
    `must target §2.1.x (7B-parameter section), got: [${targets.join(',')}]`,
  );
  assert.ok(
    !targets.some(t => t.startsWith('3.3')),
    `must NOT target §3.3 (fine-tuning — "many" is a noise word), got: [${targets.join(',')}]`,
  );
});

test('resolveByContent routes "Benchmark 1" to §4.2.1 not §4.2.2/4.2.3 (Q47 regression guard)', async () => {
  const { buildDocumentMap, resolveTargetSections } = await loadMap();
  // §4.2.1 title has NO "benchmark" word; §4.2.2 and §4.2.3 do.
  // The title-word tiebreak (+2.0) must not push §4.2.2/4.2.3 above §4.2.1
  // for "Benchmark 1" — because the BODY of §4.2.1 describes the first benchmark.
  const doc = [
    '[Page 1]', 'Contents',
    '4.2.1 Semantic relationship understanding . . 45',
    '4.2.2 Benchmark 2 . . . . . . . . 47',
    '4.2.3 Benchmark 3 . . . . . . . . 50',
    '[Page 45]', '4.2.1 Semantic relationship understanding',
    'The first benchmark examines semantic relationships between objects. The robot must pick the banana and place the grapes. This benchmark evaluates visual semantic understanding in pick-and-place tasks.',
    '[Page 47]', '4.2.2 Benchmark 2',
    'The second benchmark examines prompt complexity and instruction following.',
    '[Page 50]', '4.2.3 Benchmark 3',
    'The third benchmark examines self-awareness and multi-step planning.',
  ].join('\n');
  const map = buildDocumentMap(doc);
  const targets = resolveTargetSections('What is Benchmark 1 about?', map);
  assert.ok(
    targets.some(t => t === '4.2.1'),
    `must target §4.2.1 (first benchmark body), got: [${targets.join(',')}]`,
  );
});

test('resolveTargetSections returns empty for an unmatched query (global fallback)', async () => {
  const { buildDocumentMap, resolveTargetSections } = await loadMap();
  const map = buildDocumentMap(THESIS);
  const targets = resolveTargetSections('xyzzy plugh nonsense', map);
  assert.equal(targets.length, 0, 'no confident section match → empty → caller falls back to global');
});

// Regression (2026-07-13): a space-aligned PDF spec table extracts as one row per
// line ("Working Voltage 24 V\nBattery Life Up to 8 hours"). The section flush used
// to whitespace-collapse the whole body, fusing every row into an ambiguous blob
// from which the model could not map a label to its value. formatBodyPreservingTables
// keeps each row on its own labelled line while collapsing ordinary prose.
test('formatBodyPreservingTables keeps space-aligned table rows on separate labelled lines', async () => {
  const { formatBodyPreservingTables } = await loadMap();
  const body = [
    'The following table summarizes the specifications:',
    'Specification Value',
    'Height 1.18 m',
    'Weight 55 kg',
    'Working Voltage 24 V',
    'Battery Life 8 hours',
    'Repeatability 0.05 mm',
    'Storage Space 15 L',
  ];
  const out = formatBodyPreservingTables(body);
  // Each spec value must remain on the SAME line as its label (row boundary kept),
  // not fused with the next row. Rows keep their ORIGINAL text (no forced colon
  // split — PDF column gaps are ambiguous), so the assertion is on the raw row.
  assert.match(out, /Working Voltage 24 V/, 'voltage row preserved intact');
  assert.match(out, /Storage Space 15 L/, 'storage row preserved intact');
  // The rows must be on DISTINCT lines (the blob-fusion bug put them all on one).
  const lines = out.split('\n');
  assert.ok(lines.some(l => /^Working Voltage 24 V$/.test(l)), 'voltage is its own line');
  assert.ok(lines.some(l => /^Battery Life 8 hours$/.test(l)), 'battery is its own line');
  assert.ok(lines.length >= 6, `table rows kept on separate lines, got ${lines.length}`);
});

test('formatBodyPreservingTables leaves ordinary prose whitespace-collapsed (no false table)', async () => {
  const { formatBodyPreservingTables } = await loadMap();
  const body = [
    'The Mercury X1 is composed of two primary components. The robot',
    'features a total of 19 degrees of freedom, with each arm contributing',
    'to its dexterity. The arms use a lightweight carbon fiber shell.',
  ];
  const out = formatBodyPreservingTables(body);
  // Prose (no ≥3-row Label/Value run) must collapse to a single flowing block —
  // never gain spurious "Label: Value" colons.
  assert.doesNotMatch(out, /:\s/, 'prose must not be reshaped into label:value rows');
  assert.match(out, /19 degrees of freedom/, 'prose content preserved');
});
