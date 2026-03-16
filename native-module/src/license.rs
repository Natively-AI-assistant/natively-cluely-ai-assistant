use sha2::{Sha256, Digest};

/// Returns a deterministic hardware fingerprint (SHA-256 hash of the machine UID).
/// This is used to lock license keys to a specific physical device.
#[napi]
pub fn get_hardware_id() -> String {
    let raw_id = machine_uid::get().unwrap_or_else(|_| {
        // Fallback: use hostname if hardware UID unavailable
        hostname_fallback()
    });

    let mut hasher = Sha256::new();
    hasher.update(raw_id.as_bytes());
    format!("{:x}", hasher.finalize())
}

use napi::bindgen_prelude::*;
use napi::Task;

/// Background task that verifies a Gumroad license key via HTTP.
/// Runs on a libuv worker thread — does NOT block the Node.js event loop.
pub struct VerifyGumroadTask {
    license_key: String,
}

impl Task for VerifyGumroadTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| napi::Error::from_reason(format!("ERR:client:{}", e)))?;

        // Try both product identifiers (product_id for new products, permalink for old ones)
        let product_ids = ["1HETxGKGYYf6DNDp5SnWVw==", "mzhzpt"];
        let mut last_error = String::new();

        for (i, pid) in product_ids.iter().enumerate() {
            // Only increment the use count on the canonical (first) attempt.
            // Retry attempts against the legacy permalink should not double-count.
            let increment = if i == 0 { "true" } else { "false" };

            let res = client
                .post("https://api.gumroad.com/v2/licenses/verify")
                .form(&[
                    ("product_id", *pid),
                    ("license_key", self.license_key.as_str()),
                    ("increment_uses_count", increment),
                ])
                .send();

            match res {
                Ok(response) => {
                    let body = response.text().unwrap_or_else(|_| "no body".to_string());
                    // Parse first, log only the success/error fields (never log the full body
                    // as it may contain the license key in plaintext)
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                        let success = json["success"].as_bool().unwrap_or(false);
                        let msg = json["message"].as_str().unwrap_or("");
                        println!("[LicenseRust] Gumroad response (pid={}): success={}, msg={}", pid, success, msg);
                        if success {
                            return Ok("OK".to_string());
                        }
                        last_error = msg.to_string();
                    } else {
                        println!("[LicenseRust] Gumroad response (pid={}): parse error", pid);
                        last_error = "parse error".to_string();
                    }
                }
                Err(e) => {
                    last_error = format!("network: {}", e);
                }
            }
        }

        Ok(format!("ERR:gumroad:{}", last_error))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output)
    }
}

/// Validates a Gumroad license key by calling the Gumroad Licenses API.
/// Returns a Promise that resolves to "OK" on success, or an error message string on failure.
/// The HTTP call runs on a libuv worker thread to prevent blocking the Node.js event loop.
#[napi]
pub fn verify_gumroad_key(license_key: String) -> AsyncTask<VerifyGumroadTask> {
    AsyncTask::new(VerifyGumroadTask { license_key })
}

fn hostname_fallback() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| {
            // Last resort: read /etc/hostname on Unix
            std::fs::read_to_string("/etc/hostname")
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|_| "unknown-device".to_string())
        })
}
