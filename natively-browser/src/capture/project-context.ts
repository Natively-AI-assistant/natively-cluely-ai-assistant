/**
 * Read-only multi-file project discovery and deterministic context assembly.
 *
 * Providers in this module may only inspect already-exposed page state. They do
 * not click, focus, dispatch events, execute page scripts, or mutate the host
 * DOM. A browser integration can also pass already-loaded editor models
 * explicitly; that is the most complete and least ambiguous source and
 * therefore has first priority.
 */

import type {
  CodingProjectPayload,
  ContextEnvelope,
  ProjectFileContext,
  ProjectFileStatus,
} from './types';

export const PROJECT_CONTEXT_MAX_CHARS = 22_000;
export const PROJECT_FILE_MAX_CHARS = 7_000;

const PROBLEM_STATEMENT_MAX_CHARS = 5_000;
const MAX_DISCOVERED_FILES = 300;
const MAX_PATH_CHARS = 512;

export interface ProjectFileDiscovery {
  path: string;
  language?: string;
  charCount: number;
  revision: string;
  readable: boolean;
  reason?: string;
  content?: string;
}

export interface ProjectDiscovery {
  workspaceId: string;
  name: string;
  provider: string;
  files: ProjectFileDiscovery[];
  warnings: string[];
  estimatedChars: number;
}

export interface ProjectCaptureOptions {
  contextId: string;
  capturedAt: number;
  selectedPaths: string[];
  refresh?: boolean;
  baseContextId?: string;
  previousSelectedPaths?: string[];
  previousFiles?: ProjectFileContext[];
  problemStatement?: string;
}

export interface ProjectCaptureResult {
  envelope: ContextEnvelope<CodingProjectPayload>;
  dom: string;
  project: ProjectDiscovery;
  unchanged: boolean;
}

export interface ExternalProjectFile {
  path: string;
  language?: string;
  content?: string;
  charCount?: number;
  revision?: string;
  readable?: boolean;
  reason?: string;
}

export interface ProjectPageIdentity {
  host?: string;
  url?: string;
  title?: string;
  /** Chrome frame id, supplied by the extension to bind an embedded workspace. */
  frameId?: number;
  /** Chrome document id, supplied by the extension to survive frame-id reuse safely. */
  documentId?: string;
}

export interface ProjectProviderInput {
  document: Document;
  page: ProjectPageIdentity;
  externalFiles?: readonly ExternalProjectFile[];
}

export interface ProjectContextProvider {
  readonly id: string;
  discover(input: ProjectProviderInput): ExternalProjectFile[];
}

export interface ProjectDiscoveryOptions {
  /** Normal discovery requires two files; refresh may continue an existing snapshot with fewer. */
  minimumFiles?: number;
}

type ElementLike = Element & {
  value?: unknown;
  dataset?: Record<string, string | undefined>;
};

const SOURCE_EXTENSIONS = new Set([
  'bash', 'c', 'cc', 'cfg', 'conf', 'cpp', 'cxx', 'h', 'hpp', 'cs', 'css', 'dart',
  'dockerignore', 'editorconfig', 'env', 'ex', 'exs', 'gitignore', 'go', 'gradle',
  'graphql', 'gql', 'groovy', 'hbs', 'html', 'java', 'js', 'jsx', 'json', 'kt',
  'kts', 'less', 'lua', 'md', 'mjs', 'mod', 'mts', 'php', 'pl', 'properties',
  'proto', 'prisma', 'py', 'rb', 'rs', 'sass', 'scala', 'scss', 'sh', 'sql',
  'svelte', 'swift', 'tf', 'tfvars', 'toml', 'ts', 'tsx', 'txt', 'vue', 'xml',
  'yaml', 'yml', 'zsh',
]);

const SOURCE_FILENAMES = new Set([
  'cmakelists.txt', 'dockerfile', 'gemfile', 'makefile', 'pom.xml', 'procfile', 'rakefile',
]);

const BINARY_EXTENSIONS = new Set([
  '7z', 'a', 'avi', 'bin', 'bmp', 'class', 'db', 'dll', 'dylib', 'eot', 'exe',
  'gif', 'gz', 'ico', 'jar', 'jpeg', 'jpg', 'lockb', 'map', 'mov', 'mp3', 'mp4',
  'o', 'ogg', 'otf', 'pdf', 'png', 'pyc', 'so', 'sqlite', 'tar', 'tgz', 'ttf',
  'wav', 'webm', 'webp', 'woff', 'woff2', 'xz', 'zip',
]);

const IGNORED_SEGMENTS = new Set([
  '.git', '.gradle', '.idea', '.next', '.nuxt', '.output', '.turbo', '.vscode',
  '__pycache__', 'bower_components', 'build', 'coverage', 'deps', 'dist', 'generated',
  'node_modules', 'out', 'target', 'vendor',
]);

const GENERATED_FILENAMES = new Set([
  'cargo.lock', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
]);

// These names are sufficiently specific that reading their bodies by default
// is a poor tradeoff. Keep the path in the manifest (so the omission is
// visible), but never treat the file as readable project context. Deliberate
// templates remain eligible because they are intended to contain placeholders.
const KNOWN_SECRET_FILENAMES = new Set([
  '.dockercfg', '.netrc', '.npmrc', '.pypirc',
  'auth.json', 'token.json',
  'credentials.json', 'credentials.yml', 'credentials.yaml',
  'secrets.json', 'secrets.yml', 'secrets.yaml', 'secrets.toml',
  'service-account.json', 'serviceaccount.json', 'serviceaccountkey.json',
  'terraform.tfstate', 'terraform.tfstate.backup',
]);

function knownSecretReason(path: string): string | undefined {
  const normalized = normalizeProjectPath(path).toLowerCase();
  const segments = normalized.split('/');
  const base = segments[segments.length - 1] || '';
  if (!base) return undefined;
  const isSafeTemplate = /(?:^|[._-])(?:example|sample|template|defaults?)(?:[._-]|$)/i.test(base);
  if ((base === '.env' || base.startsWith('.env.') || base.endsWith('.env')) && !isSafeTemplate) {
    return 'ignored known secret-bearing environment file';
  }
  if (KNOWN_SECRET_FILENAMES.has(base) && !isSafeTemplate) {
    return 'ignored known secret-bearing file';
  }
  if (base === 'config.json' && segments[segments.length - 2] === '.docker' && !isSafeTemplate) {
    return 'ignored known secret-bearing Docker credential file';
  }
  if (/^(?:id_(?:rsa|dsa|ecdsa|ed25519)|.*\.(?:pem|p12|pfx|key))$/i.test(base)) {
    return 'ignored private key or certificate credential file';
  }
  return undefined;
}

/** Normalize an exposed model/tree path without inventing missing directories. */
export function normalizeProjectPath(input: string): string {
  if (typeof input !== 'string') return '';
  let value = input.trim().replace(/^['"]|['"]$/g, '');
  if (!value) return '';

  // Monaco model URIs commonly arrive as file:///workspace/src/a.ts or
  // inmemory://model/src/a.ts. Keep their path component; never retain query
  // tokens or fragments in project context.
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      value = parsed.pathname || '';
    } catch {
      value = value.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]*\/?/i, '');
    }
  }

  value = value.split(/[?#]/, 1)[0].replace(/\\/g, '/');
  value = value.replace(/^[a-z]:\/?/i, '').replace(/^\/+/, '');
  value = value.replace(/\/{2,}/g, '/');

  const parts: string[] = [];
  for (const rawPart of value.split('/')) {
    const part = rawPart.trim();
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    // Control characters make unsafe/ambiguous prompt boundaries.
    const clean = part.replace(/[\u0000-\u001f\u007f]/g, '');
    if (clean) parts.push(clean);
  }
  return parts.join('/').slice(0, MAX_PATH_CHARS);
}

/** Best-effort language label derived only from a file's normalized path. */
export function languageForPath(input: string): string | undefined {
  const path = normalizeProjectPath(input);
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (base === 'dockerfile') return 'dockerfile';
  if (base === 'makefile') return 'makefile';
  if (base === 'gemfile' || base === 'rakefile') return 'ruby';
  if (base === 'cmakelists.txt') return 'cmake';
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : '';
  const languages: Record<string, string> = {
    bash: 'shell', c: 'c', cc: 'cpp', cfg: 'config', conf: 'config', cpp: 'cpp',
    cxx: 'cpp', h: 'c', hpp: 'cpp',
    cs: 'csharp', css: 'css', dart: 'dart', ex: 'elixir', exs: 'elixir',
    go: 'go', graphql: 'graphql', gql: 'graphql', groovy: 'groovy', hbs: 'handlebars',
    html: 'html', java: 'java', js: 'javascript', jsx: 'javascript', json: 'json',
    gradle: 'gradle', kt: 'kotlin', kts: 'kotlin', less: 'less', lua: 'lua',
    md: 'markdown', mjs: 'javascript', mod: 'go.mod', mts: 'typescript', php: 'php',
    pl: 'perl', properties: 'properties', proto: 'protobuf', prisma: 'prisma',
    py: 'python', rb: 'ruby', rs: 'rust', sass: 'sass',
    scala: 'scala', scss: 'scss', sh: 'shell', sql: 'sql', svelte: 'svelte',
    swift: 'swift', tf: 'terraform', tfvars: 'terraform', toml: 'toml',
    ts: 'typescript', tsx: 'typescript', txt: 'text', vue: 'vue', xml: 'xml',
    yaml: 'yaml', yml: 'yaml', zsh: 'shell',
  };
  return languages[ext];
}

function stableHash(value: string): string {
  // FNV-1a, expressed as a fixed-width unsigned hex string. It is deliberately
  // small and deterministic; this is a change token, not a security primitive.
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableWorkspaceUrl(input: string): string {
  try {
    const url = new URL(input);
    const stableParams = [...url.searchParams.entries()]
      .filter(([key]) => /^(?:workspace(?:id)?|project(?:id)?|challenge(?:id)?|folder|repo(?:sitory)?|sandbox(?:id)?|slug)$/i.test(key))
      .map(([key, value]) => [key.toLowerCase(), value.slice(0, 512)] as const)
      .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
        compareCodePoints(`${leftKey}\0${leftValue}`, `${rightKey}\0${rightValue}`));
    const query = stableParams.length
      ? `?${stableParams.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`
      : '';
    return `${url.origin}${url.pathname}${query}`;
  } catch {
    return (input || '').split('#', 1)[0].split('?', 1)[0];
  }
}

function ignoreReason(path: string): string | undefined {
  const lower = path.toLowerCase();
  const secret = knownSecretReason(lower);
  if (secret) return secret;
  const segments = lower.split('/');
  const ignored = segments.find((part) => IGNORED_SEGMENTS.has(part));
  if (ignored) return `ignored dependency/build path (${ignored})`;
  const base = segments[segments.length - 1] || '';
  if (GENERATED_FILENAMES.has(base)) return 'ignored generated dependency lockfile';
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : '';
  if (BINARY_EXTENSIONS.has(ext)) return `ignored binary file type (.${ext})`;
  return undefined;
}

function looksLikeFile(path: string): boolean {
  const normalized = normalizeProjectPath(path);
  if (!normalized) return false;
  if (knownSecretReason(normalized)) return true;
  const base = normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase();
  if (/^\.env\.(?:example|sample|template|defaults?)$/i.test(base)) return true;
  if (SOURCE_FILENAMES.has(base)) return true;
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : '';
  return SOURCE_EXTENSIONS.has(ext) || BINARY_EXTENSIONS.has(ext) || GENERATED_FILENAMES.has(base);
}

/** Extract an exact-looking file token from real IDE accessibility labels. */
function pathFromLabel(input: string): string {
  const raw = String(input || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!raw) return '';
  const candidates = [
    raw,
    ...raw.split(/\s+(?:—|–|•|·|\|)\s+|,\s*|\s+\((?=[^)]+\)?$)/),
  ];
  for (const candidate of candidates) {
    const cleaned = candidate
      .trim()
      .replace(/^(?:file|tab|editor|modified|unsaved|active)\s*[:\-]?\s*/i, '')
      .replace(/^\[[^\]]{1,24}\]\s*/, '')
      .replace(/\s+\([^)]*\)\s*$/, '')
      .replace(/^['"`]|['"`]$/g, '');
    const normalized = normalizeProjectPath(cleaned);
    if (looksLikeFile(normalized)) return normalized;
  }
  return '';
}

function safeAttr(element: ElementLike, name: string): string {
  try {
    const value = element.getAttribute?.(name);
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return '';
  }
}

function safeText(element: ElementLike | null | undefined): string {
  if (!element) return '';
  try {
    if (typeof element.value === 'string' && element.value) return element.value;
    return typeof element.textContent === 'string' ? element.textContent : '';
  } catch {
    return '';
  }
}

function safeQueryAll(root: Document | ElementLike, selectors: readonly string[]): ElementLike[] {
  const result: ElementLike[] = [];
  const seen = new Set<ElementLike>();
  for (const selector of selectors) {
    try {
      const nodes = root.querySelectorAll?.(selector);
      if (!nodes) continue;
      for (const node of Array.from(nodes) as ElementLike[]) {
        if (!seen.has(node)) {
          seen.add(node);
          result.push(node);
        }
      }
    } catch {
      // A provider is best-effort. One selector failing in a host shim must not
      // stop the remaining read-only strategies.
    }
  }
  return result;
}

function safeQuery(root: Document | ElementLike, selectors: readonly string[]): ElementLike | null {
  return safeQueryAll(root, selectors)[0] || null;
}

function pathFromElement(element: ElementLike): string {
  const attrs = [
    'data-natively-file-path', 'data-file-path', 'data-path', 'data-uri',
    'data-resource-path', 'data-model-uri', 'data-item-path', 'data-node-path',
    'data-file', 'data-key', 'data-node-key',
  ];
  for (const attr of attrs) {
    const value = safeAttr(element, attr);
    if (value) {
      const normalized = normalizeProjectPath(value);
      if (looksLikeFile(normalized)) return normalized;
      const labelled = pathFromLabel(value);
      if (labelled) return labelled;
    }
  }
  const label = safeAttr(element, 'aria-label') || safeAttr(element, 'title');
  const directLabel = pathFromLabel(label);

  // Explorer rows commonly put their label/path on a child span while role and
  // selection state live on the row. Search only a bounded, path-oriented set
  // of descendants; never treat arbitrary container text as a file.
  const descendants = safeQueryAll(element, [
    '[data-natively-file-path]', '[data-file-path]', '[data-path]', '[data-uri]',
    '[data-resource-path]', '[data-model-uri]', '[data-item-path]', '[data-node-path]',
    '[aria-label]', '[title]', '.label-name', '.monaco-icon-label',
    '.monaco-highlighted-label', '.file-name', '.filename',
  ]).slice(0, 20);
  let nestedLabel = '';
  for (const descendant of descendants) {
    if (descendant === element) continue;
    for (const attr of [...attrs, 'aria-label', 'title']) {
      const path = pathFromLabel(safeAttr(descendant, attr));
      if (path.includes('/')) return path;
      if (path && !nestedLabel) nestedLabel = path;
    }
    const path = pathFromLabel(safeText(descendant));
    if (path.includes('/')) return path;
    if (path && !nestedLabel) nestedLabel = path;
  }
  return directLabel || nestedLabel;
}

function cooperativeContent(element: ElementLike): string | undefined {
  try {
    const inline = element.getAttribute?.('data-natively-file-content');
    if (typeof inline === 'string') return inline;
  } catch { /* fall through to explicit descendants */ }
  // Only an explicit full-content contract or a textarea value is safe here.
  // Monaco/CodeMirror/Ace line DOM is virtualized and may contain only the
  // viewport, so it must never be labelled as a complete file body.
  const child = safeQuery(element, ['[data-natively-file-content]', 'textarea']);
  if (!child) return undefined;
  try {
    const inline = child.getAttribute?.('data-natively-file-content');
    if (typeof inline === 'string') return inline;
  } catch { /* use the explicit child's text */ }
  return safeText(child);
}

const loadedEditorModelsProvider: ProjectContextProvider = {
  id: 'loaded-editor-models',
  discover({ externalFiles }) {
    if (!externalFiles?.length) return [];
    return externalFiles.map((file) => {
      const path = normalizeProjectPath(file.path);
      const ignored = ignoreReason(path);
      // Do not dereference a potentially lazy body supplied by an editor
      // integration once its path alone proves that it contains credentials.
      if (ignored) return { path, readable: false, reason: ignored };
      return { ...file, path };
    });
  },
};

const cooperativeDomProvider: ProjectContextProvider = {
  id: 'cooperative-dom',
  discover({ document }) {
    const elements = safeQueryAll(document, ['[data-natively-file-path]']);
    return elements.map((element) => {
      const path = pathFromElement(element);
      const ignored = ignoreReason(path);
      if (ignored) {
        return { path, readable: false, reason: ignored };
      }
      const content = cooperativeContent(element);
      return {
        path,
        language: safeAttr(element, 'data-natively-language') || undefined,
        content,
        revision: safeAttr(element, 'data-natively-file-revision') || undefined,
        readable: content !== undefined,
        reason: content === undefined ? 'file is listed but its content is not exposed' : undefined,
      };
    });
  },
};

const visibleFileTreeProvider: ProjectContextProvider = {
  id: 'visible-file-tree',
  discover({ document }) {
    const treeElements = safeQueryAll(document, [
      '[role="treeitem"]', '[data-file-path]', '[data-path]', '[data-resource-path]',
      '[data-item-path]', '[data-node-path]', '[data-testid*="file"]',
      '.explorer-item', '.file-tree-item', '.tree-node', '.file-node',
      '.project-file', '.monaco-list-row', '[role="tab"]', '.tab-label',
    ]);
    const candidates = treeElements.map((element) => {
      const path = pathFromElement(element);
      const ignored = ignoreReason(path);
      if (ignored) {
        return {
          isEditorTab: false,
          file: { path, readable: false, reason: ignored },
        };
      }
      const directContent = safeAttr(element, 'data-file-content');
      const className = typeof element.className === 'string' ? element.className : safeAttr(element, 'class');
      const isEditorTab = safeAttr(element, 'role') === 'tab'
        || /(?:^|\s)tab-label(?:\s|$)/.test(className);
      // A VS Code tab proves that a file exists, but its Monaco viewport is not
      // the complete document. Keep tab-derived files unreadable unless the
      // host explicitly supplies full content via data-file-content.
      const content = directContent;
      return {
        isEditorTab,
        file: {
          path,
          content: content || undefined,
          readable: Boolean(content),
          reason: content ? undefined : 'file is unopened or virtualized in the visible explorer',
        },
      };
    });

    // VS Code can expose only a basename on an open tab while its explorer row
    // exposes the exact resource path. When there is exactly one non-tab match,
    // the tab is an alias for that row, not a second root-level file. Restrict
    // this reconciliation to tab-derived descriptors so generic trees that
    // genuinely contain both `README.md` and `docs/README.md` stay intact.
    const nonTabPaths = candidates
      .filter((candidate) => !candidate.isEditorTab && candidate.file.path)
      .map((candidate) => candidate.file.path);
    return candidates
      .filter((candidate) => {
        const path = candidate.file.path;
        if (!candidate.isEditorTab || !path || path.includes('/')) return true;
        const matches = nonTabPaths.filter((treePath) =>
          treePath.includes('/') && treePath.slice(treePath.lastIndexOf('/') + 1) === path);
        return matches.length !== 1;
      })
      .map((candidate) => candidate.file);
  },
};

/** Ordered from the strongest explicit source to the most conservative fallback. */
export const PROJECT_CONTEXT_PROVIDERS: readonly ProjectContextProvider[] = Object.freeze([
  loadedEditorModelsProvider,
  cooperativeDomProvider,
  visibleFileTreeProvider,
]);

function toDiscoveryFile(file: ExternalProjectFile): ProjectFileDiscovery | null {
  const path = normalizeProjectPath(file.path);
  if (!looksLikeFile(path)) return null;
  const ignored = ignoreReason(path);
  const content = !ignored && typeof file.content === 'string' ? file.content : undefined;
  const descriptorCharCount = typeof file.charCount === 'number' && Number.isFinite(file.charCount)
    ? Math.max(0, Math.floor(file.charCount))
    : undefined;
  const readable = !ignored
    && file.readable !== false
    && (typeof content === 'string' || descriptorCharCount !== undefined);
  const reason = ignored || (!readable ? file.reason || 'file content is not readable' : undefined);
  const revision = typeof file.revision === 'string' && file.revision.trim()
    ? file.revision.trim().slice(0, 128)
    : stableHash(`${path}\0${content ?? ''}\0${reason ?? ''}`);
  return {
    path,
    language: file.language?.trim() || languageForPath(path),
    charCount: content?.length ?? descriptorCharCount ?? 0,
    revision,
    readable,
    reason,
    content: readable ? content : undefined,
  };
}

function preferFile(
  current: ProjectFileDiscovery | undefined,
  next: ProjectFileDiscovery,
  currentIsAuthoritativeUnreadable = false,
): ProjectFileDiscovery {
  if (!current) return next;
  // A MAIN-world editor probe that explicitly says the full document is
  // unreadable (for example, CodeMirror 6 exposing only its virtualized
  // viewport) is authoritative. Never relabel visible viewport text from the
  // weaker DOM provider as the complete file body.
  if (currentIsAuthoritativeUnreadable && !current.readable) return current;
  if (!current.readable && next.readable) return next;
  if (current.readable && !next.readable) return current;
  // Provider order is meaningful. For equally useful candidates, keep the
  // first provider's view instead of making DOM traversal order observable.
  return current;
}

/**
 * Discover a supported multi-file workspace. Returns null for an unsupported or
 * genuinely single-file page so the existing fast capture remains untouched.
 */
export function discoverProject(
  document: Document,
  page: ProjectPageIdentity,
  externalFiles?: readonly ExternalProjectFile[],
  options: ProjectDiscoveryOptions = {},
): ProjectDiscovery | null {
  const byPath = new Map<string, ProjectFileDiscovery>();
  const providersUsed: string[] = [];
  const authoritativeUnreadablePaths = new Set(
    (externalFiles || [])
      .filter((file) => file.readable === false)
      .map((file) => normalizeProjectPath(file.path))
      .filter(Boolean),
  );

  for (const provider of PROJECT_CONTEXT_PROVIDERS) {
    const raw = provider.discover({ document, page, externalFiles });
    let providerContributed = false;
    for (const candidate of raw) {
      const normalized = toDiscoveryFile(candidate);
      if (!normalized) continue;
      const previous = byPath.get(normalized.path);
      const preferred = preferFile(
        previous,
        normalized,
        provider.id !== 'loaded-editor-models'
          && authoritativeUnreadablePaths.has(normalized.path),
      );
      byPath.set(normalized.path, preferred);
      if (!previous || preferred !== previous) providerContributed = true;
      if (byPath.size >= MAX_DISCOVERED_FILES) break;
    }
    if (providerContributed) providersUsed.push(provider.id);
    if (byPath.size >= MAX_DISCOVERED_FILES) break;
  }

  // Some editor APIs expose only the mounted tab's basename while the visible
  // explorer exposes its exact workspace path. Re-key an external basename
  // only when there is one unambiguous full-path suffix match; otherwise keep
  // both entries rather than guessing between same-named files in two folders.
  const externalBasenames = new Set(
    (externalFiles || [])
      .map((file) => normalizeProjectPath(file.path))
      .filter((path) => path && !path.includes('/')),
  );
  for (const alias of externalBasenames) {
    const aliasFile = byPath.get(alias);
    if (!aliasFile) continue;
    const matches = [...byPath.keys()].filter((path) =>
      path.includes('/') && path.slice(path.lastIndexOf('/') + 1) === alias);
    if (matches.length !== 1) continue;
    const exactPath = matches[0];
    const exactFile = byPath.get(exactPath);
    byPath.set(exactPath, preferFile(exactFile, { ...aliasFile, path: exactPath }));
    byPath.delete(alias);
  }

  const files = [...byPath.values()].sort((a, b) => compareCodePoints(a.path, b.path));
  const projectFiles = files.filter((file) => !ignoreReason(file.path));
  const minimumFiles = Math.max(0, Math.floor(options.minimumFiles ?? 2));
  if (projectFiles.length < minimumFiles) return null;

  const warnings: string[] = [];
  const unreadableCount = projectFiles.filter((file) => !file.readable).length;
  const ignoredCount = files.length - projectFiles.length;
  if (unreadableCount) warnings.push(`${unreadableCount} file(s) are unopened, virtualized, or otherwise unreadable.`);
  if (ignoredCount) warnings.push(`${ignoredCount} sensitive, dependency, build, generated, or binary file(s) were ignored.`);
  if (byPath.size >= MAX_DISCOVERED_FILES) warnings.push(`Discovery stopped at ${MAX_DISCOVERED_FILES} files.`);

  const stableUrl = stableWorkspaceUrl(page.url || '');
  const name = (page.title || page.host || 'Coding workspace').trim().slice(0, 300);
  const provider = providersUsed[0] || 'visible-file-tree';
  // Browser IDE titles commonly follow the active file. Do not let switching
  // tabs change workspace identity. Preserve only workspace-bearing URL params
  // (never auth/tracking params), plus an exposed project-root hint, so two
  // projects hosted by one SPA shell do not reuse each other's snapshots.
  // Never derive identity from the discovered manifest: files can appear or
  // disappear as an explorer expands, and that must not invalidate refresh.
  // Two sibling IDE frames can expose the same top-tab URL. Bind identity to
  // Chrome's frame and document ids so discovery and capture cannot switch to
  // a sibling or to a replacement document after navigation.
  const frameIdentity = typeof page.frameId === 'number'
    && Number.isInteger(page.frameId)
    && page.frameId >= 0
    ? `frame:${page.frameId}`
    : '';
  const documentIdentity = typeof page.documentId === 'string' && page.documentId.trim()
    ? `document:${page.documentId.trim().slice(0, 256)}`
    : '';
  const stableIdentity = [
    stableUrl,
    frameIdentity,
    documentIdentity,
  ]
    .filter(Boolean)
    .join('\0') || name;
  return {
    workspaceId: `workspace-${stableHash(`${page.host || ''}\0${stableIdentity}`)}`,
    name,
    provider,
    files,
    warnings,
    estimatedChars: projectFiles.reduce((sum, file) => sum + (file.readable ? file.charCount : 0), 0),
  };
}

function isSelected(path: string, selectedPaths: readonly string[]): boolean {
  if (!selectedPaths.length) return true;
  return selectedPaths.some((selected) => path === selected || path.startsWith(`${selected}/`));
}

function reasonStatus(reason: string | undefined): ProjectFileStatus {
  if (/removed|deleted/i.test(reason || '')) return 'removed';
  if (/^ignored\b/i.test(reason || '')) return 'ignored';
  return 'unreadable';
}

function upsertOmitted(
  omitted: Array<{ path: string; reason: string }>,
  path: string,
  reason: string,
): void {
  const existing = omitted.find((entry) => entry.path === path);
  if (existing) existing.reason = reason;
  else omitted.push({ path, reason });
}

function clonePrevious(file: ProjectFileContext): ProjectFileContext {
  return {
    path: normalizeProjectPath(file.path),
    language: file.language,
    content: file.content,
    revision: file.revision,
    charCount: file.charCount,
    status: file.status,
    reason: file.reason,
  };
}

function reusePreviousFile(file: ProjectFileContext): ProjectFileContext {
  // A truncated snapshot does not become complete merely because its source
  // revision stayed the same. Preserve both the lossy status and disclosure.
  if (file.status === 'truncated') {
    return {
      ...file,
      status: 'truncated',
      reason: file.reason || 'content remains truncated from the previous capture',
    };
  }
  return { ...file, status: 'unchanged', reason: undefined };
}

function manifestLine(file: ProjectFileContext): string {
  const language = file.language ? `; ${file.language}` : '';
  const reason = file.reason ? `; ${file.reason}` : '';
  return `- [${file.status}] ${file.path} (${file.charCount} chars${language}${reason})`;
}

function renderProjectDom(
  discovery: ProjectDiscovery,
  problemStatement: string,
  files: readonly ProjectFileContext[],
  omitted: readonly { path: string; reason: string }[],
  refresh: boolean,
  manifestLimit = Number.POSITIVE_INFINITY,
  omittedLimit = 80,
): string {
  const lines: string[] = [
    'BROWSER_CONTEXT_KIND: coding_project',
    `WORKSPACE: ${discovery.name}`,
    `WORKSPACE_ID: ${discovery.workspaceId}`,
    `PROJECT_PROVIDER: ${discovery.provider}`,
    `CAPTURE_MODE: ${refresh ? 'changed-file refresh (full selected snapshot)' : 'full selected snapshot'}`,
  ];
  if (problemStatement) lines.push('', 'PROBLEM_STATEMENT:', problemStatement);
  lines.push('', 'PROJECT_MANIFEST:');
  const shownFiles = files.slice(0, manifestLimit);
  lines.push(...shownFiles.map(manifestLine));
  if (shownFiles.length < files.length) {
    lines.push(`- ... ${files.length - shownFiles.length} additional manifest entries omitted for context budget`);
  }

  lines.push('', 'PROJECT_FILES:');
  for (const file of files) {
    if (file.content === undefined) continue;
    lines.push(
      `--- FILE: ${file.path} ---`,
      file.language ? `LANGUAGE: ${file.language}` : 'LANGUAGE: unknown',
      file.content,
      `--- END FILE: ${file.path} ---`,
      '',
    );
  }

  if (omitted.length) {
    lines.push('OMITTED_OR_TRUNCATED_FILES:');
    for (const entry of omitted.slice(0, omittedLimit)) lines.push(`- ${entry.path}: ${entry.reason}`);
    if (omitted.length > omittedLimit) {
      lines.push(`- ... ${omitted.length - omittedLimit} additional omission records`);
    }
  }
  return lines.join('\n').trim();
}

function fitDomToBudget(
  discovery: ProjectDiscovery,
  rawProblemStatement: string,
  files: ProjectFileContext[],
  omitted: Array<{ path: string; reason: string }>,
  refresh: boolean,
): { dom: string; problemStatement: string } {
  let problemStatement = rawProblemStatement.slice(0, PROBLEM_STATEMENT_MAX_CHARS);
  if (rawProblemStatement.length > problemStatement.length) {
    problemStatement += '\n[Problem statement truncated for project context budget.]';
  }

  for (const file of files) {
    if (file.content === undefined || file.content.length <= PROJECT_FILE_MAX_CHARS) continue;
    file.content = file.content.slice(0, PROJECT_FILE_MAX_CHARS);
    file.status = 'truncated';
    file.reason = `content truncated to ${PROJECT_FILE_MAX_CHARS} characters`;
    upsertOmitted(omitted, file.path, file.reason);
  }

  let dom = renderProjectDom(discovery, problemStatement, files, omitted, refresh);
  const contentFiles = [...files].filter((file) => file.content !== undefined).reverse();
  let cursor = 0;
  while (dom.length > PROJECT_CONTEXT_MAX_CHARS && cursor < contentFiles.length) {
    const file = contentFiles[cursor];
    const content = file.content || '';
    const overflow = dom.length - PROJECT_CONTEXT_MAX_CHARS;
    if (content.length > overflow + 256) {
      const keep = Math.max(128, content.length - overflow - 160);
      file.content = `${content.slice(0, keep)}\n[File truncated for total project context budget.]`;
      file.status = 'truncated';
      file.reason = 'content truncated for total project context budget';
      upsertOmitted(omitted, file.path, file.reason);
    } else {
      file.content = undefined;
      file.status = 'truncated';
      file.reason = 'content omitted because the project context budget was exhausted';
      upsertOmitted(omitted, file.path, file.reason);
      cursor += 1;
    }
    dom = renderProjectDom(discovery, problemStatement, files, omitted, refresh);
  }

  if (dom.length > PROJECT_CONTEXT_MAX_CHARS && problemStatement) {
    const overflow = dom.length - PROJECT_CONTEXT_MAX_CHARS;
    const keep = Math.max(0, problemStatement.length - overflow - 100);
    problemStatement = keep ? `${problemStatement.slice(0, keep)}\n[Problem statement truncated.]` : '';
    dom = renderProjectDom(discovery, problemStatement, files, omitted, refresh);
  }

  // Extremely large trees can make the manifest itself exceed the budget even
  // with no content. Compact only the rendered manifest/omission list; the
  // structured payload still contains every explicit record.
  let manifestLimit = files.length;
  let omittedLimit = Math.min(80, omitted.length);
  while (dom.length > PROJECT_CONTEXT_MAX_CHARS && (manifestLimit > 1 || omittedLimit > 1)) {
    if (manifestLimit >= omittedLimit && manifestLimit > 1) manifestLimit = Math.max(1, Math.floor(manifestLimit * 0.75));
    else omittedLimit = Math.max(1, Math.floor(omittedLimit * 0.75));
    dom = renderProjectDom(discovery, problemStatement, files, omitted, refresh, manifestLimit, omittedLimit);
  }

  if (dom.length > PROJECT_CONTEXT_MAX_CHARS) {
    // Defensive last resort: render a valid, closed summary instead of slicing
    // through a file boundary.
    dom = [
      'BROWSER_CONTEXT_KIND: coding_project',
      `WORKSPACE: ${discovery.name}`,
      `WORKSPACE_ID: ${discovery.workspaceId}`,
      'PROJECT_MANIFEST:',
      `- ${files.length} selected files; details omitted because metadata exceeded the context budget`,
    ].join('\n').slice(0, PROJECT_CONTEXT_MAX_CHARS);
  }
  return { dom, problemStatement };
}

/** Assemble the selected project snapshot into the structured envelope + legacy DOM. */
export function assembleProjectContext(
  discovery: ProjectDiscovery,
  options: ProjectCaptureOptions,
): ProjectCaptureResult {
  const selectedPaths = [...new Set(options.selectedPaths.map(normalizeProjectPath).filter(Boolean))];
  const previousByPath = new Map<string, ProjectFileContext>();
  for (const previous of options.previousFiles || []) {
    const clone = clonePrevious(previous);
    if (clone.path) previousByPath.set(clone.path, clone);
  }

  const currentByPath = new Map(
    discovery.files
      .filter((file) => isSelected(file.path, selectedPaths))
      .map((file) => [file.path, file] as const),
  );
  const allPaths = new Set(currentByPath.keys());
  if (options.refresh) {
    for (const path of previousByPath.keys()) {
      if (isSelected(path, selectedPaths)) allPaths.add(path);
    }
  }

  // Exact file selections that were not discovered must be disclosed. Folder
  // prefixes are not materialized as fake files.
  for (const selected of selectedPaths) {
    if (!looksLikeFile(selected)) continue;
    if (![...allPaths].some((path) => path === selected)) allPaths.add(selected);
  }

  const files: ProjectFileContext[] = [];
  const omitted: Array<{ path: string; reason: string }> = [];
  const previousSelectedPaths = [...new Set(
    (options.previousSelectedPaths || []).map(normalizeProjectPath).filter(Boolean),
  )];
  const selectionChanged = Array.isArray(options.previousSelectedPaths)
    && (
      previousSelectedPaths.length !== selectedPaths.length
      || previousSelectedPaths.some((path) => !selectedPaths.includes(path))
    );
  let changed = Boolean(options.refresh && selectionChanged);

  for (const path of [...allPaths].sort(compareCodePoints)) {
    const current = currentByPath.get(path);
    const previous = previousByPath.get(path);
    let context: ProjectFileContext;

    if (!current) {
      if (options.refresh && previous) {
        const wasSelectedExactly = selectedPaths.includes(path);
        if (wasSelectedExactly) {
          context = {
            path,
            language: previous.language,
            revision: previous.revision,
            charCount: previous.charCount,
            status: 'removed',
            reason: 'file is no longer exposed by the workspace',
          };
          changed = true;
        } else {
          // A folder refresh may intentionally report only changed models. Keep
          // the rest of the prior selected snapshot so the assembled context is
          // still complete.
          context = reusePreviousFile(previous);
        }
      } else {
        context = {
          path,
          language: languageForPath(path),
          charCount: 0,
          status: 'unreadable',
          reason: 'selected file was not discovered',
        };
        if (options.refresh) changed = true;
      }
    } else if (!current.readable || current.content === undefined) {
      const status = reasonStatus(current.reason);
      if (
        options.refresh
        && previous?.content !== undefined
        && status !== 'removed'
        && current.revision === previous.revision
      ) {
        context = reusePreviousFile(previous);
      } else {
        context = {
          path,
          language: current.language,
          revision: current.revision,
          charCount: current.charCount,
          status,
          reason: current.reason || 'file content is not readable',
        };
        if (
          options.refresh
          && (status === 'removed' || !previous || current.revision !== previous.revision)
        ) changed = true;
      }
    } else if (
      options.refresh
      && previous?.revision === current.revision
      && previous.content !== undefined
      && (previous.status === 'included' || previous.status === 'unchanged')
    ) {
      context = {
        ...reusePreviousFile(previous),
        language: current.language || previous.language,
        charCount: current.charCount,
      };
    } else {
      context = {
        path,
        language: current.language,
        content: current.content,
        revision: current.revision,
        charCount: current.charCount,
        status: 'included',
      };
      if (
        options.refresh
        && (!previous || previous.revision !== current.revision || previous.status !== 'truncated')
      ) changed = true;
    }

    if (context.status === 'truncated' || context.content === undefined) {
      upsertOmitted(omitted, context.path, context.reason || context.status);
    }
    files.push(context);
  }

  const fitted = fitDomToBudget(
    discovery,
    options.problemStatement || '',
    files,
    omitted,
    Boolean(options.refresh),
  );
  omitted.sort((a, b) => compareCodePoints(a.path, b.path));

  const payload: CodingProjectPayload = {
    workspaceId: discovery.workspaceId,
    workspaceName: discovery.name,
    provider: discovery.provider,
    problemStatement: fitted.problemStatement || undefined,
    files,
    omitted,
    selectedPaths,
    capturedFileCount: files.filter((file) => file.content !== undefined).length,
    totalFileCount: discovery.files.length,
    budgetChars: PROJECT_CONTEXT_MAX_CHARS,
    usedChars: fitted.dom.length,
    refreshMode: options.refresh ? 'changed' : 'full',
    baseContextId: options.refresh ? options.baseContextId : undefined,
  };

  const envelope: ContextEnvelope<CodingProjectPayload> = {
    envelopeVersion: 1,
    contextId: options.contextId,
    source: 'browser_extension',
    captureMode: 'manual',
    category: 'coding_project',
    sensitivity: 'low',
    confidence: discovery.provider === 'visible-file-tree' || omitted.length > 0 ? 'medium' : 'high',
    meta: {
      platform: discovery.provider,
      title: discovery.name,
      capturedAt: options.capturedAt,
      charCount: fitted.dom.length,
      extractionSource: 'editor-dom',
      partial: omitted.length ? true : undefined,
      missing: omitted.length ? omitted.slice(0, 8).map((entry) => `${entry.path}: ${entry.reason}`) : undefined,
    },
    payload,
  };

  return {
    envelope,
    dom: fitted.dom,
    project: discovery,
    unchanged: Boolean(options.refresh) && !changed,
  };
}
