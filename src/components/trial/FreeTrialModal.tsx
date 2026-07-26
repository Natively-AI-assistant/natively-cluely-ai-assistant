// src/components/trial/FreeTrialModal.tsx
//
// Skills: ui-ux-pro-max · canvas-designer · frontend-design · ui-design-system
//
// Post-trial upgrade panel — Apple-grade dark glass card language.
// Plan cards follow Apple One / App Store subscription aesthetics:
// card-level hover lift + accent glow, benefit-oriented copy, single
// dominant CTA, trust footer — all tuned for maximum conversion.

import React, { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Zap, Key, ArrowRight, Loader2, CheckCircle, Brain, Mic, Flame, ShieldCheck } from 'lucide-react';
import nativelyLogo from '../../assets/logo.webp';

const PLAN_STANDARD_URL = 'https://checkout.dodopayments.com/buy/pdt_0NbFixGmD8CSeawb5qvVl';
const PLAN_PRO_URL      = 'https://checkout.dodopayments.com/buy/pdt_0NcM6Aw0IWdspbsgUeCLA';
const PLAN_MAX_URL      = 'https://checkout.dodopayments.com/buy/pdt_0NcM7JElX4Af6LNVFS1Yf';
const PLAN_ULTRA_URL    = 'https://checkout.dodopayments.com/buy/pdt_0NcM7rC2kAb69TFKsZnUU';

const F = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif';

// Apple easing curve
const EASE = 'cubic-bezier(0.4,0,0.2,1)';

// 5 opacity stops — the only contrast control we touch
const C = {
  t1:  '#FFFFFF',
  t2:  'rgba(255,255,255,0.76)',
  t3:  'rgba(255,255,255,0.46)',
  t4:  'rgba(255,255,255,0.28)',
  t5:  'rgba(255,255,255,0.14)',
  div: 'rgba(255,255,255,0.08)',
  glass: 'rgba(255,255,255,0.04)',
};

// Accent palettes — colour in icon + button + hairline border + hover glow
const ACC = {
  violet: {
    iconColor:   '#A78BFA',
    cardBorder:  'rgba(139,92,246,0.22)',
    cardBg:      'rgba(139,92,246,0.055)',
    cardGlow:    '0 0 32px rgba(139,92,246,0.09)',
    hoverBorder: 'rgba(139,92,246,0.52)',
    hoverGlow:   '0 0 52px rgba(139,92,246,0.22), 0 16px 40px rgba(0,0,0,0.55)',
    btnBg:       'linear-gradient(135deg,#8B5CF6,#7C3AED,#6D28D9)',
    btnShadow:   '0 0 0 1px rgba(109,40,217,0.4),0 6px 22px rgba(139,92,246,0.32),inset 0 1px 0 rgba(255,255,255,0.14)',
    btnColor:    '#fff',
    bandBg:      'rgba(139,92,246,0.2)',
    bandText:    'rgba(196,181,253,0.92)',
    dot:         '#A78BFA',
  },
  indigo: {
    iconColor:   '#818CF8',
    cardBorder:  'rgba(99,102,241,0.18)',
    cardBg:      'rgba(99,102,241,0.045)',
    cardGlow:    'none',
    hoverBorder: 'rgba(99,102,241,0.42)',
    hoverGlow:   '0 0 40px rgba(99,102,241,0.15), 0 12px 32px rgba(0,0,0,0.5)',
    btnBg:       'rgba(99,102,241,0.75)',
    btnShadow:   'inset 0 1px 0 rgba(255,255,255,0.1)',
    btnColor:    '#fff',
    bandBg:      '',
    bandText:    '',
    dot:         '#818CF8',
  },
  amber: {
    iconColor:   '#FBBF24',
    cardBorder:  'rgba(251,191,36,0.2)',
    cardBg:      'rgba(251,191,36,0.045)',
    cardGlow:    'none',
    hoverBorder: 'rgba(251,191,36,0.45)',
    hoverGlow:   '0 0 40px rgba(251,191,36,0.12), 0 12px 32px rgba(0,0,0,0.5)',
    btnBg:       'rgba(217,119,6,0.82)',
    btnShadow:   'inset 0 1px 0 rgba(255,255,255,0.1)',
    btnColor:    '#fff',
    bandBg:      '',
    bandText:    '',
    dot:         '#FBBF24',
  },
  slate: {
    iconColor:   'rgba(148,163,184,0.85)',
    cardBorder:  'rgba(148,163,184,0.15)',
    cardBg:      'rgba(148,163,184,0.04)',
    cardGlow:    'none',
    hoverBorder: 'rgba(148,163,184,0.32)',
    hoverGlow:   '0 0 24px rgba(148,163,184,0.07), 0 8px 24px rgba(0,0,0,0.4)',
    btnBg:       'rgba(148,163,184,0.12)',
    btnShadow:   '0 0 0 1px rgba(148,163,184,0.15)',
    btnColor:    'rgba(203,213,225,0.85)',
    bandBg:      '',
    bandText:    '',
    dot:         'rgba(148,163,184,0.6)',
  },
};

// ─────────────────────────────────────────────────────────────

interface TrialModalProps {
  usage:      { ai: number; stt_seconds: number; search: number };
  onByok:     () => Promise<void>;
  onStandard?: () => Promise<void>;
  onDone?:    () => void;
}

type Step = 'choose' | 'wiping' | 'done';

export const FreeTrialModal: React.FC<TrialModalProps> = ({ usage, onByok, onStandard, onDone }) => {
  const [step,  setStep]  = useState<Step>('choose');
  const [error, setError] = useState<string | null>(null);
  const reduced = useReducedMotion() ?? false;

  const openUrl = (url: string) => (window.electronAPI as any)?.openExternal?.(url);

  const handleByok = async () => {
    setStep('wiping');
    setError(null);
    try   { await onByok(); setStep('done'); }
    catch (e: any) { setError(e.message || 'Something went wrong. Restart the app.'); setStep('choose'); }
  };

  return (
    <>
      <style>{`
        @keyframes fm-border {
          0%,100% { background-position:0% 50%; }
          50%      { background-position:100% 50%; }
        }
        .fm-ring {
          background: linear-gradient(145deg,rgba(139,92,246,.7),rgba(99,102,241,.52),rgba(139,92,246,.7));
          background-size:300% 300%;
          animation:fm-border 7s ease infinite;
        }
        .fm-ring-r { background:linear-gradient(145deg,rgba(139,92,246,.55),rgba(99,102,241,.4)); }
      `}</style>

      {/* Backdrop */}
      <div style={{
        position:'fixed', inset:0, zIndex:9999,
        display:'flex', alignItems:'center', justifyContent:'center',
        background:'radial-gradient(ellipse 80% 70% at 50% 50%,rgba(139,92,246,.07) 0%,rgba(0,0,0,.9) 100%)',
        backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)',
        fontFamily: F,
      } as React.CSSProperties}>

        {/* Iridescent ring */}
        <motion.div
          initial={reduced ? {opacity:0} : {opacity:0,scale:.95,y:20,filter:'blur(8px)'}}
          animate={reduced ? {opacity:1} : {opacity:1,scale:1,  y:0, filter:'blur(0px)'}}
          transition={{type:'spring',stiffness:280,damping:24,mass:.85}}
          className={reduced ? 'fm-ring-r' : 'fm-ring'}
          style={{padding:'1.5px',borderRadius:'24px',boxShadow:'0 56px 130px -24px rgba(0,0,0,.98),0 0 80px rgba(139,92,246,.05)'}}
        >
          {/* Card shell */}
          <div style={{
            position:'relative', width:'468px',
            borderRadius:'23px',
            background:'linear-gradient(158deg,rgba(12,9,22,.99) 0%,rgba(7,5,13,1) 100%)',
          }}>
            {/* Catch-light */}
            <div aria-hidden style={{position:'absolute',top:0,left:0,right:0,height:'1px',background:'rgba(255,255,255,.12)',pointerEvents:'none',zIndex:5}} />
            {/* Aurora pulse */}
            {!reduced && (
              <motion.div aria-hidden
                animate={{opacity:[.07,.16,.07]}}
                transition={{duration:7,repeat:Infinity,ease:'easeInOut'}}
                style={{position:'absolute',top:'-80px',left:'50%',transform:'translateX(-50%)',width:'440px',height:'280px',background:'radial-gradient(ellipse,rgba(139,92,246,.28) 0%,transparent 65%)',pointerEvents:'none',zIndex:1}}
              />
            )}
            {/* Grain */}
            <div aria-hidden style={{
              position:'absolute',inset:0,borderRadius:'23px',pointerEvents:'none',zIndex:4,
              opacity:.026,mixBlendMode:'overlay',
              backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)'/%3E%3C/svg%3E")`,
              backgroundSize:'180px',
            }} />

            <div style={{padding:'22px 22px 24px',position:'relative',zIndex:6}}>
              {step==='wiping' && <WipingState />}
              {step==='done'   && <DoneState onDone={onDone} />}
              {step==='choose' && (
                <ChooseState
                  usage={usage} error={error} reduced={reduced}
                  onPro={()=>{ window.electronAPI?.convertTrial?.('pro')?.catch(()=>{}); openUrl(PLAN_PRO_URL); }}
                  onMax={()=>{ window.electronAPI?.convertTrial?.('max')?.catch(()=>{}); openUrl(PLAN_MAX_URL); }}
                  onUltra={()=>{ window.electronAPI?.convertTrial?.('ultra')?.catch(()=>{}); openUrl(PLAN_ULTRA_URL); }}
                  onStandard={()=>{
                    window.electronAPI?.convertTrial?.('standard')?.catch(()=>{});
                    if (onStandard) onStandard().catch(()=>{});
                    openUrl(PLAN_STANDARD_URL);
                  }}
                  onByok={handleByok}
                />
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </>
  );
};

// ─── Choose ──────────────────────────────────────────────────

function ChooseState({ usage, error, reduced, onPro, onMax, onUltra, onStandard, onByok }: {
  usage: {ai:number;stt_seconds:number;search:number};
  error: string|null; reduced:boolean;
  onPro:()=>void; onMax:()=>void; onUltra:()=>void; onStandard:()=>void; onByok:()=>void;
}) {
  const sttMin = (usage.stt_seconds/60).toFixed(1);
  return (
    <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>

      {/* ── Header ─── */}
      <div style={{display:'flex',alignItems:'center',gap:'10px',paddingBottom:'12px',borderBottom:`1px solid ${C.div}`}}>
        <div style={{width:'34px',height:'34px',borderRadius:'10px',background:'rgba(139,92,246,.13)',border:'1px solid rgba(139,92,246,.22)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
          <img src={nativelyLogo} alt="Natively" style={{width:'16px',height:'16px',objectFit:'contain'}} draggable={false} />
        </div>
        <div>
          <div style={{fontSize:'14px',fontWeight:650,color:C.t1,letterSpacing:'-.02em',lineHeight:1.2}}>Keep the momentum going</div>
          <div style={{fontSize:'11.5px',color:C.t4,marginTop:'2px'}}>
            {usage.ai} AI · {sttMin} min · {usage.search} searches used in your trial
          </div>
        </div>
      </div>

      {/* ── Plans ─── */}
      <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>

        <HeroCard
          title="Natively Pro" price="$15" period="/mo" icon={Zap}
          spec="1,000 AI answers · 500 min live STT · 100 searches · Pro App included"
          accent="violet" reduced={reduced} onClick={onPro}
        />

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px'}}>
          <TierCard title="Max"   price="$25" period="/mo" icon={Brain}
            spec="2,000 AI · 1,000 min · 200 searches · Pro App included"
            badge="Best value" accent="indigo" onClick={onMax} />
          <TierCard title="Ultra" price="$35" period="/mo" icon={Flame}
            spec="3,000 AI · 2,000 min · 300 searches · Pro App included"
            badge="Power" accent="amber" onClick={onUltra} />
        </div>

        <TierCard title="Standard" price="$8" period="/mo" icon={Mic}
            spec="500 AI · 200 min · 20 searches"
            badge="No Pro App" badgeWarn accent="slate" onClick={onStandard} />
      </div>

      {/* ── BYOK + trust ─── */}
      <ByokRow onClick={onByok} />

      <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'4px',marginTop:'-2px'}}>
        <ShieldCheck size={9.5} strokeWidth={2} color={C.t3} />
        <span style={{fontSize:'10px',color:C.t3}}>Cancel anytime · Secure checkout via Dodo Payments</span>
      </div>

      {error && <p style={{fontSize:'11px',color:'rgba(248,113,113,.85)',textAlign:'center',margin:0}}>{error}</p>}
    </div>
  );
}

// ─── Hero card (Pro) ──────────────────────────────────────────
// Tesla spec language: name + inline badge + price anchor + one spec line + CTA.
// Hover: lift 2px + border brightens + violet glow expands.

function HeroCard({ title, price, period, icon: Icon, spec, accent, reduced, onClick }: {
  title:string; price:string; period:string; icon:React.ElementType;
  spec:string; accent:'violet'; reduced:boolean; onClick:()=>void;
}) {
  const a = ACC[accent];
  const [hov, setHov] = useState(false);

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        borderRadius:'14px', overflow:'hidden',
        border:`1px solid ${hov ? a.hoverBorder : a.cardBorder}`,
        background: hov ? 'rgba(139,92,246,0.08)' : a.cardBg,
        boxShadow: hov ? a.hoverGlow : a.cardGlow,
        transform: hov && !reduced ? 'translateY(-2px)' : 'translateY(0)',
        transition:`transform 220ms ${EASE}, border-color 220ms ${EASE}, box-shadow 220ms ${EASE}, background 220ms ${EASE}`,
        cursor:'pointer',
      }}
    >
      <div style={{padding:'12px 14px 14px'}}>
        {/* Name + badge + price — single row */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'7px'}}>
          <div style={{display:'flex',alignItems:'center',gap:'7px'}}>
            <Icon size={13} strokeWidth={1.75} color={a.iconColor} />
            <span style={{fontSize:'13.5px',fontWeight:650,color:C.t1,letterSpacing:'-.018em'}}>{title}</span>
            <span style={{
              fontSize:'7.5px',fontWeight:720,letterSpacing:'.12em',textTransform:'uppercase',
              color:a.bandText, background:a.bandBg, padding:'2px 6px', borderRadius:'4px',
            }}>Popular</span>
          </div>
          <div style={{display:'flex',alignItems:'baseline',gap:'2px'}}>
            <span style={{fontSize:'22px',fontWeight:760,color:C.t1,letterSpacing:'-.05em',lineHeight:1}}>{price}</span>
            <span style={{fontSize:'10px',color:C.t4,fontWeight:400}}>{period}</span>
          </div>
        </div>

        {/* One spec line — the Tesla number */}
        <div style={{fontSize:'11px',color:C.t3,letterSpacing:'-.005em',marginBottom:'11px',lineHeight:1.45}}>
          {spec}
        </div>

        {/* CTA */}
        <motion.button
          onClick={onClick}
          whileHover={reduced?{}:{scale:1.008,filter:'brightness(1.09)'}}
          whileTap={{scale:.982}}
          style={{
            position:'relative', width:'100%', height:'36px', overflow:'hidden',
            display:'flex', alignItems:'center', justifyContent:'space-between',
            padding:'0 16px', borderRadius:'9px', border:'none', cursor:'pointer',
            background:a.btnBg, boxShadow:a.btnShadow, outline:'none', fontFamily:F,
          }}
        >
          {!reduced && (
            <motion.div aria-hidden
              style={{position:'absolute',inset:0,pointerEvents:'none',background:'linear-gradient(90deg,transparent,rgba(255,255,255,.1),transparent)',transform:'skewX(-14deg)'}}
              animate={{x:['-130%','230%']}}
              transition={{duration:1.8,ease:'easeInOut',repeat:Infinity,repeatDelay:5.5}}
            />
          )}
          <span style={{position:'relative',zIndex:1,fontSize:'12.5px',fontWeight:650,color:a.btnColor,letterSpacing:'-.015em'}}>
            Start {title}
          </span>
          <motion.span style={{position:'relative',zIndex:1,display:'flex',alignItems:'center'}}
            animate={reduced?{}:{x:hov?3:0}} transition={{duration:.16}}>
            <ArrowRight size={13} strokeWidth={2.3} color="rgba(255,255,255,.9)" />
          </motion.span>
        </motion.button>
      </div>
    </div>
  );
}

// ─── Tier card (Max / Ultra) ──────────────────────────────────
// Same anatomy as HeroCard but compact — no band, smaller price.

function TierCard({ title, price, period, icon: Icon, spec, accent, badge, badgeWarn, onClick }: {
  title:string; price:string; period:string; icon:React.ElementType;
  spec:string; accent:'indigo'|'amber'|'slate'; badge:string|null; badgeWarn?:boolean; onClick:()=>void;
}) {
  const a = ACC[accent];
  const [hov, setHov] = useState(false);
  const reduced = useReducedMotion() ?? false;

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        borderRadius:'13px', padding:'11px 13px 13px',
        border:`1px solid ${hov ? a.hoverBorder : a.cardBorder}`,
        background: hov
          ? (accent==='indigo' ? 'rgba(99,102,241,0.08)' : accent==='amber' ? 'rgba(251,191,36,0.07)' : 'rgba(148,163,184,0.07)')
          : a.cardBg,
        boxShadow: hov ? a.hoverGlow : 'none',
        transform: hov && !reduced ? 'translateY(-2px)' : 'translateY(0)',
        transition:`transform 220ms ${EASE}, border-color 220ms ${EASE}, box-shadow 220ms ${EASE}, background 220ms ${EASE}`,
        display:'flex', flexDirection:'column', gap:'8px', cursor:'pointer',
      }}
    >
      {/* Name + badge + price */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
          <Icon size={12} strokeWidth={1.75} color={a.iconColor} />
          <span style={{fontSize:'13px',fontWeight:640,color:C.t1,letterSpacing:'-.015em'}}>{title}</span>
          {badge && (
            <span style={{
              fontSize:'7.5px',fontWeight:720,letterSpacing:'.08em',textTransform:'uppercase',
              color: badgeWarn
                ? 'rgba(148,163,184,0.7)'
                : accent==='indigo' ? '#818CF8' : a.iconColor,
              background: badgeWarn
                ? 'rgba(148,163,184,0.06)'
                : accent==='indigo' ? 'rgba(99,102,241,0.12)' : 'rgba(251,191,36,.1)',
              border: `1px solid ${badgeWarn ? 'rgba(148,163,184,0.15)' : accent==='indigo' ? 'rgba(99,102,241,0.25)' : 'rgba(251,191,36,.22)'}`,
              padding:'1.5px 5px', borderRadius:'4px',
            }}>{badge}</span>
          )}
        </div>
        <div style={{display:'flex',alignItems:'baseline',gap:'2px'}}>
          <span style={{fontSize:'18px',fontWeight:740,color:C.t1,letterSpacing:'-.04em',lineHeight:1}}>{price}</span>
          <span style={{fontSize:'9.5px',color:C.t4}}>{period}</span>
        </div>
      </div>

      {/* Spec line */}
      <div style={{fontSize:'10.5px',color:C.t3,letterSpacing:'-.005em',lineHeight:1.4}}>{spec}</div>

      {/* Button */}
      <button
        onClick={onClick}
        style={{
          width:'100%', height:'29px', display:'flex', alignItems:'center', justifyContent:'center', gap:'4px',
          borderRadius:'7px', border:'none', cursor:'pointer', fontFamily:F,
          background: hov
            ? (accent==='indigo' ? 'rgba(99,102,241,0.9)' : accent==='amber' ? 'rgba(217,119,6,0.95)' : 'rgba(100,116,139,0.55)')
            : a.btnBg,
          boxShadow:a.btnShadow,
          fontSize:'11.5px', fontWeight:640, color:a.btnColor,
          transition:`background 180ms ${EASE}`,
        }}
      >
        Start {title} <ArrowRight size={10} strokeWidth={2.3} />
      </button>
    </div>
  );
}

// ─── Slim card (Standard) ────────────────────────────────────
// Single horizontal row — lift + border on hover.

function SlimCard({ title, price, icon: Icon, spec, accent, onClick }: {
  title:string; price:string; icon:React.ElementType;
  spec:string; accent:'slate'; onClick:()=>void;
}) {
  const a = ACC[accent];
  const [hov, setHov] = useState(false);
  const reduced = useReducedMotion() ?? false;

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        borderRadius:'11px', padding:'10px 13px',
        border:`1px solid ${hov ? a.hoverBorder : a.cardBorder}`,
        background: hov ? 'rgba(148,163,184,0.07)' : a.cardBg,
        boxShadow: hov ? a.hoverGlow : 'none',
        transform: hov && !reduced ? 'translateY(-1px)' : 'translateY(0)',
        transition:`transform 200ms ${EASE}, border-color 200ms ${EASE}, box-shadow 200ms ${EASE}, background 200ms ${EASE}`,
        display:'flex', alignItems:'center', gap:'10px', cursor:'pointer',
      }}
    >
      <Icon size={12} strokeWidth={1.75} color={hov ? 'rgba(148,163,184,1)' : a.iconColor} style={{flexShrink:0}} />
      <div style={{flex:1,minWidth:0,display:'flex',alignItems:'baseline',gap:'8px'}}>
        <span style={{fontSize:'12.5px',fontWeight:630,color:C.t1,letterSpacing:'-.015em',flexShrink:0}}>{title}</span>
        <span style={{fontSize:'10px',color:C.t4,flexShrink:0}}>{price}</span>
        <span style={{fontSize:'10px',color:C.t4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{spec}</span>
      </div>
      <button
        onClick={onClick}
        style={{
          flexShrink:0, height:'28px', padding:'0 12px',
          borderRadius:'7px', border:`1px solid ${hov ? a.hoverBorder : a.cardBorder}`,
          cursor:'pointer', fontFamily:F,
          background: hov ? 'rgba(148,163,184,0.16)' : a.btnBg,
          fontSize:'11.5px', fontWeight:630,
          color: hov ? 'rgba(226,232,240,0.95)' : a.btnColor,
          transition:`background 200ms ${EASE}, border-color 200ms ${EASE}, color 200ms ${EASE}`,
          display:'flex', alignItems:'center', gap:'4px',
        }}
      >
        Start <ArrowRight size={9} strokeWidth={2.3} />
      </button>
    </div>
  );
}

// ─── BYOK row ─────────────────────────────────────────────────

function ByokRow({ onClick }: { onClick:()=>void }) {
  const [hov, setHov] = useState(false);
  const reduced = useReducedMotion() ?? false;
  return (
    <div style={{borderTop:`1px solid ${C.div}`,paddingTop:'8px'}}>
      <button
        onClick={onClick}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          width:'100%', display:'flex', alignItems:'center', gap:'10px',
          padding:'9px 12px', borderRadius:'10px',
          border:`1px solid ${hov ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.07)'}`,
          cursor:'pointer',
          background: hov ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
          transform: hov && !reduced ? 'translateY(-1px)' : 'translateY(0)',
          transition:`background 180ms ${EASE}, border-color 180ms ${EASE}, transform 180ms ${EASE}`,
          textAlign:'left', fontFamily:F,
        }}
      >
        <div style={{
          width:'26px',height:'26px',borderRadius:'7px',flexShrink:0,
          background: hov ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.06)',
          border:`1px solid ${hov ? 'rgba(255,255,255,0.15)' : C.div}`,
          display:'flex',alignItems:'center',justifyContent:'center',
          transition:`background 180ms ${EASE}, border-color 180ms ${EASE}`,
        }}>
          <Key size={11} strokeWidth={1.75} color={hov ? C.t2 : C.t3} />
        </div>
        <div style={{flex:1}}>
          <div style={{display:'flex',alignItems:'center',gap:'7px'}}>
            <span style={{fontSize:'12px',fontWeight:580,color:hov ? C.t1 : C.t2,transition:`color 180ms ${EASE}`}}>
              Use my own API keys
            </span>
            <span style={{fontSize:'7.5px',fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',color:C.t4,border:`1px solid rgba(255,255,255,0.12)`,padding:'1.5px 4px',borderRadius:'3px'}}>free</span>
          </div>
          <div style={{fontSize:'10.5px',color:C.t4,marginTop:'1px'}}>
            Natively API disabled · No Pro features
          </div>
        </div>
        <ArrowRight size={11} strokeWidth={2} color={hov ? C.t2 : C.t3} style={{flexShrink:0,transition:`color 180ms ${EASE}`}} />
      </button>
    </div>
  );
}

// ─── Intermediate states ──────────────────────────────────────

function WipingState() {
  return (
    <div style={{padding:'52px 28px',display:'flex',flexDirection:'column',alignItems:'center',gap:'18px',textAlign:'center'}}>
      <motion.div animate={{rotate:360}} transition={{duration:1,repeat:Infinity,ease:'linear'}}>
        <Loader2 size={24} strokeWidth={1.5} color={C.t4} />
      </motion.div>
      <div>
        <div style={{fontSize:'14px',fontWeight:560,color:C.t2,marginBottom:'6px',fontFamily:F}}>Cleaning up trial data…</div>
        <div style={{fontSize:'12px',color:C.t4,lineHeight:1.6,fontFamily:F}}>Wiping cached company research and Pro data.</div>
      </div>
    </div>
  );
}

function DoneState({ onDone }: { onDone?:()=>void }) {
  return (
    <div style={{padding:'52px 28px',display:'flex',flexDirection:'column',alignItems:'center',gap:'18px',textAlign:'center'}}>
      <div style={{width:'52px',height:'52px',borderRadius:'50%',background:'rgba(52,211,153,.1)',border:'1px solid rgba(52,211,153,.2)',display:'flex',alignItems:'center',justifyContent:'center'}}>
        <CheckCircle size={22} strokeWidth={1.5} color="#34D399" />
      </div>
      <div>
        <div style={{fontSize:'15px',fontWeight:600,color:C.t1,marginBottom:'6px',fontFamily:F}}>All set.</div>
        <div style={{fontSize:'12.5px',color:C.t3,lineHeight:1.65,maxWidth:'240px',margin:'0 auto',fontFamily:F}}>
          Trial data wiped. Add your API keys in Settings → AI Providers to get started.
        </div>
      </div>
      {onDone && (
        <button
          onClick={onDone}
          style={{
            padding:'9px 24px', borderRadius:'10px', border:`1px solid ${C.div}`, cursor:'pointer',
            background:'rgba(255,255,255,.06)', fontSize:'12.5px', fontWeight:560,
            color:C.t3, fontFamily:F, transition:'background 150ms,color 150ms',
          }}
          onMouseEnter={e=>{e.currentTarget.style.background='rgba(255,255,255,.1)';e.currentTarget.style.color=C.t2;}}
          onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,.06)';e.currentTarget.style.color=C.t3;}}
        >
          Continue →
        </button>
      )}
    </div>
  );
}
