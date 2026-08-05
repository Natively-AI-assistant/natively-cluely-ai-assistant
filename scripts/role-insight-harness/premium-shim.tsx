// scripts/role-insight-harness/premium-shim.tsx
//
// Stands in for `src/premium/index.tsx` inside the harness bundle.
//
// The real barrel resolves its components through Vite's `import.meta.glob`,
// which esbuild cannot evaluate — under esbuild every export would silently
// become the barrel's `NullComponent` fallback, and the harness would render a
// Profile Intelligence panel with an EMPTY Role Insight section while looking
// entirely healthy. Importing the real modules directly keeps the harness
// honest about what ships.

import React from 'react';

export { RoleInsightPanel } from '../../premium/src/RoleInsightPanel';
export { ProfileVisualizer } from '../../premium/src/ProfileVisualizer';

const NullComponent: React.FC<any> = () => null;

// Not needed by the Profile Intelligence panel's render paths, but the module
// must satisfy every named import the panel (and its imports) may reference.
export const PremiumUpgradeModal: React.FC<any> = NullComponent;
export const PremiumPromoToaster: React.FC<any> = NullComponent;
export const ProfileFeatureToaster: React.FC<any> = NullComponent;
export const JDAwarenessToaster: React.FC<any> = NullComponent;
export const RemoteCampaignToaster: React.FC<any> = NullComponent;
export const NegotiationCoachingCard: React.FC<any> = NullComponent;
export const NativelyApiPromoToaster: React.FC<any> = NullComponent;
export const MaxUltraUpgradeToaster: React.FC<any> = NullComponent;
export const ModesSettings: React.FC<any> = NullComponent;
export const useAdCampaigns = () => ({
    activeAd: null as string | null,
    dismissAd: () => {},
    previewAd: () => {},
});
