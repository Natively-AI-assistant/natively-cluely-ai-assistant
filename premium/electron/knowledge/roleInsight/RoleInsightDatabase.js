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
var import_node_crypto = require("node:crypto");
var ROLE_INSIGHT_SCHEMA_VERSION = 1;
function fingerprint(...parts) {
    const h = (0, import_node_crypto.createHash)("sha256");
    for (const p of parts) {
        h.update(String(p ?? "").replace(/\s+/g, " ").trim());
        h.update("\0");
    }
    return h.digest("hex").slice(0, 32);
}
function toJson(v) {
    return JSON.stringify(v ?? null);
}
function fromJson(raw, fallback, label) {
    if (typeof raw !== "string" || raw.length === 0)
        return fallback;
    try {
        const parsed = JSON.parse(raw);
        return parsed === null || parsed === void 0 ? fallback : parsed;
    }
    catch (e) {
        console.error(`[RoleInsightDB] Corrupt JSON in ${label}; using fallback:`, e?.message);
        return fallback;
    }
}
var RoleInsightDatabase = class {
    db;
    constructor(db) {
        this.db = db;
    }
    initializeSchema() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS role_insight_analyses (
                id TEXT PRIMARY KEY,
                resume_fingerprint TEXT NOT NULL,
                jd_fingerprint TEXT NOT NULL,
                profile_fingerprint TEXT NOT NULL,
                extractor_version INTEGER NOT NULL,
                matcher_version INTEGER NOT NULL,
                role_alignment TEXT NOT NULL,
                evidence_confidence TEXT NOT NULL,
                hard_gate_status TEXT NOT NULL,
                summary TEXT NOT NULL,
                confidence_reasons TEXT NOT NULL,
                coverage_json TEXT NOT NULL,
                hard_gates_json TEXT NOT NULL,
                source_meta_json TEXT NOT NULL,
                stage_trace_json TEXT NOT NULL,
                status TEXT NOT NULL,
                failed_stages TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS role_insight_requirements (
                id TEXT PRIMARY KEY,
                analysis_id TEXT NOT NULL,
                original_text TEXT NOT NULL,
                normalized_text TEXT NOT NULL,
                canonical_terms TEXT NOT NULL,
                source_section TEXT,
                source_char_start INTEGER,
                source_char_end INTEGER,
                category TEXT NOT NULL,
                priority TEXT NOT NULL,
                hard_gate INTEGER NOT NULL DEFAULT 0,
                explicit INTEGER NOT NULL DEFAULT 1,
                mandatory INTEGER NOT NULL DEFAULT 0,
                extraction_confidence REAL NOT NULL DEFAULT 0.5,
                supporting_passages TEXT NOT NULL,
                excluded INTEGER NOT NULL DEFAULT 0,
                ordinal INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY(analysis_id) REFERENCES role_insight_analyses(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS role_insight_evidence (
                id TEXT PRIMARY KEY,
                analysis_id TEXT NOT NULL,
                claim TEXT NOT NULL,
                category TEXT NOT NULL,
                source_type TEXT NOT NULL,
                node_id INTEGER,
                source_location TEXT NOT NULL,
                user_confirmed INTEGER NOT NULL DEFAULT 0,
                confidence REAL NOT NULL DEFAULT 0.5,
                FOREIGN KEY(analysis_id) REFERENCES role_insight_analyses(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS role_insight_assessments (
                requirement_id TEXT PRIMARY KEY,
                analysis_id TEXT NOT NULL,
                status TEXT NOT NULL,
                evidence_ids TEXT NOT NULL,
                explanation TEXT NOT NULL,
                transfer_explanation TEXT,
                limitations TEXT NOT NULL,
                missing_information TEXT NOT NULL,
                severity TEXT,
                severity_rationale TEXT,
                confidence REAL NOT NULL DEFAULT 0.5,
                user_corrected INTEGER NOT NULL DEFAULT 0,
                original_status TEXT,
                preferred_sub_status TEXT,
                FOREIGN KEY(analysis_id) REFERENCES role_insight_analyses(id) ON DELETE CASCADE
            );

            -- Append-only. A correction NEVER mutates the row that recorded the
            -- model's original conclusion; role_insight_assessments.original_status
            -- preserves it and this table records who changed what, when.
            CREATE TABLE IF NOT EXISTS role_insight_corrections (
                id TEXT PRIMARY KEY,
                analysis_id TEXT NOT NULL,
                requirement_id TEXT,
                kind TEXT NOT NULL,
                detail TEXT NOT NULL,
                previous_status TEXT,
                saved_to_profile INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(analysis_id) REFERENCES role_insight_analyses(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_ri_analyses_fp
                ON role_insight_analyses(resume_fingerprint, jd_fingerprint, profile_fingerprint);
            CREATE INDEX IF NOT EXISTS idx_ri_analyses_created ON role_insight_analyses(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_ri_requirements_analysis ON role_insight_requirements(analysis_id);
            CREATE INDEX IF NOT EXISTS idx_ri_evidence_analysis ON role_insight_evidence(analysis_id);
            CREATE INDEX IF NOT EXISTS idx_ri_assessments_analysis ON role_insight_assessments(analysis_id);
            CREATE INDEX IF NOT EXISTS idx_ri_corrections_analysis ON role_insight_corrections(analysis_id);
        `);
        console.log("[RoleInsightDB] Schema initialized");
    }
    // ── Analyses ──────────────────────────────────────────────────────────────
    saveAnalysis(a) {
        this.db.prepare(`
            INSERT OR REPLACE INTO role_insight_analyses (
                id, resume_fingerprint, jd_fingerprint, profile_fingerprint,
                extractor_version, matcher_version, role_alignment, evidence_confidence,
                hard_gate_status, summary, confidence_reasons, coverage_json,
                hard_gates_json, source_meta_json, stage_trace_json, status,
                failed_stages, created_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(a.id, a.resumeFingerprint, a.jdFingerprint, a.profileFingerprint, a.extractorVersion, a.matcherVersion, a.roleAlignment, a.evidenceConfidence, a.hardGateStatus, a.summary, toJson(a.confidenceReasons), toJson(a.coverage), toJson(a.hardGates), toJson(a.sourceMeta), toJson(a.stageTrace), a.status, toJson(a.failedStages), a.createdAt);
    }
    mapAnalysis(row) {
        if (!row)
            return null;
        return {
            id: row.id,
            resumeFingerprint: row.resume_fingerprint,
            jdFingerprint: row.jd_fingerprint,
            profileFingerprint: row.profile_fingerprint,
            extractorVersion: row.extractor_version,
            matcherVersion: row.matcher_version,
            roleAlignment: row.role_alignment,
            evidenceConfidence: row.evidence_confidence,
            hardGateStatus: row.hard_gate_status,
            summary: row.summary,
            confidenceReasons: fromJson(row.confidence_reasons, [], `analysis ${row.id}.confidence_reasons`),
            coverage: fromJson(row.coverage_json, null, `analysis ${row.id}.coverage`),
            hardGates: fromJson(row.hard_gates_json, [], `analysis ${row.id}.hard_gates`),
            sourceMeta: fromJson(row.source_meta_json, null, `analysis ${row.id}.source_meta`),
            stageTrace: fromJson(row.stage_trace_json, [], `analysis ${row.id}.stage_trace`),
            status: row.status,
            failedStages: fromJson(row.failed_stages, [], `analysis ${row.id}.failed_stages`),
            createdAt: row.created_at
        };
    }
    getLatestAnalysis() {
        const row = this.db.prepare("SELECT * FROM role_insight_analyses ORDER BY created_at DESC, rowid DESC LIMIT 1").get();
        const mapped = this.mapAnalysis(row);
        if (mapped && (!mapped.coverage || !mapped.sourceMeta)) {
            console.error(`[RoleInsightDB] Analysis ${mapped.id} is unusable (corrupt coverage/source_meta); ignoring.`);
            return null;
        }
        return mapped;
    }
    getAnalysis(id) {
        return this.mapAnalysis(this.db.prepare("SELECT * FROM role_insight_analyses WHERE id = ?").get(id));
    }
    /** History, newest first. Retained across source changes by design. */
    listAnalyses(limit = 20) {
        const rows = this.db.prepare("SELECT * FROM role_insight_analyses ORDER BY created_at DESC, rowid DESC LIMIT ?").all(limit);
        return rows.map((r) => this.mapAnalysis(r)).filter((a) => a !== null);
    }
    /** Bounded history: drop the oldest analyses beyond `keep`. Cascades. */
    pruneAnalyses(keep = 20) {
        this.db.prepare(`
            DELETE FROM role_insight_analyses WHERE id NOT IN (
                SELECT id FROM role_insight_analyses ORDER BY created_at DESC, rowid DESC LIMIT ?
            )
        `).run(keep);
    }
    // ── Requirements ──────────────────────────────────────────────────────────
    saveRequirements(reqs) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO role_insight_requirements (
                id, analysis_id, original_text, normalized_text, canonical_terms,
                source_section, source_char_start, source_char_end, category, priority,
                hard_gate, explicit, mandatory, extraction_confidence,
                supporting_passages, excluded, ordinal
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `);
        this.db.transaction(() => {
            for (const r of reqs) {
                stmt.run(r.id, r.analysisId, r.originalText, r.normalizedText, toJson(r.canonicalTerms), r.sourceSection ?? null, r.sourceCharStart, r.sourceCharEnd, r.category, r.priority, r.hardGate ? 1 : 0, r.explicit ? 1 : 0, r.mandatory ? 1 : 0, r.extractionConfidence, toJson(r.supportingPassages), r.excluded ? 1 : 0, r.ordinal);
            }
        })();
    }
    getRequirements(analysisId) {
        const rows = this.db.prepare("SELECT * FROM role_insight_requirements WHERE analysis_id = ? ORDER BY ordinal ASC").all(analysisId);
        return rows.map((row) => ({
            id: row.id,
            analysisId: row.analysis_id,
            originalText: row.original_text,
            normalizedText: row.normalized_text,
            canonicalTerms: fromJson(row.canonical_terms, [], `req ${row.id}.canonical_terms`),
            sourceSection: row.source_section ?? void 0,
            sourceCharStart: row.source_char_start ?? null,
            sourceCharEnd: row.source_char_end ?? null,
            category: row.category,
            priority: row.priority,
            hardGate: !!row.hard_gate,
            explicit: !!row.explicit,
            mandatory: !!row.mandatory,
            extractionConfidence: row.extraction_confidence,
            supportingPassages: fromJson(row.supporting_passages, [], `req ${row.id}.supporting_passages`),
            excluded: !!row.excluded,
            ordinal: row.ordinal
        }));
    }
    setRequirementExcluded(requirementId, excluded) {
        this.db.prepare("UPDATE role_insight_requirements SET excluded = ? WHERE id = ?").run(excluded ? 1 : 0, requirementId);
    }
    setRequirementPriority(requirementId, priority, mandatory) {
        this.db.prepare("UPDATE role_insight_requirements SET priority = ?, mandatory = ? WHERE id = ?").run(priority, mandatory ? 1 : 0, requirementId);
    }
    // ── Evidence ──────────────────────────────────────────────────────────────
    saveEvidence(items) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO role_insight_evidence (
                id, analysis_id, claim, category, source_type, node_id,
                source_location, user_confirmed, confidence
            ) VALUES (?,?,?,?,?,?,?,?,?)
        `);
        this.db.transaction(() => {
            for (const e of items) {
                stmt.run(e.id, e.analysisId, e.claim, e.category, e.sourceType, e.nodeId, e.sourceLocation, e.userConfirmed ? 1 : 0, e.confidence);
            }
        })();
    }
    getEvidence(analysisId) {
        const rows = this.db.prepare("SELECT * FROM role_insight_evidence WHERE analysis_id = ?").all(analysisId);
        return rows.map((row) => ({
            id: row.id,
            analysisId: row.analysis_id,
            claim: row.claim,
            category: row.category,
            sourceType: row.source_type,
            nodeId: row.node_id ?? null,
            sourceLocation: row.source_location,
            userConfirmed: !!row.user_confirmed,
            confidence: row.confidence
        }));
    }
    // ── Assessments ───────────────────────────────────────────────────────────
    saveAssessments(items) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO role_insight_assessments (
                requirement_id, analysis_id, status, evidence_ids, explanation,
                transfer_explanation, limitations, missing_information, severity,
                severity_rationale, confidence, user_corrected, original_status,
                preferred_sub_status
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `);
        this.db.transaction(() => {
            for (const a of items) {
                stmt.run(a.requirementId, a.analysisId, a.status, toJson(a.evidenceIds), a.explanation, a.transferExplanation ?? null, toJson(a.limitations), toJson(a.missingInformation), a.severity ?? null, a.severityRationale ?? null, a.confidence, a.userCorrected ? 1 : 0, a.originalStatus ?? null, a.preferredSubStatus ?? null);
            }
        })();
    }
    getAssessments(analysisId) {
        const rows = this.db.prepare("SELECT * FROM role_insight_assessments WHERE analysis_id = ?").all(analysisId);
        return rows.map((row) => ({
            requirementId: row.requirement_id,
            analysisId: row.analysis_id,
            status: row.status,
            evidenceIds: fromJson(row.evidence_ids, [], `assessment ${row.requirement_id}.evidence_ids`),
            explanation: row.explanation,
            transferExplanation: row.transfer_explanation ?? void 0,
            limitations: fromJson(row.limitations, [], `assessment ${row.requirement_id}.limitations`),
            missingInformation: fromJson(row.missing_information, [], `assessment ${row.requirement_id}.missing_information`),
            severity: row.severity ?? void 0,
            severityRationale: row.severity_rationale ?? void 0,
            confidence: row.confidence,
            userCorrected: !!row.user_corrected,
            originalStatus: row.original_status ?? void 0,
            preferredSubStatus: row.preferred_sub_status ?? void 0
        }));
    }
    // ── Corrections (append-only) ─────────────────────────────────────────────
    addCorrection(c) {
        this.db.prepare(`
            INSERT INTO role_insight_corrections (
                id, analysis_id, requirement_id, kind, detail,
                previous_status, saved_to_profile, created_at
            ) VALUES (?,?,?,?,?,?,?,?)
        `).run(c.id, c.analysisId, c.requirementId, c.kind, c.detail, c.previousStatus, c.savedToProfile ? 1 : 0, c.createdAt);
    }
    getCorrections(analysisId) {
        const rows = this.db.prepare("SELECT * FROM role_insight_corrections WHERE analysis_id = ? ORDER BY created_at ASC, rowid ASC").all(analysisId);
        return rows.map((row) => ({
            id: row.id,
            analysisId: row.analysis_id,
            requirementId: row.requirement_id ?? null,
            kind: row.kind,
            detail: row.detail,
            previousStatus: row.previous_status ?? null,
            savedToProfile: !!row.saved_to_profile,
            createdAt: row.created_at
        }));
    }
    /**
     * Adopt a new profile fingerprint for one analysis (F9): used when a
     * save-to-profile writes the analysis's own confirmed claim into the
     * profile — the analysis now includes it, so it must not read as drift.
     */
    updateProfileFingerprint(id, profileFingerprint) {
        this.db.prepare("UPDATE role_insight_analyses SET profile_fingerprint = ? WHERE id = ?").run(profileFingerprint, id);
    }
    /** Persist the recomputed summary fields after a correction changed the analysis. */
    updateAnalysisSummary(id, fields) {
        this.db.prepare(`
            UPDATE role_insight_analyses
               SET role_alignment = ?, evidence_confidence = ?, hard_gate_status = ?,
                   summary = ?, coverage_json = ?, hard_gates_json = ?, confidence_reasons = ?
             WHERE id = ?
        `).run(fields.roleAlignment, fields.evidenceConfidence, fields.hardGateStatus, fields.summary, toJson(fields.coverage), toJson(fields.hardGates), toJson(fields.confidenceReasons), id);
    }
};
export { ROLE_INSIGHT_SCHEMA_VERSION, RoleInsightDatabase, fingerprint };
