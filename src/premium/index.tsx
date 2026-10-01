/**
 * Premium Module Loader
 *
 * Uses Vite's import.meta.glob to optionally load premium components
 * from the premium/ directory. If the premium/ folder is removed
 * (source-available build), the globs return empty objects and no-op
 * fallbacks are used instead. No build errors.
 */
import React from 'react';

// ─── No-op fallbacks ────────────────────────────────────────────────
const NullComponent: React.FC<any> = () => null;

// ─── Glob-import premium modules (empty {} when premium/ is absent) ──
const _profileVis = import.meta.glob<any>(
  '../../premium/src/ProfileVisualizer.tsx',
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

/**
 * Every ad card's component is in this build. The card scheduler only
 * schedules ad stages when this is true: a stage whose component is a no-op
 * would hold the single card slot for the session while rendering nothing.
 */
export const PREMIUM_ADS_AVAILABLE =
  Object.keys(_nativelyApiPromo).length > 0
  && Object.keys(_profileToaster).length > 0
  && Object.keys(_jdToaster).length > 0
  && Object.keys(_maxUltraUpgradeToaster).length > 0;
const _modesSettings = import.meta.glob<any>(
  '../../premium/src/ModesSettings.tsx',
  { eager: true }
);
const _roleInsight = import.meta.glob<any>(
  '../../premium/src/RoleInsightPanel.tsx',
  { eager: true }
);

// ─── Helper ──────────────────────────────────────────────────────────
function get<T>(mods: Record<string, any>, name: string, fallback: T): T {
  const mod = Object.values(mods)[0];
  return mod?.[name] ?? fallback;
}

// ─── Exports (always safe to import) ─────────────────────────────────
export const ProfileVisualizer: React.FC<any> =
  get(_profileVis, 'ProfileVisualizer', NullComponent);

export const ProfileFeatureToaster: React.FC<any> =
  get(_profileToaster, 'ProfileFeatureToaster', NullComponent);

export const JDAwarenessToaster: React.FC<any> =
  get(_jdToaster, 'JDAwarenessToaster', NullComponent);

export const RemoteCampaignToaster: React.FC<any> =
  get(_remoteCampaignToaster, 'RemoteCampaignToaster', NullComponent);

export const NegotiationCoachingCard: React.FC<any> =
  get(_negotiationCard, 'NegotiationCoachingCard', NullComponent);

export const NativelyApiPromoToaster: React.FC<any> =
  get(_nativelyApiPromo, 'NativelyApiPromoToaster', NullComponent);

export const MaxUltraUpgradeToaster: React.FC<any> =
  get(_maxUltraUpgradeToaster, 'MaxUltraUpgradeToaster', NullComponent);

export const ModesSettings: React.FC<any> =
  get(_modesSettings, 'default', NullComponent);

export const RoleInsightPanel: React.FC<any> =
  get(_roleInsight, 'RoleInsightPanel', NullComponent);
