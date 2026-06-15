// electron/intelligence/LectureIntelligenceService.ts
//
// Spec Phase 14 — Lecture Intelligence V2. Turns a lecture transcript into structured
// student notes, concepts, definitions, examples, flashcards, likely exam questions,
// a revision checklist, and cross-lecture course memory.
//
// HONEST STATUS: lecture mode today is just a meeting mode + MODE_LECTURE_PROMPT — there
// is NO lecture note structure, concept extraction, flashcards, or course memory. This
// is net-new. It is built as a DETERMINISTIC structural extractor (no LLM dependency)
// so it's fast, testable, and offline-capable; a caller can OPTIONALLY pass richer
// LLM-generated prose in, but the structure (concepts/definitions/questions/checklist)
// is derived deterministically from the transcript. Lecture mode is kept SEPARATE from
// interview/sales (non-negotiable rule #9) — nothing here pulls candidate profile.
//
// Pure, bounded, never throws.

export interface LectureSegment {
  speaker?: string;
  text: string;
  timestamp?: number;
}

export interface LectureConcept {
  term: string;
  definition?: string;
  mentions: number;
}

export interface Flashcard {
  front: string;
  back: string;
}

export interface LectureNotes {
  title: string;
  date?: number;
  course?: string;
  topicsCovered: string[];
  coreConcepts: LectureConcept[];
  definitions: Array<{ term: string; definition: string }>;
  examples: string[];
  importantPoints: string[];
  likelyExamQuestions: string[];
  flashcards: Flashcard[];
  revisionChecklist: string[];
  cleanNotes: string;
}

export interface BuildLectureNotesInput {
  lectureId: string;
  segments: LectureSegment[];
  title?: string;
  course?: string;
  date?: number;
}

// "X is/are/refers to/means/is defined as Y" → a definition.
const DEFINITION_RE = /\b([A-Z][a-zA-Z0-9 +./-]{2,40}?)\s+(?:is|are|refers to|means|is defined as|is called|can be defined as)\s+([^.!?]{8,200})[.!?]/g;
// Emphasis cues the professor stressed.
const IMPORTANT_RE = /\b(important|note that|remember|key (point|idea|concept)|crucial|must|always|never|the main|fundamental|essential|exam|will be tested)\b/i;
// Example cues.
const EXAMPLE_RE = /\b(for example|for instance|e\.g\.|such as|consider|let'?s say|imagine|suppose)\b/i;

const STOP = new Set(['the', 'this', 'that', 'these', 'those', 'and', 'but', 'for', 'are', 'was', 'were', 'with', 'about', 'into', 'from', 'they', 'their', 'there', 'here', 'what', 'when', 'where', 'which', 'who', 'why', 'how', 'will', 'can', 'could', 'would', 'should', 'now', 'then', 'also', 'very', 'just', 'okay', 'right', 'well', 'today', 'going', 'lecture', 'class']);

const clean = (t: string) => (t || '').replace(/\b(uh|um|ah|hmm|er|erm)\b/gi, '').replace(/\s+/g, ' ').trim();
const dedupe = (a: string[]) => [...new Set(a.map((s) => s.trim()).filter(Boolean))];

/** Extracts concepts (frequent capitalized terms) + definitions from a transcript. */
export class LectureConceptExtractor {
  extract(segments: LectureSegment[], maxConcepts = 12): { concepts: LectureConcept[]; definitions: Array<{ term: string; definition: string }> } {
    try {
      const fullText = segments.map((s) => clean(s?.text || '')).filter(Boolean).join('. ');
      // Concept frequency: capitalized multi-char terms + known lowercase tech terms.
      const counts = new Map<string, number>();
      for (const tok of fullText.match(/\b[A-Z][a-zA-Z0-9+./-]{2,}\b/g) || []) {
        const k = tok.toLowerCase();
        if (STOP.has(k)) continue;
        counts.set(tok, (counts.get(tok) || 0) + 1);
      }
      // Definitions.
      const definitions: Array<{ term: string; definition: string }> = [];
      let m: RegExpExecArray | null;
      DEFINITION_RE.lastIndex = 0;
      while ((m = DEFINITION_RE.exec(fullText)) !== null) {
        const term = m[1].trim();
        if (STOP.has(term.toLowerCase())) continue;
        definitions.push({ term, definition: m[2].trim() });
        if (definitions.length >= maxConcepts) break;
      }
      const defByTerm = new Map(definitions.map((d) => [d.term.toLowerCase(), d.definition]));
      const concepts: LectureConcept[] = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxConcepts)
        .map(([term, mentions]) => ({ term, mentions, definition: defByTerm.get(term.toLowerCase()) }));
      return { concepts, definitions: dedupeDefs(definitions) };
    } catch {
      return { concepts: [], definitions: [] };
    }
  }
}

function dedupeDefs(defs: Array<{ term: string; definition: string }>): Array<{ term: string; definition: string }> {
  const seen = new Set<string>();
  const out: Array<{ term: string; definition: string }> = [];
  for (const d of defs) {
    const k = d.term.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(d);
  }
  return out;
}

/** Generates flashcards, likely exam questions, and a revision checklist. */
export class LectureRevisionGenerator {
  flashcards(concepts: LectureConcept[], definitions: Array<{ term: string; definition: string }>, max = 12): Flashcard[] {
    const cards: Flashcard[] = [];
    for (const d of definitions) cards.push({ front: `What is ${d.term}?`, back: d.definition });
    for (const c of concepts) {
      if (c.definition && !cards.some((x) => x.front.includes(c.term))) cards.push({ front: `What is ${c.term}?`, back: c.definition });
    }
    return cards.slice(0, max);
  }

  examQuestions(concepts: LectureConcept[], importantPoints: string[], max = 10): string[] {
    const qs: string[] = [];
    for (const c of concepts.slice(0, 6)) {
      qs.push(`Explain ${c.term} and its role.`);
      if (c.definition) qs.push(`Define ${c.term}.`);
    }
    for (const p of importantPoints.slice(0, 3)) {
      const topic = p.replace(IMPORTANT_RE, '').replace(/^[\s,:-]+/, '').slice(0, 80).trim();
      if (topic.length > 12) qs.push(`Why is it important that ${topic}?`);
    }
    return dedupe(qs).slice(0, max);
  }

  revisionChecklist(concepts: LectureConcept[], max = 12): string[] {
    return concepts.slice(0, max).map((c) => `Review: ${c.term}${c.definition ? '' : ' (find a definition)'}`);
  }
}

/** Builds structured lecture notes (the spec's note format). */
export class LectureNoteGenerator {
  private readonly concepts = new LectureConceptExtractor();
  private readonly revision = new LectureRevisionGenerator();

  build(input: BuildLectureNotesInput): LectureNotes {
    const segments = Array.isArray(input.segments) ? input.segments : [];
    const lines = segments.map((s) => clean(s?.text || '')).filter(Boolean);
    const { concepts, definitions } = this.concepts.extract(segments);

    const importantPoints = dedupe(lines.filter((l) => IMPORTANT_RE.test(l))).slice(0, 10);
    const examples = dedupe(lines.filter((l) => EXAMPLE_RE.test(l))).slice(0, 8);
    const topicsCovered = dedupe(concepts.map((c) => c.term)).slice(0, 12);

    const flashcards = this.revision.flashcards(concepts, definitions);
    const likelyExamQuestions = this.revision.examQuestions(concepts, importantPoints);
    const revisionChecklist = this.revision.revisionChecklist(concepts);

    const cleanNotes = [
      `# ${input.title || 'Lecture Notes'}`,
      input.course ? `Course: ${input.course}` : '',
      '',
      '## Topics Covered',
      ...topicsCovered.map((t) => `- ${t}`),
      '',
      '## Key Definitions',
      ...definitions.map((d) => `- **${d.term}**: ${d.definition}`),
      '',
      '## Important Points',
      ...importantPoints.map((p) => `- ${p}`),
    ].filter((l) => l !== undefined).join('\n');

    return {
      title: input.title || 'Lecture Notes',
      date: input.date,
      course: input.course,
      topicsCovered,
      coreConcepts: concepts,
      definitions,
      examples,
      importantPoints,
      likelyExamQuestions,
      flashcards,
      revisionChecklist,
      cleanNotes,
    };
  }
}

export interface CourseMemoryEntry {
  courseId: string;
  lectureId: string;
  topics: string[];
  concepts: string[];
  summary: string;
}

/** Cross-lecture course memory — accumulates topics/concepts across a course. */
export class CourseMemoryService {
  private byCourse = new Map<string, CourseMemoryEntry[]>();

  addLecture(entry: CourseMemoryEntry): void {
    try {
      const arr = this.byCourse.get(entry.courseId) || [];
      // Replace an existing entry for the same lecture (idempotent re-processing).
      const idx = arr.findIndex((e) => e.lectureId === entry.lectureId);
      if (idx >= 0) arr[idx] = entry; else arr.push(entry);
      this.byCourse.set(entry.courseId, arr);
    } catch { /* never throw */ }
  }

  /** Which lectures in a course mention a concept? */
  lecturesMentioning(courseId: string, concept: string): CourseMemoryEntry[] {
    const arr = this.byCourse.get(courseId) || [];
    const c = concept.toLowerCase();
    return arr.filter((e) => e.concepts.some((x) => x.toLowerCase().includes(c)) || e.topics.some((x) => x.toLowerCase().includes(c)));
  }

  /** All distinct concepts across a course (for a revision plan). */
  courseConcepts(courseId: string): string[] {
    const arr = this.byCourse.get(courseId) || [];
    return dedupe(arr.flatMap((e) => e.concepts));
  }

  lectureCount(courseId: string): number {
    return (this.byCourse.get(courseId) || []).length;
  }
}

/** Facade: one entry point for lecture intelligence. */
export class LectureIntelligenceService {
  private readonly notes = new LectureNoteGenerator();
  readonly courseMemory = new CourseMemoryService();

  generateNotes(input: BuildLectureNotesInput): LectureNotes {
    const notes = this.notes.build(input);
    if (input.course) {
      this.courseMemory.addLecture({
        courseId: input.course,
        lectureId: input.lectureId,
        topics: notes.topicsCovered,
        concepts: notes.coreConcepts.map((c) => c.term),
        summary: notes.importantPoints.slice(0, 3).join(' '),
      });
    }
    return notes;
  }
}
