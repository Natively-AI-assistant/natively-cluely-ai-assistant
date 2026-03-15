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

use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, ErrorStrategy};
use napi::bindgen_prelude::*;

/// Validates a Gumroad license key by calling the Gumroad Licenses API.
/// Returns "OK" on success, or an error message string on failure.
/// Calls are made in a background thread to prevent blocking the Node.js event loop.
#[napi]
pub fn verify_gumroad_key(license_key: String, callback: JsFunction) -> napi::Result<()> {
    let tsfn: ThreadsafeFunction<String, ErrorStrategy::Fatal> = callback
        .create_threadsafe_function(0, |ctx| Ok(vec![ctx.value]))?;

    std::thread::spawn(move || {
        let client = match reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                tsfn.call(format!("ERR:client:{}", e), ThreadsafeFunctionCallMode::NonBlocking);
                return;
            }
        };

        // Try both product identifiers (product_id for new products, permalink for old ones)
        let product_ids = ["1HETxGKGYYf6DNDp5SnWVw==", "mzhzpt"];
        let mut last_error = String::new();

        for pid in &product_ids {
            let res = client
                .post("https://api.gumroad.com/v2/licenses/verify")
                .form(&[
                    ("product_id", *pid),
                    ("license_key", license_key.as_str()),
                    ("increment_uses_count", "true"),
                ])
                .send();

            match res {
                Ok(response) => {
                    let body = response.text().unwrap_or_else(|_| "no body".to_string());
                    println!("[LicenseRust] Gumroad response (pid={}): {}", pid, body);
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                        if json["success"].as_bool().unwrap_or(false) {
                            tsfn.call("OK".to_string(), ThreadsafeFunctionCallMode::NonBlocking);
                            return;
                        }
                        last_error = json["message"].as_str().unwrap_or("unknown error").to_string();
                    } else {
                        last_error = format!("parse error: {}", body);
                    }
                }
                Err(e) => {
                    last_error = format!("network: {}", e);
                }
            }
        }

        tsfn.call(format!("ERR:gumroad:{}", last_error), ThreadsafeFunctionCallMode::NonBlocking);
    });

    Ok(())
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
