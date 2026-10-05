export const SUPPORTED_DIAGRAM_TYPES: readonly string[];
export const DIAGRAM_LIMITS: Readonly<{ maxSourceChars: number; maxLines: number; maxNodes: number; maxEdges: number }>;
export const DIAGRAM_REJECTION: Readonly<{
  EMPTY: 'empty';
  UNSUPPORTED_TYPE: 'unsupported_type';
  TOO_LARGE: 'too_large';
  REMOTE_RESOURCE: 'remote_resource';
  RAW_HTML: 'raw_html';
}>;

export interface DiagramComplexity {
  nodes: number;
  edges: number;
  lines: number;
}

export interface DiagramPolicyResult {
  ok: boolean;
  /** Mermaid family: 'flowchart' | 'sequence' | 'state' | 'class' | 'er'. */
  type: string | null;
  view: string | null;
  /** Source with config / interaction statements removed. Empty when rejected. */
  renderSource: string;
  /**
   * What was changed before rendering: 'frontmatter' | 'directive' |
   * 'interaction' (removed), 'reserved_id' (a keyword used as a node id was renamed).
   */
  neutralised: string[];
  complexity: DiagramComplexity;
  rejection?: string;
  message?: string;
}

export const RESERVED_FLOWCHART_IDS: readonly string[];
export function renameReservedFlowchartIds(source: string): { text: string; renamed: string[] };
export function describeDiagramRejection(code: string): string;
export function detectDiagramType(source: string): { type: string | null; view: string | null; header: string };
export function estimateDiagramComplexity(source: string, type?: string | null): DiagramComplexity;
/** True when a flowchart, timeline or mind map holds only placeholder labels ("unknown", "not provided"). */
export function isPlaceholderDiagram(source: string | null | undefined, type?: string): boolean;
export function checkDiagramSource(
  source: string,
  options?: { limits?: Partial<{ maxSourceChars: number; maxLines: number; maxNodes: number; maxEdges: number }>; allowedTypes?: readonly string[] },
): DiagramPolicyResult;
export function diagramViewLabel(view: string | null | undefined): string;
export function diagramCardLabel(view: string | null | undefined): string;
export const DIAGRAM_SVG_MAX_CHARS: number;
export function isSafeDiagramSvg(svg: unknown): boolean;
export function diagramSourceKey(source: string): string;
