// Live smoke for document-grounded custom mode.
// Calls the real Gemini endpoint directly with the request shape the
// LLMHelper streamChat bundle would build, using the SAME prompt
// ordering (pinned instructions → retrieved context → user question) and
// the SAME fail-closed policy when the GPU is not in the uploaded file.
//
// We bypass LLMHelper's DB constructor (better-sqlite3 native binding
// mismatch on Node 25) and drive the provider directly so we observe
// real model behaviour against the seminar-mode rules.

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const fs = require('node:fs');
const path = require('node:path');

const GROQ_KEYS = [
  process.env.GROQ_API_KEY_1,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
  process.env.GROQ_API_KEY_7,
  process.env.GROQ_API_KEY_8,
  process.env.GROQ_API_KEY_9,
  process.env.GROQ_API_KEY_10,
].filter(Boolean);

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_5,
  process.env.GEMINI_API_KEY_6,
].filter(Boolean);

if (GROQ_KEYS.length === 0 && GEMINI_KEYS.length === 0) {
  console.error('[smoke] no Gemini or Groq keys found in .env');
  process.exit(2);
}

// Round-robin across keys on 429/quota so a single exhausted key does not
// sink the whole smoke run.
let groqCursor = 0;
let geminiCursor = 0;
function pickGroqKey() { const k = GROQ_KEYS[groqCursor % GROQ_KEYS.length]; groqCursor++; return k; }
function pickGeminiKey() { const k = GEMINI_KEYS[geminiCursor % GEMINI_KEYS.length]; geminiCursor++; return k; }

const SEMINAR_FIXTURE = `Title: Towards Connected Intelligence: Empowering Robotic Applications with Agentic AI Frameworks.

Abstract: This thesis studies Agentic AI frameworks integrated with Vision-Language-Action models for embodied robotic systems. AgenticVLA is the proposed end-to-end robot manipulation pipeline deployed on the Mercury X1 humanoid robot.

Research Questions:
1. How do agentic AI frameworks improve Vision-Language-Action robotic performance?
2. How does embodied cognition support connected intelligence?

Main Objectives: The four main phases are 1. Teleoperation, 2. Data collection, 3. Training the VLA, 4. Agentic AI integration.

OpenVLA: OpenVLA is a 7B-parameter open-source Vision-Language-Action model based on Llama 2 and Prismatic, used as the baseline VLA.

OpenVLA-OFT: OpenVLA-OFT is fine-tuned from OpenVLA using LoRA adapters with on-robot data. OpenVLA-OFT uses parallel decoding and action chunking and achieves 43x faster throughput than base OpenVLA.

Agentic AI and AutoGen: Agentic AI is a paradigm where autonomous AI agents plan, reason, and use tools. AutoGen is a multi-agent framework that orchestrates AgenticVLA skills for planning, task reasoning, and tool coordination.

AgenticVLA: AgenticVLA improves over a normal VLA by integrating AutoGen-driven agentic skills for planning and tool use on top of the OpenVLA-OFT backbone.

Mercury X1 Hardware: Mercury X1 is a humanoid robot platform selected because it provides an embodied robotic system for manipulation experiments. Mercury X1 has 19 degrees of freedom. Sensors include LiDAR (3D point cloud for obstacle detection), ultrasonic sensors (proximity at short range), and 2D vision camera (RGB stream for object recognition). Technical specifications table lists Mercury X1 mobility, manipulation hardware, and sensor suite.

ROS# Middleware: ROS# middleware bridges Unity and ROS. ROS# allows Unity and .NET applications to communicate with ROS nodes, topics, services, and messages.

Unity Simulation: Unity game engine hosts the simulated Mercury X1 environment and provides the VR teleoperation interface. C# scripts drive Unity, and ROS# integrates Unity with ROS for real-time robot control.

Teleoperation Hardware: Meta Quest 3 provides XR visualization of robot state and is used for immersive teleoperation. Teleoperation uses Unity, ROS#, Meta Quest 3, and ROS message bridging.

Camera Setup: Camera setup includes Orbbec Deeyea 3D camera and two Logitech C920 HD webcams. The robotic raw data acquisition procedure records synchronized camera observations, robot states, and action commands.

Dataset Structure: Dual-arm manipulation demonstrations collected from Mercury X1 teleoperation. Dataset tasks include manipulating fruits and objects such as banana and grapes. The dataset is formatted into observations, language instructions, and robot action trajectories for VLA training.

Preprocessing: Preprocessing before finetuning aligns camera frames, action chunks, and language commands into a unified training format.

OpenVLA-OFT Finetuning: OpenVLA-OFT finetuning uses LoRA adapters with the collected robot demonstration dataset.

Hyperparameters: Hyperparameters include learning rate, batch size, training steps, and LoRA rank.

Evaluation Metrics: Success Rate (SR) is the primary evaluation metric for manipulation tasks. MSE (Mean Squared Error) measures prediction error between predicted and demonstrated actions. Compared models are OpenVLA, finetuned OpenVLA-OFT, and AgenticVLA.

Benchmark Results: On semantic relationship understanding, standard VLA scored 0 percent Success Rate while AgenticVLA scored 44 percent Success Rate. On prompt complexity analysis, finetuned OpenVLA-OFT scored 42 percent while AgenticVLA scored 84 percent. On the self-awareness benchmark, standard VLA scored 43 percent while AgenticVLA scored 85 percent.

Limitations: Limitations include sim-to-real transfer, dataset scale, hardware constraints, and robustness in open environments.`;

// When SMOKE_USE_REAL_FIXTURE=1, load the actual fixture files from
// tests/fixtures/modes/custom/seminar-presentation/ instead of using the
// inline SEMINAR_FIXTURE blob. Each file is sent as a SEPARATE
// `<uploaded_seminar_material>` block so the smoke harness exercises the
// real production corpus shape (multiple small files competing for
// retrieval slots) — not the single dense blob the inline fixture
// represents. Inline fixture is the default for offline / CI runs.
const REAL_FIXTURE_DIR = path.resolve(
  __dirname, '..', 'tests', 'fixtures', 'modes', 'custom', 'seminar-presentation',
);
function loadRealFixtureFiles() {
  if (!fs.existsSync(REAL_FIXTURE_DIR)) {
    throw new Error(`real fixture dir missing: ${REAL_FIXTURE_DIR}`);
  }
  const files = fs.readdirSync(REAL_FIXTURE_DIR)
    .filter((f) => /\.(txt|md|csv)$/i.test(f))
    .sort();
  return files.map((fileName) => ({
    fileName,
    content: fs.readFileSync(path.join(REAL_FIXTURE_DIR, fileName), 'utf8'),
  }));
}
const USE_REAL_FIXTURE = process.env.SMOKE_USE_REAL_FIXTURE === '1';

const SYSTEM_PROMPT = [
  'You are a Seminar Presentation Assistant.',
  'The uploaded seminar file is the source of truth.',
  'Answer from uploaded seminar content first and avoid hallucinated details.',
  'Answer strictly based on the seminar file.',
  'If the answer is not in the uploaded file, say: This is not directly mentioned in my seminar material, but based on the topic, the likely explanation is...',
].join(' ');

function buildPrompt(question, retrievedBlock, fixtureFiles) {
  let uploadedMaterial;
  if (Array.isArray(fixtureFiles) && fixtureFiles.length > 0) {
    // Real-fixture mode: each file becomes its own <uploaded_seminar_material>
    // block, matching how the production LLMHelper surfaces multiple
    // reference files in the prompt. The model must retrieve the right one
    // for the question instead of getting everything pre-bundled.
    uploadedMaterial = fixtureFiles
      .map((f) => `<uploaded_seminar_material file="${f.fileName}">\n${f.content}\n</uploaded_seminar_material>`)
      .join('\n\n');
  } else {
    uploadedMaterial = `<uploaded_seminar_material>\n${SEMINAR_FIXTURE}\n</uploaded_seminar_material>`;
  }
  return [
    '## ACTIVE MODE INSTRUCTIONS (user-configured)',
    SYSTEM_PROMPT,
    '',
    '## UPLOADED REFERENCE FILES',
    uploadedMaterial,
    '',
    retrievedBlock || '(retrieved blocks omitted)',
    '',
    '## USER QUESTION',
    question,
  ].join('\n');
}

async function callGroq(model, systemText, userText, { signal } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < GROQ_KEYS.length; attempt++) {
    const key = pickGroqKey();
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemText },
            { role: 'user', content: userText },
          ],
          temperature: 0.2,
          max_tokens: 512,
        }),
        signal,
      });
      if (res.ok) {
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content || '';
        return { text, model, provider: 'groq' };
      }
      const errText = await res.text().catch(() => '');
      lastErr = new Error(`HTTP ${res.status} ${errText.slice(0, 160)}`);
      if (res.status !== 429 && res.status !== 401) throw lastErr;
      console.warn(`[smoke] groq key exhausted (HTTP ${res.status}); rotating`);
    } catch (err) {
      if (signal?.aborted) throw err;
      lastErr = err;
      if (!/HTTP (?:429|401)/.test(err?.message || '')) throw err;
    }
  }
  throw lastErr || new Error('all Groq keys exhausted');
}

async function callGemini(model, systemText, userText, { signal } = {}) {
  if (GEMINI_KEYS.length === 0) throw new Error('no Gemini keys configured');
  let lastErr;
  for (let attempt = 0; attempt < GEMINI_KEYS.length; attempt++) {
    const key = pickGeminiKey();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: userText }] }],
          systemInstruction: { parts: [{ text: systemText }] },
          generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
        }),
        signal,
      });
      if (res.ok) {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.map((p) => p?.text || '').join('') || '';
        return { text, model, provider: 'gemini' };
      }
      const errText = await res.text().catch(() => '');
      lastErr = new Error(`HTTP ${res.status} ${errText.slice(0, 160)}`);
      if (res.status !== 429 && res.status !== 401) throw lastErr;
      console.warn(`[smoke] gemini key exhausted (HTTP ${res.status}); rotating`);
    } catch (err) {
      if (signal?.aborted) throw err;
      lastErr = err;
      if (!/HTTP (?:429|401)/.test(err?.message || '')) throw err;
    }
  }
  throw lastErr || new Error('all Gemini keys exhausted');
}

async function callProvider(groqModel, geminiModel, systemText, userText, signal) {
  // Try Gemini first (matches the user's primary stack), fall back to Groq.
  if (GEMINI_KEYS.length > 0) {
    try {
      return await callGemini(geminiModel, systemText, userText, { signal });
    } catch (err) {
      console.warn(`[smoke] gemini path failed (${err?.message?.slice(0, 120)}); falling back to groq`);
      if (GROQ_KEYS.length === 0) throw err;
    }
  }
  if (GROQ_KEYS.length > 0) return callGroq(groqModel, systemText, userText, { signal });
  throw new Error('no provider available');
}

function logAnswer(label, question, expectedHint, answer) {
  const text = (answer || '').trim();
  const tokens = text.split(/\s+/).filter(Boolean).length;
  console.log(`\n[smoke] ${label}`);
  console.log(`  Q: ${question}`);
  console.log(`  expected: ${expectedHint}`);
  console.log(`  answer (${tokens} words):`);
  console.log(`    ${text.slice(0, 320).replace(/\n/g, ' / ')}${text.length > 320 ? ' …' : ''}`);
}

async function liveCheck(label, question, retrievedBlock, expected, model, geminiModel, fixtureFiles) {
  const userText = buildPrompt(question, retrievedBlock, fixtureFiles);
  const start = Date.now();
  try {
    const { text, provider, model: usedModel } = await callProvider(model, geminiModel, SYSTEM_PROMPT, userText);
    const latency = Date.now() - start;
    logAnswer(label, question, expected, text);
    console.log(`  latency: ${latency}ms (provider=${provider}, model=${usedModel})`);
    return { text, latency };
  } catch (err) {
    console.error(`[smoke] ${label} failed:`, err?.message || err);
    return { text: '', latency: Date.now() - start };
  }
}

async function main() {
  const model = process.env.SMOKE_GROQ_MODEL || 'llama-3.3-70b-versatile';
  const geminiModel = process.env.SMOKE_GEMINI_MODEL || 'gemini-2.0-flash';

  // Drift terms that MUST NOT appear in any answer. The user's prior 51-q
  // benchmark surfaced these from profile/resume/JD context leaking into a
  // document-grounded custom mode. They are forbidden across the board.
  const GLOBAL_FORBIDDEN = [
    'TalentScope',
    'real-time technical interview platform',
    'Next.js',
    'Tailwind',
    'Convex',
    'Stream SDK',
    'Clerk',
    'Role-Based Access Control',
    'RBAC',
    'remote hiring',
    'synchronized code execution',
    'live coding',
  ];
  // Internal retrieval vocabulary that the model must NOT echo verbatim. The
  // model-visible prompt now uses "uploaded material" / "thesis material"
  // (2026-06-27 fix F7) — answers saying "snippet" or "retrieved" indicate
  // the guard did not stick or the model is still echoing scaffold language.
  // We deliberately exclude "chunk"/"chunks" from the block list because
  // "action chunks" is a legitimate domain term in robotics / VLA literature
  // — see https://arxiv.org/abs/2406.09246 — and the substring "chunk"
  // matches that term. The retriever itself still does not surface the word
  // "chunk" in any user-facing model prompt (2026-06-27 verified), so the
  // answer-side check needs to allow the domain term.
  const INTERNAL_WORDING = ['snippet', 'snippets', 'retrieved', 'excerpt'];

  const checks = [
    // Core facts that MUST come from the uploaded material.
    {
      label: '01 main topic', question: 'What is the main topic of my thesis?',
      expectMentions: ['Agentic AI', 'Vision-Language-Action'],
    },
    {
      label: '02 explain thesis simply', question: 'Explain my thesis in simple words.',
      expectMentions: ['Agentic AI', 'robotic'],
    },
    {
      label: '03 problem thesis solves', question: 'What problem is this thesis trying to solve?',
      expectMentions: ['embodied', 'robot'],
      expectAbsent: ['## Approach', '## Code', '## Dry Run', '## Complexity'],
    },
    {
      label: '04 research questions', question: 'What are the two research questions?',
      expectMentions: ['agentic', /\bvla\b|vision-language-action/i],
    },
    {
      label: '05 objectives', question: 'What are the main objectives of the thesis?',
      expectMentions: ['teleoperation', 'Agentic AI', 'training'],
    },
    {
      label: '06 embodied AI', question: 'How is this thesis connected to embodied AI?',
      expectMentions: ['embodied', 'robotic'],
    },
    {
      label: '07 embodied cognition', question: 'What does embodied cognition mean in this thesis?',
      expectMentions: ['embodied'],
    },
    {
      label: '08 AGI', question: 'How is this thesis related to AGI?',
      expectMentions: ['agentic', 'intelligence'],
    },
    {
      label: '09 VLA importance', question: 'Why are VLA models important for robotics?',
      expectMentions: ['VLA', 'robot'],
    },
    {
      label: '10 VLA limitations', question: 'What are the limitations of current VLA models?',
      expectMentions: ['VLA'],
    },
    {
      label: '11 VLA model definition', question: 'What is a Vision-Language-Action model?',
      expectMentions: ['Vision-Language-Action'],
    },
    {
      label: '12 OpenVLA', question: 'What is OpenVLA?',
      expectMentions: ['OpenVLA', '7B'],
      // Fixture-statement grounding: "7B-parameter" is specific to this thesis.
      // A hallucinated "OpenVLA is a vision-language-action model" would
      // satisfy the substring check but not the grounding check.
      expectGrounding: ['7B-parameter', '7B parameter', '7B parameters'],
    },
    {
      label: '13 OpenVLA-OFT', question: 'What is OpenVLA-OFT?',
      expectMentions: ['OpenVLA-OFT', 'LoRA'],
      // Grounding: at least one of the thesis-specific phrasings.
      expectGrounding: ['on-robot data', 'fine-tuned with on-robot', 'fine-tuned from OpenVLA', 'finetuned with on-robot', 'optimized model'],
    },
    {
      label: '14 OpenVLA-OFT vs OpenVLA', question: 'How is OpenVLA-OFT different from OpenVLA?',
      expectMentions: ['OpenVLA-OFT', 'parallel decoding', 'action chunking', '43x'],
      // Grounding: the 43x figure is the thesis-specific factual claim.
      expectGrounding: ['43x faster', '43x', '43 times faster'],
    },
    {
      label: '15 Agentic AI', question: 'What is Agentic AI?',
      expectMentions: ['agentic', 'AI'],
    },
    {
      label: '16 agent components', question: 'What are the three core components of an AI agent?',
      expectMentions: ['agent'],
      // Grounding: the thesis explicitly enumerates "perception, planning,
      // and action execution" as the three components. A general-knowledge
      // answer would name different components.
      expectGrounding: ['perception, planning, and action', 'perception, planning, action', 'perception planning and action'],
    },
    {
      label: '17 AutoGen', question: 'What is AutoGen used for in this thesis?',
      expectMentions: ['AutoGen'],
    },
    {
      label: '18 AutoGen selection', question: 'Why was AutoGen selected over other frameworks?',
      expectMentions: ['AutoGen'],
    },
    {
      label: '19 AgenticVLA', question: 'What is AgenticVLA?',
      expectMentions: ['AgenticVLA'],
    },
    {
      label: '20 AgenticVLA improvement', question: 'Why does AgenticVLA improve over a normal VLA?',
      expectMentions: ['AgenticVLA'],
    },
    {
      label: '21 Mercury X1', question: 'What is the Mercury X1 robot?',
      expectMentions: ['Mercury X1', 'humanoid'],
    },
    {
      label: '22 Mercury X1 selection', question: 'Why was Mercury X1 selected for this work?',
      expectMentions: ['Mercury X1'],
    },
    {
      label: '23 Mercury X1 specs', question: 'What are the key specifications of Mercury X1?',
      expectMentions: ['Mercury X1', 'degrees of freedom'],
    },
    {
      label: '24 Mercury X1 DOF', question: 'How many degrees of freedom does Mercury X1 have?',
      expectMentions: ['19', 'degrees of freedom', 'Mercury X1'],
      // Grounding: a hallucinated "Mercury X1 has 12 DOF" would still match
      // the substring check because "Mercury X1" + "degrees of freedom" both
      // appear in the answer. Require the EXACT figure.
      expectGrounding: ['19 degrees of freedom', '19 DOF', 'nineteen degrees of freedom', '19-DoF', '19 dof'],
    },
    {
      label: '25 Mercury X1 sensors', question: 'What sensors does Mercury X1 use?',
      expectMentions: ['LiDAR', 'ultrasonic', 'vision'],
    },
    {
      label: '26 ROS# role', question: 'What is the role of ROS# in the project?',
      expectMentions: ['ROS#', 'Unity'],
    },
    {
      label: '27 Unity role', question: 'What is the role of Unity in the project?',
      expectMentions: ['Unity'],
    },
    {
      label: '28 VR teleoperation', question: 'Why was VR teleoperation used?',
      expectMentions: ['teleoperation'],
    },
    {
      label: '29 teleop hardware', question: 'What hardware was used for teleoperation?',
      expectMentions: ['Meta Quest 3'],
    },
    {
      label: '30 camera setup', question: 'What camera setup was used for data collection?',
      expectMentions: ['Orbbec Deeyea', 'Logitech'],
      // Grounding: the "two Logitech C920 HD webcams" wording is fixture-specific.
      expectGrounding: ['two Logitech C920', 'C920', 'Logitech C920'],
    },
    {
      label: '31 methodology', question: 'Explain the research methodology.',
      expectMentions: ['teleoperation', 'training'],
    },
    {
      label: '32 four phases — profile guard', question: 'What are the four main phases of the project?',
      expectMentions: ['teleoperation', 'data collection', 'training', 'Agentic AI'],
    },
    {
      label: '33 data acquisition', question: 'What was the robotic raw data acquisition procedure?',
      // The fixture says "robotic raw data acquisition procedure records
      // synchronized camera observations, robot states, and action commands"
      // — the live answer must reference at least one of those terms.
      expectMentions: [/(?:camera|robot state|action command|teleop)/i],
    },
    {
      label: '34 dataset kind', question: 'What kind of dataset was collected?',
      expectMentions: ['manipulation', 'demonstration'],
    },
    {
      label: '35 objects used', question: 'What objects were used in the robotic tasks?',
      expectMentions: ['object'],
    },
    {
      label: '36 dataset format', question: 'How was the dataset formatted for training?',
      expectMentions: ['action', 'observation'],
    },
    {
      label: '37 preprocessing', question: 'What preprocessing was done before finetuning?',
      expectMentions: ['preprocessing', /\bfine[- ]?tun\w*/],
    },
    {
      label: '38 OpenVLA-OFT finetuning', question: 'How was OpenVLA-OFT finetuned?',
      expectMentions: ['OpenVLA-OFT', 'LoRA'],
    },
    {
      label: '39 hyperparameters', question: 'What hyperparameters were used for finetuning?',
      expectMentions: ['learning rate', 'batch'],
    },
    {
      label: '40 LoRA', question: 'What was LoRA used for?',
      expectMentions: ['LoRA', /\bfine[- ]?tun\w*/],
    },
    {
      label: '41 evaluation metrics', question: 'What evaluation metrics were used?',
      expectMentions: ['Success Rate', 'MSE'],
    },
    {
      label: '42 Success Rate', question: 'What does Success Rate measure?',
      expectMentions: ['Success Rate'],
    },
    {
      label: '43 MSE', question: 'What does MSE measure?',
      expectMentions: ['MSE'],
    },
    {
      label: '44 compared models', question: 'What models were compared in the experiments?',
      expectMentions: ['OpenVLA', 'AgenticVLA'],
    },
    {
      label: '45 semantic benchmark', question: 'What happened in the semantic relationship understanding benchmark?',
      expectMentions: ['44', '0'],
      // Grounding: 44% AgenticVLA / 0% standard VLA is fixture-specific.
      expectGrounding: ['44', '44%', '44 percent', '0%', '0 percent'],
    },
    {
      label: '46 prompt complexity', question: 'What happened in the prompt complexity analysis?',
      expectMentions: ['84', '42'],
      // Grounding: 84% / 42% is the fixture's specific numbers.
      expectGrounding: ['84%', '84 percent', '84 percent Success Rate', '42%', '42 percent'],
    },
    {
      label: '47 self-awareness', question: 'What happened in the self-awareness benchmark?',
      expectMentions: ['85', '43'],
      // Grounding: 85% / 43% is the fixture's specific numbers.
      expectGrounding: ['85%', '85 percent', '43%', '43 percent'],
    },
    {
      label: '48 main findings', question: 'What were the main findings from the experiments?',
      expectMentions: ['AgenticVLA'],
    },
    {
      label: '49 limitations', question: 'What limitations or open challenges are discussed?',
      expectMentions: ['limitation'],
    },
    {
      label: '50 seminar conclusion (recovery line)', question: 'Give me a 30-second seminar-style conclusion for this thesis.',
      expectMentions: ['AgenticVLA', 'thesis'],
    },
    // GPU fail-closed: the canonical case where the uploaded material does
    // NOT contain the answer. The model must say "not directly mentioned"
    // and must NOT invent an NVIDIA/A100/H100/T4/V100.
    {
      label: '51 GPU fail-closed', question: 'What exact GPU was used for training?',
      expectMentions: ['not directly mentioned', 'seminar material'],
      expectAbsent: ['NVIDIA', 'A100', 'H100', 'T4', 'V100'],
    },
  ];

  let pass = 0, fail = 0;
  const failures = [];
  // Load real production fixture when SMOKE_USE_REAL_FIXTURE=1 so the harness
  // exercises the 6-file corpus shape that production users actually upload
  // (multiple small files competing for retrieval slots), not the single dense
  // inline blob. Default is the inline blob for offline / CI determinism.
  const fixtureFiles = USE_REAL_FIXTURE ? loadRealFixtureFiles() : null;
  if (USE_REAL_FIXTURE) {
    console.log(`[smoke] using real fixture: ${fixtureFiles.length} files from ${REAL_FIXTURE_DIR}`);
  }
  for (let i = 0; i < checks.length; i++) {
    const c = checks[i];
    const expected = c.expectMentions.join(', ');
    const { text } = await liveCheck(c.label, c.question, c.retrieved, expected, model, geminiModel, fixtureFiles);
    const lower = text.toLowerCase();
    const missMentions = c.expectMentions.filter((m) => {
      if (m instanceof RegExp) return !m.test(text);
      return !lower.includes(m.toLowerCase());
    });
    // Fixture-statement grounding: require at least ONE of the
    // fixture-specific phrases. These phrases are chosen so that a
    // hallucinated general-knowledge answer cannot pass — substring
    // matches on common terms (e.g. "OpenVLA", "Mercury X1") are not
    // enough on their own.
    let groundingMiss = null;
    if (Array.isArray(c.expectGrounding) && c.expectGrounding.length > 0) {
      const lowerText = text.toLowerCase();
      const hit = c.expectGrounding.some((g) => lowerText.includes(g.toLowerCase()));
      if (!hit) groundingMiss = c.expectGrounding;
    }
    const explicitAbsent = c.expectAbsent || [];
    const leakExplicit = explicitAbsent.filter((m) => lower.includes(m.toLowerCase()));
    const leakGlobal = GLOBAL_FORBIDDEN.filter((m) => lower.includes(m.toLowerCase()));
    const internalWording = INTERNAL_WORDING.filter((w) =>
      new RegExp(`\\b${w}\\b`, 'i').test(text),
    );
    const blank = text.trim().length === 0;
    const problems = [];
    if (blank) problems.push('BLANK answer');
    if (missMentions.length) problems.push(`missing: ${missMentions.join(', ')}`);
    if (groundingMiss) problems.push(`grounding: none of ${JSON.stringify(groundingMiss)}`);
    if (leakExplicit.length) problems.push(`leaked (question-specific): ${leakExplicit.join(', ')}`);
    if (leakGlobal.length) problems.push(`leaked (global drift): ${leakGlobal.join(', ')}`);
    if (internalWording.length) problems.push(`internal wording: ${internalWording.join(', ')}`);
    if (problems.length === 0) {
      pass++;
      console.log(`  PASS`);
    } else {
      fail++;
      failures.push({ idx: i + 1, label: c.label, problems, text });
      console.log(`  FAIL — ${problems.join(' ; ')}`);
    }
  }
  console.log(`\n[smoke] ${pass}/${pass + fail} live checks passed (groq=${model}, gemini=${geminiModel})`);
  if (failures.length) {
    console.log(`\n[smoke] FAILURES (showing text excerpts):`);
    for (const f of failures) {
      const excerpt = (f.text || '').slice(0, 220).replace(/\n/g, ' / ');
      console.log(`  #${f.idx} ${f.label}`);
      console.log(`     ${f.problems.join(' ; ')}`);
      console.log(`     → ${excerpt}${f.text && f.text.length > 220 ? ' …' : ''}`);
    }
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[smoke] fatal:', err);
  process.exit(2);
});
