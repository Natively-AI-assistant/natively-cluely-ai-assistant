// electron/knowledge/types.ts
// Typed identity for documents ingested into the knowledge base (resume, JD,
// reference files, and — added ahead of the lesson-content ticket so the enum
// stays stable — lesson content). Persisted verbatim into
// knowledge_documents.doc_type, so the string values are a schema contract:
// never rename them without a migration.

export enum DocType {
    RESUME = 'resume',
    JD = 'jd',
    REFERENCE = 'reference',
    LESSON = 'lesson',
}
