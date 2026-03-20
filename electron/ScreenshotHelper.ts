// ScreenshotHelper.ts

import path from "node:path"
import fs from "node:fs"
import { app, desktopCapturer, screen } from "electron"
import { v4 as uuidv4 } from "uuid"
import util from "util"
import sharp from "sharp"

function normalizeDesktopCaptureError(error: unknown): Error {
  if ((error as NodeJS.ErrnoException)?.name === 'NotAllowedError') {
    return new Error(
      'Screen capture permission denied. Please grant screen recording permission in System Settings > Privacy & Security > Screen Recording.'
    );
  }

  if ((error as NodeJS.ErrnoException)?.name === 'NotFoundError') {
    return new Error('No screen sources available. Please ensure at least one display is connected.');
  }

  return new Error(`Failed to capture screen: ${error instanceof Error ? error.message : String(error)}`);
}

/**
 * Finds the display that best contains the given rectangle.
 * Used to determine which monitor to capture for a selection area.
 * Falls back to primary display if no match is found.
 */
function getDisplayContainingRect(rect: Electron.Rectangle): Electron.Display {
  const displays = screen.getAllDisplays();
  
  // Find display that contains the center point
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  
  for (const display of displays) {
    const { x: dx, y: dy, width, height } = display.bounds;
    if (centerX >= dx && centerX < dx + width && centerY >= dy && centerY < dy + height) {
      return display;
    }
  }
  
  // Check if any part of the rect is on this display
  for (const display of displays) {
    const { x: dx, y: dy, width, height } = display.bounds;
    const displayRight = dx + width;
    const displayBottom = dy + height;
    const rectRight = rect.x + rect.width;
    const rectBottom = rect.y + rect.height;
    
    // Check for overlap
    if (rect.x < displayRight && rectRight > dx && rect.y < displayBottom && rectBottom > dy) {
      return display;
    }
  }
  
  return screen.getPrimaryDisplay();
}


/**
 * Represents a portion of the selection that lies on a specific display.
 */
interface DisplayCapture {
  display: Electron.Display;
  /** The intersection of selection with this display (in screen coordinates) */
  intersection: Electron.Rectangle;
  /** Buffer containing the cropped image data */
  imageBuffer: Buffer;
}

/**
 * Calculates which displays intersect with the given selection area.
 * Returns an array of display captures with their intersection rectangles.
 */
async function getDisplaysIntersectingSelection(
  selection: Electron.Rectangle
): Promise<DisplayCapture[]> {
  const displays = screen.getAllDisplays();
  const selectionRight = selection.x + selection.width;
  const selectionBottom = selection.y + selection.height;
  
  // Get all screen sources for desktopCapturer
  let sources: Electron.DesktopCapturerSource[];
  
  // Determine appropriate thumbnail size - use largest display
  let maxWidth = 0;
  let maxHeight = 0;
  for (const display of displays) {
    const { width, height } = display.bounds;
    const scaledWidth = Math.round(width * display.scaleFactor);
    const scaledHeight = Math.round(height * display.scaleFactor);
    maxWidth = Math.max(maxWidth, scaledWidth);
    maxHeight = Math.max(maxHeight, scaledHeight);
  }
  
  try {
    sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: maxWidth, height: maxHeight }
    });
  } catch (error) {
    console.error('[ScreenshotHelper] Failed to get desktop sources:', error);
    throw normalizeDesktopCaptureError(error);
  }

  if (sources.length === 0) {
    throw new Error(
      'No screen sources available. Check screen recording permissions in System Settings > Privacy & Security > Screen Recording.'
    );
  }
  
  console.log(`[ScreenshotHelper] Found ${sources.length} screen sources for ${displays.length} displays`);
  
  // Build a map of source by display_id for reliable matching
  // On Windows, source.display_id is a string representation of the display id
  const sourceByDisplayId = new Map<string, Electron.DesktopCapturerSource>();
  for (const src of sources) {
    if ('display_id' in src && src.display_id) {
      sourceByDisplayId.set(src.display_id, src);
      console.log(`[ScreenshotHelper] Registered source: ${src.name} with display_id: ${src.display_id}`);
    }
  }
  
  const captures: DisplayCapture[] = [];
  
  // For each display, check if selection intersects with it
  for (const display of displays) {
    const { x: dx, y: dy, width: dWidth, height: dHeight } = display.bounds;
    const displayRight = dx + dWidth;
    const displayBottom = dy + dHeight;
    
    // Check if selection intersects with this display
    const intersectsX = selection.x < displayRight && selectionRight > dx;
    const intersectsY = selection.y < displayBottom && selectionBottom > dy;
    
    if (!intersectsX || !intersectsY) {
      continue;
    }
    
    // Calculate intersection
    const intersection: Electron.Rectangle = {
      x: Math.max(selection.x, dx),
      y: Math.max(selection.y, dy),
      width: Math.min(selectionRight, displayRight) - Math.max(selection.x, dx),
      height: Math.min(selectionBottom, displayBottom) - Math.max(selection.y, dy)
    };
    
    console.log(`[ScreenshotHelper] Selection intersects with display ${display.id}:`, intersection);
    
    const scaleFactor = display.scaleFactor;
    
    // Find the corresponding source using the pre-built map
    const displayIdStr = display.id.toString();
    let source = sourceByDisplayId.get(displayIdStr);
    
    // Fallback: index-based matching (less reliable)
    if (!source) {
      console.warn(`[ScreenshotHelper] display_id ${displayIdStr} not found in sources, using index-based fallback`);
      const displayIndex = displays.findIndex(d => d.id === display.id);
      if (displayIndex === -1) {
        console.error(`[ScreenshotHelper] CRITICAL: Display ${display.id} not found in displays array. Available displays:`, displays.map(d => d.id));
      } else if (displayIndex >= sources.length) {
        console.warn(`[ScreenshotHelper] Index ${displayIndex} out of bounds for sources (${sources.length} sources). Using first source.`);
      } else {
        console.log(`[ScreenshotHelper] Fallback: matched display[${displayIndex}] to sources[${displayIndex}] = ${sources[displayIndex]?.name || 'unknown'}`);
      }
      source = sources[displayIndex] || sources[0];
    }
    
    if (!source) {
      source = sources[0];
    }
    
    console.log(`[ScreenshotHelper] Final source for display ${display.id}: ${source.name}`);
    
    // Get source thumbnail info
    const sourceSize = source.thumbnail.getSize();
    console.log(`[ScreenshotHelper] Source thumbnail size: ${sourceSize.width}x${sourceSize.height}, display bounds: ${display.bounds.width}x${display.bounds.height}`);
    
    // CRITICAL: desktopCapturer returns thumbnail in DISPLAY'S NATIVE resolution
    // NOT scaled to a common size. Different displays may have different resolutions.
    // 
    // We need to normalize crop coordinates to the thumbnail's coordinate system.
    // The ratio sourceSize / display.bounds gives us the scaling factor.
    
    // Calculate the ratio between thumbnail and display bounds
    // This accounts for any difference in how desktopCapturer captures each display
    let thumbnailToBoundsRatioX = display.bounds.width > 0 ? sourceSize.width / display.bounds.width : 1;
    let thumbnailToBoundsRatioY = display.bounds.height > 0 ? sourceSize.height / display.bounds.height : 1;
    
    // Guard against Infinity values (e.g., if sourceSize >> bounds due to DPI mismatch)
    const MAX_RATIO = 10;
    if (!isFinite(thumbnailToBoundsRatioX)) {
      console.warn(`[ScreenshotHelper] thumbnailToBoundsRatioX is ${thumbnailToBoundsRatioX}, clamping to ${MAX_RATIO}`);
      thumbnailToBoundsRatioX = MAX_RATIO;
    }
    if (!isFinite(thumbnailToBoundsRatioY)) {
      console.warn(`[ScreenshotHelper] thumbnailToBoundsRatioY is ${thumbnailToBoundsRatioY}, clamping to ${MAX_RATIO}`);
      thumbnailToBoundsRatioY = MAX_RATIO;
    }
    
    console.log(`[ScreenshotHelper] Thumbnail to bounds ratio: ${thumbnailToBoundsRatioX}x${thumbnailToBoundsRatioY}`);
    
    // Intersection coordinates are in screen coordinates (physical pixels)
    // We need to convert them to thumbnail coordinates
    const cropX = Math.round((intersection.x - display.bounds.x) * thumbnailToBoundsRatioX);
    const cropY = Math.round((intersection.y - display.bounds.y) * thumbnailToBoundsRatioY);
    const cropWidth = Math.round(intersection.width * thumbnailToBoundsRatioX);
    const cropHeight = Math.round(intersection.height * thumbnailToBoundsRatioY);
    
    console.log(`[ScreenshotHelper] Crop params: x=${cropX}, y=${cropY}, w=${cropWidth}, h=${cropHeight}`);
    
    // Ensure crop is within image bounds
    const clampedX = Math.max(0, Math.min(cropX, sourceSize.width));
    const clampedY = Math.max(0, Math.min(cropY, sourceSize.height));
    const clampedWidth = Math.max(0, Math.min(cropWidth, sourceSize.width - clampedX));
    const clampedHeight = Math.max(0, Math.min(cropHeight, sourceSize.height - clampedY));
    
    const cropped = source.thumbnail.crop({
      x: clampedX,
      y: clampedY,
      width: clampedWidth,
      height: clampedHeight
    });
    
    captures.push({
      display,
      intersection,
      imageBuffer: cropped.toPNG()
    });
  }
  
  return captures;
}

/**
 * Checks if the selection spans multiple displays.
 */
function isMultiDisplaySelection(selection: Electron.Rectangle): boolean {
  const displays = screen.getAllDisplays();
  
  if (displays.length < 2) {
    return false;
  }
  
  let displaysHit = 0;
  
  for (const display of displays) {
    const { x: dx, y: dy, width: dWidth, height: dHeight } = display.bounds;
    const displayRight = dx + dWidth;
    const displayBottom = dy + dHeight;
    
    const intersectsX = selection.x < displayRight && (selection.x + selection.width) > dx;
    const intersectsY = selection.y < displayBottom && (selection.y + selection.height) > dy;
    
    if (intersectsX && intersectsY) {
      displaysHit++;
    }
  }
  
  return displaysHit > 1;
}

/**
 * Stitches multiple display captures into a single image.
 * Handles different DPI scales by normalizing all captures to the same physical pixel scale.
 */
async function stitchImages(captures: DisplayCapture[], selection: Electron.Rectangle): Promise<Buffer> {
  if (captures.length === 0) {
    throw new Error('No captures to stitch');
  }
  
  if (captures.length === 1) {
    // Single display - no stitching needed
    return captures[0].imageBuffer;
  }
  
  console.log(`[ScreenshotHelper] Stitching ${captures.length} display captures`);
  console.log(`[ScreenshotHelper] Selection bounds: x=${selection.x}, y=${selection.y}, width=${selection.width}, height=${selection.height}`);
  
  // Memory consideration: All capture buffers are held in memory until stitchImages completes.
  // For 4K monitors, this could mean ~33MB per capture × number of captures.
  // Example: 4 monitors × 4K × RGBA = ~132MB peak memory usage during stitching.
  // Future optimization: Process captures one at a time to reduce peak memory.
  
  // Log each capture's details
  for (let i = 0; i < captures.length; i++) {
    const cap = captures[i];
    console.log(`[ScreenshotHelper] Capture ${i}: display=${cap.display.id}, displayBounds=(${cap.display.bounds.x}, ${cap.display.bounds.y}, ${cap.display.bounds.width}x${cap.display.bounds.height})`);
    console.log(`[ScreenshotHelper] Capture ${i}: intersection=(${cap.intersection.x}, ${cap.intersection.y}, ${cap.intersection.width}x${cap.intersection.height})`);
  }
  
  // Output dimensions in physical pixels (same as selection)
  const outputWidth = Math.round(selection.width);
  const outputHeight = Math.round(selection.height);
  
  console.log(`[ScreenshotHelper] Output dimensions: ${outputWidth}x${outputHeight}`);
  
  // Process each capture: resize to fit the output scale
  const composites: sharp.OverlayOptions[] = [];
  
  try {
    for (const capture of captures) {
      // Calculate where this capture goes in output coordinates (physical pixels)
      const outputOffsetX = Math.round(capture.intersection.x - selection.x);
      const outputOffsetY = Math.round(capture.intersection.y - selection.y);
      
      // Calculate the target size for this capture in output coordinates
      const targetWidth = Math.round(capture.intersection.width);
      const targetHeight = Math.round(capture.intersection.height);
      
      // Get current image dimensions
      const metadata = await sharp(capture.imageBuffer).metadata();
      const srcWidth = metadata.width || 1;
      const srcHeight = metadata.height || 1;
      
      console.log(`[ScreenshotHelper] Capture at (${outputOffsetX}, ${outputOffsetY}), source: ${srcWidth}x${srcHeight}, target: ${targetWidth}x${targetHeight}`);
      
      // Resize the capture to target dimensions to normalize DPI scales
      const resizedBuffer = await sharp(capture.imageBuffer)
        .resize(targetWidth, targetHeight, { fit: 'fill' })
        .png()
        .toBuffer();
      
      composites.push({
        input: resizedBuffer,
        left: outputOffsetX,
        top: outputOffsetY
      });
      
      console.log(`[ScreenshotHelper] Resized capture to ${targetWidth}x${targetHeight}`);
    }
  } catch (error) {
    console.error('[ScreenshotHelper] Error processing capture buffers:', error);
    throw new Error(`Failed to process screenshot buffers: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
  
  // Create a transparent canvas of the output size and composite all images
  let stitched: Buffer;
  try {
    stitched = await sharp({
      create: {
        width: outputWidth,
        height: outputHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
    .composite(composites)
    .png()
    .toBuffer();
  } catch (error) {
    console.error('[ScreenshotHelper] Error creating stitched image:', error);
    throw new Error(`Failed to create stitched screenshot: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
  
  console.log(`[ScreenshotHelper] Stitched image created: ${outputWidth}x${outputHeight}`);
  
  return stitched;
}

export class ScreenshotHelper {
  private screenshotQueue: string[] = []
  private extraScreenshotQueue: string[] = []
  private readonly MAX_SCREENSHOTS = 5

  private readonly screenshotDir: string
  private readonly extraScreenshotDir: string

  private view: "queue" | "solutions" = "queue"

  constructor(view: "queue" | "solutions" = "queue") {
    this.view = view

    // Initialize directories
    this.screenshotDir = path.join(app.getPath("userData"), "screenshots")
    this.extraScreenshotDir = path.join(
      app.getPath("userData"),
      "extra_screenshots"
    )

    // Create directories if they don't exist
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir)
    }
    if (!fs.existsSync(this.extraScreenshotDir)) {
      fs.mkdirSync(this.extraScreenshotDir)
    }
  }

  /**
   * Captures a screenshot using Electron's native desktopCapturer API.
   * Supports multi-monitor setups by selecting the appropriate display source.
   *
   * @param outputPath Path to save the PNG file
   * @param area Optional rectangle to crop the screenshot (in screen coordinates)
   * @throws Error if screen capture fails or permissions are denied
   */
  private async captureWithDesktopCapturer(
    outputPath: string,
    area?: Electron.Rectangle,
    preferredDisplay?: Electron.Display
  ): Promise<void> {
    let targetDisplay: Electron.Display;
    
    if (preferredDisplay) {
      targetDisplay = preferredDisplay;
    } else if (area) {
      // Find which display contains the selection area
      targetDisplay = getDisplayContainingRect(area);
    } else {
      targetDisplay = screen.getPrimaryDisplay();
    }
    
    const { scaleFactor } = targetDisplay;
    const displayBounds = targetDisplay.bounds;
    
    console.log(`[ScreenshotHelper] Target display bounds: ${JSON.stringify(displayBounds)}, scale: ${scaleFactor}`);
    
    let sources: Electron.DesktopCapturerSource[];

    try {
      console.log('[ScreenshotHelper] Capturing screen with desktopCapturer...');
      
      // Get thumbnail size matching the target display's resolution
      const thumbnailSize = {
        width: Math.round(displayBounds.width * scaleFactor),
        height: Math.round(displayBounds.height * scaleFactor)
      };
      
      sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize
      });
      console.log(`[ScreenshotHelper] Found ${sources.length} screen source(s)`);
    } catch (error) {
      console.error('[ScreenshotHelper] desktopCapturer.getSources failed:', error);
      throw normalizeDesktopCaptureError(error);
    }

    if (sources.length === 0) {
      console.error('[ScreenshotHelper] No screen sources found');
      throw new Error(
        'No screen sources available. Check screen recording permissions in System Settings > Privacy & Security > Screen Recording.'
      );
    }

    // Find the source matching our target display using reliable display_id mapping
    const targetDisplayId = targetDisplay.id.toString();
    let selectedSource: Electron.DesktopCapturerSource | null = null;
    
    // Build a map of sources by display_id (same logic as in getDisplaysIntersectingSelection)
    for (const source of sources) {
      if ('display_id' in source && source.display_id) {
        console.log(`[ScreenshotHelper] Source: ${source.name}, display_id: ${source.display_id}`);
        if (source.display_id === targetDisplayId) {
          selectedSource = source;
          console.log(`[ScreenshotHelper] Matched source by display_id: ${source.display_id}`);
        }
      }
    }
    
    // Last resort: use first source
    if (!selectedSource) {
      console.warn(`[ScreenshotHelper] display_id ${targetDisplayId} not found in sources, using first available`);
      selectedSource = sources[0];
    }
    
    console.log(`[ScreenshotHelper] Final source: ${selectedSource.name} (id: ${selectedSource.id})`);
    
    let image = selectedSource.thumbnail;

    if (area) {
      // Calculate crop area relative to the target display
      // The thumbnail represents the target display's content
      // area coordinates are absolute screen coordinates
      const cropX = Math.round((area.x - displayBounds.x) * scaleFactor);
      const cropY = Math.round((area.y - displayBounds.y) * scaleFactor);
      
      const croppedArea = {
        x: Math.max(0, cropX),
        y: Math.max(0, cropY),
        width: Math.round(area.width * scaleFactor),
        height: Math.round(area.height * scaleFactor)
      };
      
      console.log(`[ScreenshotHelper] Cropping relative to display: ${JSON.stringify(croppedArea)}`);
      
      // Ensure crop area is within image bounds
      const imgWidth = image.getSize().width;
      const imgHeight = image.getSize().height;
      
      if (croppedArea.x + croppedArea.width > imgWidth) {
        croppedArea.width = imgWidth - croppedArea.x;
      }
      if (croppedArea.y + croppedArea.height > imgHeight) {
        croppedArea.height = imgHeight - croppedArea.y;
      }
      
      if (croppedArea.width > 0 && croppedArea.height > 0) {
        image = image.crop(croppedArea);
      } else {
        console.warn('[ScreenshotHelper] Invalid crop area, skipping crop');
      }
    }

    try {
      await fs.promises.writeFile(outputPath, image.toPNG());
      console.log(`[ScreenshotHelper] Screenshot saved to: ${outputPath}`);
    } catch (writeError) {
      console.error('[ScreenshotHelper] Failed to write screenshot to disk:', writeError);
      throw new Error(`Failed to save screenshot: ${(writeError as Error).message}`);
    }
  }

  /**
   * Captures a virtual screen region by reading the intersecting displays and stitching them.
   */
  private async captureStitchedDesktopArea(outputPath: string, area: Electron.Rectangle): Promise<void> {
    const captures = await getDisplaysIntersectingSelection(area);
    const stitchedBuffer = await stitchImages(captures, area);
    await fs.promises.writeFile(outputPath, stitchedBuffer);
    console.log(`[ScreenshotHelper] Stitched screenshot saved to: ${outputPath}`);
  }

  /**
   * Linux-only screenshot command builder.
   */
  private getScreenshotCommand(outputPath: string, interactive: boolean): string {
    // Safety: outputPath must be within our controlled directories.
    // Since we always construct paths using path.join(this.screenshotDir, uuidv4()),
    // this assertion guards against any future regression where external input could reach here.
    // This is a defense-in-depth measure against path traversal attacks.
    const userDataDir = app.getPath('userData');
    if (!outputPath.startsWith(userDataDir)) {
      throw new Error(`[ScreenshotHelper] Refusing shell command for path outside userData: ${outputPath}`);
    }
    const safePath = outputPath.replace(/"/g, '\\"');
    const platform = process.platform;
    if (platform === 'linux') {
      return interactive
        ? `gnome-screenshot -a -f "${safePath}" 2>/dev/null || scrot -s "${safePath}" 2>/dev/null || import "${safePath}"`
        : `gnome-screenshot -f "${safePath}" 2>/dev/null || scrot "${safePath}" 2>/dev/null || import -window root "${safePath}"`;
    }
    throw new Error(`Unsupported platform for screenshots: ${platform}`);
  }

  public async takeScreenshot(preferredDisplay?: Electron.Display): Promise<string> {
    try {
      console.log('[ScreenshotHelper] Taking screenshot...');

      let screenshotPath = ""

      const exec = util.promisify(require('child_process').exec)

      if (this.view === "queue") {
        screenshotPath = path.join(this.screenshotDir, `${uuidv4()}.png`)
        console.log(`[ScreenshotHelper] Using queue directory: ${screenshotPath}`);
        if (process.platform === 'darwin') {
          await this.captureWithDesktopCapturer(screenshotPath, undefined, preferredDisplay);
        } else if (process.platform === 'win32') {
          await this.captureWithDesktopCapturer(screenshotPath);
        } else {
          await exec(this.getScreenshotCommand(screenshotPath, false))
        }

        this.screenshotQueue.push(screenshotPath)
        if (this.screenshotQueue.length > this.MAX_SCREENSHOTS) {
          const removedPath = this.screenshotQueue.shift()
          if (removedPath) {
            try {
              await fs.promises.unlink(removedPath)
              console.log(`[ScreenshotHelper] Removed old screenshot: ${removedPath}`);
            } catch (error) {
              console.warn(`[ScreenshotHelper] Failed to remove old screenshot: ${removedPath}`, error)
            }
          }
        }
      } else {
        screenshotPath = path.join(this.extraScreenshotDir, `${uuidv4()}.png`)
        console.log(`[ScreenshotHelper] Using extra screenshots directory: ${screenshotPath}`);
        if (process.platform === 'darwin') {
          await this.captureWithDesktopCapturer(screenshotPath, undefined, preferredDisplay);
        } else if (process.platform === 'win32') {
          await this.captureWithDesktopCapturer(screenshotPath);
        } else {
          await exec(this.getScreenshotCommand(screenshotPath, false))
        }

        this.extraScreenshotQueue.push(screenshotPath)
        if (this.extraScreenshotQueue.length > this.MAX_SCREENSHOTS) {
          const removedPath = this.extraScreenshotQueue.shift()
          if (removedPath) {
            try {
              await fs.promises.unlink(removedPath)
              console.log(`[ScreenshotHelper] Removed old extra screenshot: ${removedPath}`);
            } catch (error) {
              console.warn(`[ScreenshotHelper] Failed to remove old extra screenshot: ${removedPath}`, error)
            }
          }
        }
      }

      console.log(`[ScreenshotHelper] Screenshot successful: ${screenshotPath}`);
      return screenshotPath
    } catch (error) {
      console.error('[ScreenshotHelper] Failed to take screenshot:', error);
      throw new Error(`Failed to take screenshot: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  public async takeSelectiveScreenshot(captureArea?: Electron.Rectangle): Promise<string> {
    try {
      console.log('[ScreenshotHelper] Taking selective screenshot...');
      console.log(`[ScreenshotHelper] Capture area: ${captureArea ? JSON.stringify(captureArea) : 'user selection'}`);

      const screenshotPath = path.join(this.screenshotDir, `selective-${uuidv4()}.png`)

      if ((process.platform === 'win32' || process.platform === 'darwin') && captureArea) {
        // Check if selection spans multiple displays
        const isMulti = isMultiDisplaySelection(captureArea);
        
        if (isMulti) {
          console.log('[ScreenshotHelper] Selection spans multiple displays - using stitched capture');
          await this.captureStitchedDesktopArea(screenshotPath, captureArea);
        } else {
          console.log('[ScreenshotHelper] Selection within single display - using standard capture');
          await this.captureWithDesktopCapturer(screenshotPath, captureArea);
        }
      } else if (process.platform === 'linux') {
        // Linux: use interactive selection command
        const exec = util.promisify(require('child_process').exec);
        console.log('[ScreenshotHelper] Using interactive selection');
        try {
          await exec(this.getScreenshotCommand(screenshotPath, true))
        } catch (e: any) {
          console.warn('[ScreenshotHelper] User cancelled selection or error occurred:', e);
          throw new Error("Selection cancelled")
        }
      } else {
        throw new Error('Selection bounds are required for this platform');
      }

      // Verify file exists (user might have pressed Esc)
      if (!fs.existsSync(screenshotPath)) {
        console.warn('[ScreenshotHelper] Screenshot file not found after selection');
        throw new Error("Selection cancelled")
      }

      console.log(`[ScreenshotHelper] Selective screenshot successful: ${screenshotPath}`);

      // Add to queue so it appears in getScreenshots() and respects the cap
      this.screenshotQueue.push(screenshotPath);
      if (this.screenshotQueue.length > this.MAX_SCREENSHOTS) {
        const removedPath = this.screenshotQueue.shift();
        if (removedPath) {
          try {
            await fs.promises.unlink(removedPath);
          } catch {
            // best-effort cleanup
          }
        }
      }

      return screenshotPath
    } catch (error) {
      console.error('[ScreenshotHelper] Failed to take selective screenshot:', error);
      throw error
    }
  }

  public getView(): "queue" | "solutions" {
    return this.view
  }

  public setView(view: "queue" | "solutions"): void {
    this.view = view
  }

  public getScreenshotQueue(): string[] {
    return this.screenshotQueue
  }

  public getExtraScreenshotQueue(): string[] {
    return this.extraScreenshotQueue
  }

  public clearQueues(): void {
    // Clear screenshotQueue
    this.screenshotQueue.forEach((screenshotPath) => {
      fs.unlink(screenshotPath, (err) => {
        if (err) {
          // console.error(`Error deleting screenshot at ${screenshotPath}:`, err)
        }
      })
    })
    this.screenshotQueue = []

    // Clear extraScreenshotQueue
    this.extraScreenshotQueue.forEach((screenshotPath) => {
      fs.unlink(screenshotPath, (err) => {
        if (err) {
          // console.error(
          //   `Error deleting extra screenshot at ${screenshotPath}:`,
          //   err
          // )
        }
      })
    })
    this.extraScreenshotQueue = []
  }

  public async getImagePreview(filepath: string): Promise<string> {
    const maxRetries = 20
    const delay = 250 // 5s total wait time

    for (let i = 0; i < maxRetries; i++) {
      try {
        if (fs.existsSync(filepath)) {
          // Double check file size is > 0
          const stats = await fs.promises.stat(filepath)
          if (stats.size > 0) {
            const data = await fs.promises.readFile(filepath)
            return `data:image/png;base64,${data.toString("base64")}`
          }
        }
      } catch (error) {
        // console.log(`[ScreenshotHelper] Retry ${i + 1}/${maxRetries} failed:`, error)
      }
      // Wait for file system
      await new Promise((resolve) => setTimeout(resolve, delay))
    }

    throw new Error(`Failed to read screenshot after ${maxRetries} retries (${maxRetries * delay}ms): ${filepath}`)
  }

  public async deleteScreenshot(
    path: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await fs.promises.unlink(path)
      if (this.view === "queue") {
        this.screenshotQueue = this.screenshotQueue.filter(
          (filePath) => filePath !== path
        )
      } else {
        this.extraScreenshotQueue = this.extraScreenshotQueue.filter(
          (filePath) => filePath !== path
        )
      }
      return { success: true }
    } catch (error) {
      // console.error("Error deleting file:", error)
      return { success: false, error: error.message }
    }
  }
}
