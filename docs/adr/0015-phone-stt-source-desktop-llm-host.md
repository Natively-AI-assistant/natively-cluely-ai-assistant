# Phone may run STT; desktop stays the LLM host

Amends ADR 0011.

ADR 0011 keeps the phone from hosting a full listen→answer loop and keeps desktop as session host for LLM/planner, LESSON/corpus, and overlay compose. That still stands for **intelligence**. This effort additionally allows the **phone mic (or phone-captured audio) to be an STT source**: either device may arm listen-transport and produce transcript text that feeds the same desktop answer path. Desktop remains the LLM/planner host; we are not shipping phone-hosted What-to-Answer / RAG as the product thesis. Transcripts from phone STT merge into the shared session transcript the desktop already consumes.
