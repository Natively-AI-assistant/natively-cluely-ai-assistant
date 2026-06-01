# Real API Context Usage Report

### BE-001 (identity_manual)
Mode: manual_input | path: deterministic_fast_path | intent: intro | speaker: user
Selected context: stable_identity, resume, persona
Required facts found: Aarav Menon
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### BE-002 (identity_interviewer)
Mode: what_to_answer | path: deterministic_fast_path | intent: intro | speaker: interviewer
Selected context: stable_identity, resume, persona, live_transcript
Required facts found: Aarav Menon
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### BE-003 (projects_manual)
Mode: manual_input | path: provider_streaming | intent: profile_detail | speaker: user
Selected context: projects, resume, custom_context, persona
Required facts found: OpenRate
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### BE-004 (projects_interviewer)
Mode: what_to_answer | path: provider_streaming | intent: profile_detail | speaker: interviewer
Selected context: projects, resume, experience, custom_context, persona, live_transcript
Required facts found: OpenRate
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### BE-005 (jd_alignment)
Mode: what_to_answer | path: provider_streaming | intent: general | speaker: interviewer
Selected context: experience, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### BE-006 (skills)
Mode: manual_input | path: provider_streaming | intent: profile_detail | speaker: user
Selected context: skills, resume, custom_context, persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### BE-007 (follow_up)
Mode: what_to_answer | path: provider_streaming | intent: general | speaker: interviewer
Selected context: experience, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### BE-008 (negotiation)
Mode: what_to_answer | path: provider_streaming | intent: negotiation | speaker: interviewer
Selected context: experience, resume, custom_context, negotiation, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### BE-009 (unknown)
Mode: manual_input | path: provider_streaming | intent: general | speaker: user
Selected context: experience, resume, custom_context, persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### BE-010 (context_isolation)
Mode: what_to_answer | path: deterministic_fast_path | intent: intro | speaker: interviewer
Selected context: stable_identity, resume, persona, live_transcript
Required facts found: Aarav Menon
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### ML-001 (identity_manual)
Mode: manual_input | path: deterministic_fast_path | intent: intro | speaker: user
Selected context: stable_identity, resume, persona
Required facts found: Priya Sharma
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### ML-002 (identity_interviewer)
Mode: what_to_answer | path: deterministic_fast_path | intent: intro | speaker: interviewer
Selected context: stable_identity, resume, custom_context, persona, live_transcript
Required facts found: Priya Sharma
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### ML-003 (projects_manual)
Mode: manual_input | path: provider_streaming | intent: profile_detail | speaker: user
Selected context: projects, resume, custom_context, persona
Required facts found: LLM-Eval
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### ML-004 (projects_interviewer)
Mode: what_to_answer | path: provider_streaming | intent: profile_detail | speaker: interviewer
Selected context: projects, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### ML-005 (jd_alignment)
Mode: what_to_answer | path: provider_streaming | intent: technical | speaker: interviewer
Selected context: experience, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### ML-006 (skills)
Mode: manual_input | path: provider_streaming | intent: general | speaker: user
Selected context: skills, resume, custom_context, persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### ML-007 (follow_up)
Mode: what_to_answer | path: provider_streaming | intent: general | speaker: interviewer
Selected context: experience, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### ML-008 (persona)
Mode: manual_input | path: provider_streaming | intent: general | speaker: user
Selected context: experience, resume, custom_context, persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### ML-009 (unknown)
Mode: manual_input | path: provider_streaming | intent: general | speaker: user
Selected context: custom_context, persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### ML-010 (context_isolation)
Mode: what_to_answer | path: deterministic_fast_path | intent: intro | speaker: interviewer
Selected context: stable_identity, resume, persona, live_transcript
Required facts found: Priya Sharma
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### PM-001 (identity_manual)
Mode: manual_input | path: deterministic_fast_path | intent: intro | speaker: user
Selected context: stable_identity, resume, persona
Required facts found: Jordan Kim
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### PM-002 (interviewer_intro)
Mode: what_to_answer | path: deterministic_fast_path | intent: intro | speaker: interviewer
Selected context: stable_identity, resume, custom_context, persona, live_transcript
Required facts found: Jordan Kim
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### PM-003 (projects_manual)
Mode: manual_input | path: provider_streaming | intent: profile_detail | speaker: user
Selected context: projects, resume, experience, custom_context, persona
Required facts found: PaymentsUX Framework
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### PM-004 (behavioral)
Mode: what_to_answer | path: provider_streaming | intent: general | speaker: interviewer
Selected context: experience, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### PM-005 (jd_alignment)
Mode: manual_input | path: provider_streaming | intent: general | speaker: user
Selected context: persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### PM-006 (metrics_guard)
Mode: what_to_answer | path: provider_streaming | intent: general | speaker: interviewer
Selected context: experience, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### PM-007 (follow_up)
Mode: what_to_answer | path: provider_streaming | intent: general | speaker: interviewer
Selected context: experience, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### PM-008 (negotiation)
Mode: manual_input | path: provider_streaming | intent: negotiation | speaker: user
Selected context: experience, resume, custom_context, negotiation, persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### PM-009 (unknown)
Mode: manual_input | path: provider_streaming | intent: general | speaker: user
Selected context: custom_context, persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### PM-010 (context_isolation)
Mode: what_to_answer | path: deterministic_fast_path | intent: intro | speaker: interviewer
Selected context: stable_identity, resume, persona, live_transcript
Required facts found: Jordan Kim
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### SDR-001 (identity_manual)
Mode: manual_input | path: deterministic_fast_path | intent: intro | speaker: user
Selected context: stable_identity, resume, persona
Required facts found: Marcus Williams
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### SDR-002 (interviewer_intro)
Mode: what_to_answer | path: deterministic_fast_path | intent: intro | speaker: interviewer
Selected context: stable_identity, resume, custom_context, persona, live_transcript
Required facts found: Marcus Williams
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### SDR-003 (experience_manual)
Mode: manual_input | path: provider_streaming | intent: general | speaker: user
Selected context: experience, resume, custom_context, persona
Required facts found: Salesforce
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### SDR-004 (skill)
Mode: what_to_answer | path: provider_streaming | intent: general | speaker: interviewer
Selected context: skills, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### SDR-005 (jd_alignment)
Mode: manual_input | path: provider_streaming | intent: general | speaker: user
Selected context: experience, resume, custom_context, persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### SDR-006 (approach)
Mode: what_to_answer | path: provider_streaming | intent: general | speaker: interviewer
Selected context: experience, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### SDR-007 (follow_up)
Mode: what_to_answer | path: provider_streaming | intent: general | speaker: interviewer
Selected context: experience, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### SDR-008 (negotiation)
Mode: what_to_answer | path: provider_streaming | intent: negotiation | speaker: interviewer
Selected context: experience, resume, custom_context, negotiation, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### SDR-009 (unknown)
Mode: manual_input | path: provider_streaming | intent: general | speaker: user
Selected context: custom_context, persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### SDR-010 (context_isolation)
Mode: what_to_answer | path: deterministic_fast_path | intent: intro | speaker: interviewer
Selected context: stable_identity, resume, persona, live_transcript
Required facts found: Marcus Williams
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### UX-001 (identity_manual)
Mode: manual_input | path: deterministic_fast_path | intent: intro | speaker: user
Selected context: stable_identity, resume, persona
Required facts found: Sofia Rodriguez
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### UX-002 (interviewer_intro)
Mode: what_to_answer | path: deterministic_fast_path | intent: intro | speaker: interviewer
Selected context: stable_identity, resume, custom_context, persona, live_transcript
Required facts found: Sofia Rodriguez
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### UX-003 (projects_manual)
Mode: manual_input | path: provider_streaming | intent: profile_detail | speaker: user
Selected context: projects, resume, custom_context, persona
Required facts found: DesignToken.io
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### UX-004 (process)
Mode: what_to_answer | path: provider_streaming | intent: technical | speaker: interviewer
Selected context: experience, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### UX-005 (jd_alignment)
Mode: manual_input | path: provider_streaming | intent: profile_detail | speaker: user
Selected context: skills, resume, custom_context, persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### UX-006 (skills)
Mode: what_to_answer | path: provider_streaming | intent: technical | speaker: interviewer
Selected context: skills, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### UX-007 (follow_up)
Mode: what_to_answer | path: provider_streaming | intent: technical | speaker: interviewer
Selected context: experience, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### UX-008 (negotiation)
Mode: manual_input | path: provider_streaming | intent: negotiation | speaker: user
Selected context: experience, resume, custom_context, negotiation, persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### UX-009 (unknown)
Mode: manual_input | path: provider_streaming | intent: general | speaker: user
Selected context: custom_context, persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### UX-010 (context_isolation)
Mode: what_to_answer | path: deterministic_fast_path | intent: intro | speaker: interviewer
Selected context: stable_identity, resume, persona, live_transcript
Required facts found: Sofia Rodriguez
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### DA-001 (identity_manual)
Mode: manual_input | path: deterministic_fast_path | intent: intro | speaker: user
Selected context: stable_identity, resume, persona
Required facts found: Chen Wei
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### DA-002 (interviewer_intro)
Mode: what_to_answer | path: deterministic_fast_path | intent: intro | speaker: interviewer
Selected context: stable_identity, resume, custom_context, persona, live_transcript
Required facts found: Chen Wei
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### DA-003 (projects_manual)
Mode: manual_input | path: provider_streaming | intent: profile_detail | speaker: user
Selected context: projects, resume, custom_context, persona
Required facts found: ABTest-Framework
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### DA-004 (skill)
Mode: what_to_answer | path: provider_streaming | intent: general | speaker: interviewer
Selected context: experience, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### DA-005 (jd_alignment)
Mode: manual_input | path: provider_streaming | intent: technical | speaker: user
Selected context: persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### DA-006 (followup)
Mode: what_to_answer | path: provider_streaming | intent: general | speaker: interviewer
Selected context: experience, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### DA-007 (metrics_manual)
Mode: manual_input | path: provider_streaming | intent: general | speaker: user
Selected context: experience, resume, custom_context, persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### DA-008 (negotiation)
Mode: what_to_answer | path: provider_streaming | intent: negotiation | speaker: interviewer
Selected context: experience, resume, custom_context, negotiation, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### DA-009 (unknown)
Mode: manual_input | path: provider_streaming | intent: profile_detail | speaker: user
Selected context: projects, resume, custom_context, persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### DA-010 (regression_projects)
Mode: manual_input | path: provider_streaming | intent: profile_detail | speaker: user
Selected context: projects, resume, custom_context, persona
Required facts found: ABTest-Framework, SQL-Copilot
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### SRE-001 (identity_manual)
Mode: manual_input | path: deterministic_fast_path | intent: intro | speaker: user
Selected context: stable_identity, resume, persona
Required facts found: Kwame Osei
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### SRE-002 (interviewer_intro)
Mode: what_to_answer | path: deterministic_fast_path | intent: intro | speaker: interviewer
Selected context: stable_identity, resume, custom_context, persona, live_transcript
Required facts found: Kwame Osei
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### SRE-003 (projects_manual)
Mode: manual_input | path: provider_streaming | intent: profile_detail | speaker: user
Selected context: projects, resume, experience, custom_context, persona
Required facts found: ChaosMonkey-Pro
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### SRE-004 (behavioral)
Mode: what_to_answer | path: provider_streaming | intent: general | speaker: interviewer
Selected context: experience, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### SRE-005 (jd_alignment)
Mode: manual_input | path: provider_streaming | intent: profile_detail | speaker: user
Selected context: skills, resume, custom_context, persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### SRE-006 (skills)
Mode: what_to_answer | path: provider_streaming | intent: general | speaker: interviewer
Selected context: skills, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### SRE-007 (follow_up)
Mode: what_to_answer | path: provider_streaming | intent: general | speaker: interviewer
Selected context: experience, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### SRE-008 (negotiation)
Mode: manual_input | path: provider_streaming | intent: negotiation | speaker: user
Selected context: experience, resume, custom_context, negotiation, persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### SRE-009 (unknown)
Mode: manual_input | path: provider_streaming | intent: general | speaker: user
Selected context: custom_context, persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### SRE-010 (context_isolation)
Mode: what_to_answer | path: deterministic_fast_path | intent: intro | speaker: interviewer
Selected context: stable_identity, resume, persona, live_transcript
Required facts found: Kwame Osei
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### CSM-001 (identity_manual)
Mode: manual_input | path: deterministic_fast_path | intent: intro | speaker: user
Selected context: stable_identity, resume, persona
Required facts found: Aisha Patel
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### CSM-002 (interviewer_intro)
Mode: what_to_answer | path: deterministic_fast_path | intent: intro | speaker: interviewer
Selected context: stable_identity, resume, custom_context, persona, live_transcript
Required facts found: Aisha Patel
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### CSM-003 (experience_manual)
Mode: manual_input | path: provider_streaming | intent: general | speaker: user
Selected context: experience, resume, custom_context, persona
Required facts found: Slack
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### CSM-004 (behavioral)
Mode: what_to_answer | path: provider_streaming | intent: general | speaker: interviewer
Selected context: persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### CSM-005 (jd_alignment)
Mode: manual_input | path: provider_streaming | intent: technical | speaker: user
Selected context: experience, resume, custom_context, persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### CSM-006 (skills)
Mode: what_to_answer | path: provider_streaming | intent: general | speaker: interviewer
Selected context: skills, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### CSM-007 (follow_up)
Mode: what_to_answer | path: provider_streaming | intent: general | speaker: interviewer
Selected context: experience, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### CSM-008 (negotiation)
Mode: what_to_answer | path: provider_streaming | intent: negotiation | speaker: interviewer
Selected context: experience, resume, custom_context, negotiation, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### CSM-009 (unknown)
Mode: manual_input | path: provider_streaming | intent: general | speaker: user
Selected context: custom_context, persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### CSM-010 (context_isolation)
Mode: what_to_answer | path: deterministic_fast_path | intent: intro | speaker: interviewer
Selected context: stable_identity, resume, persona, live_transcript
Required facts found: Aisha Patel
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### CY-001 (identity_manual)
Mode: manual_input | path: deterministic_fast_path | intent: intro | speaker: user
Selected context: stable_identity, resume, persona
Required facts found: David Okonkwo
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### CY-002 (interviewer_intro)
Mode: what_to_answer | path: deterministic_fast_path | intent: intro | speaker: interviewer
Selected context: stable_identity, resume, custom_context, persona, live_transcript
Required facts found: David Okonkwo
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### CY-003 (projects_manual)
Mode: manual_input | path: provider_streaming | intent: profile_detail | speaker: user
Selected context: projects, resume, experience, custom_context, persona
Required facts found: ThreatHunter-Playbook
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### CY-004 (approach)
Mode: what_to_answer | path: provider_streaming | intent: general | speaker: interviewer
Selected context: experience, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### CY-005 (jd_alignment)
Mode: manual_input | path: provider_streaming | intent: profile_detail | speaker: user
Selected context: skills, resume, custom_context, persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### CY-006 (skills)
Mode: what_to_answer | path: provider_streaming | intent: general | speaker: interviewer
Selected context: skills, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### CY-007 (follow_up)
Mode: what_to_answer | path: provider_streaming | intent: general | speaker: interviewer
Selected context: experience, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### CY-008 (negotiation)
Mode: manual_input | path: provider_streaming | intent: negotiation | speaker: user
Selected context: experience, resume, custom_context, negotiation, persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### CY-009 (unknown)
Mode: manual_input | path: provider_streaming | intent: general | speaker: user
Selected context: custom_context, persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### CY-010 (context_isolation)
Mode: what_to_answer | path: deterministic_fast_path | intent: intro | speaker: interviewer
Selected context: stable_identity, resume, persona, live_transcript
Required facts found: David Okonkwo
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### FND-001 (identity_manual)
Mode: manual_input | path: deterministic_fast_path | intent: intro | speaker: user
Selected context: stable_identity, resume, persona
Required facts found: Michael Zhang
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### FND-002 (interviewer_intro)
Mode: what_to_answer | path: deterministic_fast_path | intent: intro | speaker: interviewer
Selected context: stable_identity, resume, custom_context, persona, live_transcript
Required facts found: Michael Zhang
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### FND-003 (projects_manual)
Mode: manual_input | path: provider_streaming | intent: profile_detail | speaker: user
Selected context: projects, resume, custom_context, persona
Required facts found: Nexus AI
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### FND-004 (approach)
Mode: what_to_answer | path: provider_streaming | intent: general | speaker: interviewer
Selected context: persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### FND-005 (jd_alignment)
Mode: manual_input | path: provider_streaming | intent: general | speaker: user
Selected context: persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### FND-006 (metrics_guard)
Mode: what_to_answer | path: provider_streaming | intent: general | speaker: interviewer
Selected context: experience, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### FND-007 (follow_up)
Mode: what_to_answer | path: provider_streaming | intent: general | speaker: interviewer
Selected context: experience, resume, custom_context, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### FND-008 (negotiation)
Mode: what_to_answer | path: provider_streaming | intent: negotiation | speaker: interviewer
Selected context: experience, resume, custom_context, negotiation, persona, live_transcript
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### FND-009 (unknown)
Mode: manual_input | path: provider_streaming | intent: general | speaker: user
Selected context: custom_context, persona
Required facts found: (none required)
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

### FND-010 (context_isolation)
Mode: what_to_answer | path: deterministic_fast_path | intent: intro | speaker: interviewer
Selected context: stable_identity, resume, persona, live_transcript
Required facts found: Michael Zhang
Missing facts: none
Forbidden facts present: none
Context pollution: none
Pass: true

## Summary
Resume used correctly: OK (31 recall cases, all required facts present)
JD used correctly: OK (10 relevant cases, no leakage)
Custom context used correctly: OK (custom_context surfaced where loaded; 75 cases)
Persona used correctly: style-only (persona layer present on 100 cases; no invented-metric failures: true)
Negotiation used correctly: OK (9 relevant cases, no leakage)
Transcript used correctly: OK (live_transcript on what_to_answer cases; follow-up targets resolved: true)
Reference files used correctly: n/a (no reference files in synthetic fixtures)
Assistant identity confusion count: 0
