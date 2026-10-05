import React from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import SwapText from '../ui/SwapText';
import { ChromeFold, type RequestHeightMotion } from './ChromeFold';

export interface TrayShot {
  path: string;
  preview: string;
}

const EASE_SMOOTH_OUT = [0.22, 1, 0.36, 1] as const;
const EASE_BOUNCE = [0.34, 1.36, 0.64, 1] as const; // badge pop, entrances only

/** One thumbnail. It pops in; on removal it fades and shrinks, then gives
 *  its width back, so the ones after it slide over instead of jumping. */
const Thumb: React.FC<{
  shot: TrayShot;
  index: number;
  isLightTheme: boolean;
  removeLabel: string;
  onRemove: (path: string) => void;
}> = ({ shot, index, isLightTheme, removeLabel, onRemove }) => {
  const reduce = useReducedMotion() ?? false;
  const present = useIsPresent();
  return (
    <motion.div
      className="relative group/thumb flex-shrink-0 mr-1.5"
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9, filter: 'blur(2px)' }}
      animate={
        reduce
          ? { opacity: 1, transition: { duration: 0.15 } }
          : {
              opacity: 1, scale: 1, filter: 'blur(0px)',
              transition: {
                opacity: { duration: 0.15, ease: 'easeOut' },
                scale: { duration: 0.3, ease: EASE_BOUNCE },
                filter: { duration: 0.25, ease: 'easeOut' },
              },
              transitionEnd: { filter: 'none' },
            }
      }
      exit={
        reduce
          ? { opacity: 0, transition: { duration: 0.15 } }
          : {
              opacity: 0, scale: 0.9, filter: 'blur(2px)', width: 0, marginRight: 0, overflow: 'hidden',
              transition: {
                opacity: { duration: 0.15, ease: EASE_SMOOTH_OUT },
                scale: { duration: 0.15, ease: EASE_SMOOTH_OUT },
                filter: { duration: 0.15, ease: EASE_SMOOTH_OUT },
                width: { duration: 0.25, delay: 0.04, ease: EASE_SMOOTH_OUT },
                marginRight: { duration: 0.25, delay: 0.04, ease: EASE_SMOOTH_OUT },
              },
            }
      }
      style={{ pointerEvents: present ? undefined : 'none' }}
    >
      <img
        src={shot.preview}
        alt={`Screenshot ${index + 1}`}
        className={`h-12 w-auto rounded-[10px] border object-cover shadow-sm ${isLightTheme ? 'border-black/15' : 'border-white/20'}`}
      />
      <button
        onClick={() => onRemove(shot.path)}
        className="ov-thumb-remove absolute -top-1 -right-1 w-4 h-4 bg-red-500/80 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover/thumb:opacity-100"
        title={removeLabel}
      >
        <X className="w-2.5 h-2.5 text-white" />
      </button>
    </motion.div>
  );
};

/**
 * The attached-screenshot tray above the input. Opening and closing it folds
 * the card's height (ChromeFold) instead of jumping; the count swaps in place
 * as screenshots come and go.
 */
export const ScreenshotTray: React.FC<{
  shots: TrayShot[];
  onRemove: (path: string) => void;
  onClear: () => void;
  overlayVisible: boolean;
  requestHeightMotion?: RequestHeightMotion;
  surfaceClassName: string;
  surfaceStyle?: React.CSSProperties;
  iconStyle?: React.CSSProperties;
  isLightTheme: boolean;
  t: (key: string) => string;
}> = ({ shots, onRemove, onClear, overlayVisible, requestHeightMotion, surfaceClassName, surfaceStyle, iconStyle, isLightTheme, t }) => {
  const count = shots.length;
  const label = `${count} screenshot${count > 1 ? 's' : ''} attached`;
  return (
    <ChromeFold
      show={count > 0}
      overlayVisible={overlayVisible}
      requestHeightMotion={requestHeightMotion}
      innerClassName="pb-2"
      testId="screenshot-tray"
    >
      <div className={`rounded-lg p-2 border ${surfaceClassName}`} style={surfaceStyle}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-medium overlay-text-primary">
            <SwapText swapKey={label}>{label}</SwapText>
          </span>
          <button
            onClick={onClear}
            className="p-1 rounded-full transition-colors overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive"
            title={t('Remove all')}
            style={iconStyle}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex overflow-x-auto max-w-full pb-1">
          <AnimatePresence>
            {shots.map((shot, index) => (
              <Thumb
                key={shot.path}
                shot={shot}
                index={index}
                isLightTheme={isLightTheme}
                removeLabel={t('Remove')}
                onRemove={onRemove}
              />
            ))}
          </AnimatePresence>
        </div>
        <span className="text-[10px] overlay-text-muted">
          {t('Ask a question or click Answer')}
        </span>
      </div>
    </ChromeFold>
  );
};

export default ScreenshotTray;
