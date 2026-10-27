export declare const OVERLAY_IMAGE_NAME: RegExp;

export declare function imageFilesFromDrop<F extends { name?: unknown }>(files: ArrayLike<F> | null | undefined): F[];

export declare function overlayPasteAction<F extends { name?: unknown }>(
  clipboardData:
    | { getData(type: string): string; items?: ArrayLike<{ type: string }> | null; files?: ArrayLike<F> | null }
    | null
    | undefined,
): { kind: 'native' } | { kind: 'image'; files: F[] };
