export type StackPhase = 'enter' | 'rest' | 'leaving';

export interface StackEntry<T> {
    key: string;
    item: T;
    depth: number;
    phase: StackPhase;
}

export function reconcileStack<T>(
    prev: StackEntry<T>[],
    target: { key: string; item: T }[],
    alreadyArrived?: (key: string) => boolean,
): StackEntry<T>[];

export function settleEntering<T>(entries: StackEntry<T>[]): StackEntry<T>[];

export function dropLeft<T>(entries: StackEntry<T>[], keys: string[]): StackEntry<T>[];

export function arrivalSteps<T>(target: T[]): T[][];

export const SLOT_PREFIX: 'slot:';

export function padStack<T>(target: { key: string; item: T }[], size?: number): { key: string; item: T | null }[];

export function isSlotKey(key: string): boolean;
