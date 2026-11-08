// Webhooks and Zapier: addresses Natively sends a meeting's notes to once they
// are ready (and, for webhooks, when they are edited). Zapier is the same thing
// with a Catch Hook address from Zapier's own Webhooks trigger. Each request is
// signed (Standard Webhooks: webhook-id, webhook-timestamp, webhook-signature);
// the secret is shown once, when the address is added.

import React, { useState } from 'react';
import { AlertCircle, ArrowUpRight, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import { useT } from '../../../i18n';
import { Collapse, SETTINGS_FIELD_LABEL, SETTINGS_INPUT, SettingsNotice, SettingsSwitch, useSettingsTones } from '../SettingsRow';
import type { ConnectorsApi, FolderOption, WebhookEndpointInfo, WebhookEvent } from '../../../types/connectors';
import { BusyIcon, CopyField, FlashNotice, flashOf, type Flash } from './common';
import { ActionArea, ConnectPill, DeliveryLine, DetailSection, FOLD, FolderSelect, GlassPill, ListCard, folderName } from './parts';

const capi = (): ConnectorsApi | undefined => window.electronAPI?.connectors;

const EVENT_LABEL: Record<WebhookEvent, string> = {
    'note.generated': 'Notes are ready',
    'note.edited': 'Notes are edited',
};

const EndpointRow: React.FC<{ endpoint: WebhookEndpointInfo; folders: FolderOption[]; onChanged: () => void }> = ({ endpoint, folders, onChanged }) => {
    const t = useT();
    const [busy, setBusy] = useState<'test' | 'rotate' | null>(null);
    const [flash, setFlash] = useState<Flash>(null);
    const [secret, setSecret] = useState<string | null>(null);
    const test = async () => {
        setBusy('test');
        setFlash(null);
        const res = await capi()?.testWebhook(endpoint.id).catch(() => undefined);
        setBusy(null);
        setFlash(flashOf(res, t('The test arrived.')));
        onChanged();
    };
    const rotate = async () => {
        setBusy('rotate');
        const res = await capi()?.rotateWebhookSecret(endpoint.id).catch(() => undefined);
        setBusy(null);
        if (res?.ok && res.secret) setSecret(res.secret); else setFlash(flashOf(res));
    };
    const events = endpoint.events.map((e) => t(EVENT_LABEL[e])).join(', ');
    return (
        <div className="px-4 py-3">
            <div className="flex items-center gap-4">
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-text-primary">{endpoint.label || endpoint.urlHost}</div>
                    <div className="truncate text-xs text-text-secondary">
                        {endpoint.urlHost} · {folderName(folders, endpoint.folderId, t('All meetings'))}{endpoint.kind === 'webhook' ? ` · ${events}` : ''}
                    </div>
                    <DeliveryLine delivery={endpoint.lastDelivery} />
                </div>
                <SettingsSwitch
                    checked={endpoint.enabled}
                    label={t('Send to this address')}
                    onChange={() => void capi()?.updateWebhook(endpoint.id, { enabled: !endpoint.enabled }).then(onChanged)}
                />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
                <GlassPill onClick={() => void test()} disabled={!!busy} icon={<BusyIcon busy={busy === 'test'} icon={<Send size={14} />} />}>
                    {t('Send test event')}
                </GlassPill>
                {endpoint.kind === 'webhook' && (
                    <GlassPill onClick={() => void rotate()} disabled={!!busy} icon={<BusyIcon busy={busy === 'rotate'} icon={<RefreshCw size={14} />} />}>
                        {t('New signing secret')}
                    </GlassPill>
                )}
                <GlassPill aria-label={t('Remove')} onClick={() => void capi()?.deleteWebhook(endpoint.id).then(onChanged)} icon={<Trash2 size={14} />} />
            </div>
            {secret && (
                <div className="mt-3">
                    <CopyField label={t('Signing secret')} text={secret} />
                    <p className="mt-1.5 text-xs text-text-secondary">{t('Copy this now. You won’t be able to see it again. The old secret no longer signs requests.')}</p>
                </div>
            )}
            <div className="mt-2"><FlashNotice flash={flash} /></div>
        </div>
    );
};

const AddEndpointForm: React.FC<{ kind: 'webhook' | 'zapier'; folders: FolderOption[]; onDone: (secret?: string) => void; onCancel: () => void }> = ({ kind, folders, onDone, onCancel }) => {
    const t = useT();
    const [label, setLabel] = useState('');
    const [url, setUrl] = useState('');
    const [events, setEvents] = useState<WebhookEvent[]>(['note.generated']);
    const [folderId, setFolderId] = useState<string | null>(null);
    const [includeTranscript, setIncludeTranscript] = useState(false);
    const [busy, setBusy] = useState(false);
    const [flash, setFlash] = useState<Flash>(null);
    const toggleEvent = (e: WebhookEvent) => setEvents((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]));
    const canSave = !!url.trim() && events.length > 0 && !busy;
    const save = async () => {
        if (!canSave) return;
        setBusy(true);
        setFlash(null);
        const res = await capi()?.createWebhook({ kind, label: label.trim(), url: url.trim(), events, folderId, includeTranscript }).catch(() => undefined);
        setBusy(false);
        if (!res?.ok) { setFlash(flashOf(res)); return; }
        onDone(kind === 'webhook' ? res.secret : undefined);
    };
    return (
        <div className="space-y-3">
            <label className="block">
                <span className={SETTINGS_FIELD_LABEL}>{kind === 'zapier' ? t('Zap address') : t('Endpoint URL')}</span>
                <input
                    type="url"
                    autoComplete="off"
                    spellCheck={false}
                    className={`${SETTINGS_INPUT} mt-1`}
                    placeholder={kind === 'zapier' ? 'https://hooks.zapier.com/hooks/catch/…' : 'https://example.com/natively'}
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                />
            </label>
            <label className="block">
                <span className={SETTINGS_FIELD_LABEL}>{t('Name')}</span>
                <input className={`${SETTINGS_INPUT} mt-1`} placeholder={kind === 'zapier' ? t('Meeting notes to CRM') : t('Team wiki')} value={label} onChange={(e) => setLabel(e.target.value)} />
            </label>
            <div>
                <span className={SETTINGS_FIELD_LABEL}>{t('Which meetings')}</span>
                <div className="mt-1"><FolderSelect folders={folders} value={folderId} onChange={setFolderId} /></div>
            </div>
            {kind === 'webhook' && (
                <div>
                    <span className={SETTINGS_FIELD_LABEL}>{t('Send when')}</span>
                    <div className="mt-1.5 flex flex-wrap gap-4">
                        {(Object.keys(EVENT_LABEL) as WebhookEvent[]).map((e) => (
                            <label key={e} className="flex cursor-pointer items-center gap-2 text-xs text-text-primary">
                                <input type="checkbox" className="accent-[var(--accent-primary)]" checked={events.includes(e)} onChange={() => toggleEvent(e)} />
                                {t(EVENT_LABEL[e])}
                            </label>
                        ))}
                    </div>
                </div>
            )}
            <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-text-primary">{t('Include the transcript')}</span>
                <SettingsSwitch checked={includeTranscript} label={t('Include the transcript')} onChange={() => setIncludeTranscript((v) => !v)} />
            </div>
            <FlashNotice flash={flash} />
            <div className="flex justify-end gap-2">
                <GlassPill onClick={onCancel}>{t('Cancel')}</GlassPill>
                <GlassPill onClick={() => void save()} disabled={!canSave} icon={<BusyIcon busy={busy} icon={<Plus size={14} />} />}>
                    {kind === 'zapier' ? t('Add Zap') : t('Add webhook')}
                </GlassPill>
            </div>
        </div>
    );
};

/**
 * Zapier and Webhooks: the page's card adds an address (Zapier also gets a
 * quiet way into Zapier's editor, where the Catch Hook is made), the form or
 * the one-time secret opens inside it, then a card of the addresses and, for
 * webhooks, one of what each request carries.
 */
export const WebhooksPanel: React.FC<{ kind: 'webhook' | 'zapier'; endpoints: WebhookEndpointInfo[]; folders: FolderOption[]; available: boolean; onChanged: () => void }> = ({ kind, endpoints, folders, available, onChanged }) => {
    const t = useT();
    const tones = useSettingsTones();
    const [adding, setAdding] = useState(false);
    const [secret, setSecret] = useState<string | null>(null);
    const mine = endpoints.filter((e) => e.kind === kind);
    const zapier = kind === 'zapier';
    const count = zapier
        ? (mine.length === 1 ? t('1 Zap') : `${mine.length} ${t('Zaps')}`)
        : (mine.length === 1 ? t('1 endpoint') : `${mine.length} ${t('endpoints')}`);
    return (
        <>
            {!available && (
                <SettingsNotice tone={tones.warn} icon={<AlertCircle size={14} />}>
                    {t('This part of Natively is still starting. Reopen Settings in a moment.')}
                </SettingsNotice>
            )}
            <ActionArea
                state={mine.length ? 'on' : 'off'}
                title={mine.length ? count : zapier ? t('No Zaps yet') : t('No endpoints yet')}
                titleKey={mine.length ? count : 'none'}
                detail={mine.length
                    ? t('Sent as soon as a meeting’s notes are ready.')
                    : zapier
                        ? t('Start a Zap with Webhooks by Zapier, Catch Hook, and add its address.')
                        : t('Add an https address. Each request is signed with your secret.')}
                secondary={zapier ? (
                    <GlassPill onClick={() => void window.electronAPI?.openExternal?.('https://zapier.com/editor')}>
                        <span className="inline-flex items-center gap-1">{t('Open Zapier')}<ArrowUpRight size={14} /></span>
                    </GlassPill>
                ) : undefined}
                below={
                    <Collapse open={adding || !!secret}>
                        <div className={FOLD}>
                            {adding ? (
                                <AddEndpointForm
                                    kind={kind}
                                    folders={folders}
                                    onCancel={() => setAdding(false)}
                                    onDone={(s) => { setAdding(false); if (s) setSecret(s); onChanged(); }}
                                />
                            ) : secret ? (
                                <div>
                                    <CopyField label={t('Signing secret')} text={secret} />
                                    <p className="mt-1.5 text-xs text-text-secondary">
                                        {t('Copy this now. You won’t be able to see it again. Check each request’s webhook-signature header with it.')}
                                    </p>
                                    <div className="mt-3 flex justify-end">
                                        <GlassPill onClick={() => setSecret(null)}>{t('Done')}</GlassPill>
                                    </div>
                                </div>
                            ) : <span />}
                        </div>
                    </Collapse>
                }
            >
                <ConnectPill
                    label={zapier ? t('Add a Zap') : t('Add webhook')}
                    expanded={adding}
                    disabled={!available || adding}
                    onClick={() => { setSecret(null); setAdding(true); }}
                />
            </ActionArea>
            {mine.length > 0 && (
                <DetailSection
                    title={zapier ? 'Your Zaps' : 'Endpoints'}
                    subtitle={zapier
                        ? t('Each Zap gets a meeting’s notes, summary and action items as soon as they are ready.')
                        : t('Each address gets a signed request with the meeting’s notes. Requests go out from this computer while Natively is open.')}
                >
                    <ListCard>
                        {mine.map((e) => <EndpointRow key={e.id} endpoint={e} folders={folders} onChanged={onChanged} />)}
                    </ListCard>
                </DetailSection>
            )}
            {!zapier && (
                <DetailSection title="What is sent" subtitle={t('A JSON body like this, signed with your secret.')}>
                    <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[11.5px] leading-relaxed text-text-primary">{`{
  "type": "note.generated",
  "timestamp": "2026-10-17T15:02:11Z",
  "data": {
    "meeting_id": "…",
    "title": "Weekly sync",
    "date": "2026-10-17T14:00:00Z",
    "attendees": [{ "email": "ana@acme.com", "name": "Ana" }],
    "summary_markdown": "## Decisions\\n…",
    "action_items": [{ "text": "Send the proposal", "owner": "Ana" }]
  }
}`}</pre>
                </DetailSection>
            )}
        </>
    );
};
