// Settings › Connectors without Pro or a trial: the card at the top of the list
// and of each connector's page. Connectors are a Natively Pro feature; the main
// process enforces it (electron/services/outputs/connectorAccess.ts), this card
// only says so and leads to Plans & Billing. Saved connections are kept and can
// always be disconnected; nothing is sent until the user upgrades.

import React from 'react';
import { Lock } from 'lucide-react';
import { useT } from '../../../i18n';
import { LiquidGlassButton } from '../../../ui-components/LiquidGlassButton';
import { SETTINGS_CARD } from '../SettingsRow';
import { LAVENDER_PILL, Tile } from './parts';

export const ConnectorsProCard: React.FC<{ className?: string }> = ({ className = 'mt-4' }) => {
    const t = useT();
    const openPlans = () => { void window.electronAPI?.openSettingsTab?.('plans'); };
    return (
        <div className={`${SETTINGS_CARD} ${className} flex items-center gap-4 px-4 py-3`} data-connectors-pro-card>
            <Tile><Lock size={18} className="text-text-secondary" /></Tile>
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-text-primary">{t('Connectors are part of Natively Pro')}</span>
                <span className="mt-0.5 block text-xs text-text-secondary">
                    {t('Upgrade to connect your tools and send notes to them. Anything already connected is kept, and nothing is sent until then.')}
                </span>
            </span>
            <LiquidGlassButton variant="lavender" className={LAVENDER_PILL} onClick={openPlans}>
                {t('See plans')}
            </LiquidGlassButton>
        </div>
    );
};
