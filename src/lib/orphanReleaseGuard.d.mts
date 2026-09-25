export function createOrphanReleaseGuard(): {
  press(): void;
  cancel(): void;
  release(button: number): boolean;
};
