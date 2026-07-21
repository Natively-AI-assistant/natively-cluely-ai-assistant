import React from 'react';
import { useT } from '../i18n';

interface NegotiationCoachingCardProps {
  tacticalNote?: string;
  exactScript?: string;
  phase?: string;
  theirOffer?: number | null;
  yourTarget?: number | null;
  currency?: string;
  showSilenceTimer?: boolean;
  interfaceTheme?: string;
  isLightTheme?: boolean;
  onSilenceTimerEnd?: () => void;
}

function extractScriptText(script: any): string {
  if (!script) return '';
  if (typeof script === 'string') return script;
  if (typeof script.exactScript === 'string') return script.exactScript;
  if (typeof script.script === 'string') return script.script;
  if (typeof script.text === 'string') return script.text;
  if (Array.isArray(script.talkingPoints)) return script.talkingPoints.join('\n');
  try {
    return JSON.stringify(script, null, 2);
  } catch {
    return '';
  }
}

const NegotiationCoachingCard: React.FC<NegotiationCoachingCardProps> = ({
  tacticalNote,
  exactScript,
  theirOffer,
  yourTarget,
  currency,
  isLightTheme = false,
}) => {
  const t = useT();
  const [loading, setLoading] = React.useState(false);
  const [generated, setGenerated] = React.useState<string | null>(null);
  const [emptyMessage, setEmptyMessage] = React.useState<string | null>(null);

  const cardBgBorderClass = isLightTheme
    ? 'bg-slate-100/70 backdrop-blur-md border border-slate-200/50 text-slate-900 shadow-sm'
    : 'bg-zinc-800/60 backdrop-blur-md border border-zinc-700/40 text-zinc-100 shadow-md';
  const labelColorClass = isLightTheme ? 'text-slate-500' : 'text-slate-400';
  const headerBorderClass = isLightTheme
    ? 'border-b pb-1.5 border-black/5'
    : 'border-b pb-1.5 border-white/5';
  const buttonColorClass = isLightTheme
    ? 'bg-slate-900 text-white hover:bg-slate-800'
    : 'bg-zinc-100 text-zinc-900 hover:bg-white';

  const handleGenerate = async () => {
    setLoading(true);
    setEmptyMessage(null);
    setGenerated(null);
    try {
      const res = await window.electronAPI.profileGenerateNegotiation(true);
      const text = res?.success ? extractScriptText(res.script) : '';
      if (text) {
        setGenerated(text);
      } else {
        setEmptyMessage(
          res?.error ||
            t('Negotiation scripts require a resume and job description to be uploaded.'),
        );
      }
    } catch {
      setEmptyMessage(
        t('Negotiation scripts require a resume and job description to be uploaded.'),
      );
    } finally {
      setLoading(false);
    }
  };

  const scriptText = generated ?? exactScript ?? '';
  const hasOffer = typeof theirOffer === 'number' || typeof yourTarget === 'number';

  return (
    <div
      className={`w-full rounded-[20px] rounded-tl-[4px] p-[14px_18px] ai-response-card ${cardBgBorderClass} my-2.5 transition-all duration-300`}
    >
      <div
        className={`flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold mb-2 ${labelColorClass} ${headerBorderClass}`}
      >
        {t('Negotiation Coach')}
      </div>

      {tacticalNote && (
        <p className="text-[13px] leading-relaxed italic opacity-80 mb-2 whitespace-pre-wrap">
          {tacticalNote}
        </p>
      )}

      {hasOffer && (
        <div className={`text-[11px] mb-2 ${labelColorClass}`}>
          {typeof theirOffer === 'number' && (
            <span className="mr-3">
              {t('Their offer')}: {currency || ''}
              {theirOffer}
            </span>
          )}
          {typeof yourTarget === 'number' && (
            <span>
              {t('Your target')}: {currency || ''}
              {yourTarget}
            </span>
          )}
        </div>
      )}

      {scriptText ? (
        <p className="text-[14.5px] leading-relaxed whitespace-pre-wrap">{scriptText}</p>
      ) : emptyMessage ? (
        <p className={`text-[13px] leading-relaxed ${labelColorClass}`}>{emptyMessage}</p>
      ) : null}

      {!scriptText && (
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading}
          className={`mt-2 inline-flex items-center justify-center min-h-[24px] rounded-[10px] px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${buttonColorClass}`}
        >
          {loading ? t('Generating…') : t('Generate negotiation script')}
        </button>
      )}
    </div>
  );
};

export default NegotiationCoachingCard;
