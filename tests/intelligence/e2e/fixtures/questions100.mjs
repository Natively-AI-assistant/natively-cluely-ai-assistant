// tests/intelligence/e2e/fixtures/questions100.mjs
//
// The authoritative 100-question E2E set, grouped A–K per the verification spec.
// Distribution: A15 B10 C15 D10 E10 F10 G8 H8 I8 J4 K2 = 100.
//
// Each record:
//   id, category, mode, question, expected_behavior, and category-specific hints
//   the runner uses to drive the correct live/service path and score it.
//
// Categories A–D drive the REAL manual/WTA answer path (live LLM via harness).
// Categories E–K drive the compiled intelligence SERVICES directly from
// dist-electron (deterministic engines that take injected fixtures). Hindsight
// items are marked hindsight=true so the runner records NOOP/MOCK when no server.

export const QUESTIONS = [
  // ── A. Profile identity / background (15) — manual path, candidate voice ──
  { id: 'A01', category: 'A', mode: 'manual', question: 'What is your name?', expected_behavior: 'Candidate first-person name from resume, never "I\'m Natively".', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'A02', category: 'A', mode: 'manual', question: 'Tell me about yourself.', expected_behavior: 'First-person intro grounded in resume.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'A03', category: 'A', mode: 'manual', question: 'Walk me through your background.', expected_behavior: 'Experience-arc background, first person.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'A04', category: 'A', mode: 'manual', question: 'What is your current role?', expected_behavior: 'States current/target role from profile.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'A05', category: 'A', mode: 'manual', question: 'What are your top skills?', expected_behavior: 'Lists real skills from resume.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'A06', category: 'A', mode: 'manual', question: 'What projects have you worked on?', expected_behavior: 'Lists real projects from structured resume.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'A07', category: 'A', mode: 'manual', question: 'Tell me about your best project.', expected_behavior: 'Describes a flagship project from resume.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'A08', category: 'A', mode: 'manual', question: 'What is your educational background?', expected_behavior: 'States education from resume.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'A09', category: 'A', mode: 'manual', question: 'How many years of experience do you have?', expected_behavior: 'States experience grounded in profile, no fabrication.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'A10', category: 'A', mode: 'manual', question: 'Introduce yourself for an interview.', expected_behavior: 'Polished first-person interview intro.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'A11', category: 'A', mode: 'manual', question: 'What technologies are you most experienced with?', expected_behavior: 'Names real tech from resume.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'A12', category: 'A', mode: 'manual', question: 'Give me a quick summary of who you are professionally.', expected_behavior: 'Compact professional summary, first person.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'A13', category: 'A', mode: 'manual', question: 'What is your strongest technical strength?', expected_behavior: 'Identifies a grounded strength.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'A14', category: 'A', mode: 'manual', question: 'Where have you worked?', expected_behavior: 'Lists companies/experience from resume.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'A15', category: 'A', mode: 'manual', question: 'Summarize your career so far.', expected_behavior: 'First-person career summary grounded in resume.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },

  // ── B. JD fit / profile reasoning (10) — manual path ──
  { id: 'B01', category: 'B', mode: 'manual', question: 'Why are you a good fit for this role?', expected_behavior: 'Maps profile to JD requirements, first person.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'B02', category: 'B', mode: 'manual', question: 'How does your experience match this job description?', expected_behavior: 'JD-fit reasoning grounded in resume + JD.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'B03', category: 'B', mode: 'manual', question: 'What makes you qualified for this position?', expected_behavior: 'Qualification mapping, first person.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'B04', category: 'B', mode: 'manual', question: 'Which of your skills are most relevant to this role?', expected_behavior: 'Selects JD-relevant skills from resume.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'B05', category: 'B', mode: 'manual', question: 'What gaps do you have for this role and how would you address them?', expected_behavior: 'Honest gap reasoning, no fabricated strengths.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'B06', category: 'B', mode: 'manual', question: 'Why should we hire you over other candidates?', expected_behavior: 'Differentiation grounded in real profile.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'B07', category: 'B', mode: 'manual', question: 'How would your background help you succeed here?', expected_behavior: 'Connects experience to role success.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'B08', category: 'B', mode: 'manual', question: 'What relevant experience do you bring to this job?', expected_behavior: 'Relevant experience mapped to JD.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'B09', category: 'B', mode: 'manual', question: 'How do your projects demonstrate fit for this role?', expected_behavior: 'Uses real projects to argue fit.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'B10', category: 'B', mode: 'manual', question: 'What value would you add in the first 90 days?', expected_behavior: 'Grounded value proposition, first person.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },

  // ── C. Live transcript / what-to-answer (15) — WTA path ──
  { id: 'C01', category: 'C', mode: 'what-to-answer', question: 'How would you scale Redis to handle ten times the current load?', expected_behavior: 'Technical answer on Redis scaling/sharding; no profile dump, no identity leak.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: false },
  { id: 'C02', category: 'C', mode: 'what-to-answer', question: 'How do you approach latency optimization in a read-heavy service?', expected_behavior: 'Latency optimization techniques (caching, indexing).', expectedVoice: 'first_person_candidate', profileShouldBeUsed: false },
  { id: 'C03', category: 'C', mode: 'what-to-answer', question: 'What are the tradeoffs you weigh when doing system design for a high-throughput pipeline?', expected_behavior: 'System-design tradeoffs discussion.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: false },
  { id: 'C04', category: 'C', mode: 'what-to-answer', question: 'What are your salary expectations for this role?', expected_behavior: 'Handles compensation tactfully (negotiation), no fabricated figure.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: false },
  { id: 'C05', category: 'C', mode: 'what-to-answer', question: 'Tell me about a project where you owned the end-to-end delivery.', expected_behavior: 'Ownership story grounded in real project.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'C06', category: 'C', mode: 'what-to-answer', question: 'Can you introduce yourself?', expected_behavior: 'First-person intro from resume (live copilot), never "I\'m Natively".', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'C07', category: 'C', mode: 'what-to-answer', question: 'How would you shard a Redis cluster?', expected_behavior: 'Sharding strategy, technical.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: false },
  { id: 'C08', category: 'C', mode: 'what-to-answer', question: 'What caching strategy would you use here?', expected_behavior: 'Caching strategy discussion.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: false },
  { id: 'C09', category: 'C', mode: 'what-to-answer', question: 'How do you measure and reduce p99 latency?', expected_behavior: 'p99 latency measurement/reduction.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: false },
  { id: 'C10', category: 'C', mode: 'what-to-answer', question: 'What database would you choose for this workload and why?', expected_behavior: 'DB choice reasoning with tradeoffs.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: false },
  { id: 'C11', category: 'C', mode: 'what-to-answer', question: 'How do you handle consistency versus availability tradeoffs?', expected_behavior: 'CAP/consistency tradeoffs.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: false },
  { id: 'C12', category: 'C', mode: 'what-to-answer', question: 'What is your approach to monitoring a production system?', expected_behavior: 'Monitoring/observability approach.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: false },
  { id: 'C13', category: 'C', mode: 'what-to-answer', question: 'How would you optimize a slow database query?', expected_behavior: 'Query optimization techniques.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: false },
  { id: 'C14', category: 'C', mode: 'what-to-answer', question: 'What experience do you have with distributed systems?', expected_behavior: 'Grounded distributed-systems experience, first person.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: true },
  { id: 'C15', category: 'C', mode: 'what-to-answer', question: 'Walk me through how you would design a rate limiter.', expected_behavior: 'Rate limiter design, technical.', expectedVoice: 'first_person_candidate', profileShouldBeUsed: false },

  // ── D. Same-session conversation follow-up (10) — ConversationMemoryService ──
  { id: 'D01', category: 'D', mode: 'conversation', question: 'And what about the eviction policy?', expected_behavior: 'Resolves follow-up to the prior eviction turn in the same session.', followUpExpect: 'eviction' },
  { id: 'D02', category: 'D', mode: 'conversation', question: 'Can you expand on that?', expected_behavior: 'Bare follow-up resolves to most recent turn.', followUpExpect: 'recent' },
  { id: 'D03', category: 'D', mode: 'conversation', question: 'Why is that important?', expected_behavior: 'Bare follow-up resolves to most recent turn.', followUpExpect: 'recent' },
  { id: 'D04', category: 'D', mode: 'conversation', question: 'Can you elaborate on the sharding approach?', expected_behavior: 'Resolves to the sharding turn by entity/term overlap.', followUpExpect: 'shard' },
  { id: 'D05', category: 'D', mode: 'conversation', question: 'And the latency point?', expected_behavior: 'Resolves to the latency turn.', followUpExpect: 'latency' },
  { id: 'D06', category: 'D', mode: 'conversation', question: 'What was your previous suggestion?', expected_behavior: 'Returns last assistant answer in session.', followUpExpect: 'last_answer' },
  { id: 'D07', category: 'D', mode: 'conversation', question: 'Go on.', expected_behavior: 'Bare continuation resolves to most recent turn.', followUpExpect: 'recent' },
  { id: 'D08', category: 'D', mode: 'conversation', question: 'Tell me more about caching.', expected_behavior: 'Resolves to the caching turn.', followUpExpect: 'cach' },
  { id: 'D09', category: 'D', mode: 'conversation', question: 'Why did you pick PostgreSQL?', expected_behavior: 'Resolves to the database turn by named-entity overlap.', followUpExpect: 'postgres' },
  { id: 'D10', category: 'D', mode: 'conversation', question: 'And cross-session, what did we discuss last week?', expected_behavior: 'Cross-session recall delegated to long-term provider; [] when memory disabled (no leak/break).', hindsight: true, followUpExpect: 'cross_session' },

  // ── E. Meeting memory / previous meetings (10) — MeetingMemoryService ──
  { id: 'E01', category: 'E', mode: 'meeting', question: 'What were the action items from the team meeting?', expected_behavior: 'Extracts action items from Meeting3.', meeting: 'm3_team_actions', expectField: 'actionItems' },
  { id: 'E02', category: 'E', mode: 'meeting', question: 'What decisions were made in the team meeting?', expected_behavior: 'Extracts decisions from Meeting3.', meeting: 'm3_team_actions', expectField: 'decisions' },
  { id: 'E03', category: 'E', mode: 'meeting', question: 'What questions were asked in the Redis interview?', expected_behavior: 'Extracts questions from Meeting1.', meeting: 'm1_interview_redis', expectField: 'questionsAsked' },
  { id: 'E04', category: 'E', mode: 'meeting', question: 'What topics were covered in the Redis interview?', expected_behavior: 'Extracts topics (redis/scaling/sharding) from Meeting1.', meeting: 'm1_interview_redis', expectField: 'topics', expectContains: ['redis'] },
  { id: 'E05', category: 'E', mode: 'meeting', question: 'What decision came out of the sales call?', expected_behavior: 'Extracts the discount decision from Meeting2.', meeting: 'm2_sales_pricing', expectField: 'decisions' },
  { id: 'E06', category: 'E', mode: 'meeting', question: 'What action item did the rep commit to in the sales call?', expected_behavior: 'Extracts the proposal action item from Meeting2.', meeting: 'm2_sales_pricing', expectField: 'actionItems' },
  { id: 'E07', category: 'E', mode: 'meeting', question: 'Who participated in the team meeting?', expected_behavior: 'Lists participants of Meeting3.', meeting: 'm3_team_actions', expectField: 'participants' },
  { id: 'E08', category: 'E', mode: 'meeting', question: 'What skills were discussed in the Redis interview?', expected_behavior: 'Extracts skillsDiscussed from Meeting1 (redis/caching/sharding/scalability).', meeting: 'm1_interview_redis', expectField: 'skillsDiscussed' },
  { id: 'E09', category: 'E', mode: 'meeting', question: 'Summarize the sales call.', expected_behavior: 'Builds a structured record for Meeting2 with a clean transcript.', meeting: 'm2_sales_pricing', expectField: 'cleanTranscript' },
  { id: 'E10', category: 'E', mode: 'meeting', question: 'What were the topics across the team meeting?', expected_behavior: 'Extracts topics from Meeting3.', meeting: 'm3_team_actions', expectField: 'topics' },

  // ── F. Global meeting search (10) — SearchOrchestrator.globalSearch ──
  { id: 'F01', category: 'F', mode: 'global-search', question: 'Find all meetings about Redis scaling.', query: 'redis scaling', expected_behavior: 'Ranks Redis interview meeting top for Alice; isolation holds.', scope: 'A', expectTopMeeting: 'm1_interview_redis' },
  { id: 'F02', category: 'F', mode: 'global-search', question: 'Search my meetings for pricing discussions.', query: 'pricing discount', expected_behavior: 'Surfaces the sales pricing meeting.', scope: 'A', expectMeetingPresent: 'm2_sales_pricing' },
  { id: 'F03', category: 'F', mode: 'global-search', question: 'Which meetings had action items?', query: 'action items', expected_behavior: 'Filters to meetings with action items.', scope: 'A', filter: { hasActionItems: true }, expectMeetingPresent: 'm2_sales_pricing' },
  { id: 'F04', category: 'F', mode: 'global-search', question: 'Find interviews about sharding.', query: 'sharding', expected_behavior: 'Surfaces the Redis interview.', scope: 'A', expectMeetingPresent: 'm1_interview_redis' },
  { id: 'F05', category: 'F', mode: 'global-search', question: 'Show me meetings with Acme.', query: 'acme', expected_behavior: 'Company filter surfaces Acme meetings.', scope: 'A', filter: { company: 'Acme' }, expectMeetingPresent: 'm1_interview_redis' },
  { id: 'F06', category: 'F', mode: 'global-search', question: 'Find sales calls.', query: 'sales', expected_behavior: 'Mode filter returns sales meeting.', scope: 'A', filter: { mode: 'sales' }, expectTopMeeting: 'm2_sales_pricing' },
  { id: 'F07', category: 'F', mode: 'global-search', question: 'Search for the auth migration discussion.', query: 'migrate auth service', expected_behavior: 'Surfaces the team meeting.', scope: 'A', expectMeetingPresent: 'm3_team_actions' },
  { id: 'F08', category: 'F', mode: 'global-search', question: 'Find interview questions I was asked.', query: 'interview questions', expected_behavior: 'Filter to interview-question meetings.', scope: 'A', filter: { hasInterviewQuestions: true }, expectMeetingPresent: 'm1_interview_redis' },
  { id: 'F09', category: 'F', mode: 'global-search', question: 'Find meetings about Kafka.', query: 'kafka upgrade', expected_behavior: 'Surfaces the team meeting (memory source).', scope: 'A', expectMeetingPresent: 'm3_team_actions' },
  { id: 'F10', category: 'F', mode: 'global-search', question: 'Search all meetings for everything Redis.', query: 'redis', expected_behavior: 'Isolation: Bob\'s CloudCart Redis meeting must NOT appear for Alice.', scope: 'A', expectMeetingAbsent: 'b1_cloudcart' },

  // ── G. In-meeting search (8) — SearchOrchestrator.inMeetingSearch ──
  { id: 'G01', category: 'G', mode: 'in-meeting-search', question: 'Where in this meeting did we discuss eviction?', query: 'eviction policy', expected_behavior: 'Returns the LRU eviction chunk with timestamp.', expectSnippetContains: 'eviction' },
  { id: 'G02', category: 'G', mode: 'in-meeting-search', question: 'Find where sharding was mentioned in this call.', query: 'sharding', expected_behavior: 'Returns the consistent-hashing/sharding chunk.', expectSnippetContains: 'hashing' },
  { id: 'G03', category: 'G', mode: 'in-meeting-search', question: 'When did we talk about scaling Redis?', query: 'scale redis', expected_behavior: 'Returns the scaling question chunk.', expectSnippetContains: 'scale' },
  { id: 'G04', category: 'G', mode: 'in-meeting-search', question: 'Search this transcript for caching.', query: 'caching strategy', expected_behavior: 'Returns the caching chunk.', expectSnippetContains: 'caching' },
  { id: 'G05', category: 'G', mode: 'in-meeting-search', question: 'Find the part about the cluster.', query: 'cluster', expected_behavior: 'Returns the Redis Cluster chunk.', expectSnippetContains: 'Cluster' },
  { id: 'G06', category: 'G', mode: 'in-meeting-search', question: 'Where was scalability discussed?', query: 'scalability', expected_behavior: 'Returns the scalability chunk.', expectSnippetContains: 'scalability' },
  { id: 'G07', category: 'G', mode: 'in-meeting-search', question: 'Search for write load in this meeting.', query: 'write load', expected_behavior: 'Returns the heavy-write-load chunk.', expectSnippetContains: 'write load' },
  { id: 'G08', category: 'G', mode: 'in-meeting-search', question: 'Find any mention of a unicorn in this meeting.', query: 'unicorn', expected_behavior: 'No match — returns empty (honest no-result, no hallucination).', expectEmpty: true },

  // ── H. Mode boundaries (8) — planAnswer routing/context policy ──
  { id: 'H01', category: 'H', mode: 'boundary', question: 'Reverse a linked list in Python.', source: 'manual_input', expected_behavior: 'Coding answer: profile FORBIDDEN (no resume/project leak).', expectProfilePolicy: 'forbidden', expectCoding: true },
  { id: 'H02', category: 'H', mode: 'boundary', question: 'Explain how a hash map works.', source: 'manual_input', expected_behavior: 'Technical concept: profile forbidden.', expectProfilePolicy: 'forbidden', expectCoding: false },
  { id: 'H03', category: 'H', mode: 'boundary', question: 'Our pricing is cheaper than competitors and includes support.', source: 'manual_input', activeMode: 'sales', expected_behavior: 'Sales mode: resume/JD not pulled unless asked.', expectProfilePolicyNot: 'required' },
  { id: 'H04', category: 'H', mode: 'boundary', question: 'Summarize the key points of this lecture on TCP.', source: 'manual_input', activeMode: 'lecture', expected_behavior: 'Lecture mode: no candidate profile pulled (separate from interview).', expectProfilePolicyNot: 'required' },
  { id: 'H05', category: 'H', mode: 'boundary', question: 'Why are you a strong fit for this backend role?', source: 'manual_input', activeMode: 'technical-interview', expected_behavior: 'Interview mode: profile REQUIRED.', expectProfilePolicy: 'required' },
  { id: 'H06', category: 'H', mode: 'boundary', question: 'What is the weather like today?', source: 'manual_input', activeMode: 'general', expected_behavior: 'General mode: profile not required, no profile leak.', expectProfilePolicyNot: 'required' },
  { id: 'H07', category: 'H', mode: 'boundary', question: 'I am looking for a new job, can you help me prep?', source: 'manual_input', activeMode: 'looking-for-work', expected_behavior: 'Looking-for-work: candidate-voice mode allowed to use profile.', expectCandidateVoiceMode: true },
  { id: 'H08', category: 'H', mode: 'boundary', question: 'Write a SQL query to find the second highest salary.', source: 'manual_input', expected_behavior: 'Coding/SQL: profile forbidden; "salary" here is a column, not a negotiation leak.', expectProfilePolicy: 'forbidden', expectCoding: true },

  // ── I. Lecture notes / study agent (8) — LectureIntelligenceService ──
  { id: 'I01', category: 'I', mode: 'lecture', question: 'Generate study notes for the TCP handshake lecture.', lecture: 'l1_tcp', expected_behavior: 'Structured notes: concepts/definitions for TCP handshake.', expectField: 'definitions', expectConcept: 'handshake' },
  // The deterministic concept SURFACE for a lowercase domain term lives in definitions
  // (the coreConcepts list captures only capitalized tokens — limitation noted in report).
  { id: 'I02', category: 'I', mode: 'lecture', question: 'What are the key concepts from the deadlock lecture?', lecture: 'l2_deadlock', expected_behavior: 'Surfaces the deadlock concept (via extracted definition).', expectField: 'definitions', expectConcept: 'deadlock' },
  { id: 'I03', category: 'I', mode: 'lecture', question: 'Make flashcards for the normalization lecture.', lecture: 'l3_normalization', expected_behavior: 'Flashcards generated from definitions.', expectField: 'flashcards' },
  { id: 'I04', category: 'I', mode: 'lecture', question: 'What are likely exam questions from the TCP lecture?', lecture: 'l1_tcp', expected_behavior: 'Likely exam questions generated.', expectField: 'likelyExamQuestions' },
  { id: 'I05', category: 'I', mode: 'lecture', question: 'Give me a revision checklist for the deadlock lecture.', lecture: 'l2_deadlock', expected_behavior: 'Revision checklist generated.', expectField: 'revisionChecklist' },
  { id: 'I06', category: 'I', mode: 'lecture', question: 'Define normalization from the DBMS lecture.', lecture: 'l3_normalization', expected_behavior: 'Definition extracted for normalization.', expectField: 'definitions', expectConcept: 'normalization' },
  { id: 'I07', category: 'I', mode: 'lecture', question: 'What important points were stressed in the deadlock lecture?', lecture: 'l2_deadlock', expected_behavior: 'Important points extracted.', expectField: 'importantPoints' },
  // NOTE: course-memory concept recall matches the deterministic extractor's captured
  // concepts (capitalized terms / acronyms like "TCP"), not arbitrary lowercase domain
  // words — see the report's lecture-service limitation note. We query "TCP".
  { id: 'I08', category: 'I', mode: 'lecture', question: 'Which lectures in the CN course covered the TCP protocol?', lecture: 'l1_tcp', expected_behavior: 'Course memory: lecture mentioning TCP found across the course.', courseMemory: true, expectConcept: 'TCP' },

  // ── J. Diagram intelligence (4) — DiagramIntelligenceService ──
  { id: 'J01', category: 'J', mode: 'diagram', question: 'Draw a sequence diagram of the TCP three-way handshake.', diagram: 'tcpSequence', expected_behavior: 'Valid Mermaid sequenceDiagram, labeled ai_reconstructed.', expectKind: 'sequence' },
  { id: 'J02', category: 'J', mode: 'diagram', question: 'Create a state diagram of process states.', diagram: 'deadlockState', expected_behavior: 'Valid Mermaid stateDiagram.', expectKind: 'state' },
  { id: 'J03', category: 'J', mode: 'diagram', question: 'Make a flowchart of the normalization steps.', diagram: 'normalizationFlow', expected_behavior: 'Valid Mermaid flowchart.', expectKind: 'flowchart' },
  { id: 'J04', category: 'J', mode: 'diagram', question: 'Draw a diagram of my morning coffee.', diagram: 'noStructure', expected_behavior: 'No diagram-worthy structure — returns none, does not hallucinate.', expectKind: 'none' },

  // ── K. Privacy / isolation (2) — ProfileTree + SearchOrchestrator scoping ──
  { id: 'K01', category: 'K', mode: 'privacy', question: 'As Bob, show me Alice\'s AtlasDB project.', expected_behavior: 'Bob\'s ProfileTree holds only Bob\'s facts; Alice\'s AtlasDB is unavailable (impossible by construction).', isolationKind: 'profile' },
  { id: 'K02', category: 'K', mode: 'privacy', question: 'As Bob, search all meetings for Alice\'s CloudCart-versus-AtlasDB notes.', expected_behavior: 'Global search scoped to Bob never returns Alice\'s meeting.', isolationKind: 'search' },
];
