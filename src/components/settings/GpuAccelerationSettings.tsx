// Settings › General: "Turn off GPU acceleration". Off by default. When on,
// Chromium draws without the graphics card from the NEXT launch — the remedy
// when a patched or legacy GPU (OpenCore Legacy Patcher on macOS 12, old
// Intel/NVIDIA drivers, some Windows RDP setups) leaves Natively's window
// blank or white, or the overlay never appears. "Restart now" applies it
// immediately through the existing restart-app IPC.
import React, { useEffect, useState } from 'react';
import { MonitorOff } from 'lucide-react';
import { useT } from '../../i18n';
import { SettingsRow, SettingsSwitch, SETTINGS_BTN } from './SettingsRow';

export const GpuAccelerationSettings: React.FC = () => {
    const t = useT();
    const [disabled, setDisabled] = useState(false);

    useEffect(() => {
        let live = true;
        void window.electronAPI?.gpuAccelerationGet?.().then((r) => { if (live && r) setDisabled(!!r.disabled); }).catch(() => {});
        return () => { live = false; };
    }, []);

    const toggle = async () => {
        const next = !disabled;
        setDisabled(next);
        const res = await window.electronAPI?.gpuAccelerationSet?.(next).catch(() => undefined);
        if (!res?.success) setDisabled(!next);
    };

    return (
        <div>
            <SettingsRow
                icon={<MonitorOff size={20} />}
                title={t('Turn off GPU acceleration')}
                description={disabled
                    ? t("Off from the next launch. Use this if Natively's window is blank or white, or the overlay doesn't appear (older or patched graphics drivers).")
                    : t('On. Natively uses the graphics card to draw its windows.')}
                descriptionKey={disabled ? 'on' : 'off'}
                control={<SettingsSwitch checked={disabled} onChange={() => void toggle()} label={t('Turn off GPU acceleration')} />}
            />
            <div className="flex justify-end mt-2">
                <button
                    type="button"
                    className={SETTINGS_BTN}
                    onClick={() => void window.electronAPI.restartApp()}
                >
                    {t('Restart now')}
                </button>
            </div>
        </div>
    );
};
