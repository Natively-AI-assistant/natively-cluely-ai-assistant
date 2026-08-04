// electron/services/ReviewService.ts
// Desktop-side review prompt orchestration.
//
// Responsibilities:
//   * Decide WHEN to surface the review modal (eligibility gating).
//   * Track session starts + cumulative usage time so the backend ledger is
//     up to date (the modal reads prompt-state directly from the backend).
//   * Provide the actual API call functions the React modal invokes.
//
// Storage:
//   * Local prompt-state cache in userData/review-state.json (small, easy to
//     debug). The backend is the source of truth for cross-install dedupe;
//     this file just keeps the renderer cheap (no extra round trip on every
//     launch).
//   * API keys are NOT stored here — review submissions use x-natively-key
//     transparently via the request handler.

import { app } from "electron"
import fs from "fs"
import path from "path"
import { loadNativeModule } from "../audio/nativeModuleLoader"

const REVIEW_STATE_FILE = "review-state.json"

const PROMPT_FIRST_SESSION_THRESHOLD = 3
const PROMPT_FIRST_USAGE_MS_THRESHOLD = 30 * 60 * 1000
const PROMPT_REDISPLAY_SESSION_THRESHOLD = 3
const PROMPT_REDISPLAY_DELAY_MS = 7 * 24 * 60 * 60 * 1000

// Pure eligibility logic is in ReviewPromptLogic.ts (testable without Electron).
import { shouldShowPromptLocal } from "./ReviewPromptLogic"
export { shouldShowPromptLocal }

export interface ReviewPromptLocalState {
    has_reviewed: boolean
    dismissed_count: number
    dont_show_again: boolean
    last_prompted_at: string | null
    last_dismissed_at: string | null
    next_eligible_at: string | null
    session_count: number
    total_usage_ms: number
}

export interface ReviewSessionEndResult {
    session_count: number
    total_usage_ms: number
    usage_ms: number
    counted: boolean
}

const DEFAULT_STATE: ReviewPromptLocalState = {
    has_reviewed: false,
    dismissed_count: 0,
    dont_show_again: false,
    last_prompted_at: null,
    last_dismissed_at: null,
    next_eligible_at: null,
    session_count: 0,
    total_usage_ms: 0,
}

export class ReviewService {
    private static instance: ReviewService | null = null
    private state: ReviewPromptLocalState = { ...DEFAULT_STATE }
    private statePath: string
    private writeTimer: NodeJS.Timeout | null = null
    private sessionStartTime: number | null = null

    private constructor() {
        this.statePath = path.join(app.getPath("userData"), REVIEW_STATE_FILE)
        this.loadFromDisk()
    }

    static getInstance(): ReviewService {
        if (!ReviewService.instance) ReviewService.instance = new ReviewService()
        return ReviewService.instance
    }

    // ── persistence ───────────────────────────────────────────────────────

    private loadFromDisk() {
        try {
            if (fs.existsSync(this.statePath)) {
                const raw = fs.readFileSync(this.statePath, "utf8")
                const parsed = JSON.parse(raw)
                if (parsed && typeof parsed === "object") {
                    this.state = { ...DEFAULT_STATE, ...parsed }
                }
            }
        } catch (err) {
            // Corrupt state file → reset to defaults; do NOT crash the app over
            // a review-prompt ledger.
            console.warn("[ReviewService] Could not load review-state.json:", (err as Error)?.message)
            this.state = { ...DEFAULT_STATE }
        }
    }

    private scheduleWrite() {
        if (this.writeTimer) return
        this.writeTimer = setTimeout(() => {
            this.writeTimer = null
            this.commitNow()
        }, 250)
    }

    /** Single-sourced atomic write. Used by both the debounced scheduleWrite
     *  tail AND by flush() / beforeQuit() to defeat the 250ms debounce window. */
    private commitNow() {
        try {
            const tmp = this.statePath + ".tmp"
            fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), "utf8")
            fs.renameSync(tmp, this.statePath)
        } catch (err) {
            console.warn("[ReviewService] Could not persist review-state.json:", (err as Error)?.message)
        }
    }

    // ── session + usage tracking ──────────────────────────────────────────

    /** Call when a meaningful user session starts (app open / overlay start). */
    recordSessionStart() {
        // Idempotent: a renderer reload or accidental duplicate IPC should not
        // shorten the active session by resetting the start timestamp.
        if (this.sessionStartTime == null) this.sessionStartTime = Date.now()
    }

    /** Call when the session ends. Adds elapsed ms to total_usage_ms and
     *  bumps session_count by 1. Returns the new totals so callers can sync
     *  to the backend if they wish. No-op (returns current totals) when
     *  recordSessionStart was never called or elapsed is 0 — prevents the
     *  double-call / no-call-starts case from bumping session_count and
     *  flooding the backend with zero-usage reports. */
    recordSessionEnd(): ReviewSessionEndResult {
        const now = Date.now()
        if (this.sessionStartTime == null) {
            return {
                session_count: this.state.session_count,
                total_usage_ms: this.state.total_usage_ms,
                usage_ms: 0,
                counted: false,
            }
        }
        const elapsed = Math.max(0, Math.min(now - this.sessionStartTime, 6 * 60 * 60 * 1000))
        this.state.total_usage_ms += elapsed
        this.state.session_count += 1
        this.sessionStartTime = null
        this.scheduleWrite()
        return {
            session_count: this.state.session_count,
            total_usage_ms: this.state.total_usage_ms,
            usage_ms: elapsed,
            counted: true,
        }
    }

    /** Force-flush any pending writes. Call on app quit. */
    flush() {
        if (this.writeTimer) {
            clearTimeout(this.writeTimer)
            this.writeTimer = null
        }
        this.commitNow()
    }

    /** App-quit convenience: closes the current session and flushes state.
     *  Idempotent — safe to call alongside flush() or in addition to the
     *  beforeunload-renderer path. */
    beforeQuit(): ReviewSessionEndResult {
        const result = this.recordSessionEnd()
        this.flush()
        return result
    }

    // ── prompt gating (local decision, used as a UX pre-check before the
    //    network round trip; the backend is authoritative). ───────────────

    shouldShowPrompt(): { eligible: boolean; reason: string } {
        // Hard-disabled — commercial-surface-strip / ticket 05.
        return { eligible: false, reason: 'review_disabled' }
    }

    markShown() {
        this.state.last_prompted_at = new Date().toISOString()
        this.scheduleWrite()
    }

    markDismissLater() {
        // CRITICAL FIX (audit HIGH #4): bump last_dismissed_at (separately from
        // last_prompted_at) so the 7-day redisplay window is anchored to the
        // last dismissal, not the last prompt-display.
        const now = new Date().toISOString()
        this.state.dismissed_count += 1
        this.state.last_dismissed_at = now
        this.state.next_eligible_at = new Date(Date.now() + PROMPT_REDISPLAY_DELAY_MS).toISOString()
        this.scheduleWrite()
    }

    markDontShowAgain() {
        const now = new Date().toISOString()
        this.state.dismissed_count += 1
        this.state.dont_show_again = true
        this.state.last_dismissed_at = now
        this.state.next_eligible_at = null
        this.scheduleWrite()
    }

    markReviewed(reviewId: string) {
        this.state.has_reviewed = true
        this.state.dont_show_again = true
        this.state.last_prompted_at = new Date().toISOString()
        this.state.next_eligible_at = null
        this.scheduleWrite()
    }

    /** Local state snapshot for the renderer. The renderer may choose to
     *  cross-check with the backend endpoint for cross-install dedupe. */
    getLocalState(): ReviewPromptLocalState {
        return { ...this.state }
    }

    /** Sync disabled — commercial-surface-strip / ticket 05 (no Natively reviews phone-home). */
    async syncWithBackend(_apiKey: string | null, _hardwareId: string | null): Promise<void> {
        return
    }

    /** Usage sync disabled — commercial-surface-strip / ticket 05. */
    async reportUsage(_apiKey: string | null, _hardwareId: string | null, _usageMs: number): Promise<void> {
        return
    }

    async reportEvent(_apiKey: string | null, _hardwareId: string | null, _event: Record<string, unknown>): Promise<void> {
        return
    }

    // ── API call helpers used by the modal (hard no-ops — ticket 05) ───────

    async submitReview(_apiKey: string | null, _hardwareId: string | null, _payload: {
        rating: number
        review_text: string | null
        app_version: string
        platform: string
        build_channel: string
        email: string | null
    }): Promise<{ ok: boolean; id?: string; error?: string; status?: number }> {
        return { ok: false, error: 'review_disabled' }
    }

    async updateTestimonial(_apiKey: string | null, _hardwareId: string | null, _reviewId: string, _payload: {
        name: string | null
        role: string | null
        company: string | null
        can_use_publicly: boolean
        display_name_publicly: boolean
    }): Promise<{ ok: boolean; error?: string; status?: number }> {
        return { ok: false, error: 'review_disabled' }
    }

    async getPromptState(_apiKey: string | null, _hardwareId: string | null): Promise<{ ok: boolean; state?: ReviewPromptLocalState; eligible?: boolean; reason?: string }> {
        return { ok: false, eligible: false, reason: 'review_disabled' }
    }
}

/** Get the app version (cached at module load). */
let _appVersion: string | null = null
export function getReviewAppVersion(): string {
    if (_appVersion != null) return _appVersion
    try {
        _appVersion = app.getVersion() || ""
    } catch {
        _appVersion = ""
    }
    return _appVersion || ""
}

/** Resolve the platform string the backend expects. */
export function getReviewPlatform(): "macos" | "windows" | "linux" | "other" {
    switch (process.platform) {
        case "darwin": return "macos"
        case "win32": return "windows"
        case "linux": return "linux"
        default: return "other"
    }
}

/** Hardware ID resolution — pulled lazily because the native module may
 *  load after this module (esm/cjs interop in the bundled electron). */
export async function getReviewHardwareId(): Promise<string | null> {
    try {
        const mod = loadNativeModule()
        if (mod?.getHardwareId) {
            const id = mod.getHardwareId()
            return typeof id === "string" && id.length > 0 ? id : null
        }
    } catch {
        // ignore
    }
    return null
}

/** Get the natively API key for outbound calls (paid users). Free/trial
 *  users fall back to anonymous HWID-only submission. */
export function getReviewApiKey(): string | null {
    try {
        const { CredentialsManager } = require("./CredentialsManager")
        const cm = CredentialsManager.getInstance()
        const key = cm.getNativelyApiKey?.()
        if (key && key.startsWith("natively_sk_")) return key
        const trial = cm.getTrialToken?.()
        if (trial) return null  // trial tokens are sent as x-trial-token; we don't mix them in here
        return null
    } catch {
        return null
    }
}