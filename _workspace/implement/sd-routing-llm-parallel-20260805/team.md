# Implement run — SD routing LLM parallel

**Pattern:** Pipeline (solo)  
**Why solo:** One shared seam (`planAnswer` / `classifySdIntention` / evals); strict chain; no independent frontier tickets.  
**Frontier:** single wave — sticky exclusions → Tier A evals → classifier merge → runner → unit+eval green  
**Worktree:** main checkout (no treehouse)  
**Spec:** `.scratch/sd-routing/SPEC-llm-parallel.md`  
**ADR:** 0005
