// src/components/onboarding/PermissionsToaster.tsx
//
// Skills: ui-ux-pro-max · ui-design-system · canvas-designer · frontend-design
//
// Split-view permissions onboarding card.
// Shows once on first launch, after the launcher UI is visible.
// macOS: raises the mic consent prompt, opens System Settings for screen recording.
// Windows: the same card. Only the microphone has to be given there — there is
// no per-app screen-capture gate — so the Screen Recording row is shown already
// allowed, and the guide pictures the WINDOWS microphone page, never the macOS
// alert (CLAUDE.md: no macOS troubleshooting on Windows).
// Any other platform keeps the compact single-column card with no guide.
//
// Row presentation lives in src/lib/permissionRowPolicy.mjs so both platform
// branches are testable without mutating process.platform (CLAUDE.md). This
// file renders; it does not decide.
//
// The card NEVER writes a permission state it has not observed. Actions open a
// panel or raise a prompt; the real status arrives via the focus refresh below.
//

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { X, Monitor, Mic, Settings, Check, Lock, Loader2, Circle, LayoutList, ArrowLeft, Minus, Square, ChevronRight } from 'lucide-react';
import nativelyIcon from '../../../assets/icon.png';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { LiquidGlassButton } from '../../ui-components/LiquidGlassButton';
import { GenieModal } from '../ui/GenieModal';
import { describePermRow, allPermissionsResolved } from '../../lib/permissionRowPolicy.mjs';
import type { RowPresentation } from '../../lib/permissionRowPolicy.mjs';
import { windowsMicPage } from '../../lib/micPermissionPolicy.mjs';

const STORAGE_KEY = 'natively_perms_shown_v1';

// ─── Design tokens ────────────────────────────────────────────
const T = {
  font:  '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
  blue:  '#007AFF',
  green: '#34D399',
  amber: '#F59E0B',
};

// "Open Settings" in the card's own blue: the row icons' colour, and the blue
// macOS gives an alert's default button. The material is the onboarding glass
// (`lavender`: top sheen, hairline rim, a glow underneath), re-tinted through
// its --lg-lav-* tokens. Every tinted token is set, not only the fill, or the
// kit's lavender shows through at the rim.
//
// A set of this card's own rather than WELCOME_BUTTON_TOKENS: those also colour
// the welcome CTA and Settings' selected tiles, which stay as they are.
// White on #007AFF is 4.0:1 at 14px semibold.
const OPEN_SETTINGS_GLASS = {
  light: {
    '--lg-lav-bg': T.blue,
    '--lg-lav-hover': '#1F8BFF',
    '--lg-lav-fg': '#FFFFFF',
    '--lg-lav-rim': 'rgba(255,255,255,0.46)',
    '--lg-rim-2': 'rgba(255,255,255,0.20)',
    '--lg-rim-3': 'rgba(255,255,255,0.10)',
    '--lg-lens-rim-soft': 'rgba(255,255,255,0.22)',
    // On a white card a full-strength glow blooms; a contact shadow carries it.
    '--lg-lav-glow': 'rgba(0,122,255,0.34)',
    '--lg-lav-under': 'rgba(0,45,120,0.30)',
    '--lg-lav-drop': 'rgba(0,45,120,0.18)',
  },
  dark: {
    '--lg-lav-bg': T.blue,
    '--lg-lav-hover': '#1F8BFF',
    '--lg-lav-fg': '#FFFFFF',
    '--lg-lav-rim': 'rgba(255,255,255,0.32)',
    '--lg-rim-2': 'rgba(255,255,255,0.14)',
    '--lg-rim-3': 'rgba(255,255,255,0.08)',
    '--lg-lens-rim-soft': 'rgba(255,255,255,0.18)',
    '--lg-lav-glow': 'rgba(0,122,255,0.55)',
    '--lg-lav-under': 'rgba(0,20,70,0.36)',
    '--lg-lav-drop': 'rgba(0,0,0,0.30)',
  },
} as const;

type PermStatus = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown' | 'loading';
type RowKind = 'screen' | 'microphone';

/** Resolved per-theme surface values, shared with the guide sub-components. */
interface CardColors {
  cardBg: string;
  boxShadow: string;
  overlayBg: string;
  rightBg: string;
  rightBorderLeft: string;
  gridOpacity: number;
  gridLineColor: string;
  closeBtnColor: string;
  closeBtnOpacityDefault: number;
  closeBtnOpacityHover: number;
  closeBtnBgHover: string;
  mockBg: string;
  mockBorder: string;
  mockShadow: string;
  mockIconShadow: string;
  mockTextPrimary: string;
  mockSecondaryText: string;
  panelBg: string;
  panelBorder: string;
  panelShadow: string;
  panelIconBg: string;
  panelIconBorder: string;
  panelText: string;
  connector: string;
}

interface Props {
  isOpen:    boolean;
  onDismiss: () => void;
}

// ─── Spring configs for Apple-like feel ───────────────────────
const SPRING = {
  gentle: { type: 'spring' as const, stiffness: 180, damping: 22, mass: 0.9 },
  smooth: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
};

export const PermissionsToaster: React.FC<Props> = ({ isOpen, onDismiss }) => {
  const [ready,      setReady]      = useState(false);
  // The preload knows the platform before the first status read comes back, so
  // a failed read can no longer leave a Windows card drawn as the macOS one.
  const [platform,   setPlatform]   = useState<string>(() => window.electronAPI?.platform ?? 'darwin');
  // Which Windows the guide is drawn for. Windows 10 and 11 name the microphone
  // switches differently, and both report "Windows NT 10.0" in the user agent,
  // so the release comes from the UA client hint. Read here rather than in the
  // guide so it has long settled by the time the statuses arrive and the card
  // opens; until it answers (or if it cannot) the guide is Windows 11's.
  const [winMicPage, setWinMicPage] = useState(() => windowsMicPage(null));
  useEffect(() => {
    if (platform !== 'win32') return;
    let live = true;
    const hints = (navigator as Navigator & {
      userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<{ platformVersion?: string }> };
    }).userAgentData;
    hints?.getHighEntropyValues?.(['platformVersion'])
      .then(v => { if (live) setWinMicPage(windowsMicPage(v?.platformVersion)); })
      .catch(() => { /* stays Windows 11's */ });
    return () => { live = false; };
  }, [platform]);
  const [micStatus,  setMicStatus]  = useState<PermStatus>('loading');
  const [scrStatus,  setScrStatus]  = useState<PermStatus>('loading');
  const [requesting, setRequesting] = useState<RowKind | null>(null);

  // It pours out of, and back into, the bottom of the window like every other
  // popup (GenieModal), warping one picture of itself the way macOS does. This
  // file only says WHEN the card is ready to appear: once the statuses are read.
  const reduced = useReducedMotion() ?? false;

  // The genie pours the card out whole, so nothing inside it animates in on top
  // of that. Entrances run only where there is no genie (reduced motion) or for
  // content that arrives after the card has landed (the "all set" state).
  const [landed, setLanded] = useState(false);
  const enter = reduced || landed;

  // The orchestrator unmounts this the moment it hears "dismissed", so every
  // way out closes the card first (the genie) and reports from onClosed.
  const afterCloseRef = useRef<(() => void) | null>(null);
  const closeThen = useCallback((after: () => void) => {
    if (afterCloseRef.current) return;
    afterCloseRef.current = after;
    setReady(false);
  }, []);

  const theme = useResolvedTheme();
  const isLight = theme === 'light';

  // This card is mounted as a sibling of the meeting subtree (App.tsx), outside
  // any [data-interface-theme] wrapper, so the colour theme is the only axis in
  // play here and a light/dark pair is correct.
  const colors: CardColors = {
    cardBg: isLight
      ? 'linear-gradient(160deg, #FFFFFF 0%, #FAFAFC 100%)'
      : 'linear-gradient(160deg, rgba(24,24,32,0.98) 0%, rgba(16,16,22,0.99) 100%)',
    boxShadow: isLight
      ? '0 32px 80px rgba(0,0,0,0.12), 0 0 1px rgba(0,0,0,0.12)'
      : '0 40px 100px rgba(0,0,0,0.9), 0 0 1px rgba(255,255,255,0.08)',
    // Light used to veil in WHITE (rgba(255,255,255,0.45)), which over an
    // already-light launcher changed almost nothing — measured 253,253,254
    // behind the card, so the card floated with no dim while every other
    // toaster dimmed. A scrim's job is to push the page back; that needs a
    // dark wash in both themes, lighter on light so the page stays readable.
    overlayBg: isLight ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.6)',
    rightBg: isLight ? '#EEEFF2' : 'rgba(0,0,0,0.3)',
    rightBorderLeft: isLight ? '1px solid rgba(0,0,0,0.07)' : '1px solid rgba(255,255,255,0.1)',
    // Off-white grey on the dark panel, a darker grey on the light one —
    // a neutral rule either way rather than pure black/white at low alpha,
    // which picked up the panel's tint and read slightly blue.
    gridOpacity: isLight ? 0.14 : 0.10,
    gridLineColor: isLight ? 'rgba(88, 90, 98, 0.55)' : 'rgba(228, 229, 234, 0.42)',

    closeBtnColor: isLight ? '#1C1C1E' : '#FFFFFF',
    closeBtnOpacityDefault: isLight ? 0.45 : 0.4,
    closeBtnOpacityHover: isLight ? 0.85 : 0.8,
    closeBtnBgHover: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)',

    // Mock of the macOS consent dialog. No backdrop-filter: these sit on an
    // opaque pane, so the blur cost bought nothing and this card's animated
    // blur layers were the subject of the ?isolate=permissions-toaster bisect.
    mockBg: isLight ? '#FFFFFF' : 'rgba(28, 28, 36, 0.95)',
    mockBorder: isLight ? '1px solid rgba(0,0,0,0.09)' : '1px solid rgba(255,255,255,0.12)',
    mockShadow: isLight
      ? '0 16px 36px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)'
      : '0 24px 50px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.1)',
    mockIconShadow: isLight ? '0 4px 10px rgba(0,0,0,0.12)' : '0 4px 12px rgba(0,0,0,0.4)',
    mockTextPrimary: isLight ? '#1C1C1E' : '#FFFFFF',
    mockSecondaryText: isLight ? '#1C1C1E' : '#FFFFFF',

    panelBg: isLight ? '#FFFFFF' : 'rgba(36, 36, 46, 0.8)',
    panelBorder: isLight ? '1px solid rgba(0,0,0,0.08)' : '1px solid rgba(255,255,255,0.08)',
    panelShadow: isLight
      ? '0 10px 24px rgba(0,0,0,0.05)'
      : '0 12px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.05)',
    panelIconBg: isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)',
    panelIconBorder: isLight ? '1px solid rgba(0,0,0,0.02)' : '1px solid rgba(255,255,255,0.04)',
    panelText: isLight ? '#1C1C1E' : '#FFFFFF',

    connector: isLight ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.28)',
  };

  const t1 = isLight ? '#1C1C1E' : '#FFFFFF';
  const t3 = isLight ? 'rgba(28, 28, 30, 0.48)' : 'rgba(255, 255, 255, 0.44)';

  const refreshStatus = useCallback(async () => {
    try {
      const p = await window.electronAPI?.checkPermissions?.();
      if (!p) return;
      setPlatform(p.platform);
      setMicStatus(p.microphone as PermStatus);
      setScrStatus(p.screen     as PermStatus);
    } catch {
      setMicStatus('not-determined');
      setScrStatus('not-determined');
    }
  }, []);

  useEffect(() => {
    if (!isOpen) { setReady(false); setLanded(false); return; }
    // Pure presentational: orchestrator already gated on the homepage-mounted
    // duration predicate. We just refresh status and become visible.
    refreshStatus().then(() => setReady(true));
  }, [isOpen, refreshStatus]);

  useEffect(() => {
    if (!ready) return;
    // The only way a grant reaches this card. Every row action is fire-and-
    // re-read: nothing below writes 'granted' on its own.
    const onFocus = () => refreshStatus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [ready, refreshStatus]);

  const openScreenSettings = useCallback(() => {
    if (platform !== 'darwin') return;
    // Declared HERE, beside its darwin gate, not at module scope. The renderer
    // must never even construct this scheme off macOS, and the cross-platform
    // guard test reads the 1500 chars around each executable reference looking
    // for exactly this check - a module-scope constant sits too far from any
    // gate to be verifiable, which is what made it an offender.
    const screenSettingsUri =
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
    window.electronAPI?.openExternal?.(screenSettingsUri);
  }, [platform]);

  const handleRowAction = useCallback(async (kind: RowKind, remedy: RowPresentation['remedy']) => {
    if (remedy === 'request') {
      // macOS consent prompt. CR-03: re-read the real status rather than
      // asserting one — off darwin nothing is requested at all.
      setRequesting(kind);
      try {
        await window.electronAPI?.requestMicPermission?.();
        await refreshStatus();
      } finally {
        setRequesting(null);
      }
      return;
    }
    if (remedy !== 'settings') return;

    if (kind === 'microphone') {
      // Resolves the per-platform privacy URI in the main process via
      // micSettingsUri, so Windows lands on ms-settings:privacy-microphone.
      await window.electronAPI?.openMicSettings?.();
    } else {
      openScreenSettings();
    }
  }, [refreshStatus, openScreenSettings]);

  // The rows only report status now, so the card has exactly one action and it
  // lives in the footer. It resolves the FIRST outstanding permission, which is
  // what "Open Settings" can honestly mean when two are listed.
  //
  // It routes through handleRowAction rather than opening a pane directly, so a
  // microphone that has never been asked still gets the macOS consent prompt
  // ('request'). That matters: until an app has requested once, it does not
  // appear in System Settings > Privacy > Microphone at all, so sending a fresh
  // install straight to Settings would strand it with nothing to toggle.
  //
  // A row blocked by policy is passed over, as allPermissionsResolved passes it
  // over: nothing here can fix it, and stopping on it left the button dead
  // while the microphone below it was still waiting to be asked.
  const openSettingsForNext = useCallback(async () => {
    const outstanding = (row: RowPresentation) => row.tone !== 'granted' && row.tone !== 'blocked';
    const screen = platform === 'darwin' ? describePermRow(platform, 'screen', scrStatus) : null;
    const mic = describePermRow(platform, 'microphone', micStatus);
    if (screen && outstanding(screen)) { await handleRowAction('screen', screen.remedy); return; }
    if (outstanding(mic)) await handleRowAction('microphone', mic.remedy);
  }, [platform, scrStatus, micStatus, handleRowAction]);

  // The host unmounts us the moment it hears onDismiss, which would cut the
  // genie off — so close first, report after.
  const handleDismiss = useCallback(() => {
    closeThen(() => {
      localStorage.setItem(STORAGE_KEY, '1');
      onDismiss();
    });
  }, [closeThen, onDismiss]);

  const isMac = platform === 'darwin';
  const isWin = platform === 'win32';
  // The two platforms Natively ships on share the split card: rows on the left,
  // a picture of that platform's own settings on the right.
  const hasGuide = isMac || isWin;
  const allResolved = allPermissionsResolved(platform, { microphone: micStatus, screen: scrStatus });
  const checking = micStatus === 'loading' || (isMac && scrStatus === 'loading');

  const CARD_W = hasGuide ? '600px' : '420px';

  // The same rows in both states. Once granted, PermItem already draws its own
  // check badge and stops being interactive, so the resolved state needs no
  // separate markup — and the card keeps ONE row implementation instead of two
  // that drift apart. Rendering them when resolved is also what fills the 440
  // column, so the card is the same size and shape either way.
  const permRows = (
    <motion.div
      initial={enter ? { opacity: 0 } : false} animate={{ opacity: 1 }}
      transition={{ delay: 0.12 }}
      style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '24px' }}
    >
      {/* On Windows this row is never something to do: the policy reports it
          allowed, because there is no screen-capture permission to give. */}
      {hasGuide && (
        <PermItem
          icon={Monitor}
          label="Screen Recording"
          row={describePermRow(platform, 'screen', scrStatus)}
          busy={requesting === 'screen'}
          enter={enter}
          reduced={reduced}
          isLight={isLight}
        />
      )}
      <PermItem
        icon={Mic}
        label="Microphone"
        row={describePermRow(platform, 'microphone', micStatus)}
        busy={requesting === 'microphone'}
        enter={enter}
        reduced={reduced}
        isLight={isLight}
      />
    </motion.div>
  );

  // What the card shows is decided by the statuses, so its pictures are kept
  // per combination: an open never pours out last time's checkmarks, and a
  // picture taken while the consent prompt is up is never kept.
  const genieView = `perm:${platform}:mic=${micStatus}:screen=${isMac ? scrStatus : 'none'}`;

  return (
    <GenieModal
      open={ready}
      label="PermissionsToaster"
      openingView={genieView}
      keepPictures={requesting === null}
      zIndex={9998}
      onBackdropClick={handleDismiss}
      onOpened={() => setLanded(true)}
      onClosed={() => { const after = afterCloseRef.current; afterCloseRef.current = null; after?.(); }}
      backdropStyle={{ background: colors.overlayBg }}
      wrapStyle={{ width: CARD_W, maxWidth: '92vw' }}
      cardStyle={{
        // Matches BrowserExtensionToaster's frame so the two onboarding
        // cards read as one family. Windows renders no visual guide, so
        // it loses that column rather than leaving an empty pane.
        background: colors.cardBg,
        boxShadow: colors.boxShadow,
        fontFamily: T.font,
      }}
      cardProps={{
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': 'perm-toast-title',
        'aria-describedby': 'perm-toast-desc',
        'data-genie-view': genieView,
      }}
      shadow={colors.boxShadow}
      radius={20}
    >
      {/* The close sits on the inset panel (below), as it does on the
          extension card. Without a panel it falls back to the card corner. */}
      {!hasGuide && (
      <button onClick={handleDismiss} aria-label="Dismiss"
        style={{
          position: 'absolute', top: '16px', right: '16px', zIndex: 10,
          background: 'none', border: 'none', cursor: 'pointer',
          width: '26px', height: '26px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: '50%', opacity: colors.closeBtnOpacityDefault,
          transition: 'opacity 200ms, background 200ms',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.opacity = String(colors.closeBtnOpacityHover);
          e.currentTarget.style.background = colors.closeBtnBgHover;
        }}
        onMouseLeave={e => {
          e.currentTarget.style.opacity = String(colors.closeBtnOpacityDefault);
          e.currentTarget.style.background = 'transparent';
        }}>
        <X size={12} strokeWidth={2.5} color={colors.closeBtnColor} />
      </button>
      )}

      {/* Two-column split on the extension card's proportions:
          58/40 with a 440 floor. The footer below is pinned with
          marginTop:auto, which is what holds the column together at
          that floor instead of the flex:1 row list that used to strand
          the gap ABOVE the button. */}
      <div style={{ display: 'flex', alignItems: 'stretch', minHeight: hasGuide ? '440px' : undefined }}>

        {/* ── LEFT: Permission controls ── */}
        <div style={{
          flex: hasGuide ? '1 1 58%' : 1, minWidth: 0,
          padding: hasGuide ? '40px 28px 34px 40px' : '32px 32px 28px',
          display: 'flex', flexDirection: 'column',
        }}>

          {/* Header row */}
          <div style={{ marginBottom: '24px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: t3 }}>
              Permissions
            </span>
          </div>

          {allResolved ? (
            <AllSetPanel isLight={isLight} reduced={reduced} enter={enter} onContinue={handleDismiss} rows={permRows} />
          ) : (
            <>
              {/* Title + subtitle */}
              <motion.div
                initial={enter ? { opacity: 0, y: 8 } : false} animate={{ opacity: 1, y: 0 }}
                transition={{ ...SPRING.smooth, delay: 0.05 }}
                style={{ marginBottom: '24px' }}
              >
                <h2 id="perm-toast-title" style={{ fontSize: '24px', fontWeight: 700, letterSpacing: '-0.03em', color: t1, margin: '0 0 8px', lineHeight: 1.2 }}>
                  Let's get you set up
                </h2>
                <p id="perm-toast-desc" style={{ fontSize: '13px', lineHeight: 1.65, color: t3, margin: 0 }}>
                  {isMac
                    ? 'Natively needs a few permissions to capture meetings and transcribe speech.'
                    : isWin
                    ? 'Screen recording is already allowed. Natively only needs your microphone.'
                    : 'Natively needs microphone access to transcribe speech.'}
                </p>
              </motion.div>

              {permRows}

              {/* marginTop:auto pins the action to the bottom of the
                  column however short the copy above it runs — the same
                  device the extension card uses to hold its 440 floor. */}
              <motion.div
                initial={enter ? { opacity: 0, y: 8 } : false} animate={{ opacity: 1, y: 0 }}
                transition={{ ...SPRING.smooth, delay: 0.2 }}
                style={{ marginTop: 'auto' }}
              >
                <PrimaryButton
                  isLight={isLight}
                  disabled={checking}
                  icon={Settings}
                  label="Open Settings"
                  onClick={openSettingsForNext}
                />
              </motion.div>
            </>
          )}
        </div>

        {/* ── RIGHT: Visual guide — one picture per platform ──
             macOS gets its consent dialog and Privacy & Security row;
             Windows gets its own microphone page. Showing either on the
             other would be troubleshooting for the wrong OS (CLAUDE.md). */}
        {hasGuide && (
          <motion.div
            initial={enter ? { opacity: 0, x: 20 } : false} animate={{ opacity: 1, x: 0 }}
            transition={{ ...SPRING.gentle, delay: 0.08 }}
            style={{ flex: '0 0 40%', padding: '8px 8px 8px 0', display: 'flex' }}
          >
            {/*
              Inset 8px from the card's top, right and bottom with its own
              radius, exactly as the extension card holds its image panel.
              That gap is what makes the guide read as a separate object
              held inside the card rather than a second column bleeding to
              the edge — the old full-bleed pane with a left hairline.
            */}
            <div style={{
              position: 'relative', flex: 1,
              borderRadius: '14px', overflow: 'hidden',
              background: colors.rightBg,
              boxShadow: isLight ? 'inset 0 0 0 1px rgba(11,16,32,0.07)' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '28px 18px',
            }}>
              {/* Subtle grid pattern */}
              <div aria-hidden style={{
                position: 'absolute', inset: 0, opacity: colors.gridOpacity,
                backgroundImage: `linear-gradient(${colors.gridLineColor} 1px, transparent 1px),
                                 linear-gradient(90deg, ${colors.gridLineColor} 1px, transparent 1px)`,
                backgroundSize: '24px 24px',
              }} />

              <button onClick={handleDismiss} aria-label="Dismiss"
                style={{
                  position: 'absolute', top: '8px', right: '8px', zIndex: 2,
                  width: '30px', height: '30px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: 0, cursor: 'pointer',
                  background: 'none', border: 0, borderRadius: '8px',
                  opacity: colors.closeBtnOpacityDefault,
                  transition: 'opacity 200ms, background 200ms',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.opacity = String(colors.closeBtnOpacityHover);
                  e.currentTarget.style.background = colors.closeBtnBgHover;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.opacity = String(colors.closeBtnOpacityDefault);
                  e.currentTarget.style.background = 'transparent';
                }}>
                <X size={14} strokeWidth={2} color={colors.closeBtnColor} />
              </button>

              {allResolved
                ? <GuideResolved isLight={isLight} colors={colors} t3={t3} />
                : isMac
                ? <GuideSteps isLight={isLight} colors={colors} t3={t3} reduced={reduced} enter={enter} />
                : <GuideStepsWindows isLight={isLight} colors={colors} t3={t3} reduced={reduced} enter={enter} page={winMicPage} />}
            </div>
          </motion.div>
        )}
      </div>
    </GenieModal>
  );
};

// ─── Primary button ───────────────────────────────────────────
// The shared Liquid Glass material (src/ui-components), not a hand-rolled
// gradient with a gloss span.
//
//  - `lg-sm` because design.md measured the hero's 3px rim as visibly chunky
//    by 44px; at this scale it collapses to a single hairline ring. Only its
//    BOX is overridden below — the card's CTA is 48px, not a 30px settings row.
//  - `lg-wide` because the width comes from the container, not the label.
//    Without it the cap stops stay percentages of width and the specular is
//    still climbing well past the corner (design.md's third sighting of that
//    bug, after LiquidGlassBadge and the Profile Intelligence CTA).
//  - "Open Settings" is the onboarding's glass in this card's blue: `lavender`
//    (the "Start using Natively" material) on OPEN_SETTINGS_GLASS. It was
//    `action`, a flat saturated fill that read as a blue plate, and then the
//    welcome tokens, whose pale light-theme tint did not read as blue at all.
//    The tokens are picked from the resolved theme HERE rather than by a
//    [data-theme] rule, so the macOS and Windows cards get the same button.
//  - `lavender` blurs what is behind it. This card is opaque, so the blur has
//    nothing to show, and blur layers in this card were the subject of the
//    ?isolate=permissions-toaster bisect: it is switched off on this instance.
//
// Hover, press and the lens all live in the material; no framer wrapper.
// The unresolved card's footer is the way OUT, not a third way to fix
// something. It used to be a full-width primary labelled "Open Settings" that
// called the very same openScreenSettings as the Screen Recording row's own
// button — two identical CTAs plus Microphone's "Grant" made three, and on
// Windows the same control silently meant "dismiss" instead. The remedies
// belong to the rows, which know which one they need; this only leaves.
function QuietButton({ isLight, label, onClick }: {
  isLight: boolean; label: string; onClick: () => void;
}) {
  const t2 = isLight ? 'rgba(28, 28, 30, 0.66)' : 'rgba(255, 255, 255, 0.62)';
  const rule = isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.13)';
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%', height: '44px', borderRadius: '22px',
        background: 'transparent', border: `1px solid ${rule}`,
        color: t2, fontSize: '13.5px', fontWeight: 550, letterSpacing: '-0.01em',
        cursor: 'pointer', transition: 'border-color 200ms, color 200ms',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = isLight ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.26)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = rule; }}
    >
      {label}
    </button>
  );
}

function PrimaryButton({
  isLight, label, icon: Icon, onClick, disabled, variant = 'blue',
}: {
  isLight: boolean;
  label: string;
  icon?: React.ElementType;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'blue' | 'green';
}) {
  const glass = variant === 'blue';
  return (
    <LiquidGlassButton
      variant={glass ? 'lavender' : 'green'}
      className="lg-sm lg-wide"
      onClick={onClick}
      disabled={disabled}
      icon={Icon ? <Icon size={15} strokeWidth={2} /> : undefined}
      style={{
        width: '100%',
        // lg-sm's box is a 30px settings row; this CTA keeps its 48px.
        // lg-wide derives its cap stops from --lg-pill-h, so they follow.
        ['--lg-pill-h' as string]: '48px',
        ['--lg-label-size' as string]: '14px',
        ...(glass ? {
          ...OPEN_SETTINGS_GLASS[isLight ? 'light' : 'dark'],
          backdropFilter: 'none',
          WebkitBackdropFilter: 'none',
        } : null),
        // No blanket opacity while the statuses are being read: the material
        // dims its own label, rim and lens when disabled (design.md, States).
        // The kit has no disabled body for `lavender`, so the fill is muted
        // and the glow dropped here. A darker fill only reads as "off" on the
        // dark card; on the light one it looks pressed, so there it is lifted
        // toward the card instead.
        ...(glass && disabled ? {
          filter: isLight ? 'saturate(.32) brightness(1.24)' : 'saturate(.4) brightness(.85)',
          ['--lg-lav-glow' as string]: 'transparent',
        } : null),
        cursor: disabled ? 'default' : 'pointer',
      } as React.CSSProperties}
    >
      {label}
    </LiquidGlassButton>
  );
}

// ─── Completion state ─────────────────────────────────────────
// `allPermissionsResolved` used to be computed and then thrown away, so the
// card kept demanding "Open Settings" from a user who had already granted
// everything. This is what it renders now.
// Same two rows as every other state — the card does not change shape when the
// permissions come good, only the heading, each row's status and the footer.
function AllSetPanel({ isLight, reduced, enter, onContinue, rows }: {
  isLight: boolean; reduced: boolean; enter: boolean; onContinue: () => void;
  rows: React.ReactNode;
}) {
  const t1 = isLight ? '#1C1C1E' : '#FFFFFF';
  const t3 = isLight ? 'rgba(28, 28, 30, 0.48)' : 'rgba(255, 255, 255, 0.44)';

  return (
    <motion.div
      initial={!enter ? false : reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: 0.15 } : SPRING.gentle}
      style={{ display: 'flex', flexDirection: 'column', flex: 1 }}
    >
      <h2 id="perm-toast-title" style={{ fontSize: '24px', fontWeight: 700, letterSpacing: '-0.03em', color: t1, margin: '0 0 8px', lineHeight: 1.2 }}>
        You're all set
      </h2>
      <p id="perm-toast-desc" style={{ fontSize: '13px', lineHeight: 1.65, color: t3, margin: '0 0 24px' }}>
        Natively has everything it needs.
      </p>

      {rows}

      {/* marginTop:auto holds the action on the 440 floor, as in every other state. */}
      <div style={{ marginTop: 'auto' }}>
        <PrimaryButton isLight={isLight} variant="green" label="Continue" onClick={onContinue} />
      </div>
    </motion.div>
  );
}

// ─── Guide: the two steps, macOS only ─────────────────────────
// Previously carried three infinite loops (a 2.2s setInterval driving a mock
// toggle, a floating icon and a pulsing button) stacked over two backdrop-filter
// layers. That combination is what ?isolate=permissions-toaster was added to
// bisect against a native OOM, and none of it taught the user anything a still
// image does not. Entrance animation only now.
function GuideSteps({ isLight, colors, t3, reduced, enter }: {
  isLight: boolean;
  colors: CardColors;
  t3: string;
  reduced: boolean;
  enter: boolean;
}) {
  const rise = (delay: number) => (!enter
    ? { initial: false as const }
    : reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2, delay } }
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { type: 'spring' as const, stiffness: 180, damping: 18, delay } });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', position: 'relative', zIndex: 1, width: '100%' }}>

      {/*
        Step 1 — the macOS consent alert, laid out the way the real TCC alert
        is: the app icon centred at the top, the title beneath it, the
        explanation beneath that, and the two push buttons side by side on one
        row with the default filled blue on the RIGHT.

        The previous mock was an icon-beside-text banner with right-aligned
        pills — the shape of a web toast, not a system alert — and it painted
        "Deny" as the blue default, teaching the exact wrong tap.
      */}
      <motion.div
        {...rise(0.15)}
        style={{
          width: '188px',
          backgroundColor: colors.mockBg,
          borderRadius: '12px',
          padding: '12px 12px 10px',
          border: colors.mockBorder,
          boxShadow: colors.mockShadow,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          textAlign: 'center',
        }}
      >
        <img src={nativelyIcon} alt="" aria-hidden style={{
          width: '30px', height: '30px', borderRadius: '7px',
          marginBottom: '7px', boxShadow: colors.mockIconShadow,
        }} />

        <div style={{
          fontSize: '10.5px', fontWeight: 600, color: colors.mockTextPrimary,
          lineHeight: 1.25, letterSpacing: '-0.005em', marginBottom: '9px',
        }}>
          Natively wants to record the screen.
        </div>

        <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
          <MockGlassButton isLight={isLight} color={colors.mockSecondaryText}>Deny</MockGlassButton>
          <MockGlassButton isLight={isLight} primary>Settings</MockGlassButton>
        </div>
      </motion.div>

      {/* Connector */}
      <div aria-hidden style={{ width: '1.5px', height: '14px', background: colors.connector, borderRadius: '1px' }} />

      {/* Step 2 — the Privacy & Security row, already switched on */}
      <motion.div
        {...rise(0.25)}
        style={{
          width: '188px',
          backgroundColor: colors.panelBg,
          borderRadius: '10px',
          padding: '9px 11px',
          border: colors.panelBorder,
          boxShadow: colors.panelShadow,
          display: 'flex', alignItems: 'center', gap: '9px',
          textAlign: 'left',
        }}
      >
        <div style={{
          width: '22px', height: '22px', borderRadius: '5px', flexShrink: 0,
          background: colors.panelIconBg, border: colors.panelIconBorder,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <img src={nativelyIcon} alt="" aria-hidden style={{ width: '14px', height: '14px', borderRadius: '3px' }} />
        </div>
        <span style={{ fontSize: '11px', fontWeight: 550, color: colors.panelText, flex: 1, letterSpacing: '-0.01em' }}>
          Natively
        </span>
        {/* A still switch in its target position. It used to flip itself every
            2.2s, which read as a control rather than an illustration. */}
        <div aria-hidden style={{
          width: '26px', height: '15px', borderRadius: '7.5px',
          padding: '1.5px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          flexShrink: 0,
          background: 'linear-gradient(160deg, #34D399 0%, #10B981 100%)',
          boxShadow: '0 0 8px rgba(52,211,153,0.3)',
        }}>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
        </div>
      </motion.div>

      <p style={{ fontSize: '10px', fontWeight: 500, color: t3, lineHeight: 1.4, margin: '6px 0 0', textAlign: 'center', opacity: 0.85, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        System Settings → Privacy &amp; Security
      </p>
    </div>
  );
}

// ─── Guide: the microphone page, Windows only ─────────────────
// What "Open Settings" lands on there, drawn from the real page the way the
// macOS guide draws its alert: a Windows 11 Settings window in miniature (back
// arrow, caption buttons, the breadcrumb that is the page's title, Fluent's
// neutral greys rather than this card's blue-blacks).
//
// The page's own structure, which is what makes the three switches legible:
//   - "Microphone access" is a card of its own, with the microphone glyph.
//   - "Let apps access your microphone" heads a second card, with the list
//     glyph, and "Let desktop apps access your microphone" sits INSIDE that
//     card, indented under it with no glyph. It is the one that covers
//     Natively.
// Checked against a screenshot of the page. Earlier versions drew three
// identical rows, which is not how it looks.
//
// Windows lists desktop apps under that last switch only once they have used
// the microphone, so at onboarding there is no "Natively" row to picture.
// Every switch is drawn on: the page as it should end up. Which one is off is
// said by the row on the left, in the page's own words.
//
// The names and the path are Windows's own and differ between 10 and 11:
// windowsMicPage (lib/micPermissionPolicy.mjs) holds both.
// A still image with an entrance only, as on macOS.
function GuideStepsWindows({ isLight, colors, t3, reduced, enter, page }: {
  isLight: boolean;
  colors: CardColors;
  t3: string;
  reduced: boolean;
  enter: boolean;
  page: ReturnType<typeof windowsMicPage>;
}) {
  const rise = (delay: number) => (!enter
    ? { initial: false as const }
    : reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2, delay } }
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { type: 'spring' as const, stiffness: 180, damping: 18, delay } });

  // Windows 11's own surfaces, text and default accent, per theme. The switch
  // is Fluent's: accent track with a dark knob on dark, a white one on light.
  const w = isLight ? {
    window: '#F3F3F3', card: '#FBFBFB', cardEdge: 'rgba(0,0,0,0.07)', edge: 'rgba(0,0,0,0.12)', rule: 'rgba(0,0,0,0.06)',
    text: 'rgba(0,0,0,0.9)', quiet: 'rgba(0,0,0,0.6)',
    accent: '#005FB8', knob: '#FFFFFF',
  } : {
    window: '#202020', card: '#2B2B2B', cardEdge: 'rgba(255,255,255,0.05)', edge: 'rgba(255,255,255,0.11)', rule: 'rgba(255,255,255,0.07)',
    text: '#FFFFFF', quiet: 'rgba(255,255,255,0.62)',
    accent: '#60CDFF', knob: '#000000',
  };
  const [app, ...crumbs] = page.path;
  const [device, apps, desktopApps] = page.switches;

  // One setting: an optional glyph (or the indent where one would be), the
  // switch's name, and the switch, on.
  const GLYPH = 13;
  const GAP = 7;
  const setting = (label: string, Glyph: React.ElementType | null) => (
    <div style={{ minHeight: '36px', boxSizing: 'border-box', padding: '5px 8px', display: 'flex', alignItems: 'center', gap: `${GAP}px` }}>
      {Glyph
        ? <Glyph size={GLYPH} strokeWidth={1.6} color={w.text} style={{ flexShrink: 0, opacity: 0.82 }} />
        : <span aria-hidden style={{ width: `${GLYPH}px`, flexShrink: 0 }} />}
      <span style={{ flex: 1, minWidth: 0, fontSize: '10px', fontWeight: 500, color: w.text, lineHeight: 1.28 }}>
        {label}
      </span>
      <span aria-hidden style={{
        position: 'relative', flexShrink: 0, boxSizing: 'border-box',
        width: '26px', height: '13px', borderRadius: '7px', background: w.accent,
      }}>
        <span style={{ position: 'absolute', top: '3px', right: '3px', width: '7px', height: '7px', borderRadius: '50%', background: w.knob }} />
      </span>
    </div>
  );
  const card: React.CSSProperties = { background: w.card, border: `1px solid ${w.cardEdge}`, borderRadius: '4px' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', position: 'relative', zIndex: 1, width: '100%' }}>
      <motion.div
        {...rise(0.15)}
        style={{
          // A little past the pane's padding: these names are long, and any
          // narrower the last one wraps to three lines.
          width: 'calc(100% + 12px)', minWidth: 0, margin: '0 -6px', boxSizing: 'border-box',
          background: w.window,
          borderRadius: '8px',
          border: `1px solid ${w.edge}`,
          boxShadow: colors.mockShadow,
          overflow: 'hidden',
          textAlign: 'left',
          // The real page's face where it exists; elsewhere the card's own.
          fontFamily: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
        }}
      >
        {/* Title bar: back, the app's name, then minimise / maximise / close */}
        <div aria-hidden style={{ height: '24px', display: 'flex', alignItems: 'center', paddingLeft: '9px', color: w.quiet }}>
          <ArrowLeft size={9} strokeWidth={1.75} style={{ flexShrink: 0, marginRight: '7px' }} />
          <span style={{ flex: 1, fontSize: '9px', fontWeight: 500, letterSpacing: '0.01em' }}>{app}</span>
          {[Minus, Square, X].map((Glyph, i) => (
            <span key={i} style={{ width: '22px', display: 'flex', justifyContent: 'center' }}>
              <Glyph size={i === 1 ? 7 : 9} strokeWidth={1.5} />
            </span>
          ))}
        </div>

        <div style={{ padding: '3px 7px 8px' }}>
          {/* The page's breadcrumb, which is its title on Windows */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', padding: '0 4px 9px', fontSize: '11px', fontWeight: 600, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {crumbs.map((crumb, i) => (
              <React.Fragment key={crumb}>
                {i > 0 && <ChevronRight size={10} strokeWidth={2} color={w.quiet} style={{ flexShrink: 0 }} />}
                <span style={{ color: i === crumbs.length - 1 ? w.text : w.quiet }}>{crumb}</span>
              </React.Fragment>
            ))}
          </div>

          <div style={card}>{setting(device, Mic)}</div>

          <div style={{ ...card, marginTop: '3px' }}>
            {setting(apps, LayoutList)}
            <div aria-hidden style={{ height: '1px', background: w.rule }} />
            {setting(desktopApps, null)}
          </div>
        </div>
      </motion.div>

      <p style={{ fontSize: '10px', fontWeight: 500, color: t3, lineHeight: 1.4, margin: '6px 0 0', textAlign: 'center', opacity: 0.85, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        All three switches on
      </p>
    </div>
  );
}

// ─── Guide: the alert's two push buttons ──────────────────────
// Pictures of buttons, in the same Liquid Glass as the card's own action: the
// default ("Settings") is the footer button's blue glass at 20px, the other
// ("Deny") the kit's clear glass, which takes the alert's own text colour.
//
// Spans with no lens, as LiquidGlassBadge is: nothing here can be pressed, so
// they are kept out of the pointer's reach and neither tint on hover nor take
// focus. `lavender`'s blur is off for the same reason as in PrimaryButton, and
// its glow is brought in for a pill this small (at 14px/30px it would wash the
// whole alert).
function MockGlassButton({ isLight, primary, color, children }: {
  isLight: boolean;
  primary?: boolean;
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`lg-button ${primary ? 'lg-lavender' : 'lg-clear'} lg-sm lg-wide`}
      style={{
        // The alert's own button shape: two equal rounded rectangles, as macOS
        // draws them and as this mock always had them. They were pills for a
        // while (the kit's default), which is the footer's shape, not an
        // alert's. The kit's 16px side padding is for a 30px settings row; at
        // 77px it would cut a label to an ellipsis. The tracking is the mock's
        // own.
        flex: '1 1 0', minWidth: 0,
        padding: '0 4px', pointerEvents: 'none',
        ['--lg-label-track' as string]: '-0.005em',
        ['--lg-radius' as string]: '6px',
        // The rim's cap stops follow the corner, not half the height (lg-wide's
        // pill assumption), or the specular fades out well before a 6px corner.
        ['--lg-cap-0' as string]: '1px',
        ['--lg-cap-1' as string]: '3px',
        ['--lg-cap-2' as string]: '6px',
        ['--lg-pill-h' as string]: '20px',
        ['--lg-label-size' as string]: '10px',
        ['--lg-label-weight' as string]: 500,
        ...(primary ? {
          ...OPEN_SETTINGS_GLASS[isLight ? 'light' : 'dark'],
          backdropFilter: 'none',
          WebkitBackdropFilter: 'none',
          boxShadow: [
            'inset 0 -1px 0 var(--lg-lav-under, rgba(90,43,176,0.14))',
            '0 1px 2px var(--lg-lav-drop, rgba(78,46,150,0.10))',
            '0 5px 12px -6px var(--lg-lav-glow)',
          ].join(', '),
        } : { color }),
      } as React.CSSProperties}
    >
      <span className="lg-content">
        <span className="lg-label">{children}</span>
      </span>
    </span>
  );
}

// ─── Guide: completion ────────────────────────────────────────
function GuideResolved({ isLight, colors, t3 }: {
  isLight: boolean;
  colors: CardColors;
  t3: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', position: 'relative', zIndex: 1 }}>
      <div style={{
        width: '54px', height: '54px', borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: isLight ? 'rgba(52,211,153,0.12)' : 'rgba(52,211,153,0.16)',
        border: '1px solid rgba(52,211,153,0.3)',
        boxShadow: colors.panelShadow,
      }}>
        <Check size={26} strokeWidth={2.5} color={T.green} />
      </div>
      <p style={{ fontSize: '10px', fontWeight: 500, color: t3, lineHeight: 1.4, margin: 0, textAlign: 'center', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        Ready to go
      </p>
    </div>
  );
}

// ─── Single permission row ────────────────────────────────────
// Status in, presentation out. The row has no opinion of its own: it cannot
// flip itself green, and clicking a granted row does nothing, because nothing
// was revoked.
function PermItem({
  icon: Icon, label, row, busy, enter, reduced, isLight,
}: {
  icon:     React.ElementType;
  label:    string;
  row:      RowPresentation;
  busy:     boolean;
  enter:    boolean;
  reduced:  boolean;
  isLight:  boolean;
}) {
  const t1 = isLight ? '#1C1C1E' : '#FFFFFF';
  const t3 = isLight ? 'rgba(28, 28, 30, 0.48)' : 'rgba(255, 255, 255, 0.44)';
  // On light the row was 245,245,245 on a 253,253,254 card — eight levels of
  // separation, and only the granted rows were legible at all because their
  // green edge carried them. An outstanding row, which is the one the user
  // actually needs to see, had nothing. Dark was already fine and is untouched.
  const rule = isLight ? 'rgba(0, 0, 0, 0.14)' : 'rgba(255, 255, 255, 0.1)';
  const glass = isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.06)';

  const accent =
    row.tone === 'granted' ? T.green :
    row.tone === 'blocked' ? T.amber :
    row.tone === 'pending' ? (isLight ? 'rgba(28,28,30,0.35)' : 'rgba(255,255,255,0.35)') :
    T.blue;

  return (
    <motion.div
      initial={enter ? { opacity: 0, y: 8 } : false} animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 24 }}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        // Every row keeps its container, granted or not, so the card is the
        // same object in all four states and only the status inside it moves.
        // Granted borrows a faint green edge rather than losing its box.
        padding: '13px 14px', borderRadius: '12px',
        background: glass,
        border: `1px solid ${row.tone === 'granted' ? 'rgba(52,211,153,0.18)' : rule}`,
        transition: 'border-color 300ms',
      }}
    >
      {/* The icon carries the row's state in its colour alone — no squircle
          well behind it. A tinted, bordered tile per row read as a second
          button next to the real action pill. */}
      <div style={{
        width: '26px', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={19} strokeWidth={1.75} color={accent} />
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 580, color: t1, letterSpacing: '-0.015em', whiteSpace: 'nowrap' }}>{label}</div>
        <div style={{ fontSize: '11px', color: t3, marginTop: '2px', lineHeight: 1.3 }}>
          {row.sublabel}
        </div>
      </div>

      {/* Trailing affordance — a state badge, not a switch */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        {busy ? (
          <motion.div
            animate={reduced ? {} : { rotate: 360 }}
            transition={reduced ? {} : { repeat: Infinity, duration: 0.9, ease: 'linear' }}
            style={{ display: 'flex' }}
          >
            <Loader2 size={17} strokeWidth={2} color={T.blue} />
          </motion.div>
        ) : row.tone === 'granted' ? (
          <Check aria-label="Access granted" size={16} strokeWidth={2.75} color={T.green} />
        ) : row.tone === 'blocked' ? (
          <Lock size={15} strokeWidth={2} color={T.amber} />
        ) : row.tone === 'pending' ? null : (
          // Not granted yet. A hollow circle against the granted row's filled
          // check reads as "outstanding" at a glance, without dressing a
          // status up as a button the way the blue action pill did.
          <Circle aria-label="Not granted" size={15} strokeWidth={1.75}
            color={isLight ? 'rgba(28,28,30,0.28)' : 'rgba(255,255,255,0.3)'} />
        )}
      </div>
    </motion.div>
  );
}
