//! Apple Calendar events through EventKit, for Natively's calendar sources
//! (electron/services/calendar/providers/AppleCalendarProvider.ts). Read-only:
//! nothing here creates, changes or deletes an event.
//!
//! `calendar_authorization_status()`: where the Calendars permission stands,
//!   as a name (see `access_name`). Synchronous and cheap; never prompts.
//! `request_calendar_access()`: asks for it once, macOS 14+ "full access"
//!   (requestFullAccessToEventsWithCompletion:) or the older
//!   requestAccessToEntityType:completion:, then answers the new status. It
//!   never asks when the app's Info.plist lacks the purpose string the OS
//!   needs (NSCalendarsFullAccessUsageDescription on 14+, NSCalendarsUsageDescription
//!   before): macOS ends a process that asks without one, so the answer is
//!   "missingUsageDescription" instead.
//! `get_calendar_events(start_ms, end_ms)`: the occurrences overlapping the
//!   window in every calendar the Calendar app shows, recurring series already
//!   expanded by EventKit; null without full access.
//!
//! Runs on a libuv worker (AsyncTask), never on the JS thread: EventKit's
//! first query can take a moment while it loads the store. Each call opens its
//! own EKEventStore inside an autorelease pool, so a permission granted since
//! the last call is seen at once.
//!
//! Every other OS: "unsupported" and null. The JS registry never builds the
//! Apple source there; this only keeps the export surface the same.

use napi::bindgen_prelude::*;
use napi::Task;

/// At most this many occurrences per read.
pub const MAX_EVENTS: usize = 2000;
/// At most this long a window (EventKit itself refuses spans over four years).
pub const MAX_SPAN_MS: f64 = 400.0 * 86_400_000.0;

#[napi(object)]
#[derive(Clone, Debug, PartialEq)]
pub struct CalendarParticipant {
    pub name: Option<String>,
    /// The participant's URL, usually "mailto:…".
    pub url: Option<String>,
    /// EKParticipantStatus.
    pub status: i32,
    /// EKParticipantType.
    pub kind: i32,
    pub is_current_user: bool,
}

#[napi(object)]
#[derive(Clone, Debug, PartialEq)]
pub struct CalendarEventInfo {
    /// EKEvent.eventIdentifier: shared by every occurrence of a series.
    pub event_identifier: Option<String>,
    /// calendarItemExternalIdentifier: the invite's iCalendar UID on most accounts.
    pub external_id: Option<String>,
    pub title: Option<String>,
    pub start_ms: f64,
    pub end_ms: f64,
    /// EKEvent.occurrenceDate: an occurrence's original start.
    pub occurrence_ms: Option<f64>,
    pub is_all_day: bool,
    /// EKEventStatus.
    pub status: i32,
    pub has_recurrence: bool,
    pub is_detached: bool,
    pub location: Option<String>,
    pub notes: Option<String>,
    pub url: Option<String>,
    pub time_zone: Option<String>,
    pub organizer: Option<CalendarParticipant>,
    pub attendees: Vec<CalendarParticipant>,
}

/// EKAuthorizationStatus as the name the JS side reads. `has_usage` is whether
/// the Info.plist carries the purpose string this macOS needs before asking.
pub fn access_name(status: isize, has_usage: bool) -> &'static str {
    match status {
        // EKAuthorizationStatusNotDetermined: asking is only safe with the string.
        0 if !has_usage => "missingUsageDescription",
        0 => "notDetermined",
        1 => "restricted",
        2 => "denied",
        // EKAuthorizationStatusFullAccess (14+), EKAuthorizationStatusAuthorized before.
        3 => "fullAccess",
        // EKAuthorizationStatusWriteOnly (14+): add-only, cannot read.
        4 => "writeOnly",
        _ => "denied",
    }
}

/// The status this process should act on. After the person presses Allow,
/// authorizationStatusForEntityType: in the process that asked can keep
/// answering NotDetermined (seen on macOS 27, 2026-10-18: TCC had recorded the
/// grant and a fresh process read FullAccess). The prompt's own "granted"
/// answer is the truth for the rest of this run.
pub fn settled_access_name(status: isize, has_usage: bool, granted_this_run: bool) -> &'static str {
    if status == 0 && granted_this_run {
        return "fullAccess";
    }
    access_name(status, has_usage)
}

/// A window EventKit can answer, or None for a nonsense one.
pub fn clamp_window(start_ms: f64, end_ms: f64) -> Option<(f64, f64)> {
    if !start_ms.is_finite() || !end_ms.is_finite() || end_ms <= start_ms {
        return None;
    }
    Some((start_ms, end_ms.min(start_ms + MAX_SPAN_MS)))
}

/// Where the Calendars permission stands; never prompts.
#[napi]
pub fn calendar_authorization_status() -> String {
    imp::status().to_string()
}

pub struct RequestCalendarAccessTask;

impl Task for RequestCalendarAccessTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        Ok(imp::request().to_string())
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output)
    }
}

/// Asks for calendar access (once: the OS answers at once after the first
/// time), resolving to the status afterwards. Runs on a worker thread.
#[napi(ts_return_type = "Promise<string>")]
pub fn request_calendar_access() -> AsyncTask<RequestCalendarAccessTask> {
    AsyncTask::new(RequestCalendarAccessTask)
}

pub struct GetCalendarEventsTask {
    window: Option<(f64, f64)>,
}

impl Task for GetCalendarEventsTask {
    type Output = Option<Vec<CalendarEventInfo>>;
    type JsValue = Option<Vec<CalendarEventInfo>>;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        Ok(match self.window {
            Some((start, end)) => imp::events(start, end),
            None => Some(Vec::new()),
        })
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output)
    }
}

/// The occurrences overlapping [start_ms, end_ms]; null without full access or
/// on another OS. Runs on a worker thread.
#[napi(ts_return_type = "Promise<Array<CalendarEventInfo> | null>")]
pub fn get_calendar_events(start_ms: f64, end_ms: f64) -> AsyncTask<GetCalendarEventsTask> {
    AsyncTask::new(GetCalendarEventsTask { window: clamp_window(start_ms, end_ms) })
}

#[cfg(target_os = "macos")]
mod imp {
    use super::{settled_access_name, CalendarEventInfo, CalendarParticipant, MAX_EVENTS};
    use block2::RcBlock;
    use objc2::rc::autoreleasepool;
    use objc2::runtime::{AnyClass, AnyObject, Bool, Sel};
    use objc2::{msg_send, sel};
    use std::ffi::{c_char, CStr, CString};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc;
    use std::time::Duration;

    // Loads EventKit so its classes resolve at runtime.
    #[link(name = "EventKit", kind = "framework")]
    extern "C" {}

    /// EKEntityTypeEvent.
    const ENTITY_EVENT: usize = 0;
    /// How long a permission prompt may stay unanswered.
    const PROMPT_WAIT: Duration = Duration::from_secs(300);
    /// The person pressed Allow in this run (see `settled_access_name`).
    static GRANTED_THIS_RUN: AtomicBool = AtomicBool::new(false);

    fn store_class() -> Option<&'static AnyClass> {
        AnyClass::get("EKEventStore")
    }

    /// macOS 14+: the full-access request exists.
    fn has_full_access_api(class: &AnyClass) -> bool {
        let sel: Sel = sel!(requestFullAccessToEventsWithCompletion:);
        unsafe {
            let responds: Bool = msg_send![class, instancesRespondToSelector: sel];
            responds.as_bool()
        }
    }

    unsafe fn ns_string_from(s: &str) -> *mut AnyObject {
        let c = CString::new(s).unwrap_or_default();
        msg_send![AnyClass::get("NSString").unwrap(), stringWithUTF8String: c.as_ptr()]
    }

    unsafe fn string_of(obj: *mut AnyObject) -> Option<String> {
        if obj.is_null() {
            return None;
        }
        let utf8: *const c_char = msg_send![obj, UTF8String];
        if utf8.is_null() {
            return None;
        }
        let s = CStr::from_ptr(utf8).to_string_lossy().into_owned();
        if s.is_empty() { None } else { Some(s) }
    }

    unsafe fn ms_of(date: *mut AnyObject) -> Option<f64> {
        if date.is_null() {
            return None;
        }
        let secs: f64 = msg_send![date, timeIntervalSince1970];
        Some(secs * 1000.0)
    }

    unsafe fn url_string(url: *mut AnyObject) -> Option<String> {
        if url.is_null() {
            return None;
        }
        let s: *mut AnyObject = msg_send![url, absoluteString];
        string_of(s)
    }

    /// Whether the Info.plist names why the app wants calendars (asking without it ends the process).
    fn has_usage_description(full_access_api: bool) -> bool {
        unsafe {
            let Some(bundle_class) = AnyClass::get("NSBundle") else { return false };
            let bundle: *mut AnyObject = msg_send![bundle_class, mainBundle];
            if bundle.is_null() {
                return false;
            }
            let key = if full_access_api { "NSCalendarsFullAccessUsageDescription" } else { "NSCalendarsUsageDescription" };
            let value: *mut AnyObject = msg_send![bundle, objectForInfoDictionaryKey: ns_string_from(key)];
            !value.is_null()
        }
    }

    pub fn status() -> &'static str {
        autoreleasepool(|_| {
            let Some(class) = store_class() else { return "unsupported" };
            let raw: isize = unsafe { msg_send![class, authorizationStatusForEntityType: ENTITY_EVENT] };
            settled_access_name(raw, has_usage_description(has_full_access_api(class)), GRANTED_THIS_RUN.load(Ordering::SeqCst))
        })
    }

    pub fn request() -> &'static str {
        let current = status();
        if current != "notDetermined" {
            return current;
        }
        autoreleasepool(|_| {
            let Some(class) = store_class() else { return };
            let full = has_full_access_api(class);
            let (tx, rx) = mpsc::channel::<bool>();
            let block = RcBlock::new(move |granted: Bool, _error: *mut AnyObject| {
                let _ = tx.send(granted.as_bool());
            });
            unsafe {
                let store: *mut AnyObject = msg_send![class, new];
                if store.is_null() {
                    return;
                }
                if full {
                    let _: () = msg_send![store, requestFullAccessToEventsWithCompletion: &*block];
                } else {
                    let _: () = msg_send![store, requestAccessToEntityType: ENTITY_EVENT, completion: &*block];
                }
                // The completion arrives on EventKit's own queue once the person answers.
                if let Ok(true) = rx.recv_timeout(PROMPT_WAIT) {
                    GRANTED_THIS_RUN.store(true, Ordering::SeqCst);
                }
                objc2::ffi::objc_release(store.cast());
            }
        });
        status()
    }

    unsafe fn participant(p: *mut AnyObject) -> Option<CalendarParticipant> {
        if p.is_null() {
            return None;
        }
        let url: *mut AnyObject = msg_send![p, URL];
        let name: *mut AnyObject = msg_send![p, name];
        let status: isize = msg_send![p, participantStatus];
        let kind: isize = msg_send![p, participantType];
        let current: Bool = msg_send![p, isCurrentUser];
        Some(CalendarParticipant {
            name: string_of(name),
            url: url_string(url),
            status: status as i32,
            kind: kind as i32,
            is_current_user: current.as_bool(),
        })
    }

    unsafe fn event_info(ev: *mut AnyObject) -> Option<CalendarEventInfo> {
        let start = ms_of(msg_send![ev, startDate])?;
        let end = ms_of(msg_send![ev, endDate])?;
        let all_day: Bool = msg_send![ev, isAllDay];
        let status: isize = msg_send![ev, status];
        let recurring: Bool = msg_send![ev, hasRecurrenceRules];
        let detached: Bool = msg_send![ev, isDetached];
        let tz: *mut AnyObject = msg_send![ev, timeZone];
        let tz_name = if tz.is_null() { None } else { string_of(msg_send![tz, name]) };
        let attendees_arr: *mut AnyObject = msg_send![ev, attendees];
        let mut attendees = Vec::new();
        if !attendees_arr.is_null() {
            let n: usize = msg_send![attendees_arr, count];
            for i in 0..n.min(200) {
                let p: *mut AnyObject = msg_send![attendees_arr, objectAtIndex: i];
                if let Some(p) = participant(p) {
                    attendees.push(p);
                }
            }
        }
        Some(CalendarEventInfo {
            event_identifier: string_of(msg_send![ev, eventIdentifier]),
            external_id: string_of(msg_send![ev, calendarItemExternalIdentifier]),
            title: string_of(msg_send![ev, title]),
            start_ms: start,
            end_ms: end,
            occurrence_ms: ms_of(msg_send![ev, occurrenceDate]),
            is_all_day: all_day.as_bool(),
            status: status as i32,
            has_recurrence: recurring.as_bool(),
            is_detached: detached.as_bool(),
            location: string_of(msg_send![ev, location]),
            notes: string_of(msg_send![ev, notes]),
            url: url_string(msg_send![ev, URL]),
            time_zone: tz_name,
            organizer: participant(msg_send![ev, organizer]),
            attendees,
        })
    }

    pub fn events(start_ms: f64, end_ms: f64) -> Option<Vec<CalendarEventInfo>> {
        if status() != "fullAccess" {
            return None;
        }
        autoreleasepool(|_| unsafe {
            let class = store_class()?;
            let date_class = AnyClass::get("NSDate")?;
            let store: *mut AnyObject = msg_send![class, new];
            if store.is_null() {
                return None;
            }
            let start: *mut AnyObject = msg_send![date_class, dateWithTimeIntervalSince1970: start_ms / 1000.0];
            let end: *mut AnyObject = msg_send![date_class, dateWithTimeIntervalSince1970: end_ms / 1000.0];
            let nil: *mut AnyObject = std::ptr::null_mut();
            let predicate: *mut AnyObject = msg_send![store, predicateForEventsWithStartDate: start, endDate: end, calendars: nil];
            let mut out = Vec::new();
            if !predicate.is_null() {
                let found: *mut AnyObject = msg_send![store, eventsMatchingPredicate: predicate];
                if !found.is_null() {
                    let n: usize = msg_send![found, count];
                    for i in 0..n.min(MAX_EVENTS) {
                        let ev: *mut AnyObject = msg_send![found, objectAtIndex: i];
                        if !ev.is_null() {
                            if let Some(info) = event_info(ev) {
                                out.push(info);
                            }
                        }
                    }
                }
            }
            objc2::ffi::objc_release(store.cast());
            Some(out)
        })
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::CalendarEventInfo;

    pub fn status() -> &'static str {
        "unsupported"
    }

    pub fn request() -> &'static str {
        "unsupported"
    }

    pub fn events(_start_ms: f64, _end_ms: f64) -> Option<Vec<CalendarEventInfo>> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn access_names_cover_every_status() {
        assert_eq!(access_name(0, true), "notDetermined");
        assert_eq!(access_name(0, false), "missingUsageDescription");
        assert_eq!(access_name(1, true), "restricted");
        assert_eq!(access_name(2, true), "denied");
        assert_eq!(access_name(3, true), "fullAccess");
        assert_eq!(access_name(3, false), "fullAccess", "already granted: nothing is asked");
        assert_eq!(access_name(4, true), "writeOnly");
        assert_eq!(access_name(99, true), "denied", "an unknown status never reads as access");
    }

    #[test]
    fn a_grant_in_this_run_outranks_a_stale_not_determined() {
        assert_eq!(settled_access_name(0, true, true), "fullAccess");
        assert_eq!(settled_access_name(0, true, false), "notDetermined");
        assert_eq!(settled_access_name(2, true, true), "denied", "a later refusal still counts");
        assert_eq!(settled_access_name(4, true, true), "writeOnly");
        assert_eq!(settled_access_name(3, true, false), "fullAccess");
    }

    #[test]
    fn windows_are_checked_and_bounded() {
        assert_eq!(clamp_window(0.0, 1000.0), Some((0.0, 1000.0)));
        assert_eq!(clamp_window(1000.0, 1000.0), None);
        assert_eq!(clamp_window(2000.0, 1000.0), None);
        assert_eq!(clamp_window(f64::NAN, 1000.0), None);
        assert_eq!(clamp_window(0.0, f64::INFINITY), None);
        assert_eq!(clamp_window(0.0, 10.0 * MAX_SPAN_MS), Some((0.0, MAX_SPAN_MS)));
    }
}
