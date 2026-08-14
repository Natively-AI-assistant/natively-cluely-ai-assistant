// electron/services/screen/OcrProvider.ts
//
// LEGACY OCR PATH — RUNTIME-DISABLED (2026-05-17)
// =====================================================================
// Natively now uses vision-provider screen understanding by default.
// This module is retained for two reasons:
//   1. Existing tests still verify the OCR interface contract.
//   2. A future explicit OCR-only mode could be reintroduced by toggling
//      the runtime gate in ScreenUnderstandingService.
// Do NOT call this module from any new runtime path. The default screen
// flow must route through VisionProviderFallbackChain.
// =====================================================================
//
// Original purpose:
// Unified OCR provider interface for Natively.
// Supports: macOS Apple Vision, Windows OCR, RapidOCR, Tesseract.js

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';

export interface OcrLine {
  text: string;
  confidence?: number;
  bbox?: number[]; // [x, y, width, height]
}

export interface OcrResult {
  text: string;
  lines: OcrLine[];
  confidence: number; // 0.0 - 1.0
  provider: string;
  durationMs: number;
}

export type OcrProviderType =
  | 'apple_vision'  // macOS native Vision OCR
  | 'windows_ocr'   // Windows native OCR
  | 'rapidocr'      // RapidOCR (ONNX-based)
  | 'tesseract'     // Tesseract.js (fallback)
  | 'unavailable';  // Provider not available

export interface OcrProviderAdapter {
  /**
   * The provider type identifier.
   */
  readonly type: OcrProviderType;

  /**
   * Human-readable provider name.
   */
  readonly name: string;

  /**
   * Whether this provider is available on the current platform.
   */
  isAvailable(): boolean;

  /**
   * Perform OCR on an image file.
   *
   * @param imagePath - Path to the image file
   * @param options - Optional OCR configuration
   * @returns OcrResult with extracted text and metadata
   */
  recognize(imagePath: string, options?: OcrOptions): Promise<OcrResult>;

  /**
   * Perform OCR on an image buffer.
   *
   * @param buffer - Image data as Buffer
   * @param options - Optional OCR configuration
   * @returns OcrResult with extracted text and metadata
   */
  recognizeBuffer(buffer: Buffer, options?: OcrOptions): Promise<OcrResult>;
}

export interface OcrOptions {
  /**
   * Languages to use for OCR (ISO 639-3 codes like 'eng', 'fra', etc.)
   * @default ['eng']
   */
  languages?: string[];

  /**
   * Minimum confidence threshold (0.0 - 1.0)
   * @default 0.0
   */
  confidenceThreshold?: number;

  /**
   * Timeout for OCR operation in milliseconds
   * @default 30000
   */
  timeoutMs?: number;

  /**
   * Resize large screenshots before OCR to avoid Tesseract stalls.
   * @default 1600
   */
  maxDimension?: number;
}

const requireFromBundle = createRequire(__filename);

function getTesseractAssetPaths(): { workerPath: string; corePath: string } {
  const workerPath = requireFromBundle.resolve('tesseract.js/src/worker-script/node/index.js');
  const corePath = path.dirname(requireFromBundle.resolve('tesseract.js-core'));
  return { workerPath, corePath };
}

async function prepareImageForOcr(imagePath: string, maxDimension = 1600): Promise<{ path: string; cleanup?: () => Promise<void> }> {
  const metadata = await sharp(imagePath).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  if (width <= maxDimension && height <= maxDimension) {
    return { path: imagePath };
  }

  const tempPath = path.join(os.tmpdir(), `natively-ocr-${uuidv4()}.png`);
  await sharp(imagePath)
    .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
    .grayscale()
    .normalize()
    .png({ compressionLevel: 6 })
    .toFile(tempPath);

  return {
    path: tempPath,
    cleanup: async () => {
      try {
        await fs.promises.unlink(tempPath);
      } catch {
        // Best-effort cleanup
      }
    },
  };
}

// Tesseract OCR adapter — primary fallback
export class TesseractOcrAdapter implements OcrProviderAdapter {
  readonly type: OcrProviderType = 'tesseract';
  readonly name = 'Tesseract.js';

  isAvailable(): boolean {
    // Tesseract.js is always available via npm
    return true;
  }

  async recognize(imagePath: string, options?: OcrOptions): Promise<OcrResult> {
    const startTime = Date.now();
    const prepared = await prepareImageForOcr(imagePath, options?.maxDimension);

    try {
      const Tesseract = await import('tesseract.js');
      const assetPaths = getTesseractAssetPaths();

      const result = await Tesseract.recognize(
        prepared.path,
        options?.languages?.[0] || 'eng',
        {
          ...assetPaths,
          logger: (m: any) => {
            if (process.env.NATIVELY_OCR_DEBUG === '1' && m.status === 'recognizing text') {
              console.log(`[TesseractOCR] progress: ${Math.round(m.progress * 100)}%`);
            }
          },
        }
      );

      const durationMs = Date.now() - startTime;

      return {
        text: result.data.text.trim(),
        lines: result.data.lines?.map((line: any) => ({
          text: line.text,
          confidence: line.confidence,
          bbox: line.bbox,
        })) || [],
        confidence: result.data.confidence / 100, // Tesseract returns 0-100
        provider: this.name,
        durationMs,
      };
    } catch (error: any) {
      console.error('[TesseractOCR] recognition failed:', error?.message || error);
      throw new Error(`Tesseract OCR failed: ${error?.message || 'unknown error'}`);
    } finally {
      await prepared.cleanup?.();
    }
  }

  async recognizeBuffer(buffer: Buffer, options?: OcrOptions): Promise<OcrResult> {
    const tempPath = path.join(os.tmpdir(), `ocr-${uuidv4()}.png`);
    await fs.promises.writeFile(tempPath, buffer);

    try {
      return await this.recognize(tempPath, options);
    } finally {
      try {
        await fs.promises.unlink(tempPath);
      } catch {
        // Best-effort cleanup
      }
    }
  }
}

// Apple Vision OCR adapter — macOS native
// TODO: Implement when native macOS OCR bridge is available
export class AppleVisionOcrAdapter implements OcrProviderAdapter {
  readonly type: OcrProviderType = 'apple_vision';
  readonly name = 'Apple Vision OCR';

  isAvailable(): boolean {
    // Only available on macOS
    if (process.platform !== 'darwin') {
      return false;
    }
    // TODO: Check for Vision framework availability
    return false; // Stub until native bridge is implemented
  }

  async recognize(imagePath: string, options?: OcrOptions): Promise<OcrResult> {
    throw new Error('Apple Vision OCR not yet implemented. Use Tesseract.js fallback.');
  }

  async recognizeBuffer(buffer: Buffer, options?: OcrOptions): Promise<OcrResult> {
    throw new Error('Apple Vision OCR not yet implemented. Use Tesseract.js fallback.');
  }
}

// Windows OCR adapter — Windows native
// TODO: Implement when native Windows OCR bridge is available
export class WindowsOcrAdapter implements OcrProviderAdapter {
  readonly type: OcrProviderType = 'windows_ocr';
  readonly name = 'Windows OCR';

  isAvailable(): boolean {
    // Only available on Windows
    if (process.platform !== 'win32') {
      return false;
    }
    // TODO: Check for Windows OCR availability
    return false; // Stub until native bridge is implemented
  }

  async recognize(imagePath: string, options?: OcrOptions): Promise<OcrResult> {
    throw new Error('Windows OCR not yet implemented. Use Tesseract.js fallback.');
  }

  async recognizeBuffer(buffer: Buffer, options?: OcrOptions): Promise<OcrResult> {
    throw new Error('Windows OCR not yet implemented. Use Tesseract.js fallback.');
  }
}

// RapidOCR adapter
// TODO: Implement when RapidOCR sidecar is configured
export class RapidOcrAdapter implements OcrProviderAdapter {
  readonly type: OcrProviderType = 'rapidocr';
  readonly name = 'RapidOCR';

  isAvailable(): boolean {
    // TODO: Check for RapidOCR sidecar process
    return false; // Stub until RapidOCR sidecar is implemented
  }

  async recognize(imagePath: string, options?: OcrOptions): Promise<OcrResult> {
    throw new Error('RapidOCR not yet configured. Use Tesseract.js fallback.');
  }

  async recognizeBuffer(buffer: Buffer, options?: OcrOptions): Promise<OcrResult> {
    throw new Error('RapidOCR not yet configured. Use Tesseract.js fallback.');
  }
}

// Provider registry for easy lookup
export const OCR_PROVIDERS: Record<OcrProviderType, OcrProviderAdapter> = {
  apple_vision: new AppleVisionOcrAdapter(),
  windows_ocr: new WindowsOcrAdapter(),
  rapidocr: new RapidOcrAdapter(),
  tesseract: new TesseractOcrAdapter(),
  unavailable: {
    type: 'unavailable',
    name: 'Unavailable',
    isAvailable: () => false,
    recognize: async () => { throw new Error('No OCR provider available'); },
    recognizeBuffer: async () => { throw new Error('No OCR provider available'); },
  },
};