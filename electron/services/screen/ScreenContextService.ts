// LEGACY OCR PATH — RUNTIME-DISABLED (2026-05-17)
// =====================================================================
// captureScreen, captureCropper, captureScreenFromPath, and runOCR remain
// only so existing tests keep passing and so a future opt-in legacy OCR
// mode could be reintroduced. Natively's default screen-understanding
// pipeline (ScreenUnderstandingService) no longer reads OCR text from this
// service — it routes images through VisionProviderFallbackChain instead.
// Do NOT add new callers to OCR methods on this service.
// =====================================================================
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { ImageHashService } from './ImageHashService';
import { ScreenshotHelper } from '../../ScreenshotHelper';
import { getOcrProviderManager, OcrProviderManager } from './OcrProviderManager';

export interface ScreenContext {
    ocrText: string;
    imagePath: string;
    activeWindowTitle?: string;
    timestamp: number;
    hash: string;  // perceptual hash for dedupe
    confidence?: number; // OCR confidence 0-1
    provider?: string;    // OCR provider used
}

interface CacheEntry {
    context: ScreenContext;
    createdAt: number;
}

// OCR is expensive, so we cache results by image hash
// Use change detection: if screenshot hash unchanged, reuse screen context
export class ScreenContextService {
    private imageHashService: ImageHashService;
    private ocrCache: Map<string, CacheEntry>;
    private screenshotHelper: ScreenshotHelper | null = null;
    private ocrProviderManager: OcrProviderManager | null = null;
    private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

    constructor() {
        this.imageHashService = new ImageHashService();
        this.ocrCache = new Map();
    }

    /**
     * Get the OCR provider manager (lazy initialization).
     */
    private getOcrManager(): OcrProviderManager {
        if (!this.ocrProviderManager) {
            this.ocrProviderManager = getOcrProviderManager();
        }
        return this.ocrProviderManager;
    }

    /**
     * Initialize the screenshot helper (delayed to avoid circular deps)
     */
    private getScreenshotHelper(): ScreenshotHelper {
        if (!this.screenshotHelper) {
            this.screenshotHelper = new ScreenshotHelper();
        }
        return this.screenshotHelper;
    }

    /**
     * Capture a screenshot, run OCR, and return screen context.
     * Convenience method that combines screenshot capture + OCR extraction.
     */
    async captureScreen(): Promise<ScreenContext> {
        const screenshotPath = await this.getScreenshotHelper().takeScreenshot();
        return this.captureScreenFromPath(screenshotPath);
    }

    /**
     * Capture a cropper screenshot, run OCR, and return screen context.
     */
    async captureCropper(captureArea?: Electron.Rectangle): Promise<ScreenContext> {
        const screenshotPath = await this.getScreenshotHelper().takeSelectiveScreenshot(captureArea);
        return this.captureScreenFromPath(screenshotPath);
    }

    /**
     * Process an existing screenshot file and extract OCR context.
     */
    async captureScreenFromPath(screenshotPath: string): Promise<ScreenContext> {
        const timestamp = Date.now();

        // Compute perceptual hash for dedupe
        let hash: string;
        try {
            hash = await this.imageHashService.computeHash(screenshotPath);
        } catch (error) {
            console.warn('[ScreenContextService] Failed to compute perceptual hash, using quick hash:', error);
            hash = await this.imageHashService.quickHash(screenshotPath);
        }

        // Check cache first
        const cached = this.ocrCache.get(hash);
        if (cached && (timestamp - cached.createdAt) < this.CACHE_TTL_MS) {
            console.log('[ScreenContextService] Cache hit for hash:', hash);
            return {
                ...cached.context,
                timestamp // Update timestamp to show when it was last used
            };
        }

        // Run OCR using the provider manager (supports fallback chain)
        let ocrText = '';
        let confidence = 0;
        let provider = 'tesseract';

        try {
            const ocrManager = this.getOcrManager();
            const result = await ocrManager.recognize(screenshotPath, { timeoutMs: 8_000, maxDimension: 1200 });
            ocrText = result.text;
            confidence = result.confidence;
            provider = result.provider;
        } catch (error) {
            console.error('[ScreenContextService] OCR failed:', error);
            // Graceful fallback: return empty OCR text, not an error
            ocrText = '';
            confidence = 0;
        }

        const context: ScreenContext = {
            ocrText,
            imagePath: screenshotPath,
            timestamp,
            hash,
            confidence,
            provider,
        };

        // Cache the result
        this.ocrCache.set(hash, {
            context,
            createdAt: timestamp
        });

        // Cleanup old cache entries
        this.cleanupCache();

        return context;
    }

    /**
     * Run OCR on an image using the provider manager's fallback chain.
     * This method is kept for backward compatibility but delegates to OcrProviderManager.
     */
    async runOCR(imagePath: string): Promise<string> {
        try {
            const ocrManager = this.getOcrManager();
            const result = await ocrManager.recognize(imagePath, { timeoutMs: 8_000, maxDimension: 1200 });
            return result.text;
        } catch (error) {
            console.error('[ScreenContextService] runOCR failed:', error);
            return '';
        }
    }

    /**
     * Cleanup expired cache entries
     */
    private cleanupCache(): void {
        const now = Date.now();
        for (const [hash, entry] of this.ocrCache.entries()) {
            if (now - entry.createdAt > this.CACHE_TTL_MS) {
                this.ocrCache.delete(hash);
            }
        }
    }

    /**
     * Clear the OCR cache
     */
    clearCache(): void {
        this.ocrCache.clear();
    }

    /**
     * Get cache stats for monitoring
     */
    getCacheStats(): { size: number; entries: string[]; provider: string } {
        return {
            size: this.ocrCache.size,
            entries: Array.from(this.ocrCache.keys()),
            provider: this.ocrProviderManager?.getPrimaryProviderType() || 'unknown',
        };
    }
}