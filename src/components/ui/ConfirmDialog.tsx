// src/components/ui/ConfirmDialog.tsx
//
// In-app replacement for `window.confirm()`.
//
// Native `confirm()` must not be used anywhere in this app. On Windows,
// Electron's native modal leaves Chromium's input-focus and pointer-event
// subsystem wedged after it closes: text inputs stop accepting keystrokes and
// buttons stop responding to clicks until the window loses and regains focus
// (alt-tab away and back). It also blocks the renderer's event loop while open,
// which stalls IPC the overlay depends on.
//
// This renders in a Radix portal inside the existing window instead, so nothing
// blocks and focus is never handed to an OS-level dialog.
//
// Its dim and panel sit above the popup cards (GenieModal, z-index 300), not
// at the shared dialog's z-50: a confirm asked from inside Settings otherwise
// opened BEHIND it, invisible, while its modal dim swallowed every click, so
// Settings looked frozen.

import React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useT } from '../../i18n';

/** Above GenieModal's default layer (300), where Settings and the managers sit. */
const CONFIRM_LAYER = 400;

interface ConfirmDialogProps {
    open: boolean;
    /** Called with `false` on cancel/dismiss; the parent owns the open state. */
    onOpenChange: (open: boolean) => void;
    title: string;
    /** Optional second line explaining what is lost. Keep it concrete. */
    description?: string;
    /** Defaults to "Remove" — name the action, not "OK". */
    confirmLabel?: string;
    cancelLabel?: string;
    /** Styles the confirm button as destructive. Default true, since that is
     *  what every current caller is doing. */
    destructive?: boolean;
    /** Set while an async confirm is in flight; disables both buttons. */
    busy?: boolean;
    onConfirm: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    open,
    onOpenChange,
    title,
    description,
    confirmLabel,
    cancelLabel,
    destructive = true,
    busy = false,
    onConfirm,
}) => {
    const t = useT();

    return (
        <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 bg-black bg-opacity-50" style={{ zIndex: CONFIRM_LAYER }} />
            <DialogPrimitive.Content
                className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] max-w-[92vw] bg-bg-elevated border border-border-subtle rounded-2xl shadow-2xl p-5"
                style={{ zIndex: CONFIRM_LAYER }}
            >
                <div className="flex items-start gap-3">
                    <div
                        className={`mt-0.5 shrink-0 ${destructive ? 'text-red-500' : 'text-text-tertiary'}`}
                        aria-hidden="true"
                    >
                        <AlertTriangle size={16} strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-sm font-medium text-text-primary">{title}</h3>
                        {description && (
                            <p className="text-xs text-text-secondary mt-1 leading-relaxed">{description}</p>
                        )}
                    </div>
                </div>

                <div className="flex items-center justify-end gap-2 mt-5">
                    <button
                        type="button"
                        onClick={() => onOpenChange(false)}
                        disabled={busy}
                        className="px-3 py-1.5 rounded-md text-xs font-medium border border-border-subtle bg-bg-input hover:bg-bg-elevated text-text-primary transition-colors disabled:opacity-50"
                    >
                        {cancelLabel || t('Cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={busy}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors flex items-center gap-1.5 disabled:opacity-50 ${
                            destructive
                                ? 'bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20'
                                : 'bg-bg-input hover:bg-bg-elevated text-text-primary border-border-subtle'
                        }`}
                    >
                        {busy && <Loader2 size={12} className="animate-spin" />}
                        {confirmLabel || t('Remove')}
                    </button>
                </div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
};

export default ConfirmDialog;
