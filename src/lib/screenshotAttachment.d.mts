export interface ScreenshotAttachment {
  path: string;
  preview?: string;
}

export interface ScreenCaptureEvidenceRef {
  source?: string;
}

export interface ScreenCaptureAction {
  type?: string;
  requiresScreen?: boolean;
  evidenceRefs?: ScreenCaptureEvidenceRef[];
}

export declare const MAX_SCREENSHOT_ATTACHMENTS: 5;

export declare function appendScreenshotAttachment<T extends ScreenshotAttachment>(
  existing: T[],
  screenshot: T | null | undefined,
  max?: number,
): T[];

export declare function mergePendingScreenshotAttachment<T extends ScreenshotAttachment>(
  existing: T[],
  pending: T | null | undefined,
  max?: number,
): T[];

export declare function actionNeedsScreenCapture(action: ScreenCaptureAction | null | undefined): boolean;
