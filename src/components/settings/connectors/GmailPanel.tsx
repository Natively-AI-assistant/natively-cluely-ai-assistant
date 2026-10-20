// Gmail: sign in with Google so meeting briefs can mention recent email threads
// with the people you are meeting, and follow-ups can be sent from your own
// Gmail. Tokens stay on this computer; Natively calls Google directly.
//
// Laid out as Granola's Gmail page in Settings' own parts: the account row
// under the header, what connecting includes, then how Gmail is used.
// Granola's copy promises a server that drafts and sends; these lines say what
// Natively does instead.

import React, { useState } from 'react';
import { AlertCircle, ExternalLink, FileText, Lock, Mail, Send } from 'lucide-react';
import { useT } from '../../../i18n';
import { SettingsNotice, SettingsSwitch, useSettingsTones } from '../SettingsRow';
import type { ConnectorsApi, GmailStatus } from '../../../types/connectors';
import { FlashNotice, flashOf, type Flash } from './common';
import { ActionArea, ConnectPill, DisconnectButton, FeatureCard, GlassPill, PlainSection, UsageList } from './parts';

const capi = (): ConnectorsApi | undefined => window.electronAPI?.connectors;

const USAGE = [
    { icon: <Mail size={11} />, text: 'Natively reads only your threads with the people in your meetings, to write their briefs.' },
    { icon: <Send size={11} />, text: 'Nothing is sent until you press Send with Gmail and confirm.' },
    { icon: <Lock size={11} />, text: 'Your Google sign-in stays on this computer. Natively talks to Google directly, never through our servers.' },
    { icon: <ExternalLink size={11} />, text: 'Pressing Connect opens Google in your browser to confirm permissions.' },
];

export const GmailPanel: React.FC<{ status: GmailStatus | null; onStatus: (s: GmailStatus) => void; onChanged: () => void }> = ({ status, onStatus, onChanged }) => {
    const t = useT();
    const tones = useSettingsTones();
    const [waiting, setWaiting] = useState(false);
    const [flash, setFlash] = useState<Flash>(null);

    const connect = async () => {
        setWaiting(true);
        setFlash(null);
        const res = await capi()?.connectGmail().catch(() => undefined);
        setWaiting(false);
        if (res && !res.ok && !res.message) return; // cancelled
        setFlash(flashOf(res, t('Gmail is connected.')));
        onChanged();
    };
    const disconnect = async () => {
        const res = await capi()?.disconnectGmail().catch(() => undefined);
        setFlash(res?.ok ? null : flashOf(res));
        onChanged();
    };

    if (!status) return null;
    const available = status.available;
    const state = status.connected ? 'on' : waiting ? 'busy' : 'off';
    const title = status.connected
        ? (status.account || t('your Google account'))
        : waiting ? t('Waiting for Google…') : t('Not connected');
    const detail = status.connected
        ? t('Connected. Natively talks to Google directly.')
        : waiting ? t('Finish signing in to Google in your browser.') : t('Sign in with Google in your browser.');

    return (
        <>
            {!available && (
                <SettingsNotice tone={tones.warn} icon={<AlertCircle size={14} />}>
                    {t('Gmail is not available in this version of Natively yet.')}
                </SettingsNotice>
            )}

            <ActionArea
                state={state}
                title={title}
                titleKey={state}
                detail={detail}
                secondary={waiting ? (
                    <GlassPill onClick={() => void capi()?.cancelGmailConnect()}>{t('Cancel')}</GlassPill>
                ) : undefined}
                flash={<FlashNotice flash={flash} />}
            >
                {status.connected ? (
                    <DisconnectButton confirmLabel={t('Disconnect Gmail?')} onDisconnect={() => void disconnect()} />
                ) : (
                    <ConnectPill label={t('Connect Gmail')} external waiting={waiting} disabled={!available} onClick={() => void connect()} />
                )}
            </ActionArea>

            <PlainSection title="Includes">
                <div className="space-y-4">
                    <FeatureCard
                        icon={<Send size={11} />}
                        title="Follow-up emails"
                        description="Send a meeting's follow-up email from your own Gmail, once you have read it over."
                    />
                    <FeatureCard
                        icon={<FileText size={11} />}
                        title="Meeting briefs"
                        description="Before a meeting, its brief can mention your recent threads with the people you are meeting."
                        control={status.connected ? (
                            <SettingsSwitch
                                checked={status.briefsEnabled}
                                label={t('Use email in meeting briefs')}
                                onChange={() => void capi()?.setGmailBriefsEnabled(!status.briefsEnabled).then((s) => s && onStatus(s))}
                            />
                        ) : undefined}
                    />
                </div>
            </PlainSection>

            <UsageList title="How Gmail is used" rows={USAGE} />
        </>
    );
};
