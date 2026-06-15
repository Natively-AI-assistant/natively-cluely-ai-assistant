import React from 'react';

interface TrialModalProps {
  usage?: unknown;
  onByok?: () => void;
  onStandard?: () => void;
  onDone?: () => void;
}

export const FreeTrialModal: React.FC<TrialModalProps> = () => null;
