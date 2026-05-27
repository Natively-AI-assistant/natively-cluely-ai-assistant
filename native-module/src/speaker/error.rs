//! Stable system-audio error codes propagated to JS via NAPI (`Error.message` = code).
//! JS maps codes to user-facing copy — never keyword-matches free-form strings.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SystemAudioErrorCode {
    PulseNotAvailable,
    InitTimeout,
    StreamConnectFailed,
    UnsupportedPlatform,
    CaptureThreadFailed,
    ConsumerMissing,
    CaptureAlreadyRunning,
}

impl SystemAudioErrorCode {
    pub const PULSE_NOT_AVAILABLE: &'static str = "PULSE_NOT_AVAILABLE";
    pub const INIT_TIMEOUT: &'static str = "INIT_TIMEOUT";
    pub const STREAM_CONNECT_FAILED: &'static str = "STREAM_CONNECT_FAILED";
    pub const UNSUPPORTED_PLATFORM: &'static str = "UNSUPPORTED_PLATFORM";
    pub const CAPTURE_THREAD_FAILED: &'static str = "CAPTURE_THREAD_FAILED";
    pub const CONSUMER_MISSING: &'static str = "CONSUMER_MISSING";
    pub const CAPTURE_ALREADY_RUNNING: &'static str = "CAPTURE_ALREADY_RUNNING";

    pub fn as_str(self) -> &'static str {
        match self {
            Self::PulseNotAvailable => Self::PULSE_NOT_AVAILABLE,
            Self::InitTimeout => Self::INIT_TIMEOUT,
            Self::StreamConnectFailed => Self::STREAM_CONNECT_FAILED,
            Self::UnsupportedPlatform => Self::UNSUPPORTED_PLATFORM,
            Self::CaptureThreadFailed => Self::CAPTURE_THREAD_FAILED,
            Self::ConsumerMissing => Self::CONSUMER_MISSING,
            Self::CaptureAlreadyRunning => Self::CAPTURE_ALREADY_RUNNING,
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            Self::PULSE_NOT_AVAILABLE => Some(Self::PulseNotAvailable),
            Self::INIT_TIMEOUT => Some(Self::InitTimeout),
            Self::STREAM_CONNECT_FAILED => Some(Self::StreamConnectFailed),
            Self::UNSUPPORTED_PLATFORM => Some(Self::UnsupportedPlatform),
            Self::CAPTURE_THREAD_FAILED => Some(Self::CaptureThreadFailed),
            Self::CONSUMER_MISSING => Some(Self::ConsumerMissing),
            Self::CAPTURE_ALREADY_RUNNING => Some(Self::CaptureAlreadyRunning),
            _ => None,
        }
    }
}

/// Build an `anyhow::Error` whose display string is exactly the stable code.
pub fn se(code: SystemAudioErrorCode) -> anyhow::Error {
    anyhow::anyhow!(code.as_str())
}

pub fn code_from_anyhow(e: &anyhow::Error) -> Option<SystemAudioErrorCode> {
    SystemAudioErrorCode::parse(&e.to_string())
}

pub fn anyhow_to_napi(e: anyhow::Error) -> napi::Error {
    let code = code_from_anyhow(&e).unwrap_or(SystemAudioErrorCode::CaptureThreadFailed);
    napi::Error::from_reason(code.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_stable_strings() {
        assert_eq!(
            SystemAudioErrorCode::PulseNotAvailable.as_str(),
            "PULSE_NOT_AVAILABLE"
        );
        assert_eq!(
            SystemAudioErrorCode::InitTimeout.as_str(),
            "INIT_TIMEOUT"
        );
    }

    #[test]
    fn parse_roundtrip() {
        for code in [
            SystemAudioErrorCode::PulseNotAvailable,
            SystemAudioErrorCode::InitTimeout,
            SystemAudioErrorCode::StreamConnectFailed,
        ] {
            assert_eq!(
                SystemAudioErrorCode::parse(code.as_str()),
                Some(code)
            );
        }
        assert_eq!(SystemAudioErrorCode::parse("not-a-code"), None);
    }

    #[test]
    fn anyhow_carries_code_only() {
        let e = se(SystemAudioErrorCode::PulseNotAvailable);
        assert_eq!(
            code_from_anyhow(&e),
            Some(SystemAudioErrorCode::PulseNotAvailable)
        );
    }
}
