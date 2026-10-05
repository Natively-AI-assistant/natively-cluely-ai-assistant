# Auto Answer live rig

Real capture, real STT, real judge, real answer model — nothing injected. The
interviewer is `say` rendered to a trimmed file and played on all 16 channels
of **BlackHole 16ch** (the meeting's output device, captured by the system-audio
tap); the candidate is `say` into **BlackHole 2ch** (the meeting's mic). The
overlay's own IPC listeners timestamp every answer token batch and final, so
latency is measured at the renderer, from the end of the interviewer's speech.

    NATIVELY_E2E=1 NATIVELY_CONTEXT_DEBUG=verbose NATIVELY_CONTEXT_DEBUG_INCLUDE_CONTENT=1 \
      node scripts/dev-agent.mjs 2>&1 | <timestamp every line> > app.log
    node tests/auto-answer-live/setup-profile.mjs --llm natively   # key from natively-api/.env, never printed
    node tests/auto-answer-live/aa-harness.mjs --script ti --label ti-natively
    node tests/auto-answer-live/analyze.mjs tests/auto-answer-live/results/ti-natively.json --log app.log --from <line>

`scripts.mjs` holds the labelled interviewer scripts: each turn says whether an
answer must appear (`answer`), must not (`silent`), or either is defensible.
The analyzer attributes each overlay answer to the turn its question overlaps
most, and reports misses, false fires, duplicates and stop→first-token.

Prereqs: `brew install --cask blackhole-2ch blackhole-16ch`, `brew install ffmpeg`,
macOS (the capture path is the CoreAudio tap). Windows needs its own loopback rig.
