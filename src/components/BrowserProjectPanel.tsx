import React, { useEffect, useMemo, useRef } from 'react';
import { Code, RefreshCw, X } from 'lucide-react';
import type {
  BrowserProjectDiscovery,
  BrowserProjectDiscoveryFile,
} from '../types/electron';

const PROJECT_CONTEXT_BUDGET = 22_000;
const PROJECT_FILE_BUDGET = 7_000;

interface FolderNode {
  name: string;
  path: string;
  folders: Map<string, FolderNode>;
  files: Array<{ file: BrowserProjectDiscoveryFile; name: string }>;
}

export type ProjectPreset = 'all' | 'source' | 'tests' | 'config';

export interface BrowserProjectPanelProps {
  project: BrowserProjectDiscovery;
  selectedPaths: ReadonlySet<string>;
  busy: boolean;
  refreshAvailable: boolean;
  message?: { text: string; tone: 'neutral' | 'ok' | 'warn' | 'error' } | null;
  onSelectionChange: (paths: Set<string>) => void;
  onPreset: (preset: ProjectPreset) => void;
  onCapture: (refresh: boolean) => void;
  onClose: () => void;
}

function pathParts(path: string): string[] {
  return path.replace(/\\/g, '/').replace(/^\.\/+/, '').split('/').filter(Boolean);
}

function buildTree(files: BrowserProjectDiscoveryFile[]): FolderNode {
  const root: FolderNode = { name: '', path: '', folders: new Map(), files: [] };
  for (const file of files) {
    const parts = pathParts(file.path);
    const name = parts.pop() || file.path;
    let node = root;
    for (const part of parts) {
      const path = node.path ? `${node.path}/${part}` : part;
      let child = node.folders.get(part);
      if (!child) {
        child = { name: part, path, folders: new Map(), files: [] };
        node.folders.set(part, child);
      }
      node = child;
    }
    node.files.push({ file, name });
  }
  return root;
}

function readablePaths(node: FolderNode): string[] {
  const result = node.files.filter(({ file }) => file.readable).map(({ file }) => file.path);
  for (const child of node.folders.values()) result.push(...readablePaths(child));
  return result;
}

function SelectionBox({
  paths,
  selectedPaths,
  disabled,
  onChange,
}: {
  paths: string[];
  selectedPaths: ReadonlySet<string>;
  disabled?: boolean;
  onChange: (selected: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const selectedCount = paths.filter((path) => selectedPaths.has(path)).length;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = selectedCount > 0 && selectedCount < paths.length;
  }, [paths.length, selectedCount]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={paths.length > 0 && selectedCount === paths.length}
      disabled={disabled || paths.length === 0}
      onChange={(event) => onChange(event.target.checked)}
      className="h-3 w-3 accent-blue-500"
    />
  );
}

function TreeNode({
  node,
  selectedPaths,
  busy,
  onToggle,
}: {
  node: FolderNode;
  selectedPaths: ReadonlySet<string>;
  busy: boolean;
  onToggle: (paths: string[], selected: boolean) => void;
}) {
  const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <ul className={node.path ? 'ml-4 border-l border-white/10 pl-2' : ''}>
      {folders.map((folder) => {
        const paths = readablePaths(folder);
        return (
          <li key={`folder:${folder.path}`} className="py-0.5">
            <label className="flex min-w-0 items-center gap-2 text-[10px] font-medium overlay-text-primary">
              <SelectionBox
                paths={paths}
                selectedPaths={selectedPaths}
                disabled={busy}
                onChange={(selected) => onToggle(paths, selected)}
              />
              <span className="truncate" title={folder.path}>{folder.name}</span>
            </label>
            <TreeNode node={folder} selectedPaths={selectedPaths} busy={busy} onToggle={onToggle} />
          </li>
        );
      })}
      {files.map(({ file, name }) => (
        <li key={`file:${file.path}`} className={`flex min-w-0 items-center gap-2 py-0.5 ${file.readable ? '' : 'opacity-50'}`}>
          <SelectionBox
            paths={file.readable ? [file.path] : []}
            selectedPaths={selectedPaths}
            disabled={busy || !file.readable}
            onChange={(selected) => onToggle([file.path], selected)}
          />
          <span
            className="min-w-0 flex-1 truncate text-[10px] overlay-text-primary"
            title={file.readable ? file.path : `${file.path} — ${file.reason || 'Unreadable'}`}
          >
            {name}
          </span>
          {file.changed && <span className="rounded bg-amber-400/15 px-1 text-[8px] text-amber-300">changed</span>}
          <span className="shrink-0 text-[8px] overlay-text-muted">
            {file.readable ? [file.language, file.charCount ? `${file.charCount.toLocaleString()} chars` : ''].filter(Boolean).join(' · ') : 'unreadable'}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function BrowserProjectPanel({
  project,
  selectedPaths,
  busy,
  refreshAvailable,
  message,
  onSelectionChange,
  onPreset,
  onCapture,
  onClose,
}: BrowserProjectPanelProps) {
  const tree = useMemo(() => buildTree(project.files), [project.files]);
  const selectedFiles = project.files.filter((file) => file.readable && selectedPaths.has(file.path));
  const selectedChars = selectedFiles.reduce((sum, file) => sum + Math.max(0, file.charCount || 0), 0);
  const unreadableCount = project.files.filter((file) => !file.readable).length;
  const oversizedCount = selectedFiles.filter((file) => file.charCount > PROJECT_FILE_BUDGET).length;

  const toggle = (paths: string[], selected: boolean) => {
    const next = new Set(selectedPaths);
    for (const path of paths) {
      if (selected) next.add(path);
      else next.delete(path);
    }
    onSelectionChange(next);
  };

  const toneClass = message?.tone === 'error'
    ? 'text-red-300'
    : message?.tone === 'warn'
      ? 'text-amber-300'
      : message?.tone === 'ok'
        ? 'text-emerald-300'
        : 'overlay-text-muted';

  return (
    <div className="relative no-drag mx-4 mt-1 mb-1 rounded-[12px] border border-white/10 bg-black/35 backdrop-blur-xl p-2.5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-medium overlay-text-primary">
            <Code className="h-3 w-3" />
            <span className="truncate" title={project.name}>{project.name || 'Detected project'}</span>
          </div>
          <div className="mt-0.5 text-[9px] overlay-text-muted">
            {project.provider || 'browser editor'} · {project.files.length} files
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-0.5 opacity-60 hover:bg-white/10 hover:opacity-100" aria-label="Close project picker">
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {(['all', 'source', 'tests', 'config'] as ProjectPreset[]).map((preset) => (
          <button
            key={preset}
            type="button"
            disabled={busy}
            onClick={() => onPreset(preset)}
            className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] capitalize overlay-text-primary hover:bg-white/10 disabled:opacity-50"
          >
            {preset}
          </button>
        ))}
      </div>

      <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-white/5 bg-black/15 p-2">
        <TreeNode node={tree} selectedPaths={selectedPaths} busy={busy} onToggle={toggle} />
      </div>

      <div className={`mt-1.5 flex items-center justify-between text-[9px] ${selectedChars > PROJECT_CONTEXT_BUDGET ? 'text-amber-300' : 'overlay-text-muted'}`}>
        <span>{selectedFiles.length} of {project.files.length} files selected</span>
        <span>~{selectedChars.toLocaleString()} chars</span>
      </div>

      {(unreadableCount > 0 || oversizedCount > 0 || selectedChars > PROJECT_CONTEXT_BUDGET || project.warnings.length > 0) && (
        <div className="mt-1 text-[9px] leading-4 text-amber-300/90">
          {unreadableCount > 0 && <div>{unreadableCount} listed file(s) expose paths but not complete contents; they will be disclosed as unreadable.</div>}
          {oversizedCount > 0 && <div>{oversizedCount} selected file(s) will be truncated at 7,000 characters.</div>}
          {selectedChars > PROJECT_CONTEXT_BUDGET && <div>The 22,000-character project budget may omit lower-priority files.</div>}
          {project.warnings.slice(0, 3).map((warning) => <div key={warning}>{warning}</div>)}
        </div>
      )}

      {message && <div className={`mt-1.5 text-[9px] ${toneClass}`}>{message.text}</div>}

      <div className={`mt-2 grid gap-1.5 ${refreshAvailable ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <button
          type="button"
          disabled={busy || selectedFiles.length === 0}
          onClick={() => onCapture(false)}
          className="rounded-lg bg-blue-500/90 px-2 py-1.5 text-[10px] font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy ? 'Working…' : 'Capture selected'}
        </button>
        {refreshAvailable && (
          <button
            type="button"
            disabled={busy || selectedFiles.length === 0}
            onClick={() => onCapture(true)}
            className="flex items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[10px] font-medium overlay-text-primary hover:bg-white/10 disabled:opacity-45"
          >
            <RefreshCw className="h-3 w-3" /> Refresh changed
          </button>
        )}
      </div>
    </div>
  );
}
