import React from 'react';
import { History } from 'lucide-react';
import { OverlayBanner } from '../ui/OverlayBanner';
import { useT } from '../../i18n';
import { useLastTimeRecap, type LastTimeRecapState } from '../assist/useLastTimeRecap';
import '../ui/OverlayBanner.css';

/**
 * The overlay's "Last time" notice (state: assist/useLastTimeRecap.ts). Same
 * banner as the other overlay notices (OverlayBanner), in its quiet "ok"
 * tone, like the trial's "started": good to know, nothing to fix.
 */
export { useLastTimeRecap };
export type { LastTimeRecapState };

export const LastTimeRecapBanner: React.FC<{ state: LastTimeRecapState }> = ({ state }) => {
  const t = useT();
  const recap = state.recap?.recap;
  if (!recap || !Array.isArray(recap.bullets) || recap.bullets.length === 0) return null;
  return (
    <OverlayBanner
      className="mx-4"
      tone="ok"
      icon={<History strokeWidth={2.2} />}
      title={recap.title}
      message={
        <>
          {recap.bullets.map((b, i) => (
            <span key={i} className="block">{`• ${b}`}</span>
          ))}
        </>
      }
      onDismiss={state.dismiss}
      dismissLabel={t('Dismiss')}
    />
  );
};
