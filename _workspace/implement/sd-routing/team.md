# Implement team — sd-routing

**Run:** `sd-routing`  
**Pattern:** Pipeline (solo) — tickets 01+02 share AnswerPlanner; 03 after  
**Frontier wave 1:** 01 then 02 (serial)  
**Wave 2:** 03 llm-eval no leftover  

## Seams
- Primary: `planAnswer` routing matrix (TDD)
- Sticky answerType when SD armed
- `evals/sd-routing` full coverage

## Notes
- Glossary + ADR 0004 exported
- Hybrid = front door + llm-eval on **all** scenarios (no ungated leftover)
