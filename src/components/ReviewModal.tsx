// src/components/ReviewModal.tsx
// In-app review + testimonial collection modal.
//
// Two-step morph:
//   Step 1 ("review")    — rating + optional 300-char text
//   Step 2 ("testimonial") — optional name/role/company + public-testimonial permission
//   Step 3 ("thanks")    — confirmation
//
// Polished, accessible, keyboard-navigable. Re-uses the FollowUpEmailModal visual
// idiom (dark glass + framer-motion morph) so it feels native. All motion is
// gated on `useReducedMotion()`.

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { Star, X, Lock, CheckCircle2 } from "lucide-react"

const MAX_CHARS = 300

// ─── Spring presets ────────────────────────────────────────────────────────
// Defined once at module level so they are never recreated on render.

const SPRING_SNAPPY    = { type: "spring" as const, stiffness: 380, damping: 32 }
const SPRING_BOUNCY    = { type: "spring" as const, stiffness: 550, damping: 22 }
const SPRING_CELEBRATE = { type: "spring" as const, stiffness: 550, damping: 18 }

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
    prefillRole?: string
    prefillCompany?: string
    hardwareId?: string
    appVersion?: string
    buildChannel?: string
    platform?: "macos" | "windows" | "linux" | "other"
    submitReview: (payload: {
        rating: number
        review_text: string | null
        app_version: string
        platform: string
        build_channel: string
        hardware_id: string | null
        email: string | null
    }) => Promise<{ ok: boolean; id?: string; error?: string }>
    updateTestimonial: (id: string, payload: {
        name: string | null
        role: string | null
        company: string | null
        can_use_publicly: boolean
        display_name_publicly: boolean
        hardware_id: string | null
    }) => Promise<{ ok: boolean; error?: string }>
}

type Step = "review" | "testimonial" | "thanks"

const ReviewModal: React.FC<ReviewModalProps> = ({
    isOpen,
    onClose,
    onDismissLater,
    onDismissForever,
    onSubmitted,
    prefillName = "",
    prefillRole = "",
    prefillCompany = "",
    hardwareId,
    appVersion = "",
    buildChannel = "",
    platform = "other",
    submitReview,
    updateTestimonial,
}) => {
    const reduced = useReducedMotion() ?? false
    const [step, setStep] = useState<Step>("review")
    const [rating, setRating] = useState<number>(0)
    const [hoverRating, setHoverRating] = useState<number>(0)
    const [text, setText] = useState("")
    const [submitting, setSubmitting] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)

    // Testimonial state
    const [reviewId, setReviewId] = useState<string | null>(null)
    // SOFT PREFILL only — prefilled values are held in *separate* state, NOT
    // copied into the live form fields. The user must explicitly opt in to
    // use each prefill via the chip button.
    const [name, setName] = useState("")
    const [role, setRole] = useState("")
    const [company, setCompany] = useState("")
    const [namePrefillUsed, setNamePrefillUsed] = useState(false)
    const [rolePrefillUsed, setRolePrefillUsed] = useState(false)
    const [companyPrefillUsed, setCompanyPrefillUsed] = useState(false)
    const [canUsePublicly, setCanUsePublicly] = useState(false)
    const [displayNamePublicly, setDisplayNamePublicly] = useState(false)
    const [testimonialBusy, setTestimonialBusy] = useState(false)
    const [testimonialError, setTestimonialError] = useState<string | null>(null)

    const textareaRef = useRef<HTMLTextAreaElement | null>(null)

    const namePrefillSuggested    = !namePrefillUsed    && !name    && !!prefillName?.trim()
    const rolePrefillSuggested    = !rolePrefillUsed    && !role    && !!prefillRole?.trim()
    const companyPrefillSuggested = !companyPrefillUsed && !company && !!prefillCompany?.trim()

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
            setRole("")
            setCompany("")
            setNamePrefillUsed(false)
            setRolePrefillUsed(false)
            setCompanyPrefillUsed(false)
            setCanUsePublicly(false)
            setDisplayNamePublicly(false)
            setTestimonialBusy(false)
            setTestimonialError(null)
        }
    }, [isOpen])

    // Move focus to the first star button when the modal opens (after the
    // spring settles) so keyboard users land in the right place.
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

    const closeModal = () => onClose()

    const dismissLaterAndClose = () => {
        if (step === "review") void onDismissLater?.()
        closeModal()
    }

    const dismissForeverAndClose = () => {
        if (step === "review") void onDismissForever?.()
        closeModal()
    }

    const handleSubmitReview = async () => {
        if (rating < 1 || rating > 5 || text.length > MAX_CHARS || submitting) return
        setSubmitting(true)
        setSubmitError(null)
        try {
            const res = await submitReview({
                rating,
                review_text: text.trim().length > 0 ? text.trim() : null,
                app_version: appVersion,
                platform,
                build_channel: buildChannel,
                hardware_id: hardwareId || null,
                email: null,
            })
            if (!res.ok) {
                setSubmitError(res.error || "Couldn't share. Try again.")
                setSubmitting(false)
                return
            }
            setReviewId(res.id || null)
            setStep("testimonial")
            setSubmitting(false)
            if (res.id) onSubmitted?.(res.id)
        } catch (err: any) {
            setSubmitError(err?.message || "Network error.")
            setSubmitting(false)
        }
    }

    const handleSaveTestimonial = async () => {
        if (!reviewId) {
            // ReviewId missing — go straight to thanks rather than silently failing.
            setStep("thanks")
            return
        }
        setTestimonialBusy(true)
        setTestimonialError(null)
        try {
            const res = await updateTestimonial(reviewId, {
                name: name.trim() || null,
                role: role.trim() || null,
                company: company.trim() || null,
                can_use_publicly: canUsePublicly,
                display_name_publicly: displayNamePublicly,
                hardware_id: hardwareId || null,
            })
            if (!res.ok) {
                setTestimonialError(res.error || "Couldn't save. Try again.")
                setTestimonialBusy(false)
                return
            }
            setTestimonialBusy(false)
            setStep("thanks")
        } catch (err: any) {
            setTestimonialError(err?.message || "Network error.")
            setTestimonialBusy(false)
        }
    }

    const handleSkipTestimonial = () => {
        setStep("thanks")
    }

    const ratingLabel = useMemo(() => {
        if (rating === 0) return "Tap a star to rate"
        if (rating === 1) return "Poor"
        if (rating === 2) return "Fair"
        if (rating === 3) return "Good"
        if (rating === 4) return "Great"
        return "Excellent"
    }, [rating])

    if (!isOpen) return null

    // Accessible title id. Must be unique per step to avoid duplicate IDs while
    // framer-motion is mid-exit on the previous step.
    const titleId = `review-modal-title-${step === "thanks" ? "review" : step}`

    return (
        <AnimatePresence>
            <motion.div
                key="backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={rt(reduced, { duration: 0.18 })}
                onClick={() => !submitting && !testimonialBusy && dismissLaterAndClose()}
                className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60]"
            />
            <motion.div
                key="container"
                initial={{ opacity: 0, scale: reduced ? 1 : 0.96, y: reduced ? 0 : 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: reduced ? 1 : 0.97, y: reduced ? 0 : 5 }}
                transition={rt(reduced, SPRING_SNAPPY)}
                className="fixed inset-0 z-[60] flex items-center justify-center p-4 pointer-events-none"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
            >
                <div className="w-full max-w-[520px] bg-[#121212]/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/[0.08] flex flex-col pointer-events-auto overflow-hidden ring-1 ring-white/5">
                    <AnimatePresence mode="wait">
                        {step === "review" && (
                            <StepReview
                                key="review"
                                rating={rating}
                                hoverRating={hoverRating}
                                setRating={setRating}
                                setHoverRating={setHoverRating}
                                text={text}
                                setText={setText}
                                maxChars={MAX_CHARS}
                                submitting={submitting}
                                error={submitError}
                                ratingLabel={ratingLabel}
                                onSubmit={handleSubmitReview}
                                onClose={dismissLaterAndClose}
                                onDismissLater={dismissLaterAndClose}
                                onDismissForever={dismissForeverAndClose}
                                textareaRef={textareaRef}
                                reduced={reduced}
                            />
                        )}
                        {step === "testimonial" && (
                            <StepTestimonial
                                key="testimonial"
                                name={name}
                                setName={setName}
                                role={role}
                                setRole={setRole}
                                company={company}
                                setCompany={setCompany}
                                prefillName={prefillName}
                                prefillRole={prefillRole}
                                prefillCompany={prefillCompany}
                                namePrefillSuggested={namePrefillSuggested}
                                rolePrefillSuggested={rolePrefillSuggested}
                                companyPrefillSuggested={companyPrefillSuggested}
                                onAcceptNamePrefill={() => {
                                    if (prefillName) {
                                        setName(prefillName.trim())
                                        setNamePrefillUsed(true)
                                    }
                                }}
                                onAcceptRolePrefill={() => {
                                    if (prefillRole) {
                                        setRole(prefillRole.trim())
                                        setRolePrefillUsed(true)
                                    }
                                }}
                                onAcceptCompanyPrefill={() => {
                                    if (prefillCompany) {
                                        setCompany(prefillCompany.trim())
                                        setCompanyPrefillUsed(true)
                                    }
                                }}
                                canUsePublicly={canUsePublicly}
                                setCanUsePublicly={setCanUsePublicly}
                                displayNamePublicly={displayNamePublicly}
                                setDisplayNamePublicly={setDisplayNamePublicly}
                                busy={testimonialBusy}
                                error={testimonialError}
                                onSave={handleSaveTestimonial}
                                onSkip={handleSkipTestimonial}
                                onClose={closeModal}
                                reduced={reduced}
                            />
                        )}
                        {step === "thanks" && (
                            <StepThanks
                                key="thanks"
                                canUsePublicly={canUsePublicly}
                                displayNamePublicly={displayNamePublicly}
                                onClose={closeModal}
                                reduced={reduced}
                            />
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>
        </AnimatePresence>
    )
}

// ─── Step 1: review ────────────────────────────────────────────────────────

interface StepReviewProps {
    rating: number
    hoverRating: number
    setRating: (n: number) => void
    setHoverRating: (n: number) => void
    text: string
    setText: (s: string) => void
    maxChars: number
    submitting: boolean
    error: string | null
    ratingLabel: string
    onSubmit: () => void
    onClose: () => void
    onDismissLater: () => void
    onDismissForever: () => void
    textareaRef: React.RefObject<HTMLTextAreaElement | null>
    reduced: boolean
}

const StepReview: React.FC<StepReviewProps> = ({
    rating, hoverRating, setRating, setHoverRating,
    text, setText, maxChars, submitting, error,
    ratingLabel, onSubmit, onClose, onDismissLater, onDismissForever,
    textareaRef, reduced,
}) => {
    const remaining = maxChars - text.length
    const textOver = remaining < 0
    // Counter only appears when the user is near the limit — avoids the
    // distraction of seeing 0 / 300 from a blank textarea.
    const showCounter = remaining <= 60
    const canSubmit = rating >= 1 && rating <= 5 && !textOver && !submitting

    // Arrow-key navigation for the radio group (ARIA APG).
    const handleStarKey = useCallback((e: React.KeyboardEvent<HTMLButtonElement>, n: number) => {
        if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault()
            const next = Math.min(n + 1, 5)
            setRating(next)
            document.querySelector<HTMLButtonElement>(`[data-review-star="${next}"]`)?.focus()
        } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault()
            const prev = Math.max(n - 1, 1)
            setRating(prev)
            document.querySelector<HTMLButtonElement>(`[data-review-star="${prev}"]`)?.focus()
        }
    }, [setRating])

    return (
        <motion.div
            initial={{ opacity: 0, y: reduced ? 0 : 8, scale: reduced ? 1 : 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: reduced ? 0 : -6, scale: reduced ? 1 : 0.99 }}
            transition={rt(reduced, SPRING_SNAPPY)}
        >
            <div className="flex px-6 py-4 justify-between items-center border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                    <Star size={14} className="text-amber-400" />
                    <h2 id="review-modal-title-review" className="text-sm font-medium text-[#E9E9E9] tracking-wide">
                        How's Natively working for you?
                    </h2>
                </div>
                <motion.button
                    onClick={onClose}
                    aria-label="Close"
                    whileHover={reduced ? undefined : { scale: 1.05 }}
                    whileTap={reduced ? undefined : { scale: 0.92 }}
                    transition={SPRING_BOUNCY}
                    className="text-[#71717A] hover:text-white transition-colors bg-white/5 hover:bg-white/10 p-1.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                >
                    <X size={14} />
                </motion.button>
            </div>
            <div className="px-8 pt-6 pb-6 space-y-6">
                {/* Star rating */}
                <div
                    className="flex flex-col items-center gap-2 py-2"
                    onMouseLeave={() => setHoverRating(0)}
                >
                    <div
                        className="flex gap-1.5"
                        role="radiogroup"
                        aria-label="Star rating"
                    >
                        {[1, 2, 3, 4, 5].map((n, i) => {
                            const filled = n <= (hoverRating || rating)
                            return (
                                <motion.button
                                    key={n}
                                    role="radio"
                                    aria-checked={rating === n}
                                    aria-label={`${n} star${n > 1 ? "s" : ""}`}
                                    data-review-star={n}
                                    initial={{ opacity: 0, scale: reduced ? 1 : 0.4 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{
                                        ...(reduced ? { duration: 0 } : SPRING_BOUNCY),
                                        delay: reduced ? 0 : 0.04 + i * 0.05,
                                    }}
                                    whileHover={reduced || submitting ? undefined : { scale: 1.22 }}
                                    whileTap={reduced || submitting ? undefined : { scale: 0.85 }}
                                    onMouseEnter={() => !submitting && setHoverRating(n)}
                                    onClick={() => setRating(n)}
                                    onKeyDown={(e) => handleStarKey(e, n)}
                                    disabled={submitting}
                                    className="p-1.5 rounded transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/80"
                                >
                                    <motion.span
                                        animate={{
                                            opacity: filled ? 1 : 0.38,
                                            scale: filled ? 1 : reduced ? 1 : 0.88,
                                        }}
                                        transition={reduced ? { duration: 0 } : {
                                            opacity: { duration: 0.14 },
                                            scale: SPRING_BOUNCY,
                                        }}
                                        style={{ display: "block" }}
                                    >
                                        <Star
                                            size={32}
                                            className={filled ? "text-amber-400 fill-amber-400" : "text-[#3F3F46]"}
                                            strokeWidth={1.5}
                                        />
                                    </motion.span>
                                </motion.button>
                            )
                        })}
                    </div>
                    <AnimatePresence mode="wait">
                        <motion.span
                            key={ratingLabel}
                            initial={{ opacity: 0, y: 3 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -3 }}
                            transition={{ duration: 0.15 }}
                            className="text-[12px] text-[#71717A] h-4"
                            aria-live="polite"
                        >
                            {ratingLabel}
                        </motion.span>
                    </AnimatePresence>
                </div>

                {/* Review text */}
                <div className="space-y-1.5">
                    <label htmlFor="review-text" className="block text-[12px] font-medium text-[#71717A]">
                        What stood out?
                    </label>
                    <textarea
                        id="review-text"
                        ref={textareaRef}
                        value={text}
                        onChange={(e) => setText(e.target.value.slice(0, maxChars))}
                        placeholder="Tell us what worked, what didn't, what surprised you…"
                        rows={3}
                        disabled={submitting}
                        className={`w-full bg-[#0A0A0A]/60 text-[#E9E9E9] placeholder-[#52525B] text-[13px] rounded-lg border px-3 py-2 resize-none focus:outline-none transition-colors ${
                            textOver
                                ? "border-red-500/60"
                                : "border-white/10 focus:border-white/20"
                        }`}
                        aria-invalid={textOver}
                    />
                    <AnimatePresence>
                        {showCounter && (
                            <motion.div
                                key="counter"
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={SPRING_SNAPPY}
                                className="overflow-hidden"
                            >
                                <div
                                    className={`flex justify-end text-[11px] ${
                                        textOver ? "text-red-400"
                                            : remaining <= 40 ? "text-amber-400"
                                            : "text-[#71717A]"
                                    }`}
                                >
                                    <span>
                                        {textOver
                                            ? `${Math.abs(remaining)} over`
                                            : `${text.length} / ${maxChars}`}
                                    </span>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Error */}
                <AnimatePresence>
                    {error && (
                        <motion.div
                            key="error"
                            role="alert"
                            initial={{ opacity: 0, y: -6, height: 0 }}
                            animate={{ opacity: 1, y: 0, height: "auto" }}
                            exit={{ opacity: 0, y: -4, height: 0 }}
                            transition={SPRING_SNAPPY}
                            className="overflow-hidden"
                        >
                            <div className="text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
                                {error}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Submit */}
                <motion.button
                    onClick={onSubmit}
                    disabled={!canSubmit}
                    whileHover={reduced || !canSubmit ? undefined : { y: -1, filter: "brightness(1.07)" }}
                    whileTap={reduced || !canSubmit ? undefined : { scale: 0.97 }}
                    transition={SPRING_SNAPPY}
                    className="w-full py-2.5 rounded-lg text-[13px] font-medium transition-colors bg-amber-500 hover:bg-amber-400 disabled:bg-[#27272A] disabled:text-[#71717A] disabled:cursor-not-allowed text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                >
                    {submitting ? (
                        <span className="inline-flex items-center gap-2">
                            <motion.span
                                animate={reduced ? {} : { rotate: 360 }}
                                transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                                className="block w-3.5 h-3.5 rounded-full border-2 border-black/30 border-t-black"
                            />
                            Sharing…
                        </span>
                    ) : (
                        "Share feedback"
                    )}
                </motion.button>

                <div className="flex items-center justify-center gap-3 pt-1">
                    <motion.button
                        type="button"
                        onClick={onDismissLater}
                        disabled={submitting}
                        whileHover={reduced ? undefined : { opacity: 0.82 }}
                        whileTap={reduced ? undefined : { scale: 0.96 }}
                        transition={{ duration: 0.10 }}
                        className="text-[12px] text-[#A1A1AA] hover:text-white transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:underline"
                    >
                        Maybe later
                    </motion.button>
                    <span className="text-[#3F3F46] text-[11px]">•</span>
                    <motion.button
                        type="button"
                        onClick={onDismissForever}
                        disabled={submitting}
                        whileHover={reduced ? undefined : { opacity: 0.82 }}
                        whileTap={reduced ? undefined : { scale: 0.96 }}
                        transition={{ duration: 0.10 }}
                        className="text-[12px] text-[#71717A] hover:text-white transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:underline"
                    >
                        Never ask again
                    </motion.button>
                </div>
            </div>
        </motion.div>
    )
}

// ─── Step 2: testimonial ──────────────────────────────────────────────────

interface StepTestimonialProps {
    name: string
    setName: (s: string) => void
    role: string
    setRole: (s: string) => void
    company: string
    setCompany: (s: string) => void
    prefillName?: string
    prefillRole?: string
    prefillCompany?: string
    namePrefillSuggested: boolean
    rolePrefillSuggested: boolean
    companyPrefillSuggested: boolean
    onAcceptNamePrefill: () => void
    onAcceptRolePrefill: () => void
    onAcceptCompanyPrefill: () => void
    canUsePublicly: boolean
    setCanUsePublicly: (b: boolean) => void
    displayNamePublicly: boolean
    setDisplayNamePublicly: (b: boolean) => void
    busy: boolean
    error: string | null
    onSave: () => void
    onSkip: () => void
    onClose: () => void
    reduced: boolean
}

const StepTestimonial: React.FC<StepTestimonialProps> = ({
    name, setName, role, setRole, company, setCompany,
    prefillName = "", prefillRole = "", prefillCompany = "",
    namePrefillSuggested, rolePrefillSuggested, companyPrefillSuggested,
    onAcceptNamePrefill, onAcceptRolePrefill, onAcceptCompanyPrefill,
    canUsePublicly, setCanUsePublicly, displayNamePublicly, setDisplayNamePublicly,
    busy, error,
    onSave, onSkip, onClose, reduced,
}) => {
    return (
        <motion.div
            initial={{ opacity: 0, y: reduced ? 0 : 8, scale: reduced ? 1 : 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: reduced ? 0 : -6, scale: reduced ? 1 : 0.99 }}
            transition={rt(reduced, SPRING_SNAPPY)}
        >
            <div className="flex px-6 py-4 justify-between items-center border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                    <Star size={14} className="text-amber-400" />
                    <h2 id="review-modal-title-testimonial" className="text-sm font-medium text-[#E9E9E9] tracking-wide">
                        Share as a testimonial?
                    </h2>
                </div>
                <motion.button
                    onClick={onClose}
                    aria-label="Close"
                    whileHover={reduced ? undefined : { scale: 1.05 }}
                    whileTap={reduced ? undefined : { scale: 0.92 }}
                    transition={SPRING_BOUNCY}
                    className="text-[#71717A] hover:text-white transition-colors bg-white/5 hover:bg-white/10 p-1.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                >
                    <X size={14} />
                </motion.button>
            </div>
            <p className="px-8 pt-4 text-[12px] text-[#71717A]">All optional — you can stay anonymous.</p>
            <div className="px-8 pt-4 pb-6 space-y-4">
                <Field
                    label="Name"
                    value={name}
                    onChange={setName}
                    suggestion={prefillName?.trim() ?? ""}
                    onAcceptSuggestion={onAcceptNamePrefill}
                    isSuggestionAvailable={namePrefillSuggested}
                    disabled={busy}
                    reduced={reduced}
                />
                <Field
                    label="Role / Title"
                    value={role}
                    onChange={setRole}
                    suggestion={prefillRole?.trim() ?? ""}
                    onAcceptSuggestion={onAcceptRolePrefill}
                    isSuggestionAvailable={rolePrefillSuggested}
                    disabled={busy}
                    reduced={reduced}
                />
                <Field
                    label="Company"
                    value={company}
                    onChange={setCompany}
                    suggestion={prefillCompany?.trim() ?? ""}
                    onAcceptSuggestion={onAcceptCompanyPrefill}
                    isSuggestionAvailable={companyPrefillSuggested}
                    disabled={busy}
                    reduced={reduced}
                />

                <div className="space-y-2 pt-2">
                    <Checkbox
                        checked={canUsePublicly}
                        onChange={setCanUsePublicly}
                        label="Allow Natively to use this review publicly"
                        disabled={busy}
                        reduced={reduced}
                    />
                    <div className={canUsePublicly ? "" : "opacity-50 pointer-events-none"}>
                        <Checkbox
                            checked={displayNamePublicly}
                            onChange={setDisplayNamePublicly}
                            label="Show my name publicly"
                            disabled={busy || !canUsePublicly}
                            hint={canUsePublicly
                                ? "Otherwise shown as Anonymous Natively user."
                                : "Enable public use first."}
                            reduced={reduced}
                        />
                    </div>
                </div>

                <AnimatePresence>
                    {error && (
                        <motion.div
                            key="error"
                            role="alert"
                            initial={{ opacity: 0, y: -6, height: 0 }}
                            animate={{ opacity: 1, y: 0, height: "auto" }}
                            exit={{ opacity: 0, y: -4, height: 0 }}
                            transition={SPRING_SNAPPY}
                            className="overflow-hidden"
                        >
                            <div className="text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
                                {error}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <div className="flex items-center gap-2 pt-1">
                    <motion.button
                        onClick={onSave}
                        disabled={busy}
                        whileHover={reduced || busy ? undefined : { y: -1 }}
                        whileTap={reduced || busy ? undefined : { scale: 0.97 }}
                        transition={SPRING_SNAPPY}
                        className="flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-colors bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                    >
                        {busy ? (
                            <span className="inline-flex items-center justify-center gap-2">
                                <motion.span
                                    animate={reduced ? {} : { rotate: 360 }}
                                    transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                                    className="block w-3.5 h-3.5 rounded-full border-2 border-black/30 border-t-black"
                                />
                                Saving…
                            </span>
                        ) : "Save"}
                    </motion.button>
                    <motion.button
                        onClick={onSkip}
                        disabled={busy}
                        whileHover={reduced || busy ? undefined : { y: -1 }}
                        whileTap={reduced || busy ? undefined : { scale: 0.97 }}
                        transition={SPRING_SNAPPY}
                        className="flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-colors bg-white/5 hover:bg-white/10 text-[#E9E9E9] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                    >
                        Keep anonymous
                    </motion.button>
                </div>

                <div className="flex items-start gap-2 pt-1 text-[11px] text-[#71717A]">
                    <Lock size={11} className="mt-[2px] shrink-0" aria-hidden />
                    <span>We never publish without permission. Request removal anytime.</span>
                </div>
            </div>
        </motion.div>
    )
}

// ─── Field + Checkbox helpers ────────────────────────────────────────────

interface FieldProps {
    label: string
    value: string
    onChange: (s: string) => void
    suggestion: string
    onAcceptSuggestion: () => void
    isSuggestionAvailable: boolean
    disabled: boolean
    reduced: boolean
}

const Field: React.FC<FieldProps> = ({ label, value, onChange, suggestion, onAcceptSuggestion, isSuggestionAvailable, disabled, reduced }) => {
    return (
        <div className="space-y-1">
            <label className="block text-[12px] font-medium text-[#71717A]">{label}</label>
            <input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                className="w-full bg-[#0A0A0A]/60 text-[#E9E9E9] placeholder-[#52525B] text-[13px] rounded-lg border border-white/10 focus:border-white/20 px-3 py-2 focus:outline-none transition-colors focus:ring-2 focus:ring-white/10"
            />
            <AnimatePresence>
                {isSuggestionAvailable && suggestion && (
                    <motion.button
                        key="prefill-chip"
                        type="button"
                        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.92 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={reduced ? { opacity: 0 } : { opacity: 0, y: 2, scale: 0.95 }}
                        transition={SPRING_BOUNCY}
                        whileHover={reduced ? undefined : { scale: 1.02 }}
                        whileTap={reduced ? undefined : { scale: 0.96 }}
                        onClick={onAcceptSuggestion}
                        className="inline-flex items-center gap-1.5 text-[11px] text-[#71717A] hover:text-[#A1A1AA] bg-white/5 hover:bg-white/10 border border-white/[0.06] rounded-full px-2.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                    >
                        <span className="italic text-[#A1A1AA]">Use suggested:</span>
                        <span className="truncate max-w-[180px]">{suggestion}</span>
                    </motion.button>
                )}
            </AnimatePresence>
        </div>
    )
}

interface CheckboxProps {
    checked: boolean
    onChange: (b: boolean) => void
    label: string
    hint?: string
    disabled: boolean
    reduced: boolean
}

const Checkbox: React.FC<CheckboxProps> = ({ checked, onChange, label, hint, disabled, reduced }) => {
    return (
        <label className={`flex items-start gap-3 select-none ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
            <span className="relative mt-0.5 inline-flex w-4 h-4 shrink-0">
                <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => onChange(e.target.checked)}
                    disabled={disabled}
                    className="sr-only peer"
                />
                <span
                    className={`absolute inset-0 rounded border transition-colors duration-150 ${
                        checked ? "bg-amber-500 border-amber-400" : "bg-transparent border-white/20"
                    } peer-focus-visible:ring-2 peer-focus-visible:ring-amber-400/60`}
                    aria-hidden
                />
                <AnimatePresence>
                    {checked && (
                        <motion.svg
                            key="check"
                            width="10" height="10" viewBox="0 0 24 24"
                            fill="none" stroke="currentColor"
                            initial={reduced ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={reduced ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
                            transition={reduced ? { duration: 0 } : SPRING_BOUNCY}
                            className="absolute inset-0 m-auto text-black"
                            aria-hidden
                        >
                            <motion.polyline
                                points="20 6 9 17 4 12"
                                initial={{ pathLength: 0 }}
                                animate={{ pathLength: 1 }}
                                transition={{ duration: 0.18, ease: "easeOut" }}
                            />
                        </motion.svg>
                    )}
                </AnimatePresence>
            </span>
            <div className="flex flex-col">
                <span className={`text-[13px] ${disabled ? "text-[#71717A]" : "text-[#E9E9E9]"}`}>{label}</span>
                {hint && <span className="text-[11px] text-[#71717A] mt-0.5">{hint}</span>}
            </div>
        </label>
    )
}

// ─── Step 3: thanks ───────────────────────────────────────────────────────

interface StepThanksProps {
    canUsePublicly: boolean
    displayNamePublicly: boolean
    onClose: () => void
    reduced: boolean
}

const StepThanks: React.FC<StepThanksProps> = ({ canUsePublicly, displayNamePublicly, onClose, reduced }) => {
    return (
        <motion.div
            initial={{ opacity: 0, scale: reduced ? 1 : 0.92, y: reduced ? 0 : 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={rt(reduced, SPRING_SNAPPY)}
            className="flex flex-col items-center text-center px-8 py-10 space-y-4"
        >
            <motion.div
                className="relative w-14 h-14 rounded-full bg-amber-500/20 flex items-center justify-center"
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                    ...(reduced ? { duration: 0 } : SPRING_CELEBRATE),
                    delay: reduced ? 0 : 0.08,
                }}
            >
                <CheckCircle2 size={28} className="text-amber-400" aria-hidden />
            </motion.div>

            <motion.h3
                className="text-lg font-medium text-[#E9E9E9]"
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 9 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                    ...(reduced ? { duration: 0 } : SPRING_SNAPPY),
                    delay: reduced ? 0 : 0.18,
                }}
            >
                Thanks for your feedback
            </motion.h3>

            <motion.p
                className="text-[13px] text-[#71717A] max-w-[320px]"
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 7 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                    ...(reduced ? { duration: 0 } : SPRING_SNAPPY),
                    delay: reduced ? 0 : 0.26,
                }}
            >
                {canUsePublicly
                    ? (displayNamePublicly
                        ? "Your name will appear alongside the testimonial."
                        : "It will appear as Anonymous Natively user.")
                    : "Your feedback was saved. We'll keep it private."}
            </motion.p>

            <motion.button
                onClick={onClose}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                    ...(reduced ? { duration: 0 } : SPRING_SNAPPY),
                    delay: reduced ? 0 : 0.36,
                }}
                whileHover={reduced ? undefined : { y: -1, filter: "brightness(1.1)" }}
                whileTap={reduced ? undefined : { scale: 0.97 }}
                className="mt-2 px-6 py-2 rounded-lg text-[13px] font-medium bg-white/5 hover:bg-white/10 text-[#E9E9E9] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
            >
                Done
            </motion.button>
        </motion.div>
    )
}

export default ReviewModal
