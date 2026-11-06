// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var TECHNICAL_TERMS = /* @__PURE__ */ new Set([
    // Complexity & algorithms
    "o(n)",
    "o(1)",
    "o(log n)",
    "big o",
    "time complexity",
    "space complexity",
    "amortized",
    "hash map",
    "binary tree",
    "heap",
    "graph",
    "dfs",
    "bfs",
    "dynamic programming",
    "recursion",
    "memoization",
    "backtracking",
    // Systems
    "latency",
    "throughput",
    "p99",
    "p95",
    "load balancer",
    "caching",
    "redis",
    "sharding",
    "partitioning",
    "replication",
    "consensus",
    "raft",
    "paxos",
    "cap theorem",
    "eventual consistency",
    "strong consistency",
    "microservices",
    "monolith",
    "service mesh",
    "grpc",
    "protobuf",
    // Code-level
    "interface",
    "abstract class",
    "polymorphism",
    "dependency injection",
    "solid principles",
    "design pattern",
    "singleton",
    "factory",
    "observer",
    "thread safety",
    "mutex",
    "semaphore",
    "deadlock",
    "race condition",
    "garbage collection",
    "memory leak",
    "stack overflow",
    // Databases
    "sql",
    "nosql",
    "index",
    "b-tree",
    "query optimization",
    "join",
    "normalization",
    "denormalization",
    "acid",
    "transaction isolation",
    // DevOps / Infra
    "kubernetes",
    "docker",
    "ci/cd",
    "terraform",
    "helm",
    "prometheus",
    "grafana",
    "observability",
    "tracing",
    "spans",
    // ML/AI
    "transformer",
    "attention mechanism",
    "gradient descent",
    "backpropagation",
    "embedding",
    "vector database",
    "fine-tuning",
    "rag"
]);
var BUSINESS_TERMS = /* @__PURE__ */ new Set([
    "stakeholder",
    "roi",
    "business impact",
    "team dynamics",
    "cross-functional",
    "leadership",
    "mentorship",
    "collaboration",
    "communication skills",
    "culture fit",
    "values",
    "diversity",
    "inclusion",
    "growth mindset",
    "career goals",
    "career trajectory",
    "five year plan",
    "strengths",
    "weaknesses",
    "work-life balance",
    "remote work",
    "hybrid",
    "onboarding",
    "team size",
    "management style",
    "conflict resolution",
    "feedback",
    "performance review",
    "promotion",
    "compensation",
    "benefits",
    "company culture",
    "mission",
    "vision",
    "strategy",
    "roadmap",
    "quarterly goals",
    "okr",
    "kpi",
    "revenue",
    "market share",
    "customer satisfaction",
    "user experience",
    "product-market fit"
]);
var EMA_ALPHA = 0.3;
var TechnicalDepthScorer = class {
    history = [];
    currentScore = 0.5;
    // 0 = pure HR, 1 = deep technical
    /**
     * Feed an interviewer utterance to update the depth score.
     */
    addUtterance(text) {
        const words = text.toLowerCase().split(/\s+/);
        const bigrams = [];
        for (let i = 0; i < words.length - 1; i++) {
            bigrams.push(`${words[i]} ${words[i + 1]}`);
        }
        const trigrams = [];
        for (let i = 0; i < words.length - 2; i++) {
            trigrams.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
        }
        const allTerms = [...words, ...bigrams, ...trigrams];
        let techHits = 0;
        let businessHits = 0;
        for (const term of allTerms) {
            if (TECHNICAL_TERMS.has(term))
                techHits++;
            if (BUSINESS_TERMS.has(term))
                businessHits++;
        }
        const total = techHits + businessHits;
        if (total === 0)
            return;
        const utteranceScore = techHits / total;
        this.currentScore = EMA_ALPHA * utteranceScore + (1 - EMA_ALPHA) * this.currentScore;
        this.history.push({ text: text.substring(0, 100), score: utteranceScore });
        console.log(`[TechnicalDepthScorer] Utterance score: ${utteranceScore.toFixed(2)}, Running: ${this.currentScore.toFixed(2)} (tech: ${techHits}, biz: ${businessHits})`);
    }
    /**
     * Get the current technical depth score (0-1).
     */
    getScore() {
        return this.currentScore;
    }
    /**
     * Get a tone directive based on the current score.
     */
    getToneDirective() {
        if (this.currentScore < 0.35)
            return "high_level_business";
        if (this.currentScore > 0.65)
            return "deep_technical";
        return "balanced";
    }
    /**
     * Get the tone as an XML directive string for prompt injection.
     */
    getToneXML() {
        const directive = this.getToneDirective();
        switch (directive) {
            case "high_level_business":
                return "<tone>High-level, business impact focused. Use executive-friendly language, emphasize team leadership, stakeholder management, and measurable outcomes. Avoid deep technical jargon.</tone>";
            case "deep_technical":
                return "<tone>Deep technical, code-level detail. Use precise technical terminology, discuss implementation details, time/space complexity, and architectural trade-offs. The interviewer is technically sophisticated.</tone>";
            case "balanced":
            default:
                return "<tone>Balanced technical and business context. Mix implementation details with impact metrics. Adapt depth to match the question specificity.</tone>";
        }
    }
    /**
     * Reset for a new interview session.
     */
    reset() {
        this.history = [];
        this.currentScore = 0.5;
        console.log("[TechnicalDepthScorer] Reset to neutral (0.5)");
    }
    /**
     * Get the conversation depth history for debugging.
     */
    getHistory() {
        return [...this.history];
    }
};
export { TechnicalDepthScorer };
