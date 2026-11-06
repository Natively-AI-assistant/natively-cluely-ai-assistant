// src/components/upgrade/UnlockProPlans.tsx
//
// The plans page behind the paywalls' "Unlock Pro" (Modes, Profile
// Intelligence). It replaces the paywall inside the same manager panel, not a
// new window and not a jump to Settings, and offers three ways in: the $5 Pro
// Pack (a week to try it), API Pro (AI included, recommended) and Pro Yearly
// (your own AI keys). "See all plans" opens the website's pricing page for the
// rest (Lifetime, API Max and up).
//
// Why it exists: "Unlock Pro" used to open the API Max checkout straight away,
// a $25/month "Natively API Max" page behind a button that said Pro. 6–9% of
// those checkouts were paid, against 21–25% from Settings › Plans & Billing,
// where the plans are compared first (Oct 7–Nov 5, 2026).
//
// Drawn as the website's pricing cards (natively-website
// src/components/PricingSection.tsx, `Tier`): an offer tab, a gradient mesh band
// with the tier's own motif, a white price card floating back up over the band,
// and a recessed tray of features. Light mode uses the website's values as they
// are (LAVENDER tokens, MESH, the .lg-lavender / .lg-paper pills, flattened:
// the panel is a solid ground, so there is no backdrop-filter); dark mode is
// the same anatomy re-lit, since the website has no dark theme.
//
// Prices, sale labels and checkout links are the Plans page's own (PLANS,
// lib/lifetimeSale.mjs, config/urls.ts), never a second copy; the pack's are
// its Dodo product (DODO_PACK_LIGHT_PRODUCT_ID) and natively-api lib/proPacks.js.
// Checkouts open with the paywall's surface, so the funnel keeps counting them
// per paywall.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowUpRight, Check, ChevronRight, X } from 'lucide-react';
import { PLANS } from '../settings/NativelyApiSettings';
import { CHECKOUT_URLS, PRICING_PAGE_URL } from '../../config/urls';
import { YEARLY_LIST, YEARLY_SALE, YEARLY_PCT_OFF, yearlySaleLabel } from '../../lib/lifetimeSale.mjs';
import LenticularGlass from '../glass/LenticularGlass';
import type { Palette } from '../glass/lenticular';

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif';
const EASE_CSS = 'cubic-bezier(0.23, 1, 0.32, 1)';
const EASE_FM = [0.23, 1, 0.32, 1] as const;

// The website's lavender (natively-website src/components/site/kit.tsx).
const MID = '#AF8CFE';
const DEEP = '#9C6FF3';
// natively-website src/components/features/tokens.ts NOISE_URL.
const NOISE_URL =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

// The backdrop: the website pricing page's Frosted Aurora (PricingBackdrop),
// waves under heavy frost seen through vertical glass ribs. Light is the
// concept's own Violet palette; dark is the same scene in deep violet. Drawn
// on demand only (the pointer moving over the panel), never on a clock.
const AURORA_LIGHT: Palette = ['#F1EEF9', '#E7E1F7', '#CDBDF3', '#B9C9F3', '#EBE4F8'];
const AURORA_DARK: Palette = ['#1E1A2A', '#141414', '#3A2E66', '#283865', '#2A2340'];
// Softer ribs on dark: at the light theme's lighting the grooves read as black bars.
const DARK_GLASS = { lighting: 0.32 } as const;

type Mesh = 'standard' | 'pro' | 'ultra';
type Pattern = 'dots' | 'rings' | 'grid';


// The website's MESH, one gradient field sampled per tier. The pro band is the
// same in both themes; the pale ones are re-lit for dark.
const PRO_MESH =
  `radial-gradient(120% 150% at 16% 6%, ${MID} 0%, rgba(175,140,254,0) 62%),` +
  'radial-gradient(95% 125% at 84% 4%, #CBB0FF 0%, rgba(203,176,255,0) 64%),' +
  'radial-gradient(115% 145% at 50% 106%, #5B3FCF 0%, rgba(91,63,207,0) 66%),' +
  `linear-gradient(150deg, ${MID} 0%, ${DEEP} 52%, #7B4EE4 100%)`;

const LIGHT = {
  page: '#FAF8FE',
  ink: '#2E2A38', inkMuted: '#6B5F7D', inkFaint: '#9C90AC', rule: '#DED4EB',
  error: '#B42318',
  bloom:
    'radial-gradient(130% 72% at 20% 16%, rgba(175,140,254,0.14) 0%, rgba(175,140,254,0) 70%),' +
    'radial-gradient(130% 72% at 82% 34%, rgba(156,111,243,0.10) 0%, rgba(156,111,243,0) 72%)',
  mesh: {
    standard:
      'radial-gradient(120% 150% at 16% 6%, #FFFFFF 0%, rgba(255,255,255,0) 62%),' +
      'radial-gradient(95% 125% at 84% 4%, #F5F0FF 0%, rgba(245,240,255,0) 64%),' +
      'radial-gradient(115% 145% at 50% 106%, #ECE3FD 0%, rgba(236,227,253,0) 66%),' +
      'linear-gradient(150deg, #FCFAFF 0%, #F3EDFE 100%)',
    pro: PRO_MESH,
    ultra:
      'radial-gradient(120% 150% at 16% 6%, #F0E9FE 0%, rgba(240,233,254,0) 62%),' +
      'radial-gradient(95% 125% at 84% 4%, #B9A1F6 0%, rgba(185,161,246,0) 64%),' +
      'radial-gradient(115% 145% at 50% 106%, #BEA6F5 0%, rgba(190,166,245,0) 66%),' +
      'linear-gradient(150deg, #E9DFFC 0%, #D5C3F7 100%)',
  } as Record<Mesh, string>,
  motif: { line: 'rgba(139,107,224,0.26)', dot: 'rgba(139,107,224,0.34)', accent: 'rgba(156,111,243,0.20)' },
  card: '#F7F4FD',
  cardShadow: '0 18px 40px -28px rgba(76,46,122,0.26)',
  cardShadowFeatured: '0 30px 60px -28px rgba(76,46,122,0.46)',
  tab: { bg: 'linear-gradient(140deg, #FFFFFF, #F1EAFD)', ink: DEEP, shadow: '0 -6px 18px -12px rgba(76,46,122,0.6)' },
  badge: { bg: '#FFFFFF', ink: '#6B5F7D', inkFeatured: DEEP, shadow: '0 2px 7px -2px rgba(76,46,122,0.34)' },
  well: { bg: '#FFFFFF', shadow: 'inset 0 1px 0 rgba(255,255,255,0.9), 0 16px 32px -20px rgba(76,46,122,0.5)' },
  // .lg-lavender and .lg-paper (natively-website LiquidGlassButton.css), flat.
  pill: {
    sheen: 'linear-gradient(180deg, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0.10) 18%, rgba(255,255,255,0) 100%)',
    lavender: 'rgba(156,111,243,0.24)', lavenderOn: 'rgba(156,111,243,0.36)', lavenderInk: '#3F2593',
    paper: 'rgba(156,111,243,0.14)', paperOn: 'rgba(156,111,243,0.22)', paperInk: '#2E2A38',
    rim: 'inset 0 1px 0 rgba(255,255,255,0.78), inset 0 0 0 1px rgba(156,111,243,0.22), 0 6px 14px -8px rgba(76,46,122,0.40)',
  },
};

const DARK: typeof LIGHT = {
  page: '#141414',
  ink: '#F4F1FA', inkMuted: 'rgba(236,230,253,0.68)', inkFaint: 'rgba(236,230,253,0.46)', rule: 'rgba(222,212,235,0.10)',
  error: '#FCA5A5',
  bloom:
    'radial-gradient(130% 72% at 20% 16%, rgba(175,140,254,0.10) 0%, rgba(175,140,254,0) 70%),' +
    'radial-gradient(130% 72% at 82% 34%, rgba(156,111,243,0.08) 0%, rgba(156,111,243,0) 72%)',
  mesh: {
    standard:
      'radial-gradient(120% 150% at 16% 6%, #2C2639 0%, rgba(44,38,57,0) 62%),' +
      'radial-gradient(95% 125% at 84% 4%, #2A2340 0%, rgba(42,35,64,0) 64%),' +
      'radial-gradient(115% 145% at 50% 106%, #30264C 0%, rgba(48,38,76,0) 66%),' +
      'linear-gradient(150deg, #221E2C 0%, #1E1A28 100%)',
    pro: PRO_MESH,
    ultra:
      'radial-gradient(120% 150% at 16% 6%, #3A2D5C 0%, rgba(58,45,92,0) 62%),' +
      'radial-gradient(95% 125% at 84% 4%, #4A3878 0%, rgba(74,56,120,0) 64%),' +
      'radial-gradient(115% 145% at 50% 106%, #33275A 0%, rgba(51,39,90,0) 66%),' +
      'linear-gradient(150deg, #2B2242 0%, #251D3A 100%)',
  },
  motif: { line: 'rgba(196,179,251,0.16)', dot: 'rgba(196,179,251,0.24)', accent: 'rgba(175,140,254,0.22)' },
  card: '#1A1822',
  cardShadow: '0 18px 40px -28px rgba(0,0,0,0.70)',
  cardShadowFeatured: '0 30px 60px -28px rgba(124,92,255,0.40)',
  tab: { bg: 'linear-gradient(140deg, #2B2638, #221E2D)', ink: '#C4B3FB', shadow: '0 -6px 18px -12px rgba(0,0,0,0.8)' },
  badge: { bg: '#2B2738', ink: 'rgba(236,230,253,0.72)', inkFeatured: DEEP, shadow: '0 2px 7px -2px rgba(0,0,0,0.5)' },
  well: { bg: '#25222F', shadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 16px 32px -20px rgba(0,0,0,0.75)' },
  pill: {
    sheen: 'linear-gradient(180deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.04) 18%, rgba(255,255,255,0) 100%)',
    lavender: 'rgba(156,111,243,0.40)', lavenderOn: 'rgba(156,111,243,0.52)', lavenderInk: '#F1EBFE',
    // Neutral on dark: a lavender paper next to the lavender primary read as three of the same button.
    paper: 'rgba(255,255,255,0.07)', paperOn: 'rgba(255,255,255,0.12)', paperInk: '#EDE7FA',
    rim: 'inset 0 1px 0 rgba(255,255,255,0.14), inset 0 0 0 1px rgba(185,161,246,0.16), 0 6px 14px -8px rgba(0,0,0,0.6)',
  },
};

// The website's per-tier motifs (MOTIF), each with one accent added so the
// band has a point to look at: the dot field's ring gets a second, dashed ring
// and a lavender bead riding on it; the rings get a lit centre and a bright
// dot on the middle ring; the grid gets a smaller square inside the turned one
// and two cells filled in, like days marked on a calendar. Layers back to
// front; on hover each drifts a little further than the one behind it (DRIFT).
const fade = (angle: string, stop: string): React.CSSProperties => ({
  maskImage: `linear-gradient(${angle}, #000 0%, transparent ${stop})`,
  WebkitMaskImage: `linear-gradient(${angle}, #000 0%, transparent ${stop})`,
});
const DRIFT = [
  'translate(6px, -4px)', 'translate(-8px, 4px) scale(1.05)', 'translate(-12px, 6px) scale(1.08)',
  'translate(-16px, 8px) scale(1.10)', 'translate(-20px, 10px)',
];
const BEAD = `radial-gradient(circle at 35% 30%, #FFFFFF 0%, ${MID} 55%, ${DEEP} 100%)`;

function motif(pattern: Pattern, line: string, dot: string, accent: string): React.CSSProperties[] {
  switch (pattern) {
    case 'dots':
      return [
        { inset: -24, backgroundImage: `radial-gradient(${dot} 1px, transparent 1px)`, backgroundSize: '11px 11px', ...fade('115deg', '62%') },
        { right: -40, top: -48, width: 140, height: 140, borderRadius: '50%', border: `1px solid ${line}` },
        { right: -14, top: -22, width: 88, height: 88, borderRadius: '50%', border: `1px dashed ${line}` },
        // On the big ring, a little left of its lowest point.
        { right: 91, top: 41, width: 10, height: 10, borderRadius: '50%', background: BEAD, boxShadow: '0 3px 8px -2px rgba(76,46,122,0.45)' },
      ];
    case 'rings':
      return [
        { right: -30, top: -50, width: 120, height: 120, borderRadius: '50%', background: 'radial-gradient(closest-side, rgba(255,255,255,0.38), rgba(255,255,255,0))' },
        { right: -64, top: -80, width: 210, height: 210, borderRadius: '50%', border: `1px solid ${line}` },
        { right: -40, top: -56, width: 150, height: 150, borderRadius: '50%', border: `1px solid ${line}` },
        { right: -16, top: -36, width: 92, height: 92, borderRadius: '50%', border: `1px solid ${line}` },
        // On the middle ring.
        { right: 101, top: 41, width: 8, height: 8, borderRadius: '50%', background: '#FFFFFF', boxShadow: '0 0 10px 2px rgba(255,255,255,0.75)' },
      ];
    case 'grid':
      return [
        {
          inset: -24,
          backgroundImage: `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px)`,
          backgroundSize: '20px 20px', ...fade('125deg', '66%'),
        },
        // Two cells of the grid (it starts at -24), filled.
        { left: 137, top: 17, width: 19, height: 19, background: accent },
        { left: 157, top: 37, width: 19, height: 19, background: accent, opacity: 0.55 },
        { right: -32, top: -40, width: 104, height: 104, borderRadius: 18, transform: 'rotate(38deg)', border: `1px solid ${dot}` },
        { right: -8, top: -16, width: 56, height: 56, borderRadius: 11, transform: 'rotate(38deg)', border: `1px solid ${dot}` },
      ];
  }
}

const STAGGER = { hidden: {}, show: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } } };
const ITEM = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_FM as any } },
};
const ITEM_REDUCED = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.2 } },
};

type Surface = 'modes_settings' | 'profile_intelligence';

interface Tier {
  id: string;
  name: string;
  badge: string;
  /** The offer tab over the card, only while there is one. */
  tab: string | null;
  blurb: string;
  price: string;
  /** The struck "was" price, only while a named sale runs. */
  was: string | null;
  period: string;
  /** The line under the price; tinted when it is a saving. */
  note: string;
  noteAccent: boolean;
  features: readonly string[];
  cta: string;
  url: string;
  featured: boolean;
  mesh: Mesh;
  pattern: Pattern;
}

function buildTiers(now: Date): Tier[] {
  const saleName = yearlySaleLabel(now)?.replace(/\s*[−-]\d+%$/, '') ?? null;
  const apiPro = PLANS.find(x => x.planKey === 'pro')!;
  return [
    {
      id: 'pack_light', name: 'Pro Pack', badge: 'Try it', tab: null,
      blurb: 'Every Pro feature with AI included, for one week.',
      price: '$5', was: null, period: 'one-time', note: 'No renewal', noteAccent: false,
      features: ['Full Natively Pro app', 'AI and transcription included', '2 meeting hours within 7 days'],
      cta: 'Get Pro Pack', url: CHECKOUT_URLS.packLight,
      featured: false, mesh: 'standard', pattern: 'dots',
    },
    {
      // No struck price: API Pro has only ever been $15, and a "was" price it
      // never charged reads as a fake discount.
      id: apiPro.id, name: `API ${apiPro.name}`, badge: 'Recommended', tab: null,
      blurb: apiPro.description,
      price: apiPro.price, was: null, period: '/mo', note: 'Cancel anytime', noteAccent: false,
      features: apiPro.features.slice(0, 3),
      cta: `Get API ${apiPro.name}`, url: apiPro.url,
      featured: true, mesh: 'pro', pattern: 'rings',
    },
    {
      id: 'pro_yearly', name: 'Pro Yearly', badge: 'Own keys',
      tab: saleName ? `${saleName} sale · ${YEARLY_PCT_OFF}% off` : null,
      blurb: 'All Pro features on your own AI keys. Renews yearly.',
      price: `$${YEARLY_SALE}`, was: saleName ? `$${YEARLY_LIST}` : null, period: '/yr',
      note: `$${(YEARLY_SALE / 12).toFixed(2)} a month`, noteAccent: true,
      features: ['Resume & JD context awareness', '9 expert modes', 'Your own AI keys'],
      cta: 'Get Yearly', url: CHECKOUT_URLS.proYearly,
      featured: false, mesh: 'ultra', pattern: 'grid',
    },
  ];
}

/** The website's CTA arrow (natively-website src/components/site/kit.tsx). */
const Arrow = () => (
  <svg width="22" height="8" viewBox="0 0 22 8" fill="none" aria-hidden="true">
    <path d="M0 4h20M16.5 1L20 4l-3.5 3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

interface Props {
  /** The paywall this page stands in for: also the checkout's funnel surface. */
  surface: Surface;
  /** Back to the paywall. */
  onBack: () => void;
  /** Closes the manager panel. */
  onClose?: () => void;
  /** Settings › Plans & Billing, for someone who already holds a licence or key. */
  onHaveLicense?: () => void;
  theme: 'light' | 'dark';
}

export function UnlockProPlans({ surface, onBack, onClose, onHaveLicense, theme }: Props) {
  const T = theme === 'light' ? LIGHT : DARK;
  const reduced = useReducedMotion() ?? false;
  const item = reduced ? ITEM_REDUCED : ITEM;
  const tiers = useMemo(() => buildTiers(new Date()), []);
  const rootRef = useRef<HTMLDivElement>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);

  // A checkout that opened says so for a moment, then the button is itself again.
  useEffect(() => {
    if (!opened) return;
    const timer = window.setTimeout(() => setOpened(null), 2600);
    return () => window.clearTimeout(timer);
  }, [opened]);

  const openUrl = async (url: string): Promise<boolean> => {
    try {
      const api = (window as any).electronAPI;
      if (api?.openExternal) return (await api.openExternal(url, { surface }))?.ok === true;
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    } catch (e) {
      console.warn('[UnlockProPlans] openExternal failed:', e);
      return false;
    }
  };

  const choose = async (tier: Tier) => {
    if (opening) return;
    setOpening(tier.id);
    setFailed(false);
    const ok = await openUrl(tier.url);
    setOpening(null);
    if (ok) setOpened(tier.id);
    else setFailed(true);
  };

  const iconBtn = (label: string, onClick: () => void, icon: React.ReactNode) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        width: 32, height: 32, borderRadius: 8, border: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'none', color: T.inkFaint, cursor: 'pointer', transition: `color 200ms ${EASE_CSS}`,
      }}
      onMouseEnter={e => (e.currentTarget.style.color = T.ink)}
      onMouseLeave={e => (e.currentTarget.style.color = T.inkFaint)}
    >
      {icon}
    </button>
  );

  return (
    <div
      ref={rootRef}
      role="region"
      aria-labelledby="unlock-pro-title"
      style={{
        position: 'relative', display: 'flex', flexDirection: 'column', height: '100%',
        background: T.page, color: T.ink, overflow: 'hidden',
        fontFamily: FONT, WebkitFontSmoothing: 'antialiased',
      } as React.CSSProperties}
    >
      {/* The reeded-glass backdrop, running out into the page's ground above the
          cards, with a clearing behind the title so the words sit on paper. */}
      <div aria-hidden style={{
        position: 'absolute', left: 0, right: 0, top: 0, height: 440, pointerEvents: 'none',
        maskImage: 'linear-gradient(to bottom, #000 180px, transparent 440px)',
        WebkitMaskImage: 'linear-gradient(to bottom, #000 180px, transparent 440px)',
      }}>
        <LenticularGlass concept="aurora" palette={theme === 'light' ? AURORA_LIGHT : AURORA_DARK} params={theme === 'light' ? undefined : DARK_GLASS} pointerTarget={rootRef} />
        <div style={{
          position: 'absolute', left: '50%', top: 40, width: 620, height: 230, transform: 'translateX(-50%)',
          background: theme === 'light'
            ? 'radial-gradient(closest-side, rgba(250,248,254,0.72), rgba(250,248,254,0))'
            : 'radial-gradient(closest-side, rgba(20,20,20,0.62), rgba(20,20,20,0))',
        }} />
      </div>

      {/* Header: back to the paywall, close the panel. */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px 0', flexShrink: 0 }}>
        {iconBtn('Back', onBack, <ArrowLeft size={16} strokeWidth={1.5} />)}
        {onClose ? iconBtn('Close', onClose, <X size={16} strokeWidth={1.5} />) : <span />}
      </div>

      <motion.div
        variants={STAGGER} initial="hidden" animate="show"
        style={{ position: 'relative', flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 24px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'safe center' as any }}
      >
        <motion.h2 variants={item} id="unlock-pro-title" style={{
          margin: 0, fontSize: 34, fontWeight: 600, letterSpacing: '-0.045em', lineHeight: 1, color: T.ink,
        }}>
          Unlock Pro.
        </motion.h2>
        <motion.p variants={item} style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.55, color: T.inkMuted, textAlign: 'center' }}>
          Modes and Profile Intelligence come with every plan.
        </motion.p>

        <div style={{ position: 'relative', width: '100%', maxWidth: 760, marginTop: 4 }}>
          {/* The website's Bloom: the faint field behind the row. */}
          <div aria-hidden style={{
            position: 'absolute', inset: '-40px -40px', pointerEvents: 'none', filter: 'blur(3px)', background: T.bloom,
            maskImage: 'radial-gradient(closest-side, #000 55%, transparent)',
            WebkitMaskImage: 'radial-gradient(closest-side, #000 55%, transparent)',
          }} />

          <motion.div variants={STAGGER} style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {tiers.map(tier => {
              const busy = opening === tier.id;
              const done = opened === tier.id;
              const btnHot = hoveredBtn === tier.id;
              const cardHot = hoveredCard === tier.id && !reduced;
              const bandDark = tier.mesh === 'pro';
              const line = bandDark ? 'rgba(255,255,255,0.30)' : T.motif.line;
              const dot = bandDark ? 'rgba(255,255,255,0.36)' : T.motif.dot;
              const pillBg = tier.featured
                ? `${T.pill.sheen}, ${btnHot ? T.pill.lavenderOn : T.pill.lavender}`
                : `${T.pill.sheen}, ${btnHot ? T.pill.paperOn : T.pill.paper}`;
              return (
                <motion.div key={tier.id} variants={item} style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  {/* The tab is 40px and runs on behind the card's top edge,
                      which paints over it; only its 22px lip shows. */}
                  <div style={{ position: 'relative', height: 22 }}>
                    {tier.tab && (
                      <div style={{
                        position: 'absolute', left: 12, right: 12, top: 0, height: 40,
                        display: 'flex', justifyContent: 'center', paddingTop: 6, boxSizing: 'border-box',
                        borderRadius: '18px 18px 0 0', background: T.tab.bg,
                        border: `1px solid ${T.rule}`, borderBottom: 'none', boxShadow: T.tab.shadow,
                        color: T.tab.ink, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.11em', textTransform: 'uppercase',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {tier.tab}
                      </div>
                    )}
                  </div>

                  <section
                    aria-label={tier.featured ? `${tier.name}, recommended` : tier.name}
                    onMouseEnter={() => setHoveredCard(tier.id)}
                    onMouseLeave={() => setHoveredCard(null)}
                    style={{
                      position: 'relative', zIndex: 1, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
                      borderRadius: 22, background: T.card, border: `1px solid ${T.rule}`,
                      boxShadow: tier.featured ? T.cardShadowFeatured : T.cardShadow,
                    }}
                  >
                    {/* The band. The tall bottom padding is the overlap the price card floats back up into. */}
                    {/* It fades out over its lower part, so the colour melts into the card
                        behind the price card instead of stopping on a hard line. */}
                    <div style={{
                      position: 'relative', overflow: 'hidden', padding: '16px 16px 64px', marginBottom: -20, background: T.mesh[tier.mesh],
                      maskImage: 'linear-gradient(180deg, #000 0%, #000 45%, transparent 100%)',
                      WebkitMaskImage: 'linear-gradient(180deg, #000 0%, #000 45%, transparent 100%)',
                    }}>
                      {motif(tier.pattern, line, dot, T.motif.accent).map((layer, i) => (
                        <span key={i} aria-hidden style={{
                          position: 'absolute', pointerEvents: 'none', ...layer,
                          transform: `${layer.transform ?? ''} ${cardHot ? DRIFT[i] : ''}`.trim() || undefined,
                          transition: 'transform 600ms ease-out',
                        }} />
                      ))}
                      <span aria-hidden style={{
                        position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: NOISE_URL,
                        mixBlendMode: 'overlay', opacity: bandDark ? 0.28 : 0.1,
                      }} />
                      <span aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, background: 'rgba(255,255,255,0.55)', opacity: theme === 'light' || bandDark ? 1 : 0.15 }} />
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em', color: bandDark ? '#FFFFFF' : T.ink, whiteSpace: 'nowrap' }}>
                          {tier.name}
                        </span>
                        <span style={{
                          flexShrink: 0, borderRadius: 999, padding: '4px 10px',
                          fontSize: 9, fontWeight: 700, letterSpacing: '0.11em', textTransform: 'uppercase',
                          color: tier.featured ? T.badge.inkFeatured : T.badge.ink,
                          background: tier.featured ? '#FFFFFF' : T.badge.bg, boxShadow: T.badge.shadow,
                        }}>
                          {tier.badge}
                        </span>
                      </div>
                    </div>

                    {/* The floating price card, pulled back up over the band. */}
                    <div style={{
                      position: 'relative', zIndex: 1, margin: '-32px 10px 0', padding: 14, borderRadius: 16,
                      background: T.well.bg, boxShadow: T.well.shadow,
                    }}>
                      <p style={{ margin: 0, minHeight: 38, fontSize: 12, lineHeight: 1.55, color: T.inkMuted }}>{tier.blurb}</p>

                      <p style={{ margin: '10px 0 0', display: 'flex', alignItems: 'baseline', gap: 4, color: T.ink }}>
                        <span style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{tier.price}</span>
                        {tier.was && (
                          <span aria-label={`was ${tier.was}`} style={{ fontSize: 14, fontWeight: 500, color: T.inkFaint, textDecoration: 'line-through', textDecorationThickness: 1.2 }}>
                            {tier.was}
                          </span>
                        )}
                        <span style={{ fontSize: 12, fontWeight: 500, color: T.inkFaint }}>{tier.period}</span>
                      </p>
                      <p style={{ margin: '6px 0 0', fontSize: 11.5, fontWeight: 600, color: tier.noteAccent ? MID : T.inkFaint }}>{tier.note}</p>

                      <button
                        type="button"
                        onClick={() => choose(tier)}
                        disabled={!!opening}
                        onMouseEnter={() => setHoveredBtn(tier.id)}
                        onMouseLeave={() => setHoveredBtn(null)}
                        onFocus={e => { if (e.currentTarget.matches(':focus-visible')) setHoveredBtn(tier.id); }}
                        onBlur={() => setHoveredBtn(null)}
                        style={{
                          marginTop: 12, width: '100%', height: 38, border: 0, borderRadius: 999,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                          fontFamily: FONT, fontSize: 12.5, fontWeight: 600, letterSpacing: '-0.01em',
                          background: pillBg, boxShadow: T.pill.rim,
                          color: tier.featured ? T.pill.lavenderInk : T.pill.paperInk,
                          cursor: opening ? 'progress' : 'pointer', opacity: opening && !busy ? 0.5 : 1, outline: 'none',
                          transition: `opacity 200ms ${EASE_CSS}`,
                        }}
                      >
                        {busy ? 'Opening checkout' : done ? 'Opened in browser' : (
                          <>
                            {tier.cta}
                            <span style={{ display: 'inline-flex', transform: btnHot && !reduced ? 'translateX(3px)' : 'none', transition: `transform 200ms ${EASE_CSS}` }}>
                              <Arrow />
                            </span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* The recessed tray. */}
                    <ul style={{ margin: 0, padding: '16px 18px 18px', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 9 }}>
                      {tier.features.map(f => (
                        <li key={f} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12, lineHeight: 1.45, color: T.inkMuted }}>
                          <Check size={13} aria-hidden style={{ color: MID, flexShrink: 0, transform: 'translateY(2px)' }} />
                          {f}
                        </li>
                      ))}
                    </ul>
                  </section>
                </motion.div>
              );
            })}
          </motion.div>
        </div>

        {/* Lifetime, Max and the rest live on the website's pricing page. */}
        <motion.p variants={item} style={{ margin: '18px 0 0', fontSize: 12.5, color: T.inkMuted, textAlign: 'center' }}>
          Looking for Lifetime or API Max?{' '}
          <button
            type="button"
            onClick={() => { setFailed(false); void openUrl(PRICING_PAGE_URL).then(ok => { if (!ok) setFailed(true); }); }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 2, padding: 0, border: 0, background: 'none',
              fontFamily: FONT, fontSize: 12.5, fontWeight: 600, color: T.ink, cursor: 'pointer',
            }}
          >
            See all plans <ArrowUpRight size={13} strokeWidth={2} aria-hidden />
          </button>
        </motion.p>

        {failed && (
          <p role="alert" style={{ margin: '8px 0 0', fontSize: 12, color: T.error }}>
            Couldn't open your browser. Try again, or use Settings › Plans & Billing.
          </p>
        )}
      </motion.div>

      {/* Footer: a way in for someone who already holds a licence, and what checkout will add. */}
      <div style={{
        position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: '10px 24px 14px', flexShrink: 0,
      }}>
        {onHaveLicense ? (
          <button
            type="button"
            onClick={onHaveLicense}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0, border: 0, background: 'none',
              fontFamily: FONT, fontSize: 12, fontWeight: 500, color: T.inkFaint, cursor: 'pointer',
              transition: `color 200ms ${EASE_CSS}`,
            }}
            onMouseEnter={e => (e.currentTarget.style.color = T.ink)}
            onMouseLeave={e => (e.currentTarget.style.color = T.inkFaint)}
          >
            I have a license <ChevronRight size={14} strokeWidth={1.5} />
          </button>
        ) : <span />}
        <span style={{ fontSize: 11, color: T.inkFaint }}>
          Prices in USD before tax. Checkout opens in your browser.
        </span>
      </div>
    </div>
  );
}

export default UnlockProPlans;
