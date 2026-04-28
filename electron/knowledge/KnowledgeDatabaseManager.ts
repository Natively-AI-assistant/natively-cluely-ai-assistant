import type Database from 'better-sqlite3';
import { DocType, StructuredResume, ActiveJD, CompanyDossier, NegotiationScript } from './types';

interface DocRow {
  id: string;
  doc_type: string;
  file_name: string | null;
  raw_text: string;
  structured_json: string;
  embedding: Buffer | null;
  created_at: string;
}

interface DossierRow {
  company_name: string;
  jd_id: string | null;
  dossier_json: string;
  created_at: string;
}

interface ScriptRow {
  id: string;
  script_json: string;
  jd_id: string | null;
  resume_id: string | null;
  created_at: string;
}

interface ResumeNodeRow {
  id: number;
  category: string;
  title: string;
  organization: string | null;
  start_date: string | null;
  end_date: string | null;
  duration_months: number | null;
  text_content: string;
  tags: string | null;
  embedding: Buffer | null;
}

export function vectorToBuffer(vec: number[]): Buffer {
  const f32 = new Float32Array(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

export function bufferToVector(buf: Buffer | null): number[] | null {
  if (!buf) return null;
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return Array.from(f32);
}

const KNOWLEDGE_SCHEMA_VERSION = 1;

export class KnowledgeDatabaseManager {
  constructor(private db: Database.Database) {
    this.migrate();
  }

  private migrate(): void {
    // Tables may pre-exist from a prior premium install with incompatible schemas.
    // We track our own schema version in app_state and rebuild the four knowledge
    // tables if it's missing/stale. Existing data (resume, JD, dossier) is junk
    // because the premium engine that wrote it isn't shipping in this build.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    const row = this.db.prepare(`SELECT value FROM app_state WHERE key = 'knowledge_schema_version'`).get() as { value: string } | undefined;
    const currentVersion = row ? parseInt(row.value, 10) : 0;

    if (currentVersion < KNOWLEDGE_SCHEMA_VERSION) {
      const tx = this.db.transaction(() => {
        // Drop legacy tables — schemas may not match what this engine expects.
        this.db.exec(`
          DROP TABLE IF EXISTS active_jd;
          DROP TABLE IF EXISTS knowledge_documents;
          DROP TABLE IF EXISTS company_dossiers;
          DROP TABLE IF EXISTS negotiation_scripts;
        `);

        this.db.exec(`
          CREATE TABLE knowledge_documents (
            id TEXT PRIMARY KEY,
            doc_type TEXT NOT NULL,
            file_name TEXT,
            raw_text TEXT NOT NULL,
            structured_json TEXT NOT NULL,
            embedding BLOB,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          );

          CREATE INDEX idx_knowledge_documents_type ON knowledge_documents(doc_type);

          CREATE TABLE active_jd (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            document_id TEXT NOT NULL,
            FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
          );

          CREATE TABLE company_dossiers (
            company_name TEXT PRIMARY KEY,
            jd_id TEXT,
            dossier_json TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE negotiation_scripts (
            id TEXT PRIMARY KEY,
            script_json TEXT NOT NULL,
            jd_id TEXT,
            resume_id TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          );
        `);

        this.db.prepare(
          `INSERT INTO app_state (key, value) VALUES ('knowledge_schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        ).run(String(KNOWLEDGE_SCHEMA_VERSION));
      });
      tx();
      console.log('[KnowledgeDatabaseManager] Schema migrated to v' + KNOWLEDGE_SCHEMA_VERSION);
    }
  }

  // ── knowledge_documents ──────────────────────────────────────

  insertDocument(params: {
    id: string;
    docType: DocType;
    fileName: string | null;
    rawText: string;
    structuredJson: string;
    embedding: number[] | null;
  }): void {
    this.db.prepare(
      `INSERT INTO knowledge_documents (id, doc_type, file_name, raw_text, structured_json, embedding)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      params.id,
      params.docType,
      params.fileName,
      params.rawText,
      params.structuredJson,
      params.embedding ? vectorToBuffer(params.embedding) : null
    );
  }

  getDocumentsByType(docType: DocType): DocRow[] {
    return this.db.prepare(
      `SELECT * FROM knowledge_documents WHERE doc_type = ? ORDER BY created_at DESC`
    ).all(docType) as DocRow[];
  }

  getDocumentById(id: string): DocRow | null {
    return (this.db.prepare(
      `SELECT * FROM knowledge_documents WHERE id = ?`
    ).get(id) as DocRow | undefined) ?? null;
  }

  deleteDocumentsByType(docType: DocType): void {
    this.db.prepare(`DELETE FROM knowledge_documents WHERE doc_type = ?`).run(docType);
  }

  // ── active_jd ────────────────────────────────────────────────

  setActiveJD(documentId: string): void {
    this.db.prepare(
      `INSERT INTO active_jd (singleton, document_id) VALUES (1, ?)
       ON CONFLICT(singleton) DO UPDATE SET document_id = excluded.document_id`
    ).run(documentId);
  }

  getActiveJDDocumentId(): string | null {
    const row = this.db.prepare(`SELECT document_id FROM active_jd WHERE singleton = 1`).get() as { document_id: string } | undefined;
    return row?.document_id ?? null;
  }

  getActiveJD(): { id: string; jd: ActiveJD } | null {
    const documentId = this.getActiveJDDocumentId();
    if (!documentId) return null;
    const doc = this.getDocumentById(documentId);
    if (!doc) return null;
    try {
      const jd = JSON.parse(doc.structured_json) as ActiveJD;
      return { id: doc.id, jd };
    } catch {
      return null;
    }
  }

  clearActiveJD(): void {
    this.db.prepare(`DELETE FROM active_jd WHERE singleton = 1`).run();
  }

  // ── company_dossiers ─────────────────────────────────────────

  upsertDossier(companyName: string, jdId: string | null, dossier: CompanyDossier): void {
    this.db.prepare(
      `INSERT INTO company_dossiers (company_name, jd_id, dossier_json, created_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(company_name) DO UPDATE SET
         jd_id = excluded.jd_id,
         dossier_json = excluded.dossier_json,
         created_at = excluded.created_at`
    ).run(companyName.toLowerCase().trim(), jdId, JSON.stringify(dossier));
  }

  getDossier(companyName: string): { dossier: CompanyDossier; createdAt: string } | null {
    const row = this.db.prepare(
      `SELECT dossier_json, created_at FROM company_dossiers WHERE company_name = ?`
    ).get(companyName.toLowerCase().trim()) as { dossier_json: string; created_at: string } | undefined;
    if (!row) return null;
    try {
      return { dossier: JSON.parse(row.dossier_json) as CompanyDossier, createdAt: row.created_at };
    } catch {
      return null;
    }
  }

  // ── negotiation_scripts ──────────────────────────────────────

  saveCurrentScript(script: NegotiationScript, jdId: string | null, resumeId: string | null): void {
    this.db.prepare(
      `INSERT INTO negotiation_scripts (id, script_json, jd_id, resume_id, created_at)
       VALUES ('current', ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         script_json = excluded.script_json,
         jd_id = excluded.jd_id,
         resume_id = excluded.resume_id,
         created_at = excluded.created_at`
    ).run(JSON.stringify(script), jdId, resumeId);
  }

  getCurrentScript(): NegotiationScript | null {
    const row = this.db.prepare(`SELECT script_json FROM negotiation_scripts WHERE id = 'current'`).get() as { script_json: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.script_json) as NegotiationScript;
    } catch {
      return null;
    }
  }

  clearCurrentScript(): void {
    this.db.prepare(`DELETE FROM negotiation_scripts WHERE id = 'current'`).run();
  }

  // ── user_profile (existing table in DatabaseManager) ─────────

  saveUserProfile(structured: StructuredResume, compactPersona: string, introShort: string, introInterview: string): void {
    this.db.prepare(`DELETE FROM user_profile`).run();
    this.db.prepare(
      `INSERT INTO user_profile (id, structured_json, compact_persona, intro_short, intro_interview)
       VALUES (1, ?, ?, ?, ?)`
    ).run(JSON.stringify(structured), compactPersona, introShort, introInterview);
  }

  getUserProfile(): { structured: StructuredResume; compactPersona: string; introShort: string; introInterview: string } | null {
    const row = this.db.prepare(
      `SELECT structured_json, compact_persona, intro_short, intro_interview FROM user_profile WHERE id = 1`
    ).get() as { structured_json: string; compact_persona: string; intro_short: string; intro_interview: string } | undefined;
    if (!row) return null;
    try {
      return {
        structured: JSON.parse(row.structured_json) as StructuredResume,
        compactPersona: row.compact_persona,
        introShort: row.intro_short ?? '',
        introInterview: row.intro_interview ?? '',
      };
    } catch {
      return null;
    }
  }

  clearUserProfile(): void {
    this.db.prepare(`DELETE FROM user_profile`).run();
  }

  // ── resume_nodes (existing table in DatabaseManager) ─────────

  insertResumeNode(params: {
    category: string;
    title: string;
    organization?: string;
    start_date?: string;
    end_date?: string;
    duration_months?: number;
    text_content: string;
    tags?: string[];
    embedding?: number[];
  }): number {
    const result = this.db.prepare(
      `INSERT INTO resume_nodes (category, title, organization, start_date, end_date, duration_months, text_content, tags, embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      params.category,
      params.title,
      params.organization ?? null,
      params.start_date ?? null,
      params.end_date ?? null,
      params.duration_months ?? null,
      params.text_content,
      params.tags ? JSON.stringify(params.tags) : null,
      params.embedding ? vectorToBuffer(params.embedding) : null
    );
    return result.lastInsertRowid as number;
  }

  getResumeNodes(): ResumeNodeRow[] {
    return this.db.prepare(`SELECT * FROM resume_nodes`).all() as ResumeNodeRow[];
  }

  countResumeNodesByCategory(): Record<string, number> {
    const rows = this.db.prepare(
      `SELECT category, COUNT(*) as count FROM resume_nodes GROUP BY category`
    ).all() as Array<{ category: string; count: number }>;
    return rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.category] = r.count;
      return acc;
    }, {});
  }

  clearResumeNodes(): void {
    this.db.prepare(`DELETE FROM resume_nodes`).run();
  }
}
