import React from 'react';

interface TrialBannerProps {
  expiresAt: string;
  usage: { ai: number; stt_seconds: number; search: number };
  onUpgrade: () => void;
}

export const FreeTrialBanner: React.FC<TrialBannerProps> = () => null;
