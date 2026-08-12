// src/components/ReviewModal.tsx
// In-app review + testimonial collection — "obsidian editorial".
//
// The composition is a two-column plate, not a stacked card: a black left
// plate carries an oversized display numeral that reacts live to the rating,
// and the right column carries the editorial copy and the controls. There is
// no header bar; the close glyph floats over the whole plate. Each step owns
// its own grid, so the three states have genuinely different silhouettes.
//
// Behaviour is unchanged from the form it replaces:
//   Step 1 ("review")      — rating 1-5 + optional 300-char note
//   Step 2 ("testimonial") — Save with name (requires a name) OR Keep anonymous
//   Step 3 ("thanks")      — confirmation, auto-dismisses after 5s
//
// All motion is gated on `useReducedMotion()`.

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { Star, X, Lock, Check } from "lucide-react"
// Co-located so a concurrent edit to index.css cannot silently strip the
// modal's styling — every class here resolves to nothing without it.
import "./ReviewModal.css"

const MAX_CHARS = 300

// ─── Spring presets ────────────────────────────────────────────────────────
// Defined once at module level so they are never recreated on render.

const SPRING_SNAPPY    = { type: "spring" as const, stiffness: 380, damping: 32 }
const SPRING_BOUNCY    = { type: "spring" as const, stiffness: 550, damping: 22 }
const SPRING_CELEBRATE = { type: "spring" as const, stiffness: 520, damping: 20 }

// Editorial ease. Entering/exiting content uses this rather than a spring so
// the step swap reads as a page turn, not a bounce.
const EASE_EDITORIAL = [0.23, 1, 0.32, 1] as const

// Reduced-motion fallback helper. Use anywhere we pass a `transition` object.
const rt = (reduced: boolean, normal: object): object =>
    reduced ? { duration: 0 } : normal

export interface ReviewModalProps {
    isOpen: boolean
    onClose: () => void
    onDismissLater?: () => void | Promise<void>
    onDismissForever?: () => void | Promise<void>
    onSubmitted?: (reviewId: string) => void
    prefillName?: string
    /**
     * NOTE ON WHAT IS *NOT* HERE. This modal used to accept `hardwareId`,
     * `appVersion`, `buildChannel` and `platform` and pass them down into the
     * submit payload. None of it ever reached the API: `review:submit` in
     * ipcHandlers.ts re-derives all four in the main process
     * (getReviewAppVersion / getReviewPlatform / getReviewHardwareId) and
     * ignores whatever the renderer sent — correctly, since a renderer value
     * is untrusted. `appVersion` was additionally always "" because
     * `electronAPI.appVersion` does not exist. Accepting them made the
     * component look like it controlled provenance when it does not, so the
     * props are gone and the payload types below match what is actually sent.
     */
    submitReview: (payload: {
        rating: number
        review_text: string | null
    }) => Promise<{ ok: boolean; id?: string; error?: string }>
    updateTestimonial: (id: string, payload: {
        name: string | null
        role: string | null
        company: string | null
        can_use_publicly: boolean
        display_name_publicly: boolean
    }) => Promise<{ ok: boolean; error?: string }>
}

type Step = "review" | "testimonial" | "thanks"

const RATING_WORDS = ["", "Poor", "Fair", "Good", "Great", "Exceptional"] as const

/**
 * The API returns machine codes (`rate_limited_key`, `hardware_id_required`,
 * `http_500`); this component used to print them verbatim, so users saw raw
 * identifiers in the error slot. Map the ones a user can actually hit to copy
 * that says what happened and what to do about it.
 *
 * Unknown codes fall back to the caller's generic message rather than leaking
 * the code — a string we have not vetted is not something to show a user.
 */
const ERROR_COPY: Record<string, string> = {
    rate_limited_key: "Too many attempts just now. Try again in a minute.",
    rate_limited: "Too many attempts just now. Try again in a minute.",
    hardware_id_required: "Couldn't identify this install. Restart Natively and try again.",
    rating_required_1_to_5: "Pick a rating from one to five stars.",
    review_text_too_long: "That note is over the 300-character limit.",
    review_not_found: "This review is no longer available.",
    not_owner: "This review belongs to a different install.",
    consent_window_expired: "Reviews older than 30 days need support to publish. Contact us and we'll sort it.",
    invalid_review_id: "Something went wrong saving your name. Your rating was still recorded.",
    no_db: "Our end is having trouble. Your rating wasn't saved — try again shortly.",
    network_error: "No connection. Check your network and try again.",
    no_api: "Natively isn't ready yet. Try again in a moment.",
}

/** Resolve an API error code to user-facing copy. */
function errorCopy(code: string | undefined, fallback: string): string {
    if (!code) return fallback
    if (ERROR_COPY[code]) return ERROR_COPY[code]
    // `http_429` etc. from the request helper — recover the status.
    const status = /^http_(\d{3})$/.exec(code)?.[1]
    if (status === "429") return ERROR_COPY.rate_limited
    if (status && Number(status) >= 500) return "Our end is having trouble. Try again shortly."
    return fallback
}

const ReviewModal: React.FC<ReviewModalProps> = ({
    isOpen,
    onClose,
    onDismissLater,
    onDismissForever,
    onSubmitted,
    prefillName = "",
    submitReview,
    updateTestimonial,
}) => {
    const reduced = useReducedMotion() ?? false
    const [step, setStep] = useState<Step>("review")
    // Read the latest step inside ESC/keydown handlers without making the
    // effect's dependency array include `step` (which would re-attach the
    // window listener on every step transition). The ref always points at
    // the current `step` value, so the soft-dismiss guard (`step === "review"`)
    // works correctly even after Keep-anonymous flips step without touching
    // submitting/testimonialBusy.
    const stepRef = useRef<Step>("review")
    useEffect(() => { stepRef.current = step }, [step])
    const [rating, setRating] = useState<number>(0)
    const [hoverRating, setHoverRating] = useState<number>(0)
    const [text, setText] = useState("")
    const [submitting, setSubmitting] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)

    // Public use is assumed for both attribution outcomes — the only thing the
    // user chooses is the byline. `displayNamePublicly` is not a form control;
    // it records which button was pressed so the confirmation can say the
    // right thing.
    const [displayNamePublicly, setDisplayNamePublicly] = useState(false)
    // Set when the attribution PATCH never ran (no review id). The rating is
    // recorded but nothing is publishable, so the receipt must not claim a
    // byline — see submitTestimonial.
    const [attributionSkipped, setAttributionSkipped] = useState(false)
    const [reviewId, setReviewId] = useState<string | null>(null)
    // SOFT PREFILL only — the prefilled value is never copied into the live
    // field. The user opts in explicitly via the chip.
    const [name, setName] = useState("")
    const [namePrefillUsed, setNamePrefillUsed] = useState(false)
    const [testimonialBusy, setTestimonialBusy] = useState(false)
    // Which button triggered the in-flight submitTestimonial call, so only
    // that button shows a spinner (both are disabled either way via `busy`).
    const [testimonialAction, setTestimonialAction] = useState<"credited" | "anonymous" | null>(null)
    const [testimonialError, setTestimonialError] = useState<string | null>(null)

    const textareaRef = useRef<HTMLTextAreaElement | null>(null)

    const namePrefillSuggested = !namePrefillUsed && !name && !!prefillName?.trim()

    // Reset state when modal opens fresh.
    useEffect(() => {
        if (isOpen) {
            setStep("review")
            setRating(0)
            setHoverRating(0)
            setText("")
            setSubmitting(false)
            setSubmitError(null)
            setReviewId(null)
            setName("")
            setNamePrefillUsed(false)
            setDisplayNamePublicly(false)
            setAttributionSkipped(false)
            setTestimonialBusy(false)
            setTestimonialAction(null)
            setTestimonialError(null)
        }
    }, [isOpen])

    // Move focus to the first star button when the modal opens (after the
    // entrance settles) so keyboard users land in the right place.
    useEffect(() => {
        if (!isOpen) return
        const t = window.setTimeout(() => {
            document.querySelector<HTMLButtonElement>('[data-review-star="1"]')?.focus()
        }, 260)
        return () => window.clearTimeout(t)
    }, [isOpen])

    // ESC closes; only when not mid-submit. On the first step this is a
    // soft dismissal ("Maybe later") so the prompt doesn't immediately reopen.
    useEffect(() => {
        if (!isOpen) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !submitting && !testimonialBusy) dismissLaterAndClose()
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [isOpen, submitting, testimonialBusy])

    // The confirmation is a receipt, not a form — it dismisses itself.
    useEffect(() => {
        if (!isOpen || step !== "thanks") return
        const t = window.setTimeout(() => onClose(), 5000)
        return () => window.clearTimeout(t)
    }, [isOpen, step, onClose])

    // Keep the plate mounted and animate between numeric heights reported by
    // the active step. Numeric endpoints are what make the Transitions.dev
    // resize utility work at all (`auto` is not an animatable endpoint), and
    // observing the live body also catches the counter and error rows without
    // ever measuring an outgoing step.
    const measureRef = useRef<HTMLDivElement>(null)
    const [cardHeight, setCardHeight] = useState<number | null>(null)
    useEffect(() => {
        const el = measureRef.current
        if (!el || typeof ResizeObserver === "undefined") return
        let frame = 0
        const commit = (height: number) => {
            if (height <= 0) return
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(() => setCardHeight(Math.round(height)))
        }
        commit(el.getBoundingClientRect().height)
        const observer = new ResizeObserver(([entry]) => commit(entry.contentRect.height))
        observer.observe(el)
        return () => {
            cancelAnimationFrame(frame)
            observer.disconnect()
        }
    }, [isOpen, step])

    const cardStyle: React.CSSProperties | undefined =
        reduced || cardHeight == null ? undefined : { height: cardHeight }

    const closeModal = () => onClose()

    const dismissLaterAndClose = useCallback(() => {
        // Use the ref so the soft-dismiss guard stays correct even if the
        // effect that owns this callback doesn't re-run on every step flip.
        if (stepRef.current === "review") void onDismissLater?.()
        closeModal()
    }, [onDismissLater])

    const dismissForeverAndClose = useCallback(() => {
        if (stepRef.current === "review") void onDismissForever?.()
        closeModal()
    }, [onDismissForever])

    const handleSubmitReview = async () => {
        if (rating < 1 || rating > 5 || text.length > MAX_CHARS || submitting) return
        setSubmitting(true)
        setSubmitError(null)
        try {
            const res = await submitReview({
                rating,
                review_text: text.trim().length > 0 ? text.trim() : null,
            })
            if (!res.ok) {
                setSubmitError(errorCopy(res.error, "Couldn't share that. Try again."))
                setSubmitting(false)
                return
            }
            setReviewId(res.id || null)
            setStep("testimonial")
            setSubmitting(false)
            if (res.id) onSubmitted?.(res.id)
        } catch {
            // A throw here is transport-level (offline, DNS, abort). The raw
            // message is never useful to a user, so don't surface it.
            setSubmitError(ERROR_COPY.network_error)
            setSubmitting(false)
        }
    }

    // Shared by both attribution buttons. Save credits the review under
    // `name`; Keep anonymous credits it as "Anonymous Natively user" — either
    // way the review becomes public, only the byline differs.
    const submitTestimonial = async (credited: boolean) => {
        if (!reviewId) {
            // No id came back from the create call, so there is nothing to
            // attribute. The rating itself WAS recorded, so go to the receipt
            // rather than failing — but flag it, because otherwise the receipt
            // claims "Published as Anonymous Natively user" when in fact
            // can_use_publicly is still false and nothing will be published.
            setAttributionSkipped(true)
            setStep("thanks")
            return
        }
        setTestimonialBusy(true)
        setTestimonialAction(credited ? "credited" : "anonymous")
        setTestimonialError(null)
        try {
            const res = await updateTestimonial(reviewId, {
                name: credited ? (name.trim() || null) : null,
                role: null,
                company: null,
                can_use_publicly: true,
                display_name_publicly: credited,
            })
            if (!res.ok) {
                setTestimonialError(errorCopy(res.error, "Couldn't save that. Try again."))
                setTestimonialBusy(false)
                setTestimonialAction(null)
                return
            }
            setDisplayNamePublicly(credited)
            setTestimonialBusy(false)
            setTestimonialAction(null)
            setStep("thanks")
        } catch {
            setTestimonialError(ERROR_COPY.network_error)
            setTestimonialBusy(false)
            setTestimonialAction(null)
        }
    }

    const handleSaveTestimonial = () => submitTestimonial(true)
    const handleKeepAnonymous = () => submitTestimonial(false)

    const shownRating = hoverRating || rating
    const ratingWord = useMemo(
        () => (shownRating === 0 ? "Not yet rated" : RATING_WORDS[shownRating]),
        [shownRating],
    )

    if (!isOpen) return null

    const titleId = `review-modal-title-${step}`
    const busy = submitting || testimonialBusy

    return (
        <AnimatePresence>
            <motion.div
                key="backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={rt(reduced, { duration: 0.2 })}
                onClick={() => !busy && dismissLaterAndClose()}
                className="review-modal-backdrop"
            />
            <motion.div
                key="container"
                initial={{ opacity: 0, transform: reduced ? "none" : "translateY(10px) scale(0.985)" }}
                animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
                exit={{ opacity: 0, transform: reduced ? "none" : "translateY(6px) scale(0.99)" }}
                transition={rt(reduced, SPRING_SNAPPY)}
                className="review-modal-viewport"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
            >
                <motion.div
                    initial={false}
                    style={cardStyle}
                    className="review-modal-shell"
                >
                    <div className="review-modal-ambient" aria-hidden />

                    <button
                        type="button"
                        onClick={dismissLaterAndClose}
                        disabled={busy}
                        aria-label="Close"
                        className="review-close"
                    >
                        <X size={16} strokeWidth={1.6} />
                    </button>

                    <div ref={measureRef} className="review-modal-measure">
                        <AnimatePresence mode="wait">
                            {step === "review" && (
                                <StepReview
                                    key="review"
                                    rating={rating}
                                    shownRating={shownRating}
                                    ratingWord={ratingWord}
                                    setRating={setRating}
                                    setHoverRating={setHoverRating}
                                    text={text}
                                    setText={setText}
                                    maxChars={MAX_CHARS}
                                    submitting={submitting}
                                    error={submitError}
                                    onSubmit={handleSubmitReview}
                                    onDismissLater={dismissLaterAndClose}
                                    onDismissForever={dismissForeverAndClose}
                                    textareaRef={textareaRef}
                                    reduced={reduced}
                                />
                            )}
                            {step === "testimonial" && (
                                <StepTestimonial
                                    key="testimonial"
                                    rating={rating}
                                    name={name}
                                    setName={setName}
                                    prefillName={prefillName}
                                    namePrefillSuggested={namePrefillSuggested}
                                    onAcceptNamePrefill={() => {
                                        if (prefillName) {
                                            setName(prefillName.trim())
                                            setNamePrefillUsed(true)
                                        }
                                    }}
                                    busy={testimonialBusy}
                                    action={testimonialAction}
                                    error={testimonialError}
                                    onSave={handleSaveTestimonial}
                                    onKeepAnonymous={handleKeepAnonymous}
                                    reduced={reduced}
                                />
                            )}
                            {step === "thanks" && (
                                <StepThanks
                                    key="thanks"
                                    displayNamePublicly={displayNamePublicly}
                                    name={name}
                                    attributionSkipped={attributionSkipped}
                                    reduced={reduced}
                                />
                            )}
                        </AnimatePresence>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    )
}

// ─── Shared pieces ─────────────────────────────────────────────────────────

/** The black left plate. Its content is the step's "cover". */
const Plate: React.FC<{ eyebrow: string; children: React.ReactNode; caption?: string }> = ({
    eyebrow, children, caption,
}) => (
    <aside className="review-plate">
        <span className="review-plate-eyebrow">{eyebrow}</span>
        <div className="review-plate-figure">{children}</div>
        {caption && <span className="review-plate-caption">{caption}</span>}
    </aside>
)

const Spinner: React.FC<{ tone: "ink" | "ivory"; reduced: boolean }> = ({ tone, reduced }) => (
    <motion.span
        aria-hidden
        animate={reduced ? {} : { rotate: 360 }}
        transition={{ duration: 0.75, repeat: Infinity, ease: "linear" }}
        className={`review-spinner review-spinner-${tone}`}
    />
)

const ReviewError: React.FC<{ error: string | null }> = ({ error }) => (
    <AnimatePresence initial={false}>
        {error && (
            <motion.p
                key="error"
                role="alert"
                initial={{ opacity: 0, transform: "translateY(-4px)" }}
                animate={{ opacity: 1, transform: "translateY(0px)" }}
                exit={{ opacity: 0, transform: "translateY(-3px)" }}
                transition={{ duration: 0.16, ease: EASE_EDITORIAL }}
                className="review-error"
            >
                {error}
            </motion.p>
        )}
    </AnimatePresence>
)

/** Step wrapper: the two-column grid plus the shared enter/exit. */
const StepFrame: React.FC<{ variant: string; reduced: boolean; children: React.ReactNode }> = ({
    variant, reduced, children,
}) => (
    <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, transform: "translateX(14px)" }}
        animate={{ opacity: 1, transform: "translateX(0px)" }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, transform: "translateX(-10px)" }}
        transition={rt(reduced, { duration: 0.24, ease: EASE_EDITORIAL })}
        className={`review-grid review-grid-${variant}`}
    >
        {children}
    </motion.div>
)

// ─── Step 1: review ────────────────────────────────────────────────────────

interface StepReviewProps {
    rating: number
    shownRating: number
    ratingWord: string
    setRating: (n: number) => void
    setHoverRating: (n: number) => void
    text: string
    setText: (s: string) => void
    maxChars: number
    submitting: boolean
    error: string | null
    onSubmit: () => void
    onDismissLater: () => void
    onDismissForever: () => void
    textareaRef: React.RefObject<HTMLTextAreaElement | null>
    reduced: boolean
}

const StepReview: React.FC<StepReviewProps> = ({
    rating, shownRating, ratingWord, setRating, setHoverRating,
    text, setText, maxChars, submitting, error,
    onSubmit, onDismissLater, onDismissForever, textareaRef, reduced,
}) => {
    const remaining = maxChars - text.length
    const showCounter = remaining <= 60
    const canSubmit = rating >= 1 && rating <= 5 && !submitting

    // Arrow-key navigation for the radio group (ARIA APG).
    const handleStarKey = useCallback((e: React.KeyboardEvent<HTMLButtonElement>, n: number) => {
        const move = (to: number) => {
            e.preventDefault()
            setRating(to)
            document.querySelector<HTMLButtonElement>(`[data-review-star="${to}"]`)?.focus()
        }
        if (e.key === "ArrowRight" || e.key === "ArrowUp") move(Math.min(n + 1, 5))
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") move(Math.max(n - 1, 1))
        else if (e.key === "Home") move(1)
        else if (e.key === "End") move(5)
    }, [setRating])

    return (
        <StepFrame variant="review" reduced={reduced}>
            <Plate eyebrow="REVIEW · 1 OF 3" caption={ratingWord}>
                <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                        key={shownRating}
                        initial={reduced ? { opacity: 0 } : { opacity: 0, transform: "translateY(14px)" }}
                        animate={{ opacity: 1, transform: "translateY(0px)" }}
                        exit={reduced ? { opacity: 0 } : { opacity: 0, transform: "translateY(-14px)" }}
                        transition={rt(reduced, { duration: 0.2, ease: EASE_EDITORIAL })}
                        className="review-numeral"
                    >
                        {shownRating === 0 ? "—" : shownRating}
                    </motion.span>
                </AnimatePresence>
            </Plate>

            <section className="review-column">
                <h2 id="review-modal-title-review" className="review-headline">
                    How is Natively<br />treating you?
                </h2>
                <p className="review-standfirst">
                    One rating, thirty seconds. It genuinely shapes what we build next.
                </p>

                <div
                    className="review-rating-rail"
                    role="radiogroup"
                    aria-label="Star rating"
                    onMouseLeave={() => setHoverRating(0)}
                >
                    {[1, 2, 3, 4, 5].map((n, i) => (
                        <motion.button
                            key={n}
                            type="button"
                            role="radio"
                            aria-checked={rating === n}
                            aria-label={`${n} star${n > 1 ? "s" : ""}`}
                            data-review-star={n}
                            data-filled={n <= shownRating || undefined}
                            initial={{ opacity: 0, transform: reduced ? "none" : "translateY(6px)" }}
                            animate={{ opacity: 1, transform: "translateY(0px)" }}
                            transition={{ ...(reduced ? { duration: 0 } : SPRING_BOUNCY), delay: reduced ? 0 : i * 0.03 }}
                            whileTap={reduced || submitting ? undefined : { scale: 0.9 }}
                            onMouseEnter={() => !submitting && setHoverRating(n)}
                            onFocus={() => !submitting && setHoverRating(n)}
                            onClick={() => setRating(n)}
                            onKeyDown={(e) => handleStarKey(e, n)}
                            disabled={submitting}
                            className="review-star"
                        >
                            <Star size={22} strokeWidth={1.5} />
                        </motion.button>
                    ))}
                </div>

                <div className="review-note">
                    <textarea
                        id="review-text"
                        ref={textareaRef}
                        value={text}
                        onChange={(e) => setText(e.target.value.slice(0, maxChars))}
                        placeholder="What worked, what didn't, what surprised you…"
                        rows={2}
                        disabled={submitting}
                        aria-label="Optional feedback"
                        className="review-note-input"
                    />
                    <AnimatePresence initial={false}>
                        {showCounter && (
                            <motion.span
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className={`review-counter ${remaining <= 20 ? "is-close" : ""}`}
                            >
                                {remaining}
                            </motion.span>
                        )}
                    </AnimatePresence>
                </div>

                <ReviewError error={error} />

                <div className="review-actions">
                    <motion.button
                        type="button"
                        onClick={onSubmit}
                        disabled={!canSubmit}
                        whileTap={reduced || !canSubmit ? undefined : { scale: 0.975 }}
                        transition={SPRING_SNAPPY}
                        className="review-cta"
                    >
                        {submitting ? <><Spinner tone="ink" reduced={reduced} />Sending</> : "Send rating"}
                    </motion.button>
                    <div className="review-quiet-row">
                        <button type="button" onClick={onDismissLater} disabled={submitting} className="review-quiet">
                            Maybe later
                        </button>
                        <button type="button" onClick={onDismissForever} disabled={submitting} className="review-quiet is-faint">
                            Never ask
                        </button>
                    </div>
                </div>
            </section>
        </StepFrame>
    )
}

// ─── Step 2: testimonial ──────────────────────────────────────────────────

interface StepTestimonialProps {
    rating: number
    name: string
    setName: (s: string) => void
    prefillName?: string
    namePrefillSuggested: boolean
    onAcceptNamePrefill: () => void
    busy: boolean
    action: "credited" | "anonymous" | null
    error: string | null
    onSave: () => void
    onKeepAnonymous: () => void
    reduced: boolean
}

const StepTestimonial: React.FC<StepTestimonialProps> = ({
    rating, name, setName, prefillName = "", namePrefillSuggested, onAcceptNamePrefill,
    busy, action, error, onSave, onKeepAnonymous, reduced,
}) => {
    // Save credits the review under `name` — a blank name has nothing to
    // credit, so it stays disabled until one is entered. Keep anonymous never
    // reads the field, so it is available throughout.
    const canSave = !busy && name.trim().length > 0

    return (
        <StepFrame variant="credit" reduced={reduced}>
            <Plate eyebrow="ATTRIBUTION · 2 OF 3" caption={`${rating} of 5 · recorded`}>
                <span className="review-quote" aria-hidden>&ldquo;</span>
            </Plate>

            <section className="review-column">
                <h2 id="review-modal-title-testimonial" className="review-headline">
                    Whose words<br />are these?
                </h2>
                <p className="review-standfirst">
                    Sign it, or send the very same words unsigned. Only the byline changes.
                </p>

                <div className="review-signature">
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={busy}
                        autoComplete="name"
                        aria-label="Your name"
                        placeholder="Your name"
                        className="review-signature-input"
                    />
                    <span className="review-signature-rule" aria-hidden />
                </div>

                <AnimatePresence initial={false}>
                    {namePrefillSuggested && prefillName.trim() && (
                        <motion.button
                            key="prefill"
                            type="button"
                            initial={{ opacity: 0, transform: reduced ? "none" : "translateY(3px)" }}
                            animate={{ opacity: 1, transform: "translateY(0px)" }}
                            exit={{ opacity: 0 }}
                            transition={rt(reduced, { duration: 0.17, ease: EASE_EDITORIAL })}
                            onClick={onAcceptNamePrefill}
                            className="review-prefill"
                        >
                            Use <strong>{prefillName.trim()}</strong>
                        </motion.button>
                    )}
                </AnimatePresence>

                <ReviewError error={error} />

                <div className="review-actions">
                    <div className="review-choice">
                        <motion.button
                            type="button"
                            onClick={onSave}
                            disabled={!canSave}
                            whileTap={reduced || !canSave ? undefined : { scale: 0.975 }}
                            transition={SPRING_SNAPPY}
                            className="review-cta"
                        >
                            {action === "credited" ? <><Spinner tone="ink" reduced={reduced} />Signing</> : "Save with name"}
                        </motion.button>
                        <motion.button
                            type="button"
                            onClick={onKeepAnonymous}
                            disabled={busy}
                            whileTap={reduced || busy ? undefined : { scale: 0.975 }}
                            transition={SPRING_SNAPPY}
                            className="review-ghost"
                        >
                            {action === "anonymous" ? <><Spinner tone="ivory" reduced={reduced} />Sending</> : "Keep anonymous"}
                        </motion.button>
                    </div>
                    <p className="review-fineprint">
                        <Lock size={11} strokeWidth={1.7} aria-hidden />
                        Never published without permission. Removal on request.
                    </p>
                </div>
            </section>
        </StepFrame>
    )
}

// ─── Step 3: thanks ───────────────────────────────────────────────────────

/**
 * The receipt. Deliberately NOT the two-column plate the other steps use: a
 * terminal state has one short message, and forcing it into that grid left a
 * lone seal adrift in an otherwise empty plate. A centred single column is
 * both calmer and the third distinct silhouette the flow wants.
 *
 * The byline is shown verbatim rather than described, so the last thing the
 * user sees is exactly what will be published.
 */
const StepThanks: React.FC<{
    displayNamePublicly: boolean
    name: string
    attributionSkipped: boolean
    reduced: boolean
}> = ({ displayNamePublicly, name, attributionSkipped, reduced }) => {
    const byline = displayNamePublicly && name.trim() ? name.trim() : "Anonymous Natively user"
    // Staggered so the eye lands seal → headline → byline in one beat.
    const step = (i: number) => ({
        initial: reduced ? { opacity: 0 } : { opacity: 0, transform: "translateY(7px)" },
        animate: { opacity: 1, transform: "translateY(0px)" },
        transition: rt(reduced, { duration: 0.3, ease: EASE_EDITORIAL, delay: 0.06 + i * 0.06 }),
    })

    return (
        <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, transform: "translateX(14px)" }}
            animate={{ opacity: 1, transform: "translateX(0px)" }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, transform: "translateX(-10px)" }}
            transition={rt(reduced, { duration: 0.24, ease: EASE_EDITORIAL })}
            className="review-receipt"
        >
            <motion.span
                className="review-seal"
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.72 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ ...(reduced ? { duration: 0 } : SPRING_CELEBRATE), delay: reduced ? 0 : 0.04 }}
            >
                <Check size={24} strokeWidth={2.1} aria-hidden />
            </motion.span>

            <motion.h2 id="review-modal-title-thanks" className="review-receipt-headline" {...step(0)}>
                Received
            </motion.h2>

            {attributionSkipped ? (
                <motion.p className="review-receipt-only" {...step(1)}>
                    Your rating was recorded.
                </motion.p>
            ) : (
                <>
                    <motion.p className="review-receipt-note" {...step(1)}>
                        Published as
                    </motion.p>
                    <motion.p className="review-byline" {...step(2)}>
                        {byline}
                    </motion.p>
                </>
            )}

            <motion.div className="review-thanks-timer" aria-hidden {...step(3)}>
                <span className="review-thanks-countdown" />
            </motion.div>
        </motion.div>
    )
}

export default ReviewModal
