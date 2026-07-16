// Generates the source-only assets for the Context OS real-backend benchmark.
//
// This reads the exact committed thesis PDF through the same PDFParse API used by
// ModeReferenceFileIngestion. It creates answer-key artifacts only; the E2E runner
// independently uploads the original binary through the production ingestion use
// case. No model/provider call is made here.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFParse } from 'pdf-parse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureDir = path.join(__dirname, 'fixtures/sample-thesis');
const sourcePdf = path.join(repoRoot, 'test-fixtures/modes-corpus/thesis/institutional_thesis.pdf');
const required = (value) => value.split('|');

// These are benchmark fixtures, not product rules. Every record is verified
// against parser-produced text below before it can enter a public split.
const FACTS = [
  ['meta-author', 'Who is the author of the thesis?', 'Alberto Dian', 1, 'metadata', 'factual'],
  ['meta-title', 'What is the full title of the thesis?', 'Towards Connected Intelligence', 1, 'metadata', 'factual'],
  ['meta-programme', 'What degree programme is listed for the thesis?', 'ICT Innovation', 3, 'metadata', 'factual'],
  ['meta-major', 'What is the listed major or specialization?', 'Autonomous systems and Intelligent Robots', 3, 'metadata', 'factual'],
  ['meta-supervisor', 'Who supervised the thesis?', 'Ville Kyrki', 3, 'metadata', 'factual'],
  ['meta-advisor-one', 'Name one advisor listed on the thesis title page.', 'Massimiliano Maule', 3, 'metadata', 'factual'],
  ['meta-advisor-two', 'Name the other advisor listed on the thesis title page.', 'Davide Brunelli', 3, 'metadata', 'factual'],
  ['meta-partner', 'What collaborative partner is named on the title page?', 'Huawei Munich Research Center', 3, 'metadata', 'factual'],
  ['meta-date', 'What date is listed for the thesis?', '21 June 2025', 3, 'metadata', 'factual'],
  ['meta-language', 'What language is the thesis written in?', 'English', 3, 'metadata', 'factual'],
  ['meta-license', 'What Creative Commons license covers this work?', 'Attribution-NonCommercial-ShareAlike|4.0 Interna', 2, 'metadata', 'factual'],
  ['meta-keywords', 'Name two keywords listed for the thesis.', 'Embodied AI|Robotics', 3, 'metadata', 'list'],
  ['meta-robot-abstract', 'What robot platform does the abstract say AgenticVLA is deployed on?', 'Mercury X1', 3, 'metadata', 'factual'],
  ['toc-chapter-one', 'What is the title of Chapter 1?', 'Introduction', 5, 'structure', 'factual'],
  ['toc-chapter-two', 'What is the title of Chapter 2?', 'State of The Art and Background Overview', 5, 'structure', 'factual'],
  ['toc-chapter-three', 'What is the title of Chapter 3?', 'Research Methodology', 5, 'structure', 'factual'],
  ['toc-chapter-four', 'What is the title of Chapter 4?', 'Experiments and Results', 6, 'structure', 'factual'],
  ['toc-chapter-five', 'What is the title of Chapter 5?', 'Conclusions', 6, 'structure', 'factual'],
  ['toc-vla-page', 'According to the table of contents, what page begins Visual-Language-Action Models?', '10', 5, 'structure', 'numeric'],
  ['toc-conversational-page', 'According to the table of contents, what page begins the Conversational Agent section?', '38', 5, 'structure', 'numeric'],
  ['toc-self-awareness-page', 'According to the table of contents, what page begins Self-awareness capabilities?', '52', 6, 'structure', 'numeric'],
  ['intro-embodied-origin', 'Which fields does the introduction say embodied cognition originates from?', 'Cognitive science|philosophy of mind', 7, 'background', 'comparison'],
  ['intro-vla-models', 'Name two notable VLA models named in the introduction.', 'Octo|OpenVLA', 7, 'background', 'list'],
  ['intro-open-x', 'What robotics-manipulation dataset is named in the introduction?', 'Open X-Embodiment', 7, 'background', 'factual'],
  ['intro-rq1', 'What does RQ1 ask about combining an Agentic AI Framework with a VLA model?', 'towards achieving AGI', 8, 'background', 'synthesis'],
  ['intro-rq2', 'What capability does RQ2 ask a network of AI agents to improve?', 'perception and decision-making', 8, 'background', 'synthesis'],
  ['intro-duration', 'Over what period was the project structured?', 'six-month', 9, 'background', 'numeric'],
  ['intro-phases', 'List the four main phases of the project.', 'Teleoperation|Data collection|Training the VLA|Agentic AI integration', 9, 'background', 'list'],
  ['intro-headset', 'What VR headset is named in the project structure?', 'Meta Quest 3', 9, 'background', 'factual'],
  ['intro-framework', 'Which agent framework was combined with the VLA in Phase 4?', 'AutoGen', 9, 'background', 'factual'],
  ['intro-metric', 'What metric quantifies comparative improvements in reasoning, adaptability, and task performance?', 'Success Rate', 9, 'background', 'factual'],
  ['vla-components', 'What three parts do recent VLM architectures generally consist of?', 'visual encoder|projector|LLM backbone', 12, 'background', 'list'],
  ['openvla-params', 'How many parameters does OpenVLA have?', '7B', 12, 'background', 'numeric'],
  ['openvla-trajectories', 'How many robot manipulation trajectories was OpenVLA fine-tuned on?', '970k', 12, 'background', 'numeric'],
  ['openvla-rt2', 'What larger model does OpenVLA outperform according to the thesis?', '55B-parameter RT-2-X', 12, 'background', 'factual'],
  ['openvla-vlm', 'What VLM does OpenVLA extend?', 'Prismatic-7B', 13, 'background', 'factual'],
  ['openvla-encoder', 'Which two visual models are combined in OpenVLA\'s visual encoder?', 'SigLIP|DinoV2', 13, 'background', 'list'],
  ['openvla-bins', 'Into how many bins is each OpenVLA action dimension quantized?', '256', 13, 'background', 'numeric'],
  ['openvla-image', 'What image resolution is called training-efficient with little gain from higher resolution?', '224x224', 13, 'background', 'numeric'],
  ['oft-decoding', 'What decoding approach does OpenVLA-OFT use instead of autoregressive decoding?', 'Parallel decoding', 13, 'background', 'factual'],
  ['oft-throughput', 'How much faster throughput does OpenVLA-OFT achieve than base OpenVLA?', '43x', 13, 'background', 'numeric'],
  ['oft-robot', 'What robot demonstrated OpenVLA-OFT dual-arm capability?', 'ALOHA', 13, 'background', 'factual'],
  ['agent-core', 'What are the three core components of an AI agent in the thesis?', 'Model|Tools|Instructions', 15, 'background', 'list'],
  ['autogen-company', 'What organization developed AutoGen?', 'Microsoft', 15, 'background', 'factual'],
  ['agent-frameworks', 'Name two other agent frameworks named alongside AutoGen.', 'LangChain|CrewAI', 14, 'background', 'list'],
  ['robot-maker', 'What company developed the Mercury X1 robot?', 'Elephant Robotics', 16, 'hardware', 'factual'],
  ['robot-location', 'Where is Elephant Robotics based?', 'Shenzhen, China', 16, 'hardware', 'factual'],
  ['robot-height', 'How tall is Mercury X1?', '1.18', 16, 'hardware', 'numeric'],
  ['robot-components', 'What two components make up Mercury X1?', 'Mercury B1|wheeled mobile base', 17, 'hardware', 'comparison'],
  ['robot-dof', 'How many degrees of freedom does Mercury X1 have?', '19', 17, 'hardware', 'numeric'],
  ['robot-weight', 'What is the total weight of Mercury X1?', '55 kg', 17, 'hardware', 'numeric'],
  ['robot-payload', 'What is the maximum payload of Mercury X1?', '1 kg', 17, 'hardware', 'numeric'],
  ['robot-speed', 'What is Mercury X1\'s maximum operating speed?', '1.2 m/s', 17, 'hardware', 'numeric'],
  ['robot-incline', 'What incline can Mercury X1 navigate?', '15 degrees', 17, 'hardware', 'numeric'],
  ['robot-obstacle', 'What obstacle height can Mercury X1 navigate?', '2 cm', 17, 'hardware', 'numeric'],
  ['robot-voltage', 'What working voltage is listed for Mercury X1?', '24 V', 17, 'hardware', 'numeric'],
  ['robot-battery', 'What battery life is listed for Mercury X1?', '8 hours', 17, 'hardware', 'numeric'],
  ['robot-repeatability', 'What repeatability specification is listed for Mercury X1?', '0.05 mm', 17, 'hardware', 'numeric'],
  ['robot-storage', 'What storage space is listed for Mercury X1?', '15 L', 17, 'hardware', 'numeric'],
  ['robot-control', 'What main control system is listed for Mercury X1?', 'NVIDIA Jetson Xavier', 17, 'hardware', 'factual'],
  ['robot-aux-control', 'What auxiliary control system is listed for Mercury X1?', 'Jetson Nano', 17, 'hardware', 'factual'],
  ['robot-perception', 'Name two perception systems listed for Mercury X1.', 'LiDAR|ultrasonic', 17, 'hardware', 'list'],
  ['robot-software', 'Name two software technologies listed for Mercury X1.', 'Python|MoveIt', 17, 'hardware', 'list'],
  ['open-teach-headset', 'What headset does the OPEN TEACH framework use?', 'Meta Quest 3', 19, 'background', 'factual'],
  ['open-teach-rate', 'At what frequency can OPEN TEACH operate?', '90Hz', 19, 'background', 'numeric'],
  ['ros-sharp', 'What is ROS# used for?', 'communicating with ROS from .NET applications', 20, 'software', 'synthesis'],
  ['unity-reason', 'Name two capabilities that made Unity a good fit for the project.', 'High-quality rendering|native VR support', 20, 'software', 'list'],
  ['sixg-year', 'When did the ITU finalize the 6G Vision framework?', 'June 2023', 21, 'networking', 'factual'],
  ['sixg-urllc', 'What does URLLC stand for?', 'Ultra-Reliable and Low-Latency Communications', 21, 'networking', 'factual'],
  ['sixg-isac', 'What does ISAC stand for?', 'Integrated Sensing and Communication', 21, 'networking', 'factual'],
  ['sixg-formula', 'What equation describes Connected Intelligence in Figure 7?', 'AGI for 6G + 6G for AGI', 21, 'networking', 'factual'],
  ['sixg-bodies', 'Which two standards bodies identify robotics as a key vertical for 6G?', 'ITU|3GPP', 22, 'networking', 'list'],
  ['sixg-autonomy', 'What company proposed meta-level autonomy in robotics?', 'Huawei', 22, 'networking', 'factual'],
  ['sixg-challenges', 'Name two networking challenges Agentic AI for 6G aims to bypass.', 'Network capacity|AI model flexibility', 23, 'networking', 'list'],
  ['method-strategy', 'What overall strategy does the methodology follow?', 'bottom-up strategy', 25, 'methodology', 'factual'],
  ['teleop-input', 'What headset and controllers were used to interface with teleoperation?', 'Meta Quest 3|hand controllers', 27, 'teleoperation', 'comparison'],
  ['teleop-feeds', 'How many video feeds were captured during teleoperation?', 'Three', 27, 'teleoperation', 'numeric'],
  ['teleop-main-camera', 'What camera model was used for the head-mounted view?', 'Orbbec Deeyea 3D', 27, 'teleoperation', 'factual'],
  ['teleop-usb-camera', 'What camera model was used for the USB camera views?', 'Logitech C920', 27, 'teleoperation', 'factual'],
  ['teleop-unity-ros', 'What library bridged Unity with the robot\'s ROS?', 'ROS#', 27, 'teleoperation', 'factual'],
  ['teleop-python', 'What Python library translated messages into control signals?', 'pymycobot', 27, 'teleoperation', 'factual'],
  ['teleop-frequency', 'What control frequency did the control pipeline maintain?', '50 Hz', 28, 'teleoperation', 'numeric'],
  ['teleop-target-pose', 'How many bytes is target_pose_right and what does it represent?', '24|Right arm pose', 28, 'teleoperation', 'comparison'],
  ['teleop-command-id', 'What data type and byte size is command_id?', 'int32|4', 28, 'teleoperation', 'comparison'],
  ['teleop-actuator-rate', 'What data rate range is estimated for closed-loop actuator control?', '1–10 Mb/s', 28, 'teleoperation', 'numeric'],
  ['teleop-camera-rate', 'What estimated data rate is given for the compressed camera stream?', '620 Kb/s', 29, 'teleoperation', 'numeric'],
  ['teleop-joint-rate', 'What estimated data rate is given for joint states?', '10 Kb/s', 29, 'teleoperation', 'numeric'],
  ['data-openx-limit', 'Why was Open X-Embodiment insufficient for this thesis?', 'dual-arm interaction capabilities', 30, 'dataset', 'synthesis'],
  ['data-task', 'What task is performed in each recorded episode?', 'pick-and-place', 30, 'dataset', 'factual'],
  ['data-instruction', 'What instruction template is used for the dataset?', 'Put the [color] [object] on the [color] plate', 30, 'dataset', 'factual'],
  ['data-example', 'What example instruction is given for the dataset template?', 'yellow banana on the red plate', 30, 'dataset', 'factual'],
  ['data-objects', 'What two objects are actually interacted with in the dataset?', 'yellow banana|purple grapes', 30, 'dataset', 'list'],
  ['data-visible-only', 'What two objects are visible but never interacted with?', 'apple|orange', 30, 'dataset', 'list'],
  ['data-episodes', 'How many total episodes make up the Mercury X1 dataset?', '480', 30, 'dataset', 'numeric'],
  ['data-surfaces', 'What three surfaces were objects picked up from?', 'Table|red plate|wooden plate', 31, 'dataset', 'list'],
  ['data-duration', 'What is the average duration of each episode?', '9 seconds', 31, 'dataset', 'numeric'],
  ['data-combination-episodes', 'How many episodes correspond to each Table 5 task/arm/surface combination?', '30', 32, 'dataset', 'numeric'],
  ['data-sample-rate', 'At what frame rate was each trajectory sampled for training?', '25 Hz', 32, 'dataset', 'numeric'],
  ['data-standard', 'Which dataset\'s sampling standard does the 25 Hz rate follow?', 'ALOHA', 32, 'dataset', 'factual'],
  ['data-elements', 'Name two types of information contained in each dataset step.', 'RGB images|joint angles', 32, 'dataset', 'list'],
  ['data-format', 'What format do stored episodes follow?', 'Reinforcement Learning Dataset', 34, 'dataset', 'factual'],
  ['data-lerobot', 'What organization developed the LeRobot dataset format?', 'HuggingFace', 34, 'dataset', 'factual'],
  ['data-frame', 'What image format and resolution is used for each metadata frame?', 'PNG|640x480', 34, 'dataset', 'comparison'],
  ['data-action-vector', 'Why is the action vector 10-dimensional?', 'Rotation information|not recorded', 34, 'dataset', 'synthesis'],
  ['data-origin', 'What does the origin in the end-effector reference frame correspond to?', 'robot\'s wheels', 34, 'dataset', 'factual'],
  ['training-vram', 'How much VRAM was used for single-GPU training?', '96 gigabytes', 35, 'training', 'numeric'],
  ['training-batch', 'What batch size was used for fine-tuning?', '4', 35, 'training', 'numeric'],
  ['training-lr', 'What learning rate was used for training?', '2 × 10', 35, 'training', 'numeric'],
  ['training-decay', 'After how many steps did the learning rate decay by a factor of ten?', '75,000', 35, 'training', 'numeric'],
  ['training-steps', 'How many total training steps were run?', '150,005', 35, 'training', 'numeric'],
  ['training-checkpoint', 'How often was a checkpoint saved?', '20,000', 35, 'training', 'numeric'],
  ['training-film', 'What technique conditions visual features with language input?', 'FiLM', 35, 'training', 'factual'],
  ['training-proprio', 'Was proprioceptive input used in the experiment?', 'disabled', 35, 'training', 'correction'],
  ['training-lora', 'What LoRA rank and dropout were used?', '32|0.0', 35, 'training', 'comparison'],
  ['training-peak', 'What peak VRAM usage occurred during fine-tuning?', '62 GB', 36, 'training', 'numeric'],
  ['training-deploy', 'What VRAM size did the consumer-grade inference GPU have?', '24 GB', 36, 'training', 'numeric'],
  ['training-inference', 'Approximately how much VRAM did inference occupy?', '16 GB', 36, 'training', 'numeric'],
  ['agent-main-llm', 'What LLM is the core reasoning unit in the AutoGen architecture?', 'LLaMA 3.2 7B', 38, 'architecture', 'factual'],
  ['agent-vla-role', 'How is the VLA treated within the agent architecture?', 'callable function', 38, 'architecture', 'factual'],
  ['agent-name', 'What is the hybrid system combining language, vision, and action called?', 'AgenticVLA', 38, 'architecture', 'factual'],
  ['agent-conversational-when', 'When is the Conversational Agent used?', 'no action-oriented intent', 38, 'architecture', 'factual'],
  ['agent-conversational-llm', 'What backbone does the Conversational Agent use?', 'LLaMA 3.2 7B', 39, 'architecture', 'factual'],
  ['agent-act-verbs', 'Name two example intent-triggering verbs for the Act Agent.', 'pick up|move', 39, 'architecture', 'list'],
  ['agent-act-modules', 'What two submodules does the Act Agent use before execution?', 'Reasoning Tool|Self-Awareness Tool', 39, 'architecture', 'list'],
  ['agent-deploy-server', 'Where is the refined instruction sent after Act Agent processing?', 'server where the OpenVLA-OFT model is deployed', 39, 'architecture', 'factual'],
  ['agent-reason-limit', 'What VLA limitation does the Reasoning Tool address?', 'restricted ability to generalize from natural language', 40, 'architecture', 'synthesis'],
  ['agent-reason-llm', 'What LLM performs reasoning and rephrasing in the Reasoning Tool?', 'LLaMA 3.2 7B', 41, 'architecture', 'factual'],
  ['agent-reason-format', 'What output format must the Reasoning Tool produce?', 'put the [color] [object] on the [color] plate', 41, 'architecture', 'factual'],
  ['agent-self-model', 'What model is the visual backbone for the Self-Awareness Tool?', 'Gemma 3 12B', 41, 'architecture', 'factual'],
  ['agent-self-functions', 'What two functions does the Self-Awareness Tool perform?', 'objects currently visible|potential failures', 41, 'architecture', 'list'],
  ['agent-self-camera', 'What camera perspective does the Self-Awareness Tool use?', 'Third-person', 41, 'architecture', 'factual'],
  ['results-models', 'What three systems are compared in each experiment?', 'OpenVLA|Finetuned OpenVLA-OFT|AgenticVLA', 43, 'results', 'list'],
  ['results-finetuned', 'How was the Finetuned OpenVLA-OFT model obtained?', 'LoRA', 43, 'results', 'factual'],
  ['results-metrics', 'What two metrics evaluate the experiments?', 'Success Rate|Mean Squared Error', 44, 'results', 'list'],
  ['results-sr-definition', 'How is Success Rate defined?', 'successfully completed tasks|total number of tasks', 44, 'results', 'synthesis'],
  ['results-mse-unit', 'In what unit is average MSE measured?', 'millimeters', 44, 'results', 'factual'],
  ['results-episodes-one', 'Over how many episodes were the first and third benchmarks carried out?', '100', 44, 'results', 'numeric'],
  ['results-episodes-two', 'Over how many episodes was the second benchmark carried out?', '90', 44, 'results', 'numeric'],
  ['result-one-instruction', 'What instruction was used for the semantic-relationship benchmark?', 'put the fruits on the plate', 45, 'results', 'factual'],
  ['result-one-fruits', 'What two fruits were used in the first benchmark?', 'banana|grapes', 45, 'results', 'list'],
  ['result-one-agent-sr', 'What success rate did AgenticVLA achieve in the first benchmark?', '44%', 45, 'results', 'numeric'],
  ['result-one-openvla-sr', 'What success rate did OpenVLA achieve in Table 7?', '0%', 46, 'results', 'numeric'],
  ['result-one-oft-sr', 'What success rate did Finetuned OpenVLA-OFT achieve in Table 7?', '0%', 46, 'results', 'numeric'],
  ['result-one-openvla-mrse', 'What MRSE did OpenVLA have in Table 7?', '7016', 46, 'results', 'numeric'],
  ['result-one-oft-mrse', 'What MRSE did Finetuned OpenVLA-OFT have in Table 7?', '5505', 46, 'results', 'numeric'],
  ['result-one-agent-mrse', 'What MRSE did AgenticVLA have in Table 7?', '2369', 46, 'results', 'numeric'],
  ['result-one-split', 'How did AgenticVLA handle the pick up the fruits instruction?', 'banana|grapes', 45, 'results', 'synthesis'],
  ['result-one-failures', 'Name two failure modes observed for AgenticVLA in the first benchmark.', 'Dropping the object|failing to pick it up', 45, 'results', 'list'],
  ['result-two-easy', 'What is the Easy prompt-complexity instruction?', 'put banana on plate', 47, 'results', 'factual'],
  ['result-two-medium', 'What is the Medium prompt-complexity instruction?', 'move banana from table to plate', 47, 'results', 'factual'],
  ['result-two-hard', 'What is the Hard prompt-complexity instruction?', 'if possible', 47, 'results', 'factual'],
  ['result-two-oft-easy', 'What success rate did Finetuned OpenVLA-OFT achieve in the Easy scenario?', '82%', 48, 'results', 'numeric'],
  ['result-two-agent-easy', 'What success rate did AgenticVLA achieve in the Easy scenario?', '84%', 48, 'results', 'numeric'],
  ['result-two-oft-medium', 'What success rate did Finetuned OpenVLA-OFT achieve in the Medium scenario?', '61%', 48, 'results', 'numeric'],
  ['result-two-agent-medium', 'What success rate did AgenticVLA achieve in the Medium scenario?', '83%', 48, 'results', 'numeric'],
  ['result-two-oft-hard', 'What success rate did Finetuned OpenVLA-OFT achieve in the Hard scenario?', '42%', 48, 'results', 'numeric'],
  ['result-two-agent-hard', 'What success rate did AgenticVLA achieve in the Hard scenario?', '84%', 48, 'results', 'numeric'],
  ['result-two-base', 'What success rate did base OpenVLA achieve across Easy, Medium, and Hard prompt-complexity scenarios?', '0%', 48, 'results', 'numeric'],
  ['result-two-oft-easy-mrse', 'What MRSE did Finetuned OpenVLA-OFT have in the Easy scenario?', '523', 48, 'results', 'numeric'],
  ['result-two-oft-hard-mrse', 'What MRSE did Finetuned OpenVLA-OFT have in the Hard scenario?', '8826', 48, 'results', 'numeric'],
  ['result-two-agent-hard-mrse', 'What MRSE did AgenticVLA have in the Hard scenario?', '880', 48, 'results', 'numeric'],
  ['result-two-openvla-medium-mrse', 'What MRSE did OpenVLA have in the Medium scenario?', '6111', 48, 'results', 'numeric'],
  ['result-two-reasoning', 'How did the Reasoning Tool translate the Medium instruction?', 'put banana on plate', 47, 'results', 'factual'],
  ['result-three-instruction', 'What instruction was used for the self-awareness benchmark?', 'put banana on plate', 52, 'results', 'factual'],
  ['result-three-delay', 'After how many seconds was the banana introduced in the self-awareness benchmark?', 'three seconds', 52, 'results', 'numeric'],
  ['result-three-oft-sr', 'What success rate did Finetuned OpenVLA-OFT achieve in the self-awareness benchmark?', '43%', 53, 'results', 'numeric'],
  ['result-three-agent-sr', 'What success rate did AgenticVLA achieve in the self-awareness benchmark?', '85%', 53, 'results', 'numeric'],
  ['result-three-base-sr', 'What success rate did OpenVLA achieve in the self-awareness benchmark?', '0%', 53, 'results', 'numeric'],
  ['result-three-openvla-mrse', 'What MRSE did OpenVLA have in Table 9?', '3477', 53, 'results', 'numeric'],
  ['result-three-oft-mrse', 'What MRSE did Finetuned OpenVLA-OFT have in Table 9?', '5156', 53, 'results', 'numeric'],
  ['result-three-agent-mrse', 'What MRSE did AgenticVLA have in Table 9?', '300', 53, 'results', 'numeric'],
  ['result-three-mechanism', 'How did the Self-Awareness Tool improve the third benchmark result?', 'rest position|banana is present in the scene', 52, 'results', 'synthesis'],
  ['discussion-teleop', 'What data-acquisition tool underpinned reliability and internal-validity claims?', 'Meta Quest 3', 54, 'discussion', 'factual'],
  ['discussion-rlds', 'What data format is credited with compatibility with modern VLA pipelines?', 'RLDS', 54, 'discussion', 'factual'],
  ['discussion-external', 'What factor limited external validity or generalizability?', 'controlled nature of the environment', 54, 'discussion', 'factual'],
  ['discussion-factors', 'Name two factors proposed for standalone OpenVLA and OpenVLA-OFT limitations.', 'Mismatch between architecture and setup|Lack of contextual filtering', 55, 'discussion', 'list'],
  ['discussion-baseline', 'Why was OpenVLA included despite its limitations?', 'baseline|architectural boundaries', 55, 'discussion', 'synthesis'],
  ['discussion-decision', 'Did the thesis attribute AgenticVLA improvement to low-level manipulation or decision-making?', 'decision-making', 55, 'discussion', 'correction'],
  ['conclusion-agi', 'Does the thesis claim to advance toward AGI in any general sense?', 'does not claim', 57, 'conclusion', 'correction'],
  ['conclusion-rq1-needs', 'What three areas still need development for a substantial step toward general intelligence?', 'Memory|long-horizon planning|self-adaptation', 57, 'conclusion', 'list'],
  ['conclusion-distributed', 'Does the thesis claim a fully distributed multi-agent system across devices?', 'does not constitute', 57, 'conclusion', 'correction'],
  ['conclusion-communication', 'What framework enabled structured communication between agents?', 'AutoGen', 57, 'conclusion', 'factual'],
  ['conclusion-future', 'Name two future decentralized multi-agent directions proposed.', 'inter-agent communication|dynamic resource allocation', 58, 'conclusion', 'list'],
  ['conclusion-specialized', 'What does Section 5.3 propose about multiple smaller VLAs?', 'specialized VLAs|dynamically allocate resources', 58, 'conclusion', 'synthesis'],
  ['conclusion-challenges', 'Name two open challenges raised in Section 5.4.', 'coordinate specialized VLAs|long-term memory', 58, 'conclusion', 'list'],
  ['conclusion-stateless', 'How does the thesis describe current implementations regarding state?', 'essentially stateless', 58, 'conclusion', 'factual'],
  ['conclusion-reactive', 'What can Agentic AI frameworks partially compensate for?', 'limitations of reactive VLA models', 58, 'conclusion', 'factual'],
  ['refs-count', 'How many numbered references are in the bibliography?', '[59]', 66, 'references', 'numeric'],
  ['refs-openvla-year', 'What year and arXiv identifier are listed for the OpenVLA paper?', '2024|2406.09246', 60, 'references', 'comparison'],
  ['refs-autogen', 'What is the title of the AutoGen paper reference?', 'Autogen: Enabling next-gen llm applications', 62, 'references', 'factual'],
  ['refs-autogen-id', 'What arXiv identifier is cited for the AutoGen paper?', '2308.08155', 62, 'references', 'numeric'],
  ['refs-oft', 'What is the title of the OpenVLA-OFT paper reference?', 'Fine-tuning vision-language-action models', 61, 'references', 'factual'],
  ['refs-gemma', 'Who publishes the Gemma 3 documentation reference?', 'Google DeepMind', 66, 'references', 'factual'],
];

const REFUSALS = [
  ['refusal-funding', 'Who funded this research?', 'Funding is not directly mentioned in the supplied thesis.', 'funding_source'],
  ['refusal-budget', 'What was the total project budget?', 'A total project budget is not directly mentioned in the supplied thesis.', 'financial_amount'],
  ['refusal-revenue', 'What quarterly revenue did the company report?', 'Quarterly revenue is not directly mentioned in the supplied thesis.', 'financial_amount'],
  ['refusal-training-hours', 'How many hours did training take?', 'Training duration in hours is not directly mentioned in the supplied thesis.', 'duration'],
  ['refusal-joystick', 'What physical joystick was used for the project data collection?', 'A physical joystick was not used for the project data collection; the thesis describes Meta Quest 3 VR teleoperation.', 'hardware'],
  ['refusal-100-percent', 'Which benchmark did AgenticVLA complete with a 100% success rate?', 'No benchmark reports a 100% success rate for AgenticVLA.', 'result_metric'],
  ['refusal-agi-achieved', 'Which experiment proves the thesis achieved AGI?', 'The thesis does not claim to have achieved AGI.', 'unknown'],
  ['refusal-sixg-tested', 'What 6G network latency was measured in the experiments?', 'No 6G network latency experiment is directly reported in the supplied thesis.', 'latency'],
  ['refusal-rt2-open', 'How does the thesis prove RT-2 is fully open source?', 'The supplied thesis does not make that claim; it contrasts OpenVLA with closed large-scale VLA models.', 'unknown'],
  ['refusal-proprio', 'What proprioceptive input improved the described experiment?', 'Proprioceptive input was disabled in the described experiment.', 'unknown'],
  ['refusal-conversational-act', 'How does the Conversational Agent autonomously initiate physical actions?', 'The thesis says the Conversational Agent should not initiate physical action without explicit action-oriented intent.', 'unknown'],
  ['refusal-self-assumptions', 'What hidden objects does the Self-Awareness Tool assume are present?', 'The Self-Awareness Tool is instructed not to make assumptions beyond visible input.', 'unknown'],
  ['refusal-fixed-base', 'What stationary base is the Mercury X1 mounted on?', 'Mercury X1 has a wheeled mobile base, not a stationary base.', 'hardware'],
  ['refusal-physical-page-count', 'What single page count is unambiguously established by both the title-page metadata and parser?', 'The metadata reports 67 pages, while the parser extracts 66 physical pages.', 'unknown'],
  ['refusal-date-match', 'Why are the title-page and acknowledgement dates identical?', 'They are not identical: the title page lists 21 June 2025 and the acknowledgement is signed 4 July 2025.', 'date'],
  ['refusal-openvla-positive', 'What positive success rate does Table 7 report for baseline OpenVLA?', 'Table 7 reports 0% success rate for OpenVLA.', 'result_metric'],
  ['refusal-second-episodes', 'Why was the second benchmark run over 100 episodes?', 'The second benchmark was run over 90 episodes, not 100.', 'dataset_size'],
  ['refusal-gemma-main', 'Why is Gemma 3 12B the main dialogue model for all agents?', 'LLaMA 3.2 7B is the main reasoning/dialogue model; Gemma 3 12B is the visual backbone for self-awareness.', 'unknown'],
  ['refusal-oft-auto', 'How does OpenVLA-OFT retain autoregressive decoding to get its faster throughput?', 'It replaces autoregressive decoding with parallel decoding.', 'unknown'],
  ['refusal-rt1-7b', 'Why is RT-1 described as a 7B model?', 'RT-1 is described as a 35M-parameter network; 7B refers to OpenVLA.', 'unknown'],
];

const dehyphenateLineWraps = (value) => String(value).replace(/([a-z])\s*-\s+([a-z])/gi, '$1$2');
const normalize = (value) => dehyphenateLineWraps(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sourceHash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const compact = (value) => dehyphenateLineWraps(value).replace(/\s+/g, ' ').trim();
const excerptFor = (pageText, expected) => {
  const haystack = compact(pageText);
  const needle = expected.map(normalize).find((item) => item && normalize(haystack).includes(item));
  const index = needle ? normalize(haystack).indexOf(needle) : -1;
  if (index < 0) return haystack.slice(0, 300);
  return haystack.slice(Math.max(0, index - 140), index + needle.length + 220);
};
const splitFor = (index) => index < 140 ? 'development' : index < 170 ? 'validation' : 'holdout';

const main = async () => {
  const binary = fs.readFileSync(sourcePdf);
  const parser = new PDFParse({ data: binary });
  const parsed = await parser.getText();
  const pages = (parsed.pages || []).map((page) => ({
    page: page.num,
    text: String(page.text || ''),
    normalizedText: compact(page.text || ''),
  }));
  if (pages.length !== 66 || pages.some((page) => !page.text.trim())) {
    throw new Error(`Unexpected parser result: pages=${pages.length}`);
  }
  const allFacts = FACTS.map(([id, question, expectedRaw, page, category, answerShape]) => ({
    id,
    question,
    requiredFacts: required(expectedRaw),
    page,
    category,
    answerShape,
    answerPolicy: 'answer',
  }));
  const cases = [...allFacts, ...REFUSALS.map(([id, question, expected, property]) => ({
    id,
    question,
    requiredFacts: [expected],
    forbiddenFacts: [],
    page: null,
    category: 'refusal_correction',
    answerShape: 'refusal',
    answerPolicy: 'refuse_insufficient_evidence',
    requestedProperty: property,
  }))].slice(0, 200);
  if (cases.length !== 200) throw new Error(`Expected 200 cases, got ${cases.length}`);

  const facts = allFacts.map((fact) => {
    const page = pages.find((item) => item.page === fact.page);
    const missing = fact.requiredFacts.filter((value) => !normalize(page?.text || '').includes(normalize(value)));
    if (missing.length) throw new Error(`Fact ${fact.id} did not verify on parser page ${fact.page}: ${missing.join(', ')}`);
    return {
      id: `fact:${fact.id}`,
      entity: null,
      property: fact.category,
      value: fact.requiredFacts,
      sourcePages: [fact.page],
      excerpt: excerptFor(page.text, fact.requiredFacts),
      confidence: 'direct',
    };
  });

  const casesWithSplits = cases.map((item, index) => ({
    id: `THESIS-${String(index + 1).padStart(3, '0')}`,
    sourceFactId: item.answerPolicy === 'answer' ? `fact:${item.id}` : null,
    question: item.question,
    split: splitFor(index),
    category: item.category,
    rubric: {
      requiredFacts: item.requiredFacts,
      forbiddenFacts: item.forbiddenFacts || [],
      refusalExpected: item.answerPolicy === 'refuse_insufficient_evidence',
      correctionExpected: item.category === 'refusal_correction' && item.id !== 'refusal-funding' && item.id !== 'refusal-budget' && item.id !== 'refusal-revenue' && item.id !== 'refusal-training-hours' && item.id !== 'refusal-sixg-tested',
      formatConstraints: item.answerShape === 'numeric' ? ['states the relevant number and unit when stated'] : [],
    },
    expected: {
      answerPolicy: item.answerPolicy,
      sourceOwner: 'reference_files',
      allowedSourceKinds: ['mode_reference_chunk', 'okf_document_card'],
      sourcePages: item.page ? [item.page] : [],
    },
  }));
  const holdout = casesWithSplits.filter((item) => item.split === 'holdout');
  const publicCases = casesWithSplits.map((item) => item.split === 'holdout'
    ? { id: item.id, question: item.question, split: item.split, category: item.category }
    : item);

  fs.mkdirSync(fixtureDir, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    source: {
      fileName: path.basename(sourcePdf),
      binarySha256: sourceHash(binary),
      parser: 'pdf-parse/PDFParse.getText',
      physicalPageCount: pages.length,
      extractedCharCount: pages.map((page) => page.text.length).reduce((total, count) => total + count, 0),
    },
    splitCounts: { development: 140, validation: 30, holdout: 30 },
  };
  fs.writeFileSync(path.join(fixtureDir, 'pages.json'), JSON.stringify({ ...manifest.source, pages }, null, 2));
  fs.writeFileSync(path.join(fixtureDir, 'document-map.json'), JSON.stringify({ source: manifest.source, facts }, null, 2));
  fs.writeFileSync(path.join(fixtureDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(fixtureDir, 'question-bank.json'), JSON.stringify({ ...manifest, cases: publicCases }, null, 2));

  const sealedDestination = process.env.NATIVELY_CONTEXT_OS_SEALED_HOLDOUT;
  if (sealedDestination) {
    fs.mkdirSync(path.dirname(sealedDestination), { recursive: true });
    fs.writeFileSync(sealedDestination, JSON.stringify({ ...manifest, cases: holdout }, null, 2));
  }
  console.log(JSON.stringify({ source: manifest.source, cases: casesWithSplits.length, sealedWritten: Boolean(sealedDestination) }, null, 2));
};

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
