//! One-shot "the platform stopped our capture stream" signal.
//!
//! Every system-audio backend runs its own capture thread (ScreenCaptureKit
//! delegate callbacks on macOS, the WASAPI loopback loop on Windows) while the
//! DSP loop in lib.rs drains a lock-free ring buffer. When the platform ends the
//! stream underneath us the ring buffer simply goes quiet — and a quiet ring
//! buffer is exactly what a silent meeting looks like, so nothing downstream can
//! tell the difference. Live-reproduced 2026-09-11 on macOS 26: display sleep
//! stops an SCStream with SCStreamErrorDomain -3815 ("Failed to find any
//! displays or windows to capture") and it never resumes, even after the display
//! wakes and audio plays. Without a delegate the app saw 0 chunks, no error, no
//! recovery — for the rest of the meeting.
//!
//! The backend raises the FIRST reason it observes; the DSP loop takes it once,
//! flushes, and surfaces it to JS as a capture error so the existing recovery
//! handler (main.ts setupAudioRecoveryHandler) can rebuild the capture.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

#[derive(Default, Debug)]
pub struct StopSignal {
    slot: Mutex<Option<String>>,
    /// Sticky: set by the first `raise` and never cleared. `take` hands the
    /// reason to the DSP loop once; the backend's `Drop` still needs to know
    /// the platform already ended the stream so it does not issue a redundant
    /// stop and wait on a callback that never comes.
    ever_raised: AtomicBool,
}

impl StopSignal {
    pub fn new() -> Self {
        Self::default()
    }

    /// Records `reason` unless one is already pending. Returns `true` when this
    /// call recorded it. The first reason is the root cause; a later one (for
    /// example our own stop after the platform already stopped us) must not
    /// overwrite it.
    pub fn raise(&self, reason: impl Into<String>) -> bool {
        let mut slot = match self.slot.lock() {
            Ok(s) => s,
            Err(poisoned) => poisoned.into_inner(),
        };
        if slot.is_some() {
            return false;
        }
        *slot = Some(reason.into());
        self.ever_raised.store(true, Ordering::Release);
        true
    }

    /// Takes the pending reason, if any. One-shot: a second call returns `None`
    /// until something raises again.
    pub fn take(&self) -> Option<String> {
        let mut slot = match self.slot.lock() {
            Ok(s) => s,
            Err(poisoned) => poisoned.into_inner(),
        };
        slot.take()
    }

    /// Whether a reason is pending (raised and not yet taken).
    pub fn is_raised(&self) -> bool {
        match self.slot.lock() {
            Ok(s) => s.is_some(),
            Err(poisoned) => poisoned.into_inner().is_some(),
        }
    }

    /// Whether the platform has EVER stopped this stream — survives `take`.
    pub fn was_ever_raised(&self) -> bool {
        self.ever_raised.load(Ordering::Acquire)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn take_is_one_shot() {
        let s = StopSignal::new();
        assert_eq!(s.take(), None);
        assert!(s.raise("display went away"));
        assert!(s.is_raised());
        assert_eq!(s.take().as_deref(), Some("display went away"));
        assert!(!s.is_raised());
        assert!(s.was_ever_raised(), "the sticky flag must survive take()");
        assert_eq!(s.take(), None);
    }

    #[test]
    fn never_raised_reads_false_on_both_flags() {
        let s = StopSignal::new();
        assert!(!s.is_raised());
        assert!(!s.was_ever_raised());
    }

    #[test]
    fn first_reason_wins_until_taken() {
        let s = StopSignal::new();
        assert!(s.raise("root cause"));
        assert!(!s.raise("later symptom"));
        assert_eq!(s.take().as_deref(), Some("root cause"));
        assert!(s.raise("a fresh stop after the first was handled"));
    }

    #[test]
    fn shared_across_threads() {
        use std::sync::Arc;
        let s = Arc::new(StopSignal::new());
        let s2 = s.clone();
        std::thread::spawn(move || {
            s2.raise("from the capture thread");
        })
        .join()
        .unwrap();
        assert_eq!(s.take().as_deref(), Some("from the capture thread"));
    }
}
