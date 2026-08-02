import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { AccordionSection } from '../ui/AccordionSection';

// Extracted from NativelyApiSettings so PlansSettings can order this AFTER the
// app-only-license section. It used to be the last thing inside the API
// component, which forced it to render above the Pro section (a sibling one
// level up) with no way to reorder the two.
//
// No boxed icon left of the title: the accordion header is already a bordered
// rectangle, so a second one inside it was redundant. Title + chevron is enough.
export const HowItWorksRefund: React.FC = () => {
    const openExternal = (url: string) => {
        (window.electronAPI as any)?.openExternal?.(url);
    };

    return (
    <AccordionSection
      title="How it works & refund policy"
      className="bg-bg-item-surface rounded-2xl border-border-subtle !mb-0"
    >
      {/* ── How it works ─────────────────────────────────── */}
      {/* Two distinct products, two distinct flows — spelled out as two  */}
      {/* short lists instead of one generic checkout→paste description  */}
      {/* that only ever matched the API path and silently ignored Pro.  */}
      <div className="pb-5">
        <div className="flex items-baseline justify-between mb-3.5">
          <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-[0.07em]">
            How it works
          </p>
          <button
            onClick={() => openExternal('https://natively.software/pro')}
            className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-text-primary transition-colors duration-150 cursor-pointer motion-reduce:transition-none"
          >
            Watch demo <ArrowUpRight size={11} strokeWidth={2} />
          </button>
        </div>

        <div className="space-y-5">
          <div>
            <p className="text-[13px] font-medium text-text-primary mb-2.5">
              Natively API (managed subscription)
            </p>
            <div className="space-y-2.5">
              {[
                { step: '1', text: 'Subscribe above and complete checkout on Dodo Payments.' },
                { step: '2', text: 'Your API key is emailed instantly to your inbox.' },
                { step: '3', text: 'Paste it into the Natively key box below. Usage, model access, and (on Pro/Max/Ultra) your Pro license all activate automatically.' },
              ].map(({ step, text }) => (
                <div key={step} className="flex items-start gap-3">
                  <span className="text-[12px] tabular-nums text-text-tertiary shrink-0 w-3">
                    {step}
                  </span>
                  <p className="text-[12px] text-text-secondary leading-relaxed">{text}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[13px] font-medium text-text-primary mb-2.5">
              Natively Pro (app-only license)
            </p>
            <div className="space-y-2.5">
              {[
                { step: '1', text: 'Prefer to bring your own AI keys instead of managed API usage? Buy a Yearly or Lifetime Pro license below.' },
                { step: '2', text: 'Your license key is emailed instantly to your inbox.' },
                { step: '3', text: 'Paste it into the same Natively key box. Natively recognizes it\'s a license key (not an API key) and activates Pro on this device.' },
              ].map(({ step, text }) => (
                <div key={step} className="flex items-start gap-3">
                  <span className="text-[12px] tabular-nums text-text-tertiary shrink-0 w-3">
                    {step}
                  </span>
                  <p className="text-[12px] text-text-secondary leading-relaxed">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="h-px bg-border-subtle" />

      {/* ── Refund Policy ────────────────────────────────── */}
      <div className="pt-5">
        <p className="text-[13px] font-medium text-text-primary">Refund policy</p>
        <p className="text-[12px] text-text-secondary leading-snug mt-1">
          Different window per product. Voucher purchases are final sale either way.
        </p>
      </div>

      <div className="pt-4 pb-1">
        <div className="space-y-3.5">
          <div>
            <p className="text-[12px] text-text-secondary leading-relaxed">
              <strong className="text-text-primary font-semibold">A quick heads-up:</strong>{' '}
              Natively is built and maintained by a single developer and integrates a lot of
              third-party services: AI providers, transcription engines, search APIs, payments,
              OS-level audio &amp; screen capture. That gives the app a lot of capability, but the
              surface area is wider than a typical closed-source product, and once in a while
              something may not behave exactly as expected. If you run into something like that,
              please <em>report it</em> rather than disputing the charge. We read every report,
              and fixes typically land in the next update.
            </p>
          </div>

          {/* Two products, two windows — kept as separate rows (not merged
              into one sentence) since this is exactly the distinction this
              section was reported as glossing over. */}
          {/* Two products, two windows — the labels used to be an orchid pill
              and a violet pill, i.e. two more hues introduced to distinguish
              two rows that a plain bold lead-in distinguishes just as well. */}
          <div className="space-y-2.5">
            <p className="text-[12px] text-text-secondary leading-relaxed">
              <strong className="text-text-primary font-medium">Natively API</strong> subscriptions
              (Standard/Pro/Max/Ultra) have a{' '}
              <strong className="text-text-primary font-medium">24-hour refund window</strong>{' '}
              from purchase.
            </p>
            <p className="text-[12px] text-text-secondary leading-relaxed">
              <strong className="text-text-primary font-medium">Natively Pro</strong>, the
              app-only license (Yearly/Lifetime, BYOK), has a shorter{' '}
              <strong className="text-text-primary font-medium">1-hour pre-activation window</strong>{' '}
              instead. Try the free trial first if you're unsure it's for you.
            </p>
            <p className="text-[12px] text-text-secondary leading-relaxed">
              Purchases made with a coupon, voucher, referral credit, or limited-time offer are{' '}
              <strong className="text-text-primary font-medium">final sale</strong> and not
              eligible for refund.
            </p>
            <p className="text-[12px] text-text-secondary leading-relaxed">
              To cancel your subscription, log in to the{' '}
              <span
                onClick={() => openExternal('https://customer.dodopayments.com/')}
                className="text-text-primary hover:text-text-secondary underline decoration-border-muted underline-offset-[3px] cursor-pointer transition-colors duration-150 motion-reduce:transition-none"
              >
                customer portal
              </span>{' '}
              to manage or cancel your plan.
            </p>
          </div>

          <div className="h-px bg-border-subtle" />

          <p className="text-[12px] text-text-secondary leading-relaxed">
            For everything else (the refund windows above, subscription handling, taxes &amp;
            fees, and your local consumer rights), please see our full{' '}
            <span
              onClick={() => openExternal('https://natively.software/refundpolicy')}
              className="text-text-primary hover:text-text-secondary underline decoration-border-muted underline-offset-[3px] cursor-pointer transition-colors duration-150 motion-reduce:transition-none"
            >
              Refund Policy
            </span>
            . To request a refund or ask a question, email{' '}
            <span
              onClick={() => openExternal('mailto:natively.contact@gmail.com')}
              className="text-text-primary hover:text-text-secondary underline decoration-border-muted underline-offset-[3px] cursor-pointer transition-colors duration-150 motion-reduce:transition-none"
            >
              natively.contact@gmail.com
            </span>
            .
          </p>

          {/* Was an amber-tinted, amber-bordered box — a warning treatment on
              a friendly note, and yet another hue. It's a paragraph. */}
          <p className="text-[12px] text-text-secondary leading-relaxed">
            <strong className="text-text-primary font-medium">A personal note:</strong>{' '}
            Natively is built, maintained, and supported entirely by one person, in their free time.
            Email replies may take a few days, and weekends (Sat &amp; Sun) are offline.
            Your patience is genuinely appreciated.
          </p>
        </div>
      </div>
    </AccordionSection>
    );
};
