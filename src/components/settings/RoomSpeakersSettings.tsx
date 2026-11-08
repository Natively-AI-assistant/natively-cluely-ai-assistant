// Settings › Audio: "People sharing your microphone". Off by default. When on,
// the microphone channel is transcribed with the provider's own voice labels
// (electron/audio/sttDiarization.ts) and, when the meeting is saved, the voice
// with the most words stays "Me" while each other real voice becomes its own
// speaker in the transcript and notes (services/meeting/roomSpeakers.ts).
// Takes effect from the next meeting. Built from the same row and switch as
// the other Audio rows.
import React, { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { useT } from '../../i18n';
import { SettingsRow, SettingsSwitch } from './SettingsRow';
import { ROOM_SPEAKERS_PROVIDERS } from './roomSpeakersProviders';


export const RoomSpeakersSettings: React.FC<{ sttProvider: string }> = ({ sttProvider }) => {
    const t = useT();
    const [enabled, setEnabled] = useState(false);
    const supported = ROOM_SPEAKERS_PROVIDERS.has(sttProvider);

    useEffect(() => {
        let live = true;
        void window.electronAPI?.roomSpeakersGet?.().then((r) => { if (live && r) setEnabled(!!r.enabled); }).catch(() => {});
        return () => { live = false; };
    }, []);

    const toggle = async () => {
        const next = !enabled;
        setEnabled(next);
        const res = await window.electronAPI?.roomSpeakersSet?.(next).catch(() => undefined);
        if (!res?.success) setEnabled(!next);
    };

    const description = !supported
        ? t('Works with Natively, Deepgram or Soniox transcription. Your current provider does not tell voices apart.')
        : enabled
            ? t('On from your next meeting. Voices on your microphone are told apart when the meeting is saved; the one that speaks most is you.')
            : t('Off. Everything heard on your microphone is written down as you.');

    return (
        <SettingsRow
            icon={<Users size={20} />}
            title={t('People sharing your microphone')}
            description={description}
            descriptionKey={!supported ? 'unsupported' : enabled ? 'on' : 'off'}
            control={<SettingsSwitch checked={enabled && supported} onChange={() => { if (supported) void toggle(); }} label={t('People sharing your microphone')} disabled={!supported} />}
        />
    );
};
