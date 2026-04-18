/**
 * Premium Module Loader
 *
 * Uses Vite's import.meta.glob to optionally load premium components
 * from the premium/ directory. If the premium/ folder is removed
 * (open-source build), the globs return empty objects and no-op
 * fallbacks are used instead. No build errors.
 */
import React from 'react';

// ─── No-op fallbacks ────────────────────────────────────────────────
const NullComponent: React.FC<any> = () => null;

const nullAdCampaigns = (
  _planDetails: { isPremium: boolean; plan?: string; provider?: string },
  _hasProfile: boolean,
  _isAppReady: boolean,
  _appStartTime?: number,
  _lastMeetingEndTime?: number | null,
  _isProcessingMeeting?: boolean,
  _hasNativelyApi?: boolean
) => ({
  activeAd: null as string | null,
  dismissAd: (_campaignId?: string) => {},
  previewAd: (_ad: any) => {},
});

// ─── Glob-import premium modules (empty {} when premium/ is absent) ──
const _premiumModal = import.meta.glob<any>(
  '../../premium/src/PremiumUpgradeModal.tsx',
  { eager: true }
);
const _profileVis = import.meta.glob<any>(
  '../../premium/src/ProfileVisualizer.tsx',
  { eager: true }
);
const _promoToaster = import.meta.glob<any>(
  '../../premium/src/PremiumPromoToaster.tsx',
  { eager: true }
);
const _profileToaster = import.meta.glob<any>(
  '../../premium/src/ProfileFeatureToaster.tsx',
  { eager: true }
);
const _jdToaster = import.meta.glob<any>(
  '../../premium/src/JDAwarenessToaster.tsx',
  { eager: true }
);
const _remoteCampaignToaster = import.meta.glob<any>(
  '../../premium/src/RemoteCampaignToaster.tsx',
  { eager: true }
);
const _adHook = import.meta.glob<any>(
  '../../premium/src/useAdCampaigns.ts',
  { eager: true }
);
const _negotiationCard = import.meta.glob<any>(
  '../../premium/src/NegotiationCoachingCard.tsx',
  { eager: true }
);
const _nativelyApiPromo = import.meta.glob<any>(
  '../../premium/src/NativelyApiPromoToaster.tsx',
  { eager: true }
);
const _maxUltraUpgradeToaster = import.meta.glob<any>(
  '../../premium/src/MaxUltraUpgradeToaster.tsx',
  { eager: true }
);
const _modesSettings = import.meta.glob<any>(
  '../../premium/src/ModesSettings.tsx',
  { eager: true }
);

// ─── Helper ──────────────────────────────────────────────────────────
function get<T>(mods: Record<string, any>, name: string, fallback: T): T {
  const mod = Object.values(mods)[0];
  return mod?.[name] ?? fallback;
}

// ─── Exports (always safe to import) ─────────────────────────────────
export const PremiumUpgradeModal: React.FC<any> =
  get(_premiumModal, 'PremiumUpgradeModal', NullComponent);

export const ProfileVisualizer: React.FC<any> =
  get(_profileVis, 'ProfileVisualizer', NullComponent);

export const PremiumPromoToaster: React.FC<any> =
  get(_promoToaster, 'PremiumPromoToaster', NullComponent);

export const ProfileFeatureToaster: React.FC<any> =
  get(_profileToaster, 'ProfileFeatureToaster', NullComponent);

export const JDAwarenessToaster: React.FC<any> =
  get(_jdToaster, 'JDAwarenessToaster', NullComponent);

export const RemoteCampaignToaster: React.FC<any> =
  get(_remoteCampaignToaster, 'RemoteCampaignToaster', NullComponent);

export const useAdCampaigns: typeof nullAdCampaigns =
  get(_adHook, 'useAdCampaigns', nullAdCampaigns);

export const NegotiationCoachingCard: React.FC<any> =
  get(_negotiationCard, 'NegotiationCoachingCard', NullComponent);

export const NativelyApiPromoToaster: React.FC<any> =
  get(_nativelyApiPromo, 'NativelyApiPromoToaster', NullComponent);

export const MaxUltraUpgradeToaster: React.FC<any> =
  get(_maxUltraUpgradeToaster, 'MaxUltraUpgradeToaster', NullComponent);

export const ModesSettings: React.FC<any> =
  get(_modesSettings, 'default', NullComponent);
