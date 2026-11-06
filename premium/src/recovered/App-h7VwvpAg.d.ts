import type { ComponentType } from 'react';
export const ProfileVisualizer: ComponentType<{ profile: unknown; isPremium?: boolean; isTrialActive?: boolean }>;
export const RoleInsightPanel: ComponentType<{ hasAccess?: boolean; onNeedUpgrade?: () => void; onGoToProfile?: () => void }>;
export const NegotiationCoachingCard: ComponentType<{ coaching: unknown; onDismiss?: () => void }>;
export const ProfileFeatureToaster: ComponentType<{ [key: string]: unknown }>;
export const JDAwarenessToaster: ComponentType<{ [key: string]: unknown }>;
export const NativelyApiPromoToaster: ComponentType<{ [key: string]: unknown }>;
export const MaxUltraUpgradeToaster: ComponentType<{ [key: string]: unknown }>;
export const RemoteCampaignToaster: ComponentType<{ [key: string]: unknown }>;
