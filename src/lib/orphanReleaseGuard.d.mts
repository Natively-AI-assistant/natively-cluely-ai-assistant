export function createOrphanReleaseGuard(): {
  press(): void;
  cancel(): void;
  release(button: number): boolean;
};

export function installOrphanReleaseClick(win: Pick<Window, 'addEventListener' | 'removeEventListener'>): () => void;
