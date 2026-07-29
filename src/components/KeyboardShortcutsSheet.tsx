import React, { useEffect, useMemo } from 'react';
import {
  EyeOff,
  Keyboard,
  Mic,
  MousePointer2,
  Move,
  RefreshCw,
  Sparkles,
  Camera,
  ArrowUpDown,
  ArrowLeftRight,
} from 'lucide-react';
import {
  resolveShortcutsSheetRows,
  type ShortcutsSheetIconId,
  type ShortcutsSheetRow,
} from '../../electron/services/shortcutsSheet';
import { acceleratorToKeys } from '../utils/keyboardUtils';
import { useT } from '../i18n';

export interface KeyboardShortcutsSheetProps {
  isOpen: boolean;
  onDismiss: () => void;
  /** Live KeybindManager list from getKeybinds / onKeybindsUpdate. */
  keybinds: Array<{ id: string; accelerator?: string | null }>;
  onOpenHotkeysSettings?: () => void;
}

const ICON_MAP: Record<ShortcutsSheetIconId, React.ReactNode> = {
  sparkles: <Sparkles className="w-4 h-4" />,
  screenshot: <Camera className="w-4 h-4" />,
  mic: <Mic className="w-4 h-4" />,
  reset: <RefreshCw className="w-4 h-4" />,
  eyeOff: <EyeOff className="w-4 h-4" />,
  mouse: <MousePointer2 className="w-4 h-4" />,
  scrollVert: <ArrowUpDown className="w-4 h-4" />,
  scrollHoriz: <ArrowLeftRight className="w-4 h-4" />,
  move: <Move className="w-4 h-4" />,
};

function Keycaps({ accelerators }: { accelerators: string[] }) {
  const nonEmpty = accelerators.filter((a) => a && a.trim());
  if (nonEmpty.length === 0) {
    return (
      <span className="text-[10px] overlay-text-muted whitespace-nowrap">{'Unbound'}</span>
    );
  }

  // For multi-bind rows (scroll/move), show unique key sequences without repeating shared modifiers excessively.
  // Prefer showing each accelerator's keycaps separated by a thin gap.
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5 max-w-[160px]">
      {nonEmpty.map((acc, i) => {
        const keys = acceleratorToKeys(acc);
        return (
          <span key={`${acc}-${i}`} className="inline-flex items-center gap-0.5">
            {keys.map((k, j) => (
              <kbd
                key={`${k}-${j}`}
                className="min-w-[1.25rem] h-5 px-1 inline-flex items-center justify-center rounded-md border border-white/15 bg-white/10 text-[10px] font-medium overlay-text-primary"
              >
                {k}
              </kbd>
            ))}
          </span>
        );
      })}
    </div>
  );
}

function SheetRow({ row }: { row: ShortcutsSheetRow }) {
  const t = useT();
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="mt-0.5 w-5 flex justify-center text-white/70 shrink-0">
        {ICON_MAP[row.icon]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold overlay-text-primary leading-tight">
          {t(row.title)}
        </div>
        <div className="text-[11px] overlay-text-muted leading-snug mt-0.5">
          {t(row.description)}
        </div>
      </div>
      <Keycaps accelerators={row.accelerators} />
    </div>
  );
}

/**
 * Mid-session Cluely-parity Keyboard Shortcuts cheat-sheet.
 * Display-live: chords come from KeybindManager via `keybinds` prop.
 */
export const KeyboardShortcutsSheet: React.FC<KeyboardShortcutsSheetProps> = ({
  isOpen,
  onDismiss,
  keybinds,
  onOpenHotkeysSettings,
}) => {
  const t = useT();
  const rows = useMemo(() => resolveShortcutsSheetRows(keybinds), [keybinds]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isOpen, onDismiss]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center p-4"
      data-stealth-ignore="true"
      role="dialog"
      aria-modal="true"
      aria-label={t('Keyboard Shortcuts')}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px] border-0 cursor-default"
        aria-label={t('Dismiss')}
        onClick={onDismiss}
      />
      <div
        className="relative w-full max-w-[420px] max-h-[min(85vh,640px)] overflow-y-auto rounded-2xl border border-white/10 bg-[#161618]/92 backdrop-blur-xl shadow-2xl px-5 pt-5 pb-4"
        data-stealth-ignore="true"
      >
        <div className="flex flex-col items-center mb-3">
          <Keyboard className="w-5 h-5 text-white/80 mb-2" />
          <h2 className="text-[16px] font-bold overlay-text-primary tracking-tight">
            {t('Keyboard Shortcuts')}
          </h2>
        </div>

        <div className="divide-y divide-white/10">
          {rows.map((row) => (
            <SheetRow key={row.id} row={row} />
          ))}
        </div>

        {onOpenHotkeysSettings && (
          <button
            type="button"
            onClick={onOpenHotkeysSettings}
            className="mt-3 w-full text-center text-[11px] overlay-text-muted hover:overlay-text-primary transition-colors"
            data-stealth-ignore="true"
          >
            {t('Customize in Settings › Hotkeys')}
          </button>
        )}

        <button
          type="button"
          onClick={onDismiss}
          className="mt-3 w-full h-10 rounded-full bg-white/90 hover:bg-white text-[#161618] text-[13px] font-semibold transition-colors"
          data-stealth-ignore="true"
        >
          {t('Got it')}
        </button>
      </div>
    </div>
  );
};
