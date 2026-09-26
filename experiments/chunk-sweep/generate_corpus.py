#!/usr/bin/env python3
"""Generate the synthetic ~63,000-character combined reference file + needles.json.

Mirrors the beta tester's structure: 5 distinct integration projects, each with
the same six section headings, unique needle facts per project, and realistic
filler prose surrounding every needle. Deterministic (seeded) so reruns are
reproducible.
"""
import json
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_MD = HERE / "corpus" / "combined_reference.md"
OUT_NEEDLES = HERE / "corpus" / "needles.json"

random.seed(20260828)

# ── Project definitions with unique needle facts ────────────────────────────
PROJECTS = [
    {
        "name": "FieldServe-CRM Sync",
        "systems": ("FieldServe (field-service operating system)", "OrbitCRM"),
        "domain": "work orders and customer accounts",
        "idem_key": "IDK-FSC-{workOrderId}-{revision}",
        "retries": "6 attempts with a backoff multiplier of 2.5",
        "dlq": "fsc-sync-dlq-workorders",
        "p95": "p95 latency SLO of 450 ms",
        "metric": "fsc_sync_lag_seconds",
        "transport": "webhook fan-out through an internal event bus",
        "language": "TypeScript on Node 20",
    },
    {
        "name": "LedgerLink",
        "systems": ("BrightBooks (billing platform)", "the Corvus ERP general ledger"),
        "domain": "invoices and journal entries",
        "idem_key": "LL-{invoiceNumber}-{fiscalPeriod}-v2",
        "retries": "4 attempts with a backoff multiplier of 3.0",
        "dlq": "ledgerlink-dlq-journal-entries",
        "p95": "p95 latency SLO of 900 ms",
        "metric": "ledgerlink_posting_failures_total",
        "transport": "nightly batch reconciliation plus a realtime delta feed",
        "language": "Kotlin services on the JVM",
    },
    {
        "name": "FleetBridge",
        "systems": ("RoadPulse telematics", "the DispatchOne routing engine"),
        "domain": "vehicle positions and job assignments",
        "idem_key": "FB-{vehicleVin}-{sequenceNumber}",
        "retries": "8 attempts with a backoff multiplier of 1.7",
        "dlq": "fleetbridge-dlq-position-events",
        "p95": "p95 latency SLO of 250 ms",
        "metric": "fleetbridge_gps_gap_ratio",
        "transport": "MQTT ingestion bridged into Kafka topics",
        "language": "Go with a small Rust codec library",
    },
    {
        "name": "StockMesh",
        "systems": ("WarehouseIQ inventory", "the Shopfront e-commerce platform"),
        "domain": "stock levels and purchase orders",
        "idem_key": "SM-{sku}-{warehouseCode}-{mutationUlid}",
        "retries": "5 attempts with a backoff multiplier of 2.0",
        "dlq": "stockmesh-dlq-stock-mutations",
        "p95": "p95 latency SLO of 600 ms",
        "metric": "stockmesh_oversell_incidents_total",
        "transport": "change-data-capture off the inventory database",
        "language": "Python with FastAPI workers",
    },
    {
        "name": "CarePoint Connect",
        "systems": ("CarePoint scheduling", "the MedFlow EHR"),
        "domain": "appointments and patient demographics",
        "idem_key": "CPC-{appointmentGuid}-{hl7MessageControlId}",
        "retries": "3 attempts with a backoff multiplier of 4.0",
        "dlq": "carepoint-dlq-adt-messages",
        "p95": "p95 latency SLO of 1200 ms",
        "metric": "carepoint_hl7_reject_rate",
        "transport": "HL7v2 interfaces wrapped behind a FHIR facade",
        "language": "C# on .NET 8",
    },
]

SECTIONS = [
    "Architecture",
    "What I Personally Built",
    "Idempotency",
    "Retries and Exception Handling",
    "Testing",
    "Post-launch Monitoring",
]

# ── Filler prose builders ───────────────────────────────────────────────────
# Varied sentence templates; {0}=project name, {1}=system A, {2}=system B,
# {3}=domain, {4}=transport, {5}=language.
FILLER = {
    "Architecture": [
        "The integration connects {1} with {2}, keeping {3} consistent across both platforms.",
        "At the core sits a stateless translation layer written in {5}, deployed as three replicas behind an internal load balancer.",
        "Data moves via {4}, which we chose after benchmarking against a plain polling design that could not meet the freshness requirements.",
        "Each side of the integration keeps its own canonical model; the mapping layer owns every field-level transformation and never lets one vendor's schema leak into the other.",
        "Configuration lives in a versioned YAML bundle that operations can roll back independently of a code deploy, which mattered twice during the first quarter.",
        "A thin anti-corruption layer isolates vendor API quirks so upgrades on either platform do not ripple through the business logic.",
        "Schema changes are handled through a compatibility gate: new fields are additive for two release cycles before any consumer may rely on them.",
        "The event contracts are documented in an internal registry, and every payload is validated against its JSON Schema before it crosses a system boundary.",
        "We deliberately avoided a shared database; all coupling is through explicit, versioned messages so either system can be re-platformed later.",
        "Back-pressure is handled with bounded queues between stages, and the ingestion edge sheds load gracefully instead of cascading failures downstream.",
    ],
    "What I Personally Built": [
        "I designed and implemented the mapping engine that translates {3} between the two systems, including the reconciliation rules for conflicting edits.",
        "I wrote the deployment pipeline, the canary rollout stage, and the rollback tooling the team still uses for every release.",
        "I owned the {5} codebase end to end, from the first proof of concept through the production hardening milestones.",
        "I built the operator dashboard that shows sync health per entity type, which support now uses as their first diagnostic stop.",
        "I ran the design reviews with both vendor teams and negotiated the webhook contract changes we needed for reliable delivery.",
        "I implemented the replay tooling that lets us reprocess any historical window without double-applying side effects.",
        "I mentored two junior engineers on the project, handing over the ingestion edge while keeping architectural review responsibility.",
        "I profiled and removed the serialization hot spots, cutting steady-state CPU by roughly a third before launch.",
    ],
    "Idempotency": [
        "Every mutation carries a deterministic idempotency key so replays and duplicate webhooks collapse into a single applied change.",
        "The idempotency key format is {6}.",
        "Keys are stored in a dedicated dedupe table with a 30-day retention window, long enough to cover every realistic replay scenario we observed.",
        "Consumers treat an already-seen key as a successful no-op and return the original result, so upstream retries are indistinguishable from first delivery.",
        "We audited every write path for hidden side effects; two email notifications had to be moved behind the dedupe check after a replay incident in staging.",
        "Partial failures are handled by making each step of the pipeline individually idempotent rather than wrapping everything in a distributed transaction.",
        "The dedupe store is checked before any external call, which keeps duplicate suppression cheap even under a webhook storm.",
    ],
    "Retries and Exception Handling": [
        "Transient failures are retried with exponential backoff and full jitter; the policy is {7}.",
        "After the retry budget is exhausted, the event is parked on a dead-letter queue named {8} for manual or automated reprocessing.",
        "Permanent failures such as validation rejections skip the retry loop entirely and land in the dead-letter queue with a structured error envelope.",
        "Every exception is classified at the boundary into transient, permanent, or unknown; unknown defaults to transient with an alert so we notice new failure shapes.",
        "The DLQ consumer annotates each parked message with the last error, attempt count, and a replay-safe flag before an operator ever touches it.",
        "Poison messages are fingerprinted so a repeating payload cannot burn the retry budget of the whole partition.",
        "Circuit breakers wrap each vendor API; a tripped breaker fails fast and drains work to the parking lot instead of stacking timeouts.",
    ],
    "Testing": [
        "Contract tests pin both vendor APIs; a recorded fixture suite replays real payload shapes against the mapping engine on every commit.",
        "Property-based tests generate randomized {3} mutations and assert that applying them twice always equals applying them once.",
        "The end-to-end suite runs against a dockerized clone of both systems, seeded with anonymized production-shaped data.",
        "Chaos runs kill the worker mid-batch and assert that recovery neither loses nor duplicates a single record.",
        "Load tests replay the worst observed production hour at 3x volume before every major release.",
        "A nightly reconciliation job diffs both systems and files a ticket automatically when drift exceeds ten records.",
        "We keep a regression corpus of every payload that ever caused an incident, and the suite refuses to ship if any of them fails again.",
    ],
    "Post-launch Monitoring": [
        "The primary health signal is the {9} metric, which pages the on-call when it breaches its burn-rate alert.",
        "We track a {10} for the end-to-end path, measured from source commit to visible effect in the target system.",
        "Dashboards break down failures by entity type, vendor endpoint, and error class, so triage starts from data instead of guesswork.",
        "Weekly operational reviews walk through DLQ depth, replay counts, and alert noise, feeding a small hardening backlog.",
        "Synthetic probes exercise the full round trip every minute with a canary record that is filtered out of business reports.",
        "Log sampling keeps verbose payload logging affordable while guaranteeing every failed message is logged in full.",
        "Alert thresholds were tuned after launch to track the real traffic envelope; the initial static thresholds paged three times in the first week for non-issues.",
    ],
}

# Needle sentences (must appear verbatim; answers are exact substrings of them).
def needle_sentences(p):
    return {
        "Idempotency": f"The idempotency key format is {p['idem_key']}.",
        "Retries and Exception Handling": (
            f"the policy is {p['retries']}",
            f"a dead-letter queue named {p['dlq']}",
        ),
        "Post-launch Monitoring": (
            f"the {p['metric']} metric",
            f"a {p['p95']} for the end-to-end path",
        ),
    }


def build_section(p, section, target_chars):
    """Assemble one section: filler sentences (with needles embedded mid-section)."""
    subs = {
        "0": p["name"], "1": p["systems"][0], "2": p["systems"][1],
        "3": p["domain"], "4": p["transport"], "5": p["language"],
        "6": p["idem_key"], "7": p["retries"], "8": p["dlq"],
        "9": p["metric"], "10": p["p95"],
    }
    sentences = []
    for tmpl in FILLER[section]:
        s = tmpl
        for k, v in subs.items():
            s = s.replace("{" + k + "}", v)
        sentences.append(s)
    # Shuffle the non-needle order a little per project for realism, but keep
    # needle-bearing sentences (those with the unique values) present exactly once.
    rng = random.Random(f"{p['name']}::{section}")
    rng.shuffle(sentences)
    # Pad with generic elaboration sentences until we reach the target length.
    generic = [
        "This decision was revisited during the post-launch review and kept unchanged.",
        "The runbook documents the manual recovery path step by step, including the rollback criteria.",
        "Stakeholders on both vendor sides signed off on the behavior before rollout.",
        "The approach survived two vendor API version bumps without a breaking change.",
        "Operational ownership was handed to the platform team after the stabilization period.",
        "Edge cases discovered in the pilot region were folded back into the automated test suite.",
        "Cost tracking showed the design stayed well inside the infrastructure budget.",
        "Documentation for this area lives alongside the code and is reviewed in the same pull requests.",
    ]
    paragraphs = []
    buf = []
    for s in sentences:
        buf.append(s)
        if len(buf) >= 3:
            paragraphs.append(" ".join(buf))
            buf = []
    if buf:
        paragraphs.append(" ".join(buf))
    gi = 0
    while sum(len(x) for x in paragraphs) < target_chars:
        extra = [generic[gi % len(generic)], generic[(gi + 3) % len(generic)]]
        gi += 1
        # Vary the padding slightly per project/section so paragraphs are not
        # byte-identical across the corpus.
        tag = rng.choice([
            "In practice,", "Over the first quarter,", "During the pilot,",
            "After stabilization,", "In the retrospective,",
        ])
        paragraphs.append(f"{tag} {' '.join(extra)}")
    return "\n\n".join(paragraphs)


def main():
    OUT_MD.parent.mkdir(parents=True, exist_ok=True)
    target_total = 63000
    per_project = target_total // len(PROJECTS)
    per_section = per_project // len(SECTIONS)

    parts = ["# Integration Project History — Combined Reference\n"]
    for p in PROJECTS:
        parts.append(f"\n## Project: {p['name']}\n")
        parts.append(
            f"Integration between {p['systems'][0]} and {p['systems'][1]}, "
            f"synchronizing {p['domain']}.\n"
        )
        for section in SECTIONS:
            parts.append(f"\n### {section}\n")
            parts.append(build_section(p, section, per_section - 100))
    text = "\n".join(parts)
    OUT_MD.write_text(text, encoding="utf-8")

    # Verify every needle survives verbatim.
    needles = []
    for p in PROJECTS:
        checks = [
            ("idempotency key format",
             f"What is the idempotency key format used on the {p['name']} project?",
             p["idem_key"]),
            ("retry policy",
             f"How many retry attempts and what backoff multiplier does {p['name']} use?",
             p["retries"]),
            ("dead-letter queue",
             f"What is the name of the dead-letter queue on the {p['name']} integration?",
             p["dlq"]),
            ("p95 SLO",
             f"What p95 latency SLO does the {p['name']} project have?",
             p["p95"]),
            ("monitoring metric",
             f"What is the primary monitoring metric name for {p['name']}?",
             p["metric"]),
        ]
        for kind, q, ans in checks:
            assert ans in text, f"needle missing from corpus: {ans}"
            needles.append({"project": p["name"], "kind": kind, "question": q, "answer": ans})

    followups = [
        {
            "project": p["name"],
            "question": "What did you monitor after launch on that project?",
            "answer": p["metric"],
        }
        for p in PROJECTS
    ]

    OUT_NEEDLES.write_text(json.dumps(
        {"direct": needles, "followups": followups}, indent=2), encoding="utf-8")
    print(f"corpus: {len(text)} chars -> {OUT_MD}")
    print(f"needles: {len(needles)} direct + {len(followups)} follow-ups -> {OUT_NEEDLES}")


if __name__ == "__main__":
    main()
