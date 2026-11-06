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
var ALIASES = {
    // Cloud
    "amazon web services": "aws",
    "aws cloud": "aws",
    "ec2": "aws",
    "amazon ec2": "aws",
    "s3": "aws",
    "amazon s3": "aws",
    "lambda": "aws",
    "aws lambda": "aws",
    "google cloud platform": "gcp",
    "google cloud": "gcp",
    "gce": "gcp",
    "microsoft azure": "azure",
    "azure cloud": "azure",
    // Containers / orchestration
    "k8s": "kubernetes",
    "kube": "kubernetes",
    "eks": "kubernetes",
    "gke": "kubernetes",
    "aks": "kubernetes",
    "openshift": "kubernetes",
    "docker containers": "docker",
    "containerization": "docker",
    "containers": "docker",
    // CI/CD
    "ci/cd": "ci_cd",
    "cicd": "ci_cd",
    "ci cd": "ci_cd",
    "continuous integration": "ci_cd",
    "continuous delivery": "ci_cd",
    "continuous deployment": "ci_cd",
    "github actions": "ci_cd",
    "gitlab ci": "ci_cd",
    "jenkins": "ci_cd",
    "circleci": "ci_cd",
    "build pipelines": "ci_cd",
    "ci pipelines": "ci_cd",
    // Databases
    "postgres": "postgresql",
    "psql": "postgresql",
    "postgre sql": "postgresql",
    "ms sql": "sql_server",
    "mssql": "sql_server",
    "microsoft sql server": "sql_server",
    "relational database": "relational_databases",
    "relational databases": "relational_databases",
    "rdbms": "relational_databases",
    "sql databases": "relational_databases",
    "nosql": "nosql_databases",
    "no-sql": "nosql_databases",
    "document database": "nosql_databases",
    "mongo": "mongodb",
    "dynamo": "dynamodb",
    "dynamo db": "dynamodb",
    // Languages
    "js": "javascript",
    "ecmascript": "javascript",
    "node": "nodejs",
    "node.js": "nodejs",
    "ts": "typescript",
    "golang": "go",
    "c sharp": "csharp",
    "c#": "csharp",
    "c++": "cpp",
    "objective c": "objective_c",
    "py": "python",
    // Frontend
    "react.js": "react",
    "reactjs": "react",
    "react js": "react",
    "next.js": "nextjs",
    "next js": "nextjs",
    "vue.js": "vue",
    "vuejs": "vue",
    "angular.js": "angular",
    "angularjs": "angular",
    // ML / AI
    "machine learning": "ml",
    "deep learning": "deep_learning",
    "artificial intelligence": "ai",
    "llm": "llms",
    "large language models": "llms",
    "large language model": "llms",
    "genai": "generative_ai",
    "gen ai": "generative_ai",
    "generative ai": "generative_ai",
    "natural language processing": "nlp",
    "retrieval augmented generation": "rag",
    "retrieval-augmented generation": "rag",
    "computer vision": "cv",
    "pytorch": "pytorch",
    "tensorflow": "tensorflow",
    // Infra concepts
    "infrastructure as code": "iac",
    "iac": "iac",
    "terraform": "terraform",
    "observability": "monitoring",
    "apm": "monitoring",
    "application performance monitoring": "monitoring",
    "site reliability engineering": "sre",
    "sre": "sre",
    "distributed system": "distributed_systems",
    "distributed systems": "distributed_systems",
    "micro services": "microservices",
    "micro-services": "microservices",
    "high availability": "high_availability",
    "highly available": "high_availability",
    "ha": "high_availability",
    "incident response": "incident_response",
    "on call": "on_call",
    "on-call": "on_call",
    "oncall": "on_call",
    "postmortem": "incident_response",
    "post-mortem": "incident_response",
    "root cause analysis": "incident_response",
    "rca": "incident_response",
    // APIs
    "restful": "rest_api",
    "rest apis": "rest_api",
    "rest api": "rest_api",
    "restful apis": "rest_api",
    "graph ql": "graphql",
    "grpc": "grpc",
    "web sockets": "websockets",
    "websocket": "websockets",
    // Practice / people
    "people management": "people_management",
    "line management": "people_management",
    "team lead": "team_leadership",
    "tech lead": "team_leadership",
    "technical leadership": "team_leadership",
    "team leadership": "team_leadership",
    "mentoring": "mentorship",
    "mentorship": "mentorship",
    "coaching": "mentorship",
    "stakeholder management": "stakeholder_management",
    "cross functional": "cross_functional",
    "cross-functional": "cross_functional",
    "agile": "agile",
    "scrum": "agile",
    "kanban": "agile",
    // Business / GTM (non-engineering roles matter too)
    "customer relationship management": "crm",
    "salesforce": "crm",
    "hubspot": "crm",
    "business to business": "b2b",
    "business-to-business": "b2b",
    "account executive": "sales",
    "quota carrying": "sales",
    "quota-carrying": "sales",
    "pipeline generation": "sales_pipeline",
    "lead generation": "sales_pipeline",
    "full cycle sales": "sales",
    "full-cycle sales": "sales",
    "talent acquisition": "recruiting",
    "technical recruiting": "recruiting",
    "full cycle recruiting": "recruiting",
    "sourcing": "recruiting",
    "applicant tracking system": "ats",
    "greenhouse": "ats",
    "lever": "ats",
    "product management": "product_management",
    "roadmapping": "product_management",
    "product roadmap": "product_management",
    "user research": "user_research",
    "usability testing": "user_research",
    "design systems": "design_systems",
    "figma": "figma",
    "sketch": "figma",
    "financial modeling": "financial_modeling",
    "fp&a": "fpa",
    "financial planning and analysis": "fpa",
    "generally accepted accounting principles": "gaap",
    "gaap": "gaap",
    "process improvement": "process_improvement",
    "six sigma": "process_improvement",
    "lean": "process_improvement",
    "supply chain": "supply_chain",
    "logistics operations": "supply_chain",
    // Data
    "business intelligence": "bi",
    "power bi": "bi",
    "tableau": "bi",
    "looker": "bi",
    "etl": "etl",
    "elt": "etl",
    "data pipelines": "etl",
    "data pipeline": "etl",
    "data warehouse": "data_warehouse",
    "snowflake": "data_warehouse",
    "bigquery": "data_warehouse",
    "redshift": "data_warehouse",
    // Security
    "information security": "security",
    "infosec": "security",
    "cyber security": "security",
    "cybersecurity": "security",
    "application security": "appsec",
    "appsec": "appsec",
    "penetration testing": "pentesting",
    "pen testing": "pentesting",
    // Real-time
    "web rtc": "webrtc",
    "real time": "realtime",
    "real-time": "realtime"
};
var CANONICAL_LABELS = {
    aws: "AWS",
    gcp: "Google Cloud",
    azure: "Azure",
    kubernetes: "Kubernetes",
    ci_cd: "CI/CD",
    postgresql: "PostgreSQL",
    relational_databases: "relational databases",
    nosql_databases: "NoSQL databases",
    distributed_systems: "distributed systems",
    high_availability: "high availability",
    incident_response: "incident response",
    on_call: "on-call ownership",
    rest_api: "REST APIs",
    people_management: "people management",
    team_leadership: "technical leadership",
    stakeholder_management: "stakeholder management",
    cross_functional: "cross-functional collaboration",
    sales_pipeline: "pipeline generation",
    product_management: "product management",
    user_research: "user research",
    design_systems: "design systems",
    financial_modeling: "financial modeling",
    process_improvement: "process improvement",
    supply_chain: "supply chain",
    data_warehouse: "data warehousing",
    generative_ai: "generative AI",
    monitoring: "monitoring and observability",
    iac: "infrastructure as code",
    nodejs: "Node.js",
    nextjs: "Next.js",
    llms: "large language models"
};
var STOPWORDS = /* @__PURE__ */ new Set([
    "a",
    "an",
    "the",
    "and",
    "or",
    "of",
    "in",
    "on",
    "with",
    "for",
    "to",
    "at",
    "by",
    "experience",
    "experienced",
    "strong",
    "solid",
    "proven",
    "demonstrated",
    "excellent",
    "good",
    "deep",
    "hands",
    "hand",
    "plus",
    "years",
    "year",
    "yrs",
    "minimum",
    "least",
    "working",
    "knowledge",
    "ability",
    "able",
    "familiarity",
    "familiar",
    "understanding",
    // 2026-08-04: filler that blocked the direct-proven pass. "Proficiency with
    // PostgreSQL or another relational database" produced canonical terms
    // {proficiency, postgresql, another, relational_databases}; allCovered then
    // required evidence for "proficiency" and "another", which no résumé ever
    // supplies — observed against real Gemini (0 proven on the SWE fixture).
    "proficiency",
    "proficient",
    "another",
    "other",
    "comparable",
    "similar",
    "skills",
    "skill",
    "using",
    "use",
    "such",
    "as",
    "etc",
    "including",
    "related",
    "equivalent",
    "preferred",
    "required",
    "must",
    "have",
    "is",
    "are",
    "be",
    "you",
    "your",
    "we",
    "our",
    "their",
    "this",
    "that",
    "will",
    "can",
    "should",
    "would"
]);
function normalizeTerm(raw) {
    return String(raw ?? "").toLowerCase().replace(/[‘’“”]/g, "'").replace(/[^a-z0-9+#.\/\s-]/g, " ").replace(/\s+/g, " ").trim();
}
function canonicalize(raw) {
    const n = normalizeTerm(raw);
    if (!n)
        return "";
    if (ALIASES[n])
        return ALIASES[n];
    const singular = n.replace(/s$/, "");
    if (ALIASES[singular])
        return ALIASES[singular];
    return n.replace(/[\s\/-]+/g, "_");
}
function canonicalLabel(canonical) {
    return CANONICAL_LABELS[canonical] ?? canonical.replace(/_/g, " ");
}
function extractCanonicalTerms(text) {
    const n = normalizeTerm(text);
    if (!n)
        return [];
    const found = /* @__PURE__ */ new Set();
    const phrases = Object.keys(ALIASES).filter((k) => k.includes(" ")).sort((a, b) => b.length - a.length);
    let residual = ` ${n} `;
    for (const phrase of phrases) {
        if (residual.includes(` ${phrase} `)) {
            found.add(ALIASES[phrase]);
            residual = residual.split(` ${phrase} `).join(" ");
        }
    }
    for (const tok of residual.split(/[\s,\/]+/)) {
        const t = tok.trim().replace(/^[.\-]+|[.\-]+$/g, "");
        if (!t || t.length < 2 || STOPWORDS.has(t))
            continue;
        if (/^\d+\+?$/.test(t))
            continue;
        found.add(ALIASES[t] ?? ALIASES[t.replace(/s$/, "")] ?? t);
    }
    return Array.from(found);
}
var TRANSFER_EDGES = [
    {
        from: "webrtc",
        to: "distributed_systems",
        sharedCapability: "real-time network coordination across independent peers, session lifecycle management, and handling connection failure and recovery",
        limitation: "does not establish consensus algorithms, data partitioning, replication, or very large service scale",
        strength: 0.55
    },
    {
        from: "webrtc",
        to: "realtime",
        sharedCapability: "sub-second bidirectional media and data transport with latency and jitter as first-order constraints",
        limitation: "does not establish experience with high-throughput event streaming or message-broker architectures",
        strength: 0.8
    },
    {
        from: "aws",
        to: "cloud_infrastructure",
        sharedCapability: "provisioning, configuring, and operating compute and storage on a managed cloud provider",
        limitation: "provider-specific; does not establish equivalent depth on GCP or Azure",
        strength: 0.85
    },
    {
        from: "gcp",
        to: "cloud_infrastructure",
        sharedCapability: "provisioning, configuring, and operating compute and storage on a managed cloud provider",
        limitation: "provider-specific; does not establish equivalent depth on AWS or Azure",
        strength: 0.85
    },
    {
        from: "azure",
        to: "cloud_infrastructure",
        sharedCapability: "provisioning, configuring, and operating compute and storage on a managed cloud provider",
        limitation: "provider-specific; does not establish equivalent depth on AWS or GCP",
        strength: 0.85
    },
    {
        from: "docker",
        to: "kubernetes",
        sharedCapability: "building and running containerized workloads, image layering, and container-level configuration",
        limitation: "does not establish cluster orchestration, scheduling, service meshes, or operator patterns",
        strength: 0.45
    },
    {
        from: "aws",
        to: "kubernetes",
        sharedCapability: "deploying and operating services on managed cloud compute",
        limitation: "does not establish container orchestration, pod scheduling, or cluster operations specifically",
        strength: 0.3
    },
    {
        from: "people_management",
        to: "team_leadership",
        sharedCapability: "direct responsibility for other people's work, priorities, and development",
        limitation: "does not by itself establish technical direction-setting or architecture ownership",
        strength: 0.75
    },
    {
        from: "team_leadership",
        to: "people_management",
        sharedCapability: "coordinating and directing the work of other engineers",
        limitation: "does not establish formal reporting-line responsibility such as performance reviews, hiring, or compensation decisions",
        strength: 0.55
    },
    {
        from: "mentorship",
        to: "team_leadership",
        sharedCapability: "raising the capability of other team members through direct guidance",
        limitation: "does not establish ownership of team direction, delivery, or staffing",
        strength: 0.4
    },
    {
        from: "postgresql",
        to: "relational_databases",
        sharedCapability: "schema design, SQL querying, indexing, and transactional semantics in a relational engine",
        limitation: "engine-specific tuning and operational behaviour differ from MySQL, Oracle, or SQL Server",
        strength: 0.9
    },
    {
        from: "mysql",
        to: "relational_databases",
        sharedCapability: "schema design, SQL querying, indexing, and transactional semantics in a relational engine",
        limitation: "engine-specific tuning and operational behaviour differ from PostgreSQL, Oracle, or SQL Server",
        strength: 0.9
    },
    {
        from: "ci_cd",
        to: "devops",
        sharedCapability: "automating build, test, and release so changes reach production repeatably",
        limitation: "does not establish infrastructure provisioning, capacity planning, or production on-call ownership",
        strength: 0.6
    },
    {
        from: "monitoring",
        to: "incident_response",
        sharedCapability: "instrumenting services and detecting abnormal production behaviour",
        limitation: "detection is not resolution \u2014 does not establish incident command, mitigation, or postmortem ownership",
        strength: 0.45
    },
    {
        from: "on_call",
        to: "incident_response",
        sharedCapability: "personal responsibility for responding to production failures within a defined rotation",
        limitation: "does not establish the scale or severity of incidents handled, or formal postmortem practice",
        strength: 0.8
    },
    {
        from: "customer_support",
        to: "incident_response",
        sharedCapability: "diagnosing live user-affecting failures under time pressure and communicating status",
        limitation: "does not establish direct system remediation, rollback authority, or infrastructure-level recovery",
        strength: 0.35
    },
    {
        from: "microservices",
        to: "distributed_systems",
        sharedCapability: "designing services with independent lifecycles that coordinate over a network, including failure isolation",
        limitation: "does not establish consensus, replication, or partition-tolerance design",
        strength: 0.65
    },
    {
        from: "high_availability",
        to: "distributed_systems",
        sharedCapability: "designing for redundancy and graceful degradation under component failure",
        limitation: "does not establish data-consistency or coordination-protocol design",
        strength: 0.6
    },
    {
        from: "rag",
        to: "llms",
        sharedCapability: "building production systems around large language models, including retrieval, prompting, and evaluation",
        limitation: "does not establish model training, fine-tuning, or serving-infrastructure work",
        strength: 0.75
    },
    {
        from: "ml",
        to: "deep_learning",
        sharedCapability: "the modelling workflow \u2014 data preparation, training, evaluation, and error analysis",
        limitation: "does not establish neural-architecture design or GPU-scale training",
        strength: 0.5
    },
    {
        from: "etl",
        to: "data_warehouse",
        sharedCapability: "moving, reshaping, and loading data between systems on a schedule with correctness guarantees",
        limitation: "does not establish dimensional modelling, warehouse cost management, or query-performance tuning",
        strength: 0.6
    },
    {
        from: "bi",
        to: "data_analysis",
        sharedCapability: "turning raw data into decision-ready views for non-technical stakeholders",
        limitation: "does not establish statistical inference, experiment design, or causal analysis",
        strength: 0.6
    },
    {
        from: "sales",
        to: "sales_pipeline",
        sharedCapability: "owning revenue outcomes and moving opportunities through defined stages",
        limitation: "does not establish outbound prospecting volume or top-of-funnel generation specifically",
        strength: 0.5
    },
    {
        from: "recruiting",
        to: "stakeholder_management",
        sharedCapability: "aligning multiple decision-makers with competing priorities toward a shared outcome",
        limitation: "does not establish executive-level or commercial stakeholder ownership",
        strength: 0.4
    },
    {
        from: "product_management",
        to: "stakeholder_management",
        sharedCapability: "negotiating scope and priority across engineering, design, and commercial stakeholders",
        limitation: "does not establish the seniority of the stakeholders involved",
        strength: 0.65
    },
    {
        from: "user_research",
        to: "product_management",
        sharedCapability: "grounding product decisions in observed user behaviour rather than assumption",
        limitation: "does not establish roadmap ownership, prioritisation authority, or commercial accountability",
        strength: 0.4
    },
    {
        from: "agile",
        to: "process_improvement",
        sharedCapability: "running and adapting a defined delivery process with feedback loops",
        limitation: "does not establish formal process-improvement methodology or measured efficiency outcomes",
        strength: 0.35
    },
    {
        from: "rest_api",
        to: "graphql",
        sharedCapability: "designing and versioning network API contracts consumed by other teams",
        limitation: "does not establish schema-federation, resolver performance, or query-cost management specific to GraphQL",
        strength: 0.4
    },
    {
        from: "typescript",
        to: "javascript",
        sharedCapability: "the same runtime, standard library, and asynchronous execution model",
        limitation: "none material \u2014 TypeScript is a superset of JavaScript",
        strength: 0.95
    },
    {
        from: "react",
        to: "nextjs",
        sharedCapability: "the React component model, hooks, and rendering lifecycle that Next.js is built on",
        limitation: "does not establish server-side rendering, routing conventions, or build-pipeline specifics of Next.js",
        strength: 0.6
    }
];
var EDGE_INDEX = (() => {
    const byTarget = /* @__PURE__ */ new Map();
    for (const e of TRANSFER_EDGES) {
        const list = byTarget.get(e.to) ?? [];
        list.push(e);
        byTarget.set(e.to, list);
    }
    return byTarget;
})();
function findTransferEdges(requirementTerm, evidenceTerms) {
    const target = canonicalize(requirementTerm);
    const candidates = EDGE_INDEX.get(target);
    if (!candidates || candidates.length === 0)
        return [];
    const have = new Set(Array.from(evidenceTerms).map((t) => canonicalize(t)));
    return candidates.filter((e) => have.has(e.from)).sort((a, b) => b.strength - a.strength);
}
function termsEquivalent(a, b) {
    const ca = canonicalize(a), cb = canonicalize(b);
    if (!ca || !cb)
        return false;
    return ca === cb;
}
export { TRANSFER_EDGES, canonicalLabel, canonicalize, extractCanonicalTerms, findTransferEdges, normalizeTerm, termsEquivalent };
