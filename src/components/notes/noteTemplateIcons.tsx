import {
    BadgeCheck, Briefcase, Building2, CalendarDays, ClipboardList, Coffee, Compass, DoorOpen, FileText, Filter, Flag,
    HeartHandshake, Landmark, Lightbulb, ListChecks, Megaphone, Mic, MonitorPlay, Network, Presentation,
    RefreshCw, Scale, SquareKanban, Sunrise, Target, TrendingUp, UserPlus, Users, Wallet, Wrench,
    type LucideIcon,
} from 'lucide-react';

/**
 * Each note template's icon (2026-10-21), in place of one grey page for all
 * 29: a line glyph that says what the meeting is, drawn on the gallery's own
 * neutral tile in its secondary ink. No colours per group and no lit tiles:
 * those read as cheap next to the notepad (Evin, 2026-10-21).
 */
const GLYPH: Record<string, LucideIcon> = {
    'one-to-one': Users,
    'customer-discovery': Compass,
    hiring: UserPlus,
    'stand-up': Sunrise,
    'weekly-team-meeting': CalendarDays,
    'account-management': Building2,
    'customer-existing': HeartHandshake,
    'pipeline-review': Filter,
    advisory: Scale,
    'board-meeting': Presentation,
    'investor-current': Landmark,
    'investor-prospective': TrendingUp,
    networking: Network,
    'customer-onboarding': DoorOpen,
    'product-demo': MonitorPlay,
    'requirements-gathering': ListChecks,
    troubleshooting: Wrench,
    'user-interview': Mic,
    'hiring-advanced': BadgeCheck,
    'all-hands': Megaphone,
    brainstorm: Lightbulb,
    'project-kick-off': Flag,
    'project-sync': RefreshCw,
    'sprint-planning': SquareKanban,
    'catch-up-investor': Coffee,
    'catch-up-portfolio': Briefcase,
    'lp-prospective': Wallet,
    'vc-board-meeting': ClipboardList,
    'vc-pitch': Target,
};

/** The template's glyph; a page for one without its own. */
export function noteTemplateGlyph(id: string): LucideIcon {
    return GLYPH[id] ?? FileText;
}
