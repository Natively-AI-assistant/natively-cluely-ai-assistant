export function isPlansTab(tab: unknown): boolean;
export function plansViewTransition(
  wasInView: boolean,
  now: { open: boolean; tab: unknown; fromSidebar: boolean },
): { from: 'sidebar' | 'link' } | null;
