export const PLANS_SECTIONS: readonly ['api_plans', 'packs', 'pro', 'bottom'];
export type PlansSection = (typeof PLANS_SECTIONS)[number];
export const PLANS_VISIT_SECONDS_MAX: number;
export const PLAN_CARDS: readonly ['standard', 'pro', 'max', 'ultra'];
export function isCheckoutUrl(url: string): boolean;

export type PlansVisitProps = {
  from: 'sidebar' | 'link';
  seconds: number;
  saw_api_plans: boolean;
  saw_packs: boolean;
  saw_pro: boolean;
  saw_bottom: boolean;
  plan_cards: number;
  saw_max_ultra: boolean;
  rail_scrolled: boolean;
  cycle_switched: boolean;
  checkouts: number;
  refund_opened: boolean;
  cycle?: 'monthly' | 'yearly';
};

export interface PlansVisitTracker {
  start(from: 'sidebar' | 'link', opts?: { visible?: boolean }): void;
  readonly active: boolean;
  onStart(fn: () => void): () => void;
  seen(section: string): void;
  card(id: string): void;
  railScrolled(): void;
  cycle(value: string): void;
  cycleSwitched(value: string): void;
  opened(url: string): void;
  refundOpened(): void;
  visibility(visible: boolean): void;
  end(): PlansVisitProps | null;
}

export function createPlansVisitTracker(deps?: {
  now?: () => number;
  send?: (props: PlansVisitProps) => void;
}): PlansVisitTracker;

export const plansVisit: PlansVisitTracker;
