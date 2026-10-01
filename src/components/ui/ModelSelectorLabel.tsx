import { useLayoutEffect, useRef, useState } from 'react';
import { modelSelectorLabelText } from './modelSelectorLabelText';

/**
 * The model name in the overlay's fixed-width selector button. The name is
 * cut to 16 characters with no ellipsis (modelSelectorLabelText).
 *
 * A name that fits is centred in the space before the chevron, so a short one
 * ("Natively API", "GPT 5.4") doesn't sit against the left edge with a gap
 * after it; "Gemini 3.8 Flash" nearly fills that space, so it barely moves.
 * A cut name that is still too wide (the Groq GPT-OSS ones) stays left-aligned
 * and fades out at the edge instead of being sliced mid-letter.
 */
export function ModelSelectorLabel({ children }: { children: string }) {
  const text = modelSelectorLabelText(children);
  const ref = useRef<HTMLSpanElement>(null);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflows(el.scrollWidth > el.clientWidth + 0.5);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  const mask = overflows ? 'linear-gradient(to right, #000 calc(100% - 14px), transparent)' : undefined;
  return (
    <span
      ref={ref}
      className={`flex-1 min-w-0 overflow-hidden whitespace-nowrap ${overflows ? 'text-left' : 'text-center'}`}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    >
      {text}
    </span>
  );
}
