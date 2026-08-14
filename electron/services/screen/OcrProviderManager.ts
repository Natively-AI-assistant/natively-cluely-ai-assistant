// electron/services/screen/OcrProviderManager.ts
//
// LEGACY OCR PATH — RUNTIME-DISABLED (2026-05-17)
// =====================================================================
// Natively now uses vision-provider screen understanding by default.
// This manager is retained ONLY so existing tests and any future opt-in
// legacy OCR mode can still reference the OCR provider chain. The default
// screen-understanding pipeline (ScreenUnderstandingService) no longer
// invokes OcrProviderManager.recognize from any runtime code path.
// Do NOT add new callers to this module.
// =====================================================================
//
// Original purpose:
// Manages the OCR provider chain with automatic fallback.
// Provider order: macOS Apple Vision → Windows OCR → RapidOCR → Tesseract.js → unavailable

import {
  OcrProviderAdapter,
  OcrProviderType,
  OcrResult,
  OcrOptions,
  OCR_PROVIDERS,
  TesseractOcrAdapter,
} from './OcrProvider';

export class OcrProviderManager {
  private primaryProvider: OcrProviderAdapter;
  private fallbackChain: OcrProviderAdapter[];
  private readonly DEFAULT_TIMEOUT_MS = 12_000;

  constructor() {
    // Build provider chain in priority order
    this.primaryProvider = this.detectBestAvailableProvider();
    this.fallbackChain = this.buildFallbackChain(this.primaryProvider);

    console.log(`[OcrProviderManager] Primary: ${this.primaryProvider.name}`);
    if (this.fallbackChain.length > 0) {
      console.log(`[OcrProviderManager] Fallback chain: ${this.fallbackChain.map(p => p.name).join(' → ')}`);
    }
  }

  /**
   * Detect the best available OCR provider for the current platform.
   */
  private detectBestAvailableProvider(): OcrProviderAdapter {
    // Priority order: Apple Vision → Windows OCR → RapidOCR → Tesseract
    const providers: OcrProviderAdapter[] = [
      OCR_PROVIDERS.apple_vision,
      OCR_PROVIDERS.windows_ocr,
      OCR_PROVIDERS.rapidocr,
      OCR_PROVIDERS.tesseract,
    ];

    for (const provider of providers) {
      if (provider.isAvailable()) {
        return provider;
      }
    }

    // Tesseract is always available as ultimate fallback
    return OCR_PROVIDERS.tesseract;
  }

  /**
   * Build fallback chain excluding the primary provider.
   */
  private buildFallbackChain(primary: OcrProviderAdapter): OcrProviderAdapter[] {
    const allProviders: OcrProviderAdapter[] = [
      OCR_PROVIDERS.apple_vision,
      OCR_PROVIDERS.windows_ocr,
      OCR_PROVIDERS.rapidocr,
      OCR_PROVIDERS.tesseract,
    ];

    return allProviders.filter(p => p.type !== primary.type && p.isAvailable());
  }

  /**
   * Get the current primary provider type.
   */
  getPrimaryProviderType(): OcrProviderType {
    return this.primaryProvider.type;
  }

  /**
   * Get all available provider types.
   */
  getAvailableProviders(): OcrProviderType[] {
    const available: OcrProviderType[] = [];
    for (const provider of Object.values(OCR_PROVIDERS)) {
      if (provider.isAvailable() && provider.type !== 'unavailable') {
        available.push(provider.type);
      }
    }
    return available;
  }

  /**
   * Perform OCR with automatic fallback.
   *
   * @param imagePath - Path to the image file
   * @param options - Optional OCR configuration
   * @returns OcrResult from the best available provider
   */
  async recognize(imagePath: string, options?: OcrOptions): Promise<OcrResult> {
    const timeoutMs = options?.timeoutMs || this.DEFAULT_TIMEOUT_MS;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`OCR timeout after ${timeoutMs}ms`)), timeoutMs)
    );

    // Try primary provider first
    try {
      const result = await Promise.race([
        this.primaryProvider.recognize(imagePath, options),
        timeoutPromise,
      ]);
      console.log(`[OcrProviderManager] OCR succeeded with ${this.primaryProvider.name}`);
      return result;
    } catch (primaryError: any) {
      console.warn(`[OcrProviderManager] Primary provider ${this.primaryProvider.name} failed: ${primaryError?.message}`);
    }

    // Fall back through chain
    for (const provider of this.fallbackChain) {
      try {
        const result = await Promise.race([
          provider.recognize(imagePath, options),
          timeoutPromise,
        ]);
        console.log(`[OcrProviderManager] OCR succeeded with fallback ${provider.name}`);
        return result;
      } catch (fallbackError: any) {
        console.warn(`[OcrProviderManager] Fallback provider ${provider.name} failed: ${fallbackError?.message}`);
      }
    }

    // All providers failed
    throw new Error('All OCR providers failed');
  }

  /**
   * Perform OCR on an image buffer with automatic fallback.
   */
  async recognizeBuffer(buffer: Buffer, options?: OcrOptions): Promise<OcrResult> {
    const timeoutMs = options?.timeoutMs || this.DEFAULT_TIMEOUT_MS;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`OCR timeout after ${timeoutMs}ms`)), timeoutMs)
    );

    // Try primary provider first
    try {
      const result = await Promise.race([
        this.primaryProvider.recognizeBuffer(buffer, options),
        timeoutPromise,
      ]);
      return result;
    } catch (primaryError: any) {
      console.warn(`[OcrProviderManager] Primary provider ${this.primaryProvider.name} failed on buffer: ${primaryError?.message}`);
    }

    // Fall back through chain
    for (const provider of this.fallbackChain) {
      try {
        const result = await Promise.race([
          provider.recognizeBuffer(buffer, options),
          timeoutPromise,
        ]);
        console.log(`[OcrProviderManager] OCR buffer succeeded with fallback ${provider.name}`);
        return result;
      } catch (fallbackError: any) {
        console.warn(`[OcrProviderManager] Fallback provider ${provider.name} failed on buffer: ${fallbackError?.message}`);
      }
    }

    throw new Error('All OCR providers failed on buffer');
  }
}

// Export singleton
let instance: OcrProviderManager | null = null;

export function getOcrProviderManager(): OcrProviderManager {
  if (!instance) {
    instance = new OcrProviderManager();
  }
  return instance;
}