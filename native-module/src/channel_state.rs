//! Joint dual-channel speech state for Auto Answer (V3 Amendment 1).
//!
//! Natively captures the microphone (user) and system loopback (interviewer)
//! as two independent streams, each with its own `SilenceSuppressor`. This
//! module folds their per-channel speech edges into ONE joint state —
//! `neither` / `interviewer_speaking` / `user_speaking` / `both` — with a
//! timestamp per transition, so the Auto Answer gate on the TypeScript side
//! can require "user silent for N ms after the interviewer committed" and veto
//! a boundary where both channels were active at once.
//!
//! The tracker is pure and clock-injected (`on_edge` takes `now_ms`); the two
//! capture threads share one instance behind `global()` and hand the returned
//! transition to their own threadsafe callback.
//!
//! PLATFORM: the user channel's edges are only as trustworthy as the stage
//! that produced them. On macOS the mic runs the WebRTC VAD (speaker bleed and
//! typing rejected); on Windows it is RMS-only (PR #497, device DSP starves the
//! VAD), so a user "speech_started" there can be interviewer audio bleeding
//! back through the speakers. `user_edges_vad_backed` rides on every
//! transition so the consumer can treat Windows user edges as weaker evidence.
//! It is injected, not read from `cfg!`, so a test on either host asserts BOTH
//! branches (same pattern as `silence_suppression::for_microphone_on`).

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use once_cell::sync::Lazy;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Channel {
    Interviewer,
    User,
}

impl Channel {
    pub fn as_str(self) -> &'static str {
        match self {
            Channel::Interviewer => "interviewer",
            Channel::User => "user",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JointState {
    Neither,
    InterviewerSpeaking,
    UserSpeaking,
    Both,
}

impl JointState {
    pub fn as_str(self) -> &'static str {
        match self {
            JointState::Neither => "neither",
            JointState::InterviewerSpeaking => "interviewer_speaking",
            JointState::UserSpeaking => "user_speaking",
            JointState::Both => "both",
        }
    }

    fn from_flags(interviewer: bool, user: bool) -> Self {
        match (interviewer, user) {
            (false, false) => JointState::Neither,
            (true, false) => JointState::InterviewerSpeaking,
            (false, true) => JointState::UserSpeaking,
            (true, true) => JointState::Both,
        }
    }
}

/// One per-channel edge that changed the joint state.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ChannelTransition {
    pub channel: Channel,
    pub speaking: bool,
    pub joint: JointState,
    pub at_ms: u64,
    /// Milliseconds since the OTHER channel's last edge (u64::MAX if none yet).
    /// The overlap veto on the TS side is "both channels active within ~400 ms".
    pub ms_since_other_edge: u64,
    pub user_edges_vad_backed: bool,
}

#[derive(Debug)]
pub struct ChannelStateTracker {
    interviewer_speaking: bool,
    user_speaking: bool,
    last_interviewer_edge_ms: Option<u64>,
    last_user_edge_ms: Option<u64>,
    user_edges_vad_backed: bool,
}

impl ChannelStateTracker {
    /// `user_edges_vad_backed` is the platform decision, injected: `true`
    /// wherever `SilenceSuppressionConfig::for_microphone_on(..).use_vad` is.
    pub fn new(user_edges_vad_backed: bool) -> Self {
        Self {
            interviewer_speaking: false,
            user_speaking: false,
            last_interviewer_edge_ms: None,
            last_user_edge_ms: None,
            user_edges_vad_backed,
        }
    }

    /// Constructor mirroring the mic split: Windows mic edges are RMS-only.
    pub fn for_platform(is_windows: bool) -> Self {
        Self::new(!is_windows)
    }

    pub fn joint(&self) -> JointState {
        JointState::from_flags(self.interviewer_speaking, self.user_speaking)
    }

    pub fn user_edges_vad_backed(&self) -> bool {
        self.user_edges_vad_backed
    }

    /// Feed a per-channel edge. Returns the transition if the joint state
    /// changed; a repeated edge in the same direction (or an edge the
    /// suppressor already implied) is absorbed and returns `None`.
    pub fn on_edge(&mut self, channel: Channel, speaking: bool, now_ms: u64) -> Option<ChannelTransition> {
        let (flag, last_self, last_other) = match channel {
            Channel::Interviewer => (
                &mut self.interviewer_speaking,
                &mut self.last_interviewer_edge_ms,
                self.last_user_edge_ms,
            ),
            Channel::User => (
                &mut self.user_speaking,
                &mut self.last_user_edge_ms,
                self.last_interviewer_edge_ms,
            ),
        };
        if *flag == speaking {
            return None;
        }
        *flag = speaking;
        *last_self = Some(now_ms);
        let ms_since_other_edge = match last_other {
            Some(t) => now_ms.saturating_sub(t),
            None => u64::MAX,
        };
        Some(ChannelTransition {
            channel,
            speaking,
            joint: self.joint(),
            at_ms: now_ms,
            ms_since_other_edge,
            user_edges_vad_backed: self.user_edges_vad_backed,
        })
    }

    /// A capture (re)started: whatever that channel was doing is over. The
    /// other channel is untouched so a mic restart mid-meeting does not erase
    /// a live interviewer turn. Returns the implied "ended" transition, if any.
    pub fn reset_channel(&mut self, channel: Channel, now_ms: u64) -> Option<ChannelTransition> {
        self.on_edge(channel, false, now_ms)
    }
}

/// Process-wide tracker shared by the two capture threads. The platform
/// decision here is the compiled one; tests construct their own instances.
pub fn global() -> &'static Mutex<ChannelStateTracker> {
    static TRACKER: Lazy<Mutex<ChannelStateTracker>> =
        Lazy::new(|| Mutex::new(ChannelStateTracker::for_platform(cfg!(target_os = "windows"))));
    &TRACKER
}

/// Epoch milliseconds, the same timeline as `Date.now()` on the JS side so the
/// transcript timestamps AppState stamps and these edges are comparable.
pub fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joint_state_follows_both_channels() {
        let mut t = ChannelStateTracker::new(true);
        assert_eq!(t.joint(), JointState::Neither);

        let tr = t.on_edge(Channel::Interviewer, true, 1000).expect("transition");
        assert_eq!(tr.joint, JointState::InterviewerSpeaking);
        assert_eq!(tr.ms_since_other_edge, u64::MAX, "no user edge yet");

        let tr = t.on_edge(Channel::User, true, 1300).expect("transition");
        assert_eq!(tr.joint, JointState::Both);
        assert_eq!(tr.ms_since_other_edge, 300);

        let tr = t.on_edge(Channel::Interviewer, false, 1500).expect("transition");
        assert_eq!(tr.joint, JointState::UserSpeaking);
        assert_eq!(tr.ms_since_other_edge, 200);

        let tr = t.on_edge(Channel::User, false, 2400).expect("transition");
        assert_eq!(tr.joint, JointState::Neither);
        assert_eq!(tr.ms_since_other_edge, 900);
    }

    #[test]
    fn repeated_edges_in_the_same_direction_are_absorbed() {
        let mut t = ChannelStateTracker::new(true);
        assert!(t.on_edge(Channel::User, false, 10).is_none(), "already silent");
        assert!(t.on_edge(Channel::User, true, 20).is_some());
        assert!(t.on_edge(Channel::User, true, 30).is_none(), "already speaking");
        assert_eq!(t.joint(), JointState::UserSpeaking);
    }

    #[test]
    fn reset_channel_only_touches_that_channel() {
        let mut t = ChannelStateTracker::new(true);
        t.on_edge(Channel::Interviewer, true, 100);
        t.on_edge(Channel::User, true, 200);
        let tr = t.reset_channel(Channel::User, 300).expect("user ended");
        assert_eq!(tr.joint, JointState::InterviewerSpeaking, "interviewer turn survives a mic restart");
        assert!(t.reset_channel(Channel::User, 400).is_none(), "idempotent");
    }

    /// BOTH platform branches from whichever host runs the suite. The mic
    /// split (silence_suppression::for_microphone_on) decides whether user
    /// edges are VAD-backed; the tracker must carry exactly that decision.
    #[test]
    fn user_edge_trust_is_platform_scoped() {
        let win = ChannelStateTracker::for_platform(true);
        let mac = ChannelStateTracker::for_platform(false);
        assert!(!win.user_edges_vad_backed(), "Windows mic is RMS-only: user edges are weak evidence");
        assert!(mac.user_edges_vad_backed(), "macOS mic runs the WebRTC VAD: user edges are strong evidence");

        // The flag agrees with the suppressor config on the same injected decision.
        use crate::silence_suppression::SilenceSuppressionConfig;
        assert_eq!(win.user_edges_vad_backed(), SilenceSuppressionConfig::for_microphone_on(true).use_vad);
        assert_eq!(mac.user_edges_vad_backed(), SilenceSuppressionConfig::for_microphone_on(false).use_vad);

        // It rides on every transition, for both branches.
        for (mut t, expected) in [(win, false), (mac, true)] {
            let tr = t.on_edge(Channel::User, true, 5).expect("transition");
            assert_eq!(tr.user_edges_vad_backed, expected);
        }

        // The live global agrees with the branch this build compiled for.
        assert_eq!(
            global().lock().unwrap().user_edges_vad_backed(),
            !cfg!(target_os = "windows")
        );
    }

    #[test]
    fn string_forms_are_stable_wire_names() {
        assert_eq!(JointState::Neither.as_str(), "neither");
        assert_eq!(JointState::InterviewerSpeaking.as_str(), "interviewer_speaking");
        assert_eq!(JointState::UserSpeaking.as_str(), "user_speaking");
        assert_eq!(JointState::Both.as_str(), "both");
        assert_eq!(Channel::Interviewer.as_str(), "interviewer");
        assert_eq!(Channel::User.as_str(), "user");
    }
}
