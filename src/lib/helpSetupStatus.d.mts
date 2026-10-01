export interface SetupStep {
  state: 'done' | 'todo' | 'checking' | 'locked';
  detail: string;
}

export function permissionsStep(
  platform: 'darwin' | 'win32',
  check: { platform?: string; microphone?: string; screen?: string } | null | undefined,
): SetupStep;

export function speechStep(
  platform: 'darwin' | 'win32',
  credentials: Record<string, unknown> | null | undefined,
): SetupStep;

export function modelStep(
  credentials: Record<string, unknown> | null | undefined,
  llm: { provider?: string; modelId?: string } | null | undefined,
): SetupStep;

export function nativelyStep(credentials: Record<string, unknown> | null | undefined): SetupStep;

export function speechProviderLabel(id: string): string | null;

export function contextUnlocked(
  license: { isPremium?: boolean } | null | undefined,
  trial: { hasToken?: boolean; expired?: boolean } | null | undefined,
): boolean | null;

export function modeStep(
  unlocked: boolean | null,
  active: { name?: string; templateType?: string } | null | undefined,
): SetupStep;

export function profileStep(unlocked: boolean | null, profile: { hasProfile?: boolean } | null | undefined): SetupStep;
