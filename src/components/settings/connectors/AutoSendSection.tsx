// "Send automatically" on a connector's page: rules that send a meeting's notes
// to this destination by themselves once they are ready, for every meeting or
// one folder's. Like Granola's per-folder auto-post and auto-sync, but kept on
// the connector's own page. Nothing is sent without a rule the user made here.

import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useT } from '../../../i18n';
import { SettingsSwitch, useSettingsTones } from '../SettingsRow';
import type { AutoSendDestination, AutoSendRuleInfo, ConnectorsApi, FolderOption } from '../../../types/connectors';
import { ConnectorSelect, DeliveryLine, DetailSection, FolderSelect, GlassPill, ListCard, folderName } from './parts';

const capi = (): ConnectorsApi | undefined => window.electronAPI?.connectors;

const sameDestination = (a: AutoSendDestination, b: AutoSendDestination): boolean =>
    a.kind === b.kind && (a.kind !== 'slack' || (b.kind === 'slack' && a.webhookId === b.webhookId)) && (a.kind !== 'crm' || (b.kind === 'crm' && a.service === b.service));

export const AutoSendSection: React.FC<{
    /** The destination(s) this page sends to: one for Notion and CRMs, one per channel for Slack. */
    destinations: Array<{ destination: AutoSendDestination; label: string }>;
    connected: boolean;
    rules: AutoSendRuleInfo[];
    folders: FolderOption[];
    onChanged: () => void;
}> = ({ destinations, connected, rules, folders, onChanged }) => {
    const t = useT();
    const tones = useSettingsTones();
    const [folderId, setFolderId] = useState<string | null>(null);
    const [target, setTarget] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const mine = rules.filter((r) => destinations.some((d) => sameDestination(d.destination, r.destination)));
    const labelOf = (r: AutoSendRuleInfo) => destinations.find((d) => sameDestination(d.destination, r.destination))?.label ?? '';
    const all = t('All meetings');

    const add = async () => {
        const d = destinations[target];
        if (!d) return;
        setBusy(true);
        setError(null);
        const res = await capi()?.createAutoSendRule({ destination: d.destination, folderId }).catch(() => undefined);
        setBusy(false);
        if (!res?.ok) { setError(res?.message || t('Could not add that. Try again.')); return; }
        onChanged();
    };

    // Nothing to set up or show until the destination is connected (Granola's
    // pages show no automation before that either); rules kept from before stay visible.
    if (!connected && !mine.length) return null;

    return (
        <DetailSection
            title="Send automatically"
            subtitle={t('When a meeting’s notes are ready, Natively sends them here by itself, once per meeting. It runs while Natively is open.')}
            after={error ? <p className={`mt-1.5 px-1 text-xs ${tones.text.danger}`}>{error}</p> : null}
        >
            {mine.length > 0 && (
                    <ListCard>
                        {mine.map((r) => (
                            <div key={r.id} className="flex items-center gap-4 px-4 py-3">
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-bold text-text-primary">
                                        {folderName(folders, r.folderId, all)}
                                        {destinations.length > 1 ? <span className="text-text-secondary"> {t('to')} {labelOf(r)}</span> : null}
                                    </div>
                                    <DeliveryLine delivery={r.lastDelivery} />
                                </div>
                                <SettingsSwitch
                                    checked={r.enabled}
                                    label={t('Send automatically')}
                                    onChange={() => void capi()?.updateAutoSendRule(r.id, { enabled: !r.enabled }).then(onChanged)}
                                />
                                <GlassPill aria-label={t('Remove')} onClick={() => void capi()?.deleteAutoSendRule(r.id).then(onChanged)} icon={<Trash2 size={14} />} />
                            </div>
                        ))}
                    </ListCard>
            )}
            {connected ? (
                <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                    <span className="mr-auto text-sm font-bold text-text-primary">{t('Add a rule')}</span>
                    <div className="w-44"><FolderSelect folders={folders} value={folderId} onChange={setFolderId} /></div>
                    {destinations.length > 1 && (
                        <div className="w-44">
                            <ConnectorSelect
                                label={t('Where')}
                                value={String(target)}
                                onChange={(v) => setTarget(Number(v))}
                                options={destinations.map((d, i) => ({ id: String(i), name: d.label }))}
                            />
                        </div>
                    )}
                    <GlassPill onClick={() => void add()} disabled={busy || !destinations.length} icon={<Plus size={14} />}>
                        {t('Add')}
                    </GlassPill>
                </div>
            ) : (
                <p className="px-4 py-3 text-xs text-text-secondary">{t('Connect first, then choose which meetings are sent here by themselves.')}</p>
            )}
        </DetailSection>
    );
};
