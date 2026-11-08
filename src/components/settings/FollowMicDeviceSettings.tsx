// Settings › Audio: "Use the meeting app's microphone". Off by default. When
// on, and you have not pinned a microphone of your own, Natively captures from
// the same input device the call app (Zoom, Teams, a browser in a call) is
// using, so the headset you picked there is the one Natively records. Takes
// effect at the next meeting. macOS 14+ only: the OS names the app's device
// there; elsewhere the row stays available but does nothing.
import React, { useEffect, useState } from 'react';
import { Headphones } from 'lucide-react';
import { useT } from '../../i18n';
import { SettingsRow, SettingsSwitch } from './SettingsRow';

export const FollowMicDeviceSettings: React.FC = () => {
    const t = useT();
    const [enabled, setEnabled] = useState(false);

    useEffect(() => {
        let live = true;
        void window.electronAPI?.followMicDeviceGet?.().then((r) => { if (live && r) setEnabled(!!r.enabled); }).catch(() => {});
        return () => { live = false; };
    }, []);

    const toggle = async () => {
        const next = !enabled;
        setEnabled(next);
        const res = await window.electronAPI?.followMicDeviceSet?.(next).catch(() => undefined);
        if (!res?.success) setEnabled(!next);
    };

    return (
        <SettingsRow
            icon={<Headphones size={20} />}
            title={t("Use the meeting app's microphone")}
            description={enabled
                ? t('On from your next meeting. When you have not chosen a microphone yourself, Natively records from the one the call app is using.')
                : t('Off. Natively records from your chosen microphone, or the system default.')}
            descriptionKey={enabled ? 'on' : 'off'}
            control={<SettingsSwitch checked={enabled} onChange={() => void toggle()} label={t("Use the meeting app's microphone")} />}
        />
    );
};
