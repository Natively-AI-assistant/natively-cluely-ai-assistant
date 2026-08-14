/**
 * ================================================================================
 * InstallPingManager - Anonymous Install Counter
 * ================================================================================
 *
 * PURPOSE:
 * This module sends a ONE-TIME anonymous ping when the app is first installed.
 * It exists solely to estimate total install counts for the source-available project.
 *
 * WHAT IS SENT (exactly):
 * - "app": "natively" (hardcoded app identifier)
 * - "install_id": A random UUID generated once per install (NOT tied to user/hardware)
 * - "version": The app version from package.json
 * - "platform": "darwin" | "win32" | "linux"
 *
 * WHAT IS EXPLICITLY NOT COLLECTED:
 * ❌ IP addresses (not stored by this code - backend must also not store)
 * ❌ Hardware fingerprints
 * ❌ User accounts or login info
 * ❌ Usage analytics or behavior tracking
 * ❌ Session information
 * ❌ Any repeated pings (fires exactly once per install)
 * ❌ Timestamps or timezone data
 *
 * PRIVACY GUARANTEES:
 * - The install_id is a random UUID with no correlation to hardware or identity
 * - Once sent, the ping is never repeated (controlled by local flag file)
 * - If the ping fails, it fails silently - no aggressive retries
 * - This code is fully auditable and easy to remove if unwanted
 *
 * This is NOT analytics. This is NOT telemetry. This is a simple install counter.
 * ================================================================================
 */

import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Anonymous install ping endpoint.
 * Replace this URL with your actual Cloudflare Worker endpoint.
 */
const INSTALL_PING_URL = 'https://divine-sun-927d.natively.workers.dev';

// Local storage paths (inside user data directory)
const INSTALL_ID_PATH = path.join(app.getPath('userData'), 'install_id.txt');
const INSTALL_PING_SENT_PATH = path.join(app.getPath('userData'), 'install_ping_sent.txt');

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get or create a persistent anonymous install ID.
 * This ID is a random UUID with no connection to hardware or user identity.
 * Once created, it never changes.
 */
export function getOrCreateInstallId(): string {
    try {
        // Check if install ID already exists
        if (fs.existsSync(INSTALL_ID_PATH)) {
            const existingId = fs.readFileSync(INSTALL_ID_PATH, 'utf-8').trim();
            if (existingId && existingId.length > 0) {
                return existingId;
            }
        }

        // Generate new UUID
        const newId = uuidv4();
        fs.writeFileSync(INSTALL_ID_PATH, newId, 'utf-8');
        console.log('[InstallPingManager] Generated new install ID');
        return newId;
    } catch (error) {
        console.error('[InstallPingManager] Error managing install ID:', error);
        // Return a temporary ID if we can't persist (ping may repeat, but that's fine)
        return uuidv4();
    }
}

/**
 * Check if the install ping has already been sent.
 */
function hasInstallPingBeenSent(): boolean {
    try {
        if (fs.existsSync(INSTALL_PING_SENT_PATH)) {
            const value = fs.readFileSync(INSTALL_PING_SENT_PATH, 'utf-8').trim();
            return value === 'true';
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * Mark the install ping as sent.
 */
function markInstallPingSent(): void {
    try {
        fs.writeFileSync(INSTALL_PING_SENT_PATH, 'true', 'utf-8');
        console.log('[InstallPingManager] Install ping marked as sent');
    } catch (error) {
        console.error('[InstallPingManager] Error marking ping as sent:', error);
    }
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Send a one-time anonymous install ping.
 *
 * This function:
 * - Checks if a ping has already been sent (exits early if so)
 * - Sends a minimal, anonymous payload to the configured endpoint
 * - Marks the ping as sent to prevent future pings
 * - Never blocks app startup
 * - Fails silently on any error
 */
export async function sendAnonymousInstallPing(): Promise<void> {
    try {
        // Early exit if ping already sent
        if (hasInstallPingBeenSent()) {
            console.log('[InstallPingManager] Install ping already sent, skipping');
            return;
        }

        const installId = getOrCreateInstallId();
        const version = app.getVersion();
        const platform = process.platform; // 'darwin' | 'win32' | 'linux'

        const payload = {
            app: 'natively',
            install_id: installId,
            version: version,
            platform: platform
        };

        console.log('[InstallPingManager] Sending anonymous install ping...');

        // Non-blocking fetch with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

        const response = await fetch(INSTALL_PING_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
            markInstallPingSent();
            console.log('[InstallPingManager] Install ping sent successfully');
        } else {
            // Don't mark as sent on failure - will retry on next launch
            console.log(`[InstallPingManager] Install ping failed with status: ${response.status}`);
        }
    } catch (error) {
        // Silently fail - this is non-critical functionality
        // Common reasons: no network, endpoint doesn't exist yet, timeout
        console.log('[InstallPingManager] Install ping failed (silent):', error instanceof Error ? error.message : 'Unknown error');
    }
}

/**
 * Namespace export for compatibility with require() pattern
 */
export const InstallPingManager = {
    getOrCreateInstallId,
    sendAnonymousInstallPing
};
