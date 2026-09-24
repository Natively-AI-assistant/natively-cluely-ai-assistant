// src/components/ProviderChangeNotice.tsx
//
// The notice in the launcher's bottom-right corner when meetings were indexed
// under a previous AI provider, and the re-index it offers. One card: Re-index
// turns the warning into the progress in place, so the genie pours once, not
// out and back in again. A notice, not a modal (no dim), and no kept picture:
// its counts and provider names are new each time.
import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { GenieModal } from './ui/GenieModal';

export interface ProviderChangeWarning { count: number; oldProvider: string; newProvider: string }
export interface ReindexProgress { done: number; total: number }

interface ProviderChangeNoticeProps {
  open: boolean;
  /** The warning; shown until Re-index or Dismiss. */
  warning: ProviderChangeWarning | null;
  /** The re-index under way. Takes the card's place once set. */
  progress: ReindexProgress | null;
  onDismiss: () => void;
  onReindex: () => void;
}

export const ProviderChangeNotice: React.FC<ProviderChangeNoticeProps> = ({ open, warning, progress, onDismiss, onReindex }) => (
  <GenieModal
    open={open}
    label="ProviderChangeNotice"
    modal={false}
    placement="bottom-right"
    keepPictures={false}
    zIndex={50}
    padding={24}
    wrapClassName="max-w-[340px]"
    cardClassName={`bg-[#1A1A1A] border ${progress ? 'border-white/10' : 'border-[#ff3333]/30'} shadow-2xl rounded-2xl p-5 flex flex-col gap-3`}
    shadow="0 25px 50px -12px rgba(0,0,0,0.25)"
    radius={16}
  >
    {progress ? (
      <div className="flex items-start gap-3">
        <RefreshCw className={`w-5 h-5 text-[#A0A0A0] shrink-0 mt-0.5 ${progress.done < progress.total ? 'animate-spin' : ''}`} />
        <div className="flex-1">
          <h3 className="text-[#E0E0E0] font-medium text-sm">
            {progress.done >= progress.total && progress.total > 0
              ? 'Search index updated'
              : 'Updating search index'}
          </h3>
          <p className="text-[#A0A0A0] text-xs mt-1 leading-relaxed">
            {progress.done >= progress.total && progress.total > 0
              ? 'Your past conversations are searchable again.'
              : `Re-indexing your past conversations for the upgraded AI model… ${progress.done}/${progress.total}`}
          </p>
          {progress.total > 0 && (
            <div className="mt-2 h-1 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-[#E0E0E0] transition-all duration-500"
                style={{ width: `${Math.min(100, Math.round((progress.done / progress.total) * 100))}%` }}
              />
            </div>
          )}
        </div>
      </div>
    ) : warning ? (
      <>
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-[#ff3333] shrink-0 mt-0.5" />
          <div>
            <h3 className="text-[#E0E0E0] font-medium text-sm">Provider Changed</h3>
            <p className="text-[#A0A0A0] text-xs mt-1 leading-relaxed">
              ⚠ {warning.count} meetings used your previous AI provider ({warning.oldProvider}) and won't appear in search results under {warning.newProvider}.
            </p>
          </div>
        </div>
        <div className="flex gap-2 mt-1 justify-end">
          <button 
            onClick={onDismiss}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#A0A0A0] hover:text-white hover:bg-white/5 transition-colors"
          >
            Dismiss
          </button>
          <button 
            onClick={onReindex}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#ff3333]/10 text-[#ff3333] hover:bg-[#ff3333]/20 transition-colors"
          >
            Re-index automatically
          </button>
        </div>
      </>
    ) : null}
  </GenieModal>
);

export default ProviderChangeNotice;
