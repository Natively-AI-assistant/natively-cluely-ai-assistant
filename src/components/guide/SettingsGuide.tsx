// First-run guide, Settings: step 7 (Plans & Billing) and step 8 (the user's
// own keys). Step 6 reads the real trial status so it never says more than is
// true; buying a plan or saving keys moves the guide on by itself
// (src/lib/onboarding/firstRunGuide.mjs decides what each purchase means).
import React, { useCallback, useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { planStepTitle } from '../../lib/onboarding/firstRunGuide.mjs';
import { GuideCard, type GuideListRow } from './GuideCard';
import { guideOn, useGuide } from './useGuide';

type TrialLeft = { ms: number | null; over: boolean };

export const SettingsGuide: React.FC = () => {
  const tr = useT();
  const { state, justDone, dispatch } = useGuide();
  const onPlans = guideOn(state, 'plans');
  const onKeys = guideOn(state, 'keys');
  const finishedBought = state?.status === 'finished' && state.outcome === 'bought';

  // Step 6: a plan bought here, or keys added. Main judges what changed from
  // its own sources (a running trial's placeholder key is not a purchase).
  const report = useCallback(() => {
    dispatch({ type: 'plan_changed' });
  }, [dispatch]);
  useEffect(() => {
    if (!onPlans) return;
    report();
    const offs = [window.electronAPI?.onLicenseStatusChanged?.(report), window.electronAPI?.onCredentialsChanged?.(report)];
    return () => { offs.forEach((off) => off?.()); };
  }, [onPlans, report]);

  // Step 6: what is really left of the trial.
  const [trial, setTrial] = useState<TrialLeft | null>(null);
  useEffect(() => {
    if (!onPlans) return;
    let alive = true;
    window.electronAPI?.getTrialStatus?.()
      .then((s) => {
        if (!alive) return;
        const ms = typeof s?.remaining_ms === 'number' ? Math.max(0, s.remaining_ms) : null;
        setTrial({ ms, over: !!s?.expired || ms === 0 });
      })
      .catch(() => { if (alive) setTrial({ ms: null, over: false }); });
    return () => { alive = false; };
  }, [onPlans]);

  // Step 7: tick each setting as it is saved.
  const [setup, setSetup] = useState({ ai: false, stt: false, retrieval: false });
  useEffect(() => {
    if (!onKeys) return;
    let alive = true;
    const read = () => {
      const api = window.electronAPI;
      void Promise.all([
        api?.getStoredCredentials?.().catch(() => undefined),
        api?.getSttProvider?.().catch(() => 'none'),
        api?.getEmbeddingStatus?.().catch(() => undefined),
      ]).then(([creds, stt, retrieval]) => {
        if (!alive) return;
        setSetup({
          ai: !!creds?.hasOwnAiKey,
          // 'natively' is the Natively key's own speech-to-text, not one of theirs.
          stt: !!stt && stt !== 'none' && stt !== 'natively',
          retrieval: !!retrieval?.active?.configured,
        });
      });
    };
    read();
    const off = window.electronAPI?.onCredentialsChanged?.(read);
    const timer = setInterval(read, 4000);
    return () => { alive = false; off?.(); clearInterval(timer); };
  }, [onKeys]);

  // A plan bought at step 7: say thanks on the same card, then go.
  const [thanks, setThanks] = useState(false);
  useEffect(() => {
    if (!finishedBought || !state?.updatedAt || Date.now() - state.updatedAt > 10_000) return;
    setThanks(true);
    const timer = setTimeout(() => setThanks(false), 4000);
    return () => clearTimeout(timer);
  }, [finishedBought, state?.updatedAt]);

  const skip = () => dispatch({ type: 'skip' });

  if (thanks) {
    return (
      <GuideCard
        anchor='[data-guide="nav-plans"]'
        width={290}
        dx={60}
        stepId="plans"
        title={tr('Thanks. You’re all set.')}
        body={tr('Your plan covers the AI and speech-to-text. Start a meeting any time.')}
        lit={false}
      />
    );
  }

  if (onPlans) {
    const minutes = trial?.ms != null ? Math.max(1, Math.round(trial.ms / 60000)) : null;
    const variant = state!.variant;
    const over = variant === 'trial_out' || !!trial?.over;
    const title = tr(planStepTitle({ variant, remainingMs: trial?.ms ?? null, expired: !!trial?.over }));
    const left = !over && variant !== 'no_trial' && minutes != null
      ? `${tr('About {n} min left.').replace('{n}', String(minutes))} `
      : '';
    return (
      <GuideCard
        anchor='[data-guide="nav-plans"]'
        width={290}
        dx={60}
        stepId="plans"
        title={title}
        body={`${left}${tr('Pick a plan on the right to keep Natively Pro. Or use your own AI keys, free.')}`}
        action={{ label: tr('Use my own keys'), onClick: () => dispatch({ type: 'own_keys' }) }}
        done={justDone}
        onSkip={skip}
      />
    );
  }

  if (onKeys) {
    const rows: GuideListRow[] = [];
    const firstTodo = !setup.ai ? 'ai' : !setup.stt ? 'stt' : !setup.retrieval ? 'retrieval' : null;
    const row = (key: 'ai' | 'stt' | 'retrieval', label: string, hint: string): GuideListRow =>
      [label, setup[key] ? 'done' : firstTodo === key ? 'now' : 'todo', setup[key] ? undefined : hint];
    rows.push(row('ai', tr('AI provider'), tr('Paste a key')));
    rows.push(row('stt', tr('Speech-to-text'), tr('Pick one')));
    rows.push(row('retrieval', tr('Retrieval'), tr('Optional')));
    return (
      <GuideCard
        anchor='[data-guide="nav-ai-providers"]'
        width={320}
        dx={60}
        stepId="keys"
        title={tr('Set up Natively your way.')}
        body={tr('An AI provider is all you need. Speech-to-text and retrieval make it better.')}
        list={rows}
        action={{ label: tr('Done'), onClick: () => dispatch({ type: 'keys_done' }), disabled: !setup.ai }}
        done={justDone}
        onSkip={skip}
      />
    );
  }

  return null;
};
