export interface LaunchSession {
  /** Full-window cards shown this launch, in order (orchestrated cards and 'update'). */
  shown: string[];
  /** Cards the user closed this launch. */
  dismissed: string[];
  /** This launch began with the first-run Welcome. */
  welcome: boolean;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'> | null | undefined;

export declare const LAUNCH_SESSION_KEY: 'natively_orchestrator_launch_v1';
export function emptyLaunchSession(): LaunchSession;
export function loadLaunchSession(storage: StorageLike): LaunchSession;
export function saveLaunchSession(storage: StorageLike, session: LaunchSession): void;
export function launchCapAllows(session: LaunchSession, id: string): boolean;
