import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

const StickyNoteWindow: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const noteId = params.get('id') ?? '';
  const [text, setText] = useState('');
  const [intent, setIntent] = useState<string | undefined>();

  useEffect(() => {
    if (!noteId || !window.electronAPI?.getStickyNoteContent) return;
    window.electronAPI.getStickyNoteContent(noteId).then((payload) => {
      if (!payload) return;
      setText(payload.text);
      setIntent(payload.intent);
    });
  }, [noteId]);

  const handleClose = () => {
    window.electronAPI?.closeStickyNote?.(noteId);
  };

  const intentLabel =
    intent && intent !== 'chat'
      ? intent.replace(/_/g, ' ')
      : null;

  return (
    <div className="w-screen h-screen p-0 m-0 bg-transparent overflow-hidden select-text">
      <div className="flex flex-col h-full rounded-2xl border border-amber-400/35 bg-amber-50/95 dark:bg-amber-950/90 backdrop-blur-xl shadow-2xl overflow-hidden">
        <div
          className="flex items-center justify-between gap-2 px-3 py-2 border-b border-amber-400/25 bg-amber-100/80 dark:bg-amber-900/50 cursor-move"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-800/80 dark:text-amber-200/80 truncate">
            {intentLabel ? `Note · ${intentLabel}` : 'Sticky note'}
          </span>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 rounded-md text-amber-800/70 hover:text-red-600 hover:bg-black/5 dark:text-amber-100/70 dark:hover:bg-white/10 transition-colors"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            title="Delete note"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div
          className="flex-1 overflow-y-auto px-3 py-3 text-[13px] leading-relaxed text-amber-950 dark:text-amber-50 whitespace-pre-wrap custom-scrollbar"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {text || '…'}
        </div>
      </div>
    </div>
  );
};

export default StickyNoteWindow;
