// The meeting overlay's buttons as drawn: glyph and English label (pass it
// through t()). NativelyInterface draws them from this, and so does
// Settings › Overlay (its preview and tray), so the two can't drift. Speak
// (Answer until 2026-10-30) reads Stop while recording; the overlay swaps
// that itself.
import { BookOpen, HelpCircle, History, Lightbulb, MessageSquare, Mic, Pencil, Quote, RefreshCw, type LucideIcon } from 'lucide-react';
import type { OverlayButtonId } from '../../lib/overlayButtonOrder';

export const OVERLAY_BUTTONS: Record<OverlayButtonId, { Icon: LucideIcon; label: string }> = {
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
