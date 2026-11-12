//! Capture lifecycle lines for the app's debug log.
//!
//! Native println!/eprintln! output goes to stdout/stderr only. In a packaged
//! app (always on Windows) nobody reads those, so natively_debug.log, the file
//! users send in, never showed which backend started, how long init took,
//! that the requested device failed and the default was used, or how a
//! capture thread ended. These lines are kept here as well; the JS wrapper
//! drains them with takeNativeCaptureLog() and writes them to that log.

use std::collections::VecDeque;
use std::sync::Mutex;

use once_cell::sync::Lazy;

/// Enough for several start/fail/restart cycles between drains. Oldest lines
/// go first when JS stops draining (no capture running).
const CAPACITY: usize = 256;

struct Buffer {
    lines: VecDeque<NativeCaptureLogLine>,
    dropped: u32,
}

static BUFFER: Lazy<Mutex<Buffer>> = Lazy::new(|| {
    Mutex::new(Buffer {
        lines: VecDeque::with_capacity(CAPACITY),
        dropped: 0,
    })
});

#[napi(object)]
#[derive(Clone, Debug, PartialEq)]
pub struct NativeCaptureLogLine {
    /// Wall-clock ms since the Unix epoch when the line was written.
    pub at_ms: f64,
    pub message: String,
}

fn lock() -> std::sync::MutexGuard<'static, Buffer> {
    match BUFFER.lock() {
        Ok(b) => b,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// Prints `message` (as before) and keeps it for the debug log.
pub(crate) fn record(message: String) {
    println!("{}", message);
    let mut b = lock();
    if b.lines.len() == CAPACITY {
        b.lines.pop_front();
        b.dropped = b.dropped.saturating_add(1);
    }
    b.lines.push_back(NativeCaptureLogLine {
        at_ms: crate::channel_state::epoch_ms() as f64,
        message,
    });
}

fn take_all() -> Vec<NativeCaptureLogLine> {
    let mut b = lock();
    let mut out = Vec::with_capacity(b.lines.len() + 1);
    if b.dropped > 0 {
        out.push(NativeCaptureLogLine {
            at_ms: b.lines.front().map(|l| l.at_ms).unwrap_or(0.0),
            message: format!("[native-log] {} earlier line(s) dropped (buffer full)", b.dropped),
        });
        b.dropped = 0;
    }
    out.extend(b.lines.drain(..));
    out
}

/// Returns and clears the buffered capture lifecycle lines, oldest first.
#[napi]
pub fn take_native_capture_log() -> Vec<NativeCaptureLogLine> {
    take_all()
}

#[cfg(test)]
mod tests {
    use super::*;

    // One test: the buffer is process-wide, so parallel tests would race.
    #[test]
    fn keeps_order_drains_and_reports_overflow() {
        let _ = take_all();

        record("first".into());
        record("second".into());
        let lines = take_all();
        assert_eq!(
            lines.iter().map(|l| l.message.as_str()).collect::<Vec<_>>(),
            vec!["first", "second"]
        );
        assert!(lines[0].at_ms > 0.0);
        assert!(take_all().is_empty(), "take drains the buffer");

        for i in 0..CAPACITY + 3 {
            record(format!("line {}", i));
        }
        let lines = take_all();
        assert_eq!(lines.len(), CAPACITY + 1);
        assert!(lines[0].message.contains("3 earlier line(s) dropped"));
        assert_eq!(lines[1].message, "line 3");
        assert_eq!(lines.last().unwrap().message, format!("line {}", CAPACITY + 2));
    }
}
