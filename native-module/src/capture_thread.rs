//! The background thread behind a capture object, and whether it is still
//! capturing.
//!
//! A capture thread can end on its own: device init fails, the stream cannot
//! be opened, or the OS stops the stream. It reports that to JS and returns,
//! but the owner still holds its JoinHandle. Treating "handle present" as
//! "running" made every later start() fail with "Capture already running"
//! (issue #729). `check()` instead joins a thread that has ended, so the
//! same object can start again.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// Raised by the capture thread right before it reports a fatal error and
/// returns. The error callback runs on the JS thread and may call start()
/// before this thread has actually returned; the flag lets start() treat it
/// as finished and join it rather than refuse.
#[derive(Clone)]
pub(crate) struct EndingFlag(Arc<AtomicBool>);

impl EndingFlag {
    pub(crate) fn set(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

/// What `check()` found in the slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SlotState {
    /// No thread was owned.
    Idle,
    /// A thread is still capturing.
    Running,
    /// A thread had ended on its own; it was joined, taking `join` (the time
    /// it spent dropping its stream, see `check`).
    Reaped { join: Duration },
}

pub(crate) struct CaptureThread {
    handle: Option<JoinHandle<()>>,
    ending: EndingFlag,
}

impl CaptureThread {
    pub(crate) fn new() -> Self {
        CaptureThread {
            handle: None,
            ending: EndingFlag(Arc::new(AtomicBool::new(false))),
        }
    }

    /// Running while a thread is capturing. A thread that has returned, or
    /// has raised its ending flag, is joined here (Reaped) and no longer counts.
    ///
    /// The join runs on the caller's thread (the JS thread for start()) and
    /// lasts as long as the old thread takes to drop its stream: microseconds
    /// after a failed init, up to SpeakerStream's 2 s stop wait when a stream
    /// was open. stop() already blocks the same way.
    ///
    /// Restart only after the error callback has fired. If start() is called
    /// in the instant between the flag and the error reaching JS, the old
    /// run's error is still delivered, to the old callback, after the new run
    /// has begun. The TS wrapper cannot do this: its isRecording guard holds
    /// until that error arrives.
    pub(crate) fn check(&mut self) -> SlotState {
        let Some(handle) = &self.handle else {
            return SlotState::Idle;
        };
        if !handle.is_finished() && !self.ending.0.load(Ordering::SeqCst) {
            return SlotState::Running;
        }
        let started = Instant::now();
        self.join();
        SlotState::Reaped { join: started.elapsed() }
    }

    #[cfg(test)]
    fn is_running(&mut self) -> bool {
        self.check() == SlotState::Running
    }

    /// Spawns `body` with a fresh ending flag. Call only when `check()` did not
    /// return Running (which leaves no handle); a previous handle would be dropped
    /// without a join and its thread would keep capturing.
    pub(crate) fn spawn<F>(&mut self, body: F)
    where
        F: FnOnce(EndingFlag) + Send + 'static,
    {
        debug_assert!(
            self.handle.is_none(),
            "CaptureThread::spawn while a thread is still owned; call check() first"
        );
        let ending = EndingFlag(Arc::new(AtomicBool::new(false)));
        self.ending = ending.clone();
        self.handle = Some(thread::spawn(move || body(ending)));
    }

    /// Waits for the thread to return; the caller signals it to stop first.
    /// Returns whether there was a thread to join.
    pub(crate) fn join(&mut self) -> bool {
        match self.handle.take() {
            Some(handle) => {
                let _ = handle.join();
                true
            }
            None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn idle_slot_is_not_running() {
        let mut slot = CaptureThread::new();
        assert!(!slot.is_running());
        assert_eq!(slot.check(), SlotState::Idle);
        assert!(!slot.join(), "nothing to join");
    }

    #[test]
    fn check_reports_a_reaped_thread_once() {
        let mut slot = CaptureThread::new();
        let (reported_tx, reported_rx) = mpsc::channel::<()>();
        slot.spawn(move |ending| {
            ending.set();
            reported_tx.send(()).unwrap();
        });
        reported_rx.recv().unwrap();
        assert!(matches!(slot.check(), SlotState::Reaped { .. }));
        assert_eq!(slot.check(), SlotState::Idle, "reaped means the handle is gone");
    }

    #[test]
    fn live_thread_blocks_a_second_start() {
        let mut slot = CaptureThread::new();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        slot.spawn(move |_ending| {
            let _ = release_rx.recv();
        });
        assert!(slot.is_running());
        release_tx.send(()).unwrap();
        slot.join();
        assert!(!slot.is_running());
    }

    // #729: the first start's init fails and its thread returns; a retry on
    // the same object must start a new thread instead of "already running".
    #[test]
    fn thread_that_failed_init_does_not_block_a_retry() {
        let mut slot = CaptureThread::new();
        let starts = Arc::new(AtomicUsize::new(0));

        // Stands in for the JS error callback: the retry comes after the
        // failure has been reported.
        let (reported_tx, reported_rx) = mpsc::channel::<()>();
        let s = starts.clone();
        slot.spawn(move |ending| {
            s.fetch_add(1, Ordering::SeqCst);
            ending.set();
            reported_tx.send(()).unwrap();
        });
        reported_rx.recv().unwrap();
        // Whether or not the thread has returned yet, it no longer counts.
        assert!(!slot.is_running());

        let s = starts.clone();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        slot.spawn(move |_ending| {
            s.fetch_add(1, Ordering::SeqCst);
            let _ = release_rx.recv();
        });
        assert!(slot.is_running());
        release_tx.send(()).unwrap();
        slot.join();
        assert_eq!(starts.load(Ordering::SeqCst), 2);
    }

    // The error callback can call start() while the failed thread is still
    // between raising the flag and returning. start() must wait for it, not
    // refuse, and must not leave two threads alive.
    #[test]
    fn retry_while_failed_thread_is_still_returning_waits_for_it() {
        let mut slot = CaptureThread::new();
        let (flag_raised_tx, flag_raised_rx) = mpsc::channel::<()>();
        let returned = Arc::new(AtomicBool::new(false));

        let r = returned.clone();
        slot.spawn(move |ending| {
            ending.set();
            flag_raised_tx.send(()).unwrap();
            thread::sleep(Duration::from_millis(50));
            r.store(true, Ordering::SeqCst);
        });
        flag_raised_rx.recv().unwrap();

        assert!(!slot.is_running());
        assert!(returned.load(Ordering::SeqCst), "old thread must be joined before a retry");
    }

    // spawn() over an owned handle would detach a thread that may still be
    // capturing; debug builds refuse instead.
    #[test]
    #[should_panic(expected = "call check() first")]
    fn spawn_over_an_owned_thread_is_refused() {
        let mut slot = CaptureThread::new();
        slot.spawn(|_ending| {});
        slot.spawn(|_ending| {});
    }

    // The thread ending without raising the flag (a path that forgot to)
    // still frees the slot once it has returned.
    #[test]
    fn returned_thread_frees_the_slot_without_the_flag() {
        let mut slot = CaptureThread::new();
        slot.spawn(|_ending| {});
        while slot.handle.as_ref().is_some_and(|h| !h.is_finished()) {
            thread::sleep(Duration::from_millis(1));
        }
        assert!(!slot.is_running());
    }
}
