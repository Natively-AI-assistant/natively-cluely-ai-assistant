//! Dev-only faults for running the system-audio failure paths in the real app.
//!
//! Compiled in only with `--features fault-injection`
//! (`NATIVELY_NATIVE_FEATURES=fault-injection npm run build:native`). Shipped
//! builds never enable the feature, so there the functions below are constant
//! no-ops and no environment variable is read.
//!
//!   NATIVELY_FAULT_SYSTEM_AUDIO_INIT_FAILS=N
//!       The first N system-audio starts fail device init, both the requested
//!       device and the default fallback, as a busy or missing output would.
//!   NATIVELY_FAULT_SYSTEM_AUDIO_STOP_AFTER_MS=T
//!       A capture that initialised is stopped "by the system" T ms later, as
//!       SCK / WASAPI do on sleep or a device reset.
//!   NATIVELY_FAULT_SYSTEM_AUDIO_STOPS=N
//!       How many stops fire (default 1). A run that ends before T ms (the
//!       app's own quick restarts at meeting start) does not use one up.

#[cfg(feature = "fault-injection")]
mod imp {
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::Duration;

    use once_cell::sync::Lazy;

    fn env_u32(name: &str) -> Option<u32> {
        std::env::var(name).ok()?.trim().parse().ok()
    }

    struct Faults {
        init_fails: AtomicU32,
        stop_after: Option<Duration>,
        stops: AtomicU32,
    }

    static FAULTS: Lazy<Faults> = Lazy::new(|| {
        let stop_after = env_u32("NATIVELY_FAULT_SYSTEM_AUDIO_STOP_AFTER_MS")
            .map(|ms| Duration::from_millis(ms as u64));
        Faults {
            init_fails: AtomicU32::new(env_u32("NATIVELY_FAULT_SYSTEM_AUDIO_INIT_FAILS").unwrap_or(0)),
            stop_after,
            stops: AtomicU32::new(if stop_after.is_some() {
                env_u32("NATIVELY_FAULT_SYSTEM_AUDIO_STOPS").unwrap_or(1)
            } else {
                0
            }),
        }
    });

    /// Spends one unit of `budget`; false once it is used up.
    fn spend(budget: &AtomicU32) -> bool {
        budget
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
            .is_ok()
    }

    pub(crate) fn take_init_failure() -> bool {
        spend(&FAULTS.init_fails)
    }

    pub(crate) fn stop_after() -> Option<Duration> {
        if FAULTS.stops.load(Ordering::SeqCst) == 0 {
            return None;
        }
        FAULTS.stop_after
    }

    pub(crate) fn take_stop() -> bool {
        spend(&FAULTS.stops)
    }

    pub(crate) fn describe() -> Option<String> {
        let f = &*FAULTS;
        let init = f.init_fails.load(Ordering::SeqCst);
        let stops = f.stops.load(Ordering::SeqCst);
        if init == 0 && stops == 0 {
            return Some("[fault-injection] build has faults compiled in; none armed".into());
        }
        Some(format!(
            "[fault-injection] armed: init failures left={}, system stops left={} after {:?}",
            init, stops, f.stop_after
        ))
    }
}

#[cfg(not(feature = "fault-injection"))]
mod imp {
    use std::time::Duration;

    #[inline(always)]
    pub(crate) fn stop_after() -> Option<Duration> {
        None
    }

    #[inline(always)]
    pub(crate) fn take_stop() -> bool {
        false
    }

    #[inline(always)]
    pub(crate) fn describe() -> Option<String> {
        None
    }
}

pub(crate) use imp::{describe, stop_after, take_stop};
// Called only from code that is itself cfg'd on the feature (see lib.rs).
#[cfg(feature = "fault-injection")]
pub(crate) use imp::take_init_failure;
