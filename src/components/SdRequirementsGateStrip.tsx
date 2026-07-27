// src/components/SdRequirementsGateStrip.tsx
//
// Read-only Requirements gate-status strip (ticket 17 / SPEC 17).
// Lives in the overlay status-pill band: compact progress + optional expand
// for gate-relevant slot statuses, plus an Advance button that reuses the
// prepare + answer path with sdRequirementsUiAdvance.

import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, ListChecks } from 'lucide-react';
import type { GateStatusViewModel } from '../types/electron';

const HIDDEN: GateStatusViewModel = {
  visible: false,
  filled: 0,
  required: 0,
  nextSlotLabel: null,
  progressLabel: '',
  rows: [],
  missingIds: [],
  shouldAutoExpand: false,
  checklistComplete: false,
};

function statusGlyph(status: 'filled' | 'missing' | 'assumed'): string {
  if (status === 'filled') return '✓';
  if (status === 'assumed') return '~';
  return '○';
}

export interface SdRequirementsGateStripProps {
  /** Shared with other status pills so the row mounts when any pill is present. */
  onVisibilityChange?: (visible: boolean) => void;
  /** Triggers What-to-Answer with UI advance (same path as speech). */
  onAdvance: () => void | Promise<void>;
  advancing?: boolean;
  statusPillBaseClass: string;
  getStatusToneClass: (tone: 'ok' | 'warn' | 'error') => string;
}

export const SdRequirementsGateStrip: React.FC<SdRequirementsGateStripProps> = ({
  onVisibilityChange,
  onAdvance,
  advancing = false,
  statusPillBaseClass,
  getStatusToneClass,
}) => {
  const [vm, setVm] = useState<GateStatusViewModel>(HIDDEN);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const apply = (next: GateStatusViewModel | null | undefined) => {
      if (cancelled || !next) return;
      setVm(next);
      if (next.shouldAutoExpand) setExpanded(true);
      if (!next.visible) setExpanded(false);
      onVisibilityChange?.(Boolean(next.visible));
    };

    void window.electronAPI?.getSdRequirementsGateStatus?.()
      .then((res) => {
        if (res?.viewModel) apply(res.viewModel);
      })
      .catch(() => { /* non-fatal */ });

    const off = window.electronAPI?.onSdRequirementsGateStatus?.((next) => apply(next));
    return () => {
      cancelled = true;
      try { off?.(); } catch { /* unmount */ }
    };
  }, [onVisibilityChange]);

  const toggle = useCallback(() => {
    setExpanded((v) => !v);
  }, []);

  if (!vm.visible) return null;

  const missingSet = new Set(vm.missingIds || []);
  const nextLine = vm.nextSlotLabel ? `next: ${vm.nextSlotLabel}` : 'ready to advance';

  return (
    <div className="flex flex-col items-stretch gap-1 max-w-[min(420px,92vw)]">
      <div
        className={`${statusPillBaseClass} ${getStatusToneClass(vm.checklistComplete ? 'ok' : 'warn')} pr-1.5`}
        title="Requirements grilling gate — checklist status"
      >
        <ListChecks className="h-3 w-3 opacity-70 shrink-0" />
        <button
          type="button"
          className="flex items-center gap-1.5 min-w-0 text-left"
          onClick={toggle}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse requirements checklist' : 'Expand requirements checklist'}
        >
          <span className="truncate font-medium">{vm.progressLabel || `Requirements · ${vm.filled}/${vm.required}`}</span>
          <span className="truncate opacity-80 text-[10px]">{nextLine}</span>
          {expanded ? <ChevronUp className="h-3 w-3 opacity-70 shrink-0" /> : <ChevronDown className="h-3 w-3 opacity-70 shrink-0" />}
        </button>
        <button
          type="button"
          className="ml-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-black/10 dark:bg-white/10 hover:bg-black/15 dark:hover:bg-white/15 disabled:opacity-50"
          disabled={advancing}
          onClick={() => { void onAdvance(); }}
          aria-label="Advance past Requirements"
        >
          Advance
        </button>
      </div>

      {expanded && vm.rows.length > 0 && (
        <div className="rounded-[12px] border border-white/10 bg-black/25 backdrop-blur-xl px-2.5 py-1.5 text-[11px] overlay-text-primary shadow-sm">
          <ul className="flex flex-col gap-0.5">
            {vm.rows.map((row) => {
              const highlight = missingSet.has(row.id);
              return (
                <li
                  key={row.id}
                  className={`flex items-center gap-1.5 ${highlight ? 'text-amber-200 font-medium' : 'opacity-90'}`}
                >
                  <span className="w-3 text-center opacity-80" aria-hidden>
                    {statusGlyph(row.status)}
                  </span>
                  <span className="truncate">{row.label}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wide opacity-60">
                    {row.status}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};

export default SdRequirementsGateStrip;
