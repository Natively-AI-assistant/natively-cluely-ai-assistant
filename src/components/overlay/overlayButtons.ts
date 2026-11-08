// The meeting overlay's buttons as drawn: glyph and English label (pass it
// through t()). NativelyInterface draws them from this, and so does
// Settings › Overlay (its preview and tray), so the two can't drift. Speak
// (Answer until 2026-10-30) reads Stop while recording; the overlay swaps
// that itself.
//
// The user's own buttons (overlayCustomButtons.ts) are drawn with one glyph
// and their name as typed (never through t()): overlayButtonFace covers both.
import { BookOpen, HelpCircle, History, Lightbulb, MessageSquare, Mic, Pencil, Quote, RefreshCw, Pin, type LucideIcon } from 'lucide-react';
import { isBuiltinOverlayButtonId, type BuiltinOverlayButtonId, type OverlayButtonId } from '../../lib/overlayButtonOrder';
import type { OverlayCustomButton } from '../../lib/overlayCustomButtons';

export const OVERLAY_BUTTONS: Record<BuiltinOverlayButtonId, { Icon: LucideIcon; label: string }> = {
    what_to_answer: { Icon: Pencil, label: 'What to answer?' },
    clarify: { Icon: MessageSquare, label: 'Clarify' },
    recap: { Icon: RefreshCw, label: 'Recap' },
    follow_up: { Icon: HelpCircle, label: 'Follow Up Question' },
    answer: { Icon: Mic, label: 'Speak' },
    brainstorm: { Icon: Lightbulb, label: 'Brainstorm' },
    catch_me_up: { Icon: History, label: 'What did I miss?' },
    define: { Icon: BookOpen, label: 'Define' },
    sound_smart: { Icon: Quote, label: 'Sound smart' },
};

/** The glyph every custom button wears: a pin, the button the user pinned to the overlay. */
export const OVERLAY_CUSTOM_BUTTON_ICON: LucideIcon = Pin;

/**
 * Any button's glyph and the words to show: a built-in label translated by
 * `t`, a custom name as the user typed it. A custom id no longer in
 * `customs` (deleted in another window a moment ago) reads as an empty label.
 */
export function overlayButtonFace(
    id: OverlayButtonId,
    t: (s: string) => string,
    customs: readonly OverlayCustomButton[],
): { Icon: LucideIcon; label: string } {
    if (isBuiltinOverlayButtonId(id)) {
        const { Icon, label } = OVERLAY_BUTTONS[id];
        return { Icon, label: t(label) };
    }
    return { Icon: OVERLAY_CUSTOM_BUTTON_ICON, label: customs.find((b) => b.id === id)?.name ?? '' };
}
