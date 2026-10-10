import React from 'react';
import { Clock, Timer, TimerOff, WifiOff } from 'lucide-react';
import { OverlayBanner, OverlayBannerButton } from '../ui/OverlayBanner';
import { useLensTracking } from '../../ui-components/LiquidGlassButton';
import SwapText from '../ui/SwapText';
import { useT } from '../../i18n';
import { fmt } from '../onboarding/i18nText';
import type { OverlayTrial } from './useOverlayTrial';
import '../ui/OverlayBanner.css';
import './PageContextChip.css';
import './TrialNotice.css';

/**
 * What the meeting overlay says about the free trial that starts by itself
 * with a meeting (state: useOverlayTrial; rule: overlayTrialNotice.mjs).
 *
 *  - started: it began, how long it lasts, and where the audio goes. One way
 *    out, and a close. Folds into the countdown by itself.
 *  - ending:  five minutes left, both ways to keep going. No close: it stays
 *    until the trial ends.
 *  - ended:   it ran out in this meeting. No close: nothing answers until one
 *    of the two is chosen.
 *  - failed:  the automatic start could not reach Natively. The only place a
 *    "Start free trial" button is left. No close, as for ended: closed, it
 *    would uncover "Transcription Not Configured" and its wrong advice.
 *
 * Every string is passed through t() here; the rows are in src/i18n.trial.ts.
 * None of the banners blocks the overlay.
 */
export const TrialNoticeBanner: React.FC<{ trial: OverlayTrial }> = ({ trial }) => {
  const t = useT();
  const ownKeys = <OverlayBannerButton onClick={trial.useOwnKeys}>{t('Use my own keys')}</OverlayBannerButton>;
  const plans = <OverlayBannerButton variant="primary" onClick={trial.seePlans}>{t('See plans')}</OverlayBannerButton>;
  const keepGoing = t('Pick a plan or add your own keys to keep getting answers.');

  switch (trial.banner) {
    case 'started':
      return (
        <OverlayBanner
          className="mx-4"
          tone="ok"
          icon={<Timer strokeWidth={2.2} />}
          title={fmt(t('Free trial started: {minutes} minutes'), { minutes: trial.minutesLeft ?? 30 })}
          message={t("Audio and questions are processed on Natively's servers.")}
          onDismiss={trial.dismiss}
          dismissLabel={t('Dismiss')}
          actions={ownKeys}
        />
      );
    case 'ending':
      return (
        <OverlayBanner
          className="mx-4"
          tone="warning"
          icon={<Timer strokeWidth={2.2} />}
          title={t('Free trial is almost over')}
          message={keepGoing}
          actions={<>{plans}{ownKeys}</>}
        />
      );
    case 'ended':
      return (
        <OverlayBanner
          className="mx-4"
          tone="error"
          icon={<TimerOff strokeWidth={2.2} />}
          title={t('Free trial ended')}
          message={keepGoing}
          actions={<>{plans}{ownKeys}</>}
        />
      );
    case 'failed': {
      const start = t('Start free trial');
      const starting = t('Starting…');
      return (
        <OverlayBanner
          className="mx-4"
          tone="warning"
          icon={trial.failure === 'unreachable' || !trial.failure ? <WifiOff strokeWidth={2.2} /> : <Clock strokeWidth={2.2} />}
          title={t('Free trial could not start')}
          message={trial.failure === 'rate_limited'
            ? t('Too many attempts. Try again later.')
            : trial.failure === 'paused'
            ? t('Free trials are not available right now. Try again later.')
            : t('Natively could not be reached. Check your connection and try again.')}
          actions={
            <>
              <OverlayBannerButton variant="primary" disabled={trial.starting} onClick={trial.startManually}>
                {/* The label changes in place while the start is in flight.
                    Both labels size the button (hidden, in the same cell), so
                    the pill keeps one width whichever is longer in this language. */}
                <span className="trial-start-label">
                  <span className="trial-start-sizer" aria-hidden="true">{start}</span>
                  <span className="trial-start-sizer" aria-hidden="true">{starting}</span>
                  <SwapText swapKey={trial.starting ? 'starting' : 'start'}>
                    {trial.starting ? starting : start}
                  </SwapText>
                </span>
              </OverlayBannerButton>
              {ownKeys}
            </>
          }
        />
      );
    }
    default:
      return null;
  }
};

/**
 * The countdown for the rest of the trial: the page chip's clear glass with a
 * plain timer, green until five minutes are left and amber after. It is not a
 * control, so it has no buttons and does not press.
 */
export const TrialChip: React.FC<{ minutesLeft: number; tone: 'ok' | 'warning' }> = ({ minutesLeft, tone }) => {
  const t = useT();
  const lens = useLensTracking<HTMLDivElement>();
  const rest = fmt(t('{minutes} min left'), { minutes: minutesLeft });
  return (
    <div className="ov-tone-scope pc-chip-host trial-chip-host" data-tone={tone}>
      <div
        ref={lens.ref}
        onPointerMove={lens.onPointerMove}
        className="lg-button lg-clear lg-sm lg-wide pc-chip trial-chip"
        role="status"
      >
        <span className="lg-lens" aria-hidden="true" />
        <span className="lg-content">
          {/* Keyed on the tone: the timer pops again when the countdown
              turns amber, as a banner's mark does when its tone changes. */}
          <span className="pc-chip-icon" aria-hidden="true" key={tone}>
            <Timer strokeWidth={2} />
          </span>
          <span className="lg-label pc-chip-label">
            <span className="pc-chip-head">{t('Free trial')}</span>
            {/* The minute changes in place instead of jumping. */}
            <span className="pc-chip-rest"> · <SwapText swapKey={rest}>{rest}</SwapText></span>
          </span>
        </span>
      </div>
    </div>
  );
};
