// Context OS Phase 14 — contamination-suite fixtures.
//
// One shared file (profile, modes, documents, transcript, prior assistant) so
// every contamination test drives the SAME synthetic world. All content is
// synthetic; sentinel strings (NATIVELY_SENTINEL_*) let tests assert absence
// with zero false positives.

export const SENTINELS = {
  PROFILE: 'NATIVELY_SENTINEL_PROFILE_FACT',
  DOCUMENT: 'NATIVELY_SENTINEL_DOC_FACT',
  TRANSCRIPT: 'NATIVELY_SENTINEL_TRANSCRIPT_FACT',
  HINDSIGHT: 'NATIVELY_SENTINEL_HINDSIGHT_FACT',
  PRIOR_ASSISTANT: 'NATIVELY_SENTINEL_PRIOR_CLAIM',
  JD: 'NATIVELY_SENTINEL_JD_REQUIREMENT',
};

// ── Profile fixture (candidate: Rina Patel) ────────────────────────────────

export const PROFILE_FIXTURE = {
  fullName: 'Rina Patel',
  headline: 'Robotics Software Engineer',
  summary: `Robotics engineer. ${SENTINELS.PROFILE}: built the TalentScope resume screener.`,
  totalExperienceYears: 6,
  experience: [
    { title: 'Robotics Engineer', company: 'OrbitalWorks', startDate: '2020-02', endDate: 'present', highlights: [`${SENTINELS.PROFILE}: shipped the arm-control stack`] },
  ],
  projects: [
    { name: 'TalentScope', description: `${SENTINELS.PROFILE}: AI resume screener with 4 pipeline phases (ingest, parse, rank, report).`, technologies: ['Python'] },
  ],
  skills: ['Python', 'ROS', 'C++'],
  education: [{ school: 'NIT Calicut', degree: 'B.Tech', endDate: '2019' }],
};

export const JD_FIXTURE = {
  title: 'Senior Robotics Engineer',
  company: 'MechCorp',
  requirements: [`${SENTINELS.JD}: 5 years of Kubernetes`, 'Strong ROS 2'],
  responsibilities: ['Own the manipulation stack'],
};

// ── Document fixture (uploaded thesis; the "project" universe) ──────────────

export const DOC_SNIPPET_BLOCK = [
  '<active_mode_retrieved_context>',
  '  <snippet>',
  '    <source>{"sourceId":"thesis-1","fileName":"thesis.pdf","chunkIndex":2,"score":0.55,"ftsScore":0.6,"vectorScore":0.5}</source>',
  `    <text>[Section 3.1 | p12] ${SENTINELS.DOCUMENT}: the project methodology comprises four phases: perception, planning, manipulation, and evaluation.</text>`,
  '  </snippet>',
  '  <snippet>',
  '    <source>{"sourceId":"thesis-1","fileName":"thesis.pdf","chunkIndex":9,"score":0.4,"ftsScore":0.3,"vectorScore":0.5}</source>',
  `    <text>[Section 4.2 | p31] ${SENTINELS.DOCUMENT}: the system uses an NVIDIA Jetson Orin Nano as the main compute controller; the hardware includes two RGB-D cameras.</text>`,
  '  </snippet>',
  '  <snippet>',
  '    <source>{"sourceId":"thesis-1","fileName":"thesis.pdf","chunkIndex":14,"score":0.35,"ftsScore":0.3,"vectorScore":0.4}</source>',
  `    <text>[Section 6 | p50] ${SENTINELS.DOCUMENT}: this research was conducted in collaboration with Huawei Munich Research Center; the dataset contains 9,500 demonstrations and the evaluation reports an 87% success rate.</text>`,
  '  </snippet>',
  '</active_mode_retrieved_context>',
].join('\n');

// ── Transcript fixture (live meeting) ────────────────────────────────────────

export const TRANSCRIPT_FIXTURE = [
  `Interviewer: ${SENTINELS.TRANSCRIPT}: we are discussing Project Meridian today.`,
  `PM: ${SENTINELS.TRANSCRIPT}: the deadline moved to Q3, decision confirmed by leadership.`,
].join('\n');

// ── Prior assistant + Hindsight fixtures ────────────────────────────────────

export const PRIOR_ASSISTANT_FIXTURE = `${SENTINELS.PRIOR_ASSISTANT}: The project uses ESP32.`;
export const HINDSIGHT_FIXTURE = `${SENTINELS.HINDSIGHT}: two months ago the team said the controller was an Arduino.`;

// ── Kernel input builders per mode ──────────────────────────────────────────

export function kernelInputFor(mode, question) {
  const base = {
    surface: 'manual_chat',
    question,
    activeModeId: `${mode}-mode`,
    answerShape: 'general',
    voicePerspective: 'assistant_explanation',
    enforcement: 'enforce',
    hasReferenceFiles: false,
    hasProfileFacts: true,
    hasLiveTranscript: false,
  };
  switch (mode) {
    case 'document_grounded_seminar':
      return { ...base, sourceAuthority: 'reference_files_only', hasReferenceFiles: true, hasLiveTranscript: true };
    case 'interview':
      return { ...base, sourceAuthority: 'profile_plus_transcript', voicePerspective: 'first_person_candidate', hasLiveTranscript: true };
    case 'meeting':
      return { ...base, sourceAuthority: 'transcript_only', hasLiveTranscript: true, hasProfileFacts: false };
    case 'sales':
      return { ...base, sourceAuthority: 'reference_files_plus_transcript', hasReferenceFiles: true, hasLiveTranscript: true, hasProfileFacts: false };
    case 'lecture':
      return { ...base, sourceAuthority: 'reference_files_only', hasReferenceFiles: true };
    case 'general':
    default:
      return { ...base, sourceAuthority: 'general_mixed', hasLiveTranscript: true };
  }
}

/** Standard retrievers wired to the fixtures, with call tracking. */
export function trackedRetrievers(calls) {
  return {
    retrieveModeContext: () => { calls.add('mode'); return DOC_SNIPPET_BLOCK; },
    retrieveProfileContext: () => { calls.add('profile'); return `<candidate_profile>${SENTINELS.PROFILE}: built the TalentScope project — an AI resume screener; 6 years of robotics experience; skills: Python, ROS, C++; currently a Robotics Engineer at OrbitalWorks.</candidate_profile>`; },
    retrieveTranscriptContext: () => { calls.add('transcript'); return TRANSCRIPT_FIXTURE; },
    retrieveHindsight: () => { calls.add('hindsight'); return HINDSIGHT_FIXTURE; },
    retrieveMeetingRag: () => { calls.add('meeting_rag'); return `${SENTINELS.TRANSCRIPT}: earlier in this meeting the decision on Meridian scope was approved.`; },
  };
}
