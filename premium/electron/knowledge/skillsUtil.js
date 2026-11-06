// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { SKILL_CATEGORIES } from "./types";
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
// premium/electron/knowledge/skillsUtil.ts
function emptySkills() {
    return { languages: [], frameworks: [], cloud: [], databases: [], ml: [], devops: [], tools: [] };
}
function dedupePreserveOrder(items) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const raw of items) {
        if (typeof raw !== "string")
            continue;
        const v = raw.trim();
        if (!v)
            continue;
        const key = v.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(v);
    }
    return out;
}
function flattenSkills(skills) {
    if (!skills)
        return [];
    const all = [];
    for (const cat of SKILL_CATEGORIES) {
        const arr = skills[cat];
        if (Array.isArray(arr))
            all.push(...arr);
    }
    return dedupePreserveOrder(all);
}
function coerceSkills(raw) {
    if (!raw)
        return emptySkills();
    if (Array.isArray(raw)) {
        return categorizeFlatSkills(raw);
    }
    if (typeof raw === "object") {
        const out = emptySkills();
        const leftover = [];
        for (const [key, val] of Object.entries(raw)) {
            if (!Array.isArray(val))
                continue;
            const arr = val.filter((x) => typeof x === "string");
            if (SKILL_CATEGORIES.includes(key)) {
                out[key].push(...arr);
            }
            else {
                leftover.push(...arr);
            }
        }
        if (leftover.length)
            out.tools.push(...leftover);
        for (const cat of SKILL_CATEGORIES) {
            out[cat] = dedupePreserveOrder(out[cat]);
        }
        return out;
    }
    return emptySkills();
}
var norm = (s) => s.toLowerCase().replace(/[\s._-]+/g, "");
var CATEGORY_RULES = [
    {
        cat: "languages",
        exact: new Set([
            "python",
            "typescript",
            "javascript",
            "js",
            "ts",
            "java",
            "go",
            "golang",
            "rust",
            "c",
            "cpp",
            "c++",
            "csharp",
            "c#",
            "ruby",
            "php",
            "swift",
            "kotlin",
            "scala",
            "r",
            "sql",
            "bash",
            "shell",
            "perl",
            "haskell",
            "elixir",
            "dart",
            "objectivec",
            "lua",
            "matlab",
            "solidity",
            "clojure",
            "erlang",
            "fsharp",
            "groovy",
            "html",
            "css"
        ].map(norm)),
        includes: []
    },
    {
        cat: "ml",
        exact: new Set([
            "pytorch",
            "tensorflow",
            "keras",
            "scikitlearn",
            "sklearn",
            "xgboost",
            "lightgbm",
            "huggingface",
            "transformers",
            "langchain",
            "llamaindex",
            "rag",
            "llm",
            "llms",
            "opencv",
            "spacy",
            "nltk",
            "pandas",
            "numpy",
            "jupyter",
            "mlflow",
            "onnx",
            "cuda",
            "ollama",
            "diffusers",
            "finetuning",
            "embeddings",
            "vectorsearch"
        ].map(norm)),
        includes: [
            "machinelearning",
            "deeplearning",
            "neuralnet",
            "nlp",
            "computervision",
            "genai",
            "generativeai",
            "gpt",
            "bert",
            "diffusion"
        ]
    },
    {
        cat: "cloud",
        exact: new Set([
            "aws",
            "gcp",
            "azure",
            "vercel",
            "netlify",
            "cloudflare",
            "heroku",
            "digitalocean",
            "lambda",
            "s3",
            "ec2",
            "cloudfront",
            "firebase",
            "supabase",
            "render",
            "fly",
            "cloudrun",
            "gke",
            "eks",
            "aks",
            "route53"
        ].map(norm)),
        includes: ["amazonwebservices", "googlecloud", "azurecloud"]
    },
    {
        cat: "databases",
        exact: new Set([
            "postgres",
            "postgresql",
            "mysql",
            "sqlite",
            "mongodb",
            "mongo",
            "redis",
            "cassandra",
            "dynamodb",
            "elasticsearch",
            "neo4j",
            "mariadb",
            "oracle",
            "mssql",
            "cockroachdb",
            "pgvector",
            "pinecone",
            "weaviate",
            "qdrant",
            "chroma",
            "snowflake",
            "bigquery",
            "clickhouse",
            "influxdb",
            "couchbase",
            "firestore"
        ].map(norm)),
        includes: ["database"]
    },
    {
        cat: "devops",
        exact: new Set([
            "docker",
            "kubernetes",
            "k8s",
            "terraform",
            "ansible",
            "jenkins",
            "githubactions",
            "gitlabci",
            "circleci",
            "travisci",
            "helm",
            "prometheus",
            "grafana",
            "datadog",
            "nginx",
            "apache",
            "kafka",
            "rabbitmq",
            "airflow",
            "argocd",
            "vault",
            "consul",
            "packer",
            "pulumi",
            "cicd"
        ].map(norm)),
        includes: ["cicd", "continuousintegration", "continuousdeployment", "infrastructure"]
    },
    {
        cat: "frameworks",
        exact: new Set([
            "react",
            "reactjs",
            "nextjs",
            "next",
            "vue",
            "vuejs",
            "nuxt",
            "angular",
            "svelte",
            "sveltekit",
            "django",
            "flask",
            "fastapi",
            "express",
            "expressjs",
            "nestjs",
            "spring",
            "springboot",
            "rails",
            "rubyonrails",
            "laravel",
            "symfony",
            "dotnet",
            "aspnet",
            "nodejs",
            "node",
            "deno",
            "bun",
            "electron",
            "flutter",
            "reactnative",
            "tailwind",
            "tailwindcss",
            "bootstrap",
            "graphql",
            "redux",
            "jquery",
            "gatsby",
            "remix",
            "astro",
            "vite",
            "webpack",
            "pytest",
            "jest",
            "vitest",
            "playwright",
            "cypress",
            "selenium"
        ].map(norm)),
        includes: []
    }
];
function classifySkill(skill) {
    const n = norm(skill);
    if (!n)
        return "tools";
    for (const rule of CATEGORY_RULES) {
        if (rule.exact.has(n))
            return rule.cat;
    }
    for (const rule of CATEGORY_RULES) {
        for (const sub of rule.includes) {
            if (n.includes(sub))
                return rule.cat;
        }
    }
    return "tools";
}
function categorizeFlatSkills(flat) {
    const out = emptySkills();
    if (!Array.isArray(flat))
        return out;
    for (const skill of flat) {
        if (typeof skill !== "string" || !skill.trim())
            continue;
        out[classifySkill(skill)].push(skill.trim());
    }
    for (const cat of SKILL_CATEGORIES) {
        out[cat] = dedupePreserveOrder(out[cat]);
    }
    return out;
}
function isLegacyFlatSkills(raw) {
    return Array.isArray(raw);
}
var SKILL_CATEGORY_QUERY_RULES = [
    { cat: "languages", patterns: [/\blanguages?\b/, /programming languages?/, /coding languages?/, /\blangs?\b/] },
    { cat: "ml", patterns: [/\bml\b/, /machine learning/, /\bai\b/, /artificial intelligence/, /deep learning/, /\bnlp\b/, /\bllms?\b/, /data science/] },
    { cat: "cloud", patterns: [/\bcloud\b/, /\baws\b/, /\bgcp\b/, /\bazure\b/, /cloud platforms?/, /cloud services?/] },
    { cat: "devops", patterns: [/\bdevops\b/, /\bci\/?cd\b/, /infrastructure/, /\bcontainers?\b/, /orchestration/, /\bk8s\b/, /kubernetes/, /\bdocker\b/, /deployment tools?/, /monitoring tools?/, /observability/] },
    { cat: "databases", patterns: [/\bdatabases?\b/, /\bdbs?\b/, /\bsql\b/, /data ?stores?/, /\bdata storage\b/] },
    { cat: "frameworks", patterns: [/\bframeworks?\b/, /\blibraries\b/, /\blibs?\b/, /tech stack/, /\bstack\b/] }
];
function detectSkillCategories(question) {
    const q = question.toLowerCase();
    const hit = [];
    for (const rule of SKILL_CATEGORY_QUERY_RULES) {
        if (rule.patterns.some((p) => p.test(q)))
            hit.push(rule.cat);
    }
    return hit;
}
export { categorizeFlatSkills, classifySkill, coerceSkills, detectSkillCategories, emptySkills, flattenSkills, isLegacyFlatSkills };
