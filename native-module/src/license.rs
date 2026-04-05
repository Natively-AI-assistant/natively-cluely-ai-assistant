use sha2::{Digest, Sha256};

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

// ─── Gumroad ─────────────────────────────────────────────────────────────────

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
                        println!(
                            "[LicenseRust] Gumroad response (pid={}): success={}, msg={}",
                            pid, success, msg
                        );
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

// ─── Dodo Payments — Activate ────────────────────────────────────────────────

/// Background task that activates a Dodo Payments license key via HTTP.
///
/// Security properties (identical to Gumroad path):
///   - Runs on a libuv worker thread — never blocks the JS event loop
///   - Compiled to machine code — not patchable from JS memory
///   - Binds to the device HWID at storage time (LicenseManager.storeLicense)
///   - Never logs the raw license key
///   - Returns "OK:<instance_id>" on success, "ERR:dodo:<reason>" on failure
///   - Handles 409 Conflict (duplicate activation) as a recoverable success path
///
/// Endpoint: POST https://live.dodopayments.com/licenses/activate
/// Auth: None required — this is a public Dodo endpoint.
pub struct VerifyDodoTask {
    license_key: String,
    /// Short device label sent to Dodo so the merchant can see activations in their dashboard.
    /// This is the first 32 chars of the SHA-256 HWID — not sensitive.
    device_label: String,
}

impl Task for VerifyDodoTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .user_agent("Natively/1.0 (license-check)")
            .build()
            .map_err(|e| napi::Error::from_reason(format!("ERR:client:{}", e)))?;

        // Build the JSON body — never include the raw key in log output
        let body = serde_json::json!({
            "license_key": self.license_key,
            "name": self.device_label,
        });

        let res = client
            .post("https://live.dodopayments.com/licenses/activate")
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send();

        match res {
            Ok(response) => {
                let status = response.status().as_u16();
                let body_text = response.text().unwrap_or_else(|_| "no body".to_string());

                // Parse but never log the full body (may contain key material)
                match serde_json::from_str::<serde_json::Value>(&body_text) {
                    Ok(json) => {
                        // Dodo returns { "id": "lki_xxx", "license_key": "...", ... } on success
                        if status == 200 || status == 201 {
                            if let Some(instance_id) = json["id"].as_str() {
                                println!(
                                    "[LicenseRust] Dodo activation success (status={}, instance_id present)",
                                    status
                                );
                                // Return instance_id so LicenseManager can persist it for
                                // future validate/deactivate calls.
                                return Ok(format!("OK:{}", instance_id));
                            }
                        }

                        // 409 = key already activated on this (or another) device.
                        // Dodo may return the existing instance_id in the error body.
                        // We treat this as a retriable error so LicenseManager can handle
                        // the duplicate flow (show "already activated" message).
                        if status == 409 {
                            println!(
                                "[LicenseRust] Dodo activation: 409 conflict (duplicate activation)"
                            );
                            // Return the instance_id from the conflict body if available,
                            // so callers can re-use the existing activation slot.
                            if let Some(existing_id) = json["id"]
                                .as_str()
                                .or_else(|| json["license_key_instance_id"].as_str())
                            {
                                return Ok(format!("ERR:dodo:duplicate:{}", existing_id));
                            }
                            return Ok("ERR:dodo:duplicate activation".to_string());
                        }

                        // 422 = activation limit reached (product has 0 or exhausted slots)
                        // Return a stable code so TypeScript doesn't need to match human-readable strings.
                        if status == 422 {
                            let code = json["code"].as_str().unwrap_or("LIMIT_REACHED");
                            println!(
                                "[LicenseRust] Dodo activation failed: status={}, err={}",
                                status, code
                            );
                            return Ok("ERR:dodo:limit_reached".to_string());
                        }

                        // Extract the most useful error field (never the full body)
                        let err = json["error"]["message"]
                            .as_str()
                            .or_else(|| json["detail"].as_str())
                            .or_else(|| json["message"].as_str())
                            .unwrap_or("unknown error");

                        println!(
                            "[LicenseRust] Dodo activation failed: status={}, err={}",
                            status, err
                        );
                        Ok(format!("ERR:dodo:{}", err))
                    }
                    Err(_) => {
                        println!(
                            "[LicenseRust] Dodo activation: non-JSON response (status={})",
                            status
                        );
                        Ok(format!("ERR:dodo:unexpected response (HTTP {})", status))
                    }
                }
            }
            Err(e) => {
                println!("[LicenseRust] Dodo network error: {}", e);
                Ok(format!("ERR:dodo:network:{}", e))
            }
        }
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output)
    }
}

/// Activates a Dodo Payments license key against the live API.
///
/// `device_label` — first 32 chars of the HWID hash; passed as the `name` field so the
/// merchant can correlate activations to devices in the Dodo dashboard.
///
/// Returns a Promise resolving to "OK:<instance_id>" on success, or "ERR:dodo:<reason>".
/// The HTTP call runs on a libuv worker thread to prevent blocking the Node.js event loop.
#[napi]
pub fn verify_dodo_key(license_key: String, device_label: String) -> AsyncTask<VerifyDodoTask> {
    AsyncTask::new(VerifyDodoTask {
        license_key,
        device_label,
    })
}

// ─── Dodo Payments — Validate ────────────────────────────────────────────────

/// Background task that validates an existing Dodo license instance via HTTP.
///
/// Call this on startup to detect server-side revocations (admin disabled key, chargebacks, etc).
/// Uses the same libuv thread pool as activation — never blocks the event loop.
///
/// Endpoint: POST https://live.dodopayments.com/licenses/validate
/// Auth: None required — public endpoint.
///
/// Returns:
///   "OK"      — key is still valid
///   "REVOKED" — server says the key is no longer active (license revoked/expired/disabled)
///   "ERR:dodo:network:<reason>" — network failure; caller should fail-open (keep cached result)
///   "ERR:dodo:<reason>" — other error
pub struct ValidateDodoTask {
    license_key: String,
}

impl Task for ValidateDodoTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .user_agent("Natively/1.0 (license-validate)")
            .build()
            .map_err(|e| napi::Error::from_reason(format!("ERR:client:{}", e)))?;

        // Only send license_key — not the raw instance_id (avoids leaking it in transit).
        // Dodo's validate endpoint accepts just the key and returns { "valid": bool, ... }
        let body = serde_json::json!({
            "license_key": self.license_key,
        });

        let res = client
            .post("https://live.dodopayments.com/licenses/validate")
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send();

        match res {
            Ok(response) => {
                let status = response.status().as_u16();
                let body_text = response.text().unwrap_or_else(|_| "no body".to_string());

                match serde_json::from_str::<serde_json::Value>(&body_text) {
                    Ok(json) => {
                        let valid = json["valid"].as_bool().unwrap_or(false);
                        println!(
                            "[LicenseRust] Dodo validate response: status={}, valid={}",
                            status, valid
                        );

                        if status == 200 && valid {
                            return Ok("OK".to_string());
                        }

                        // Any 4xx with valid=false means the key is definitively revoked/expired
                        if status >= 400 || !valid {
                            return Ok("REVOKED".to_string());
                        }

                        Ok("ERR:dodo:validate unexpected state".to_string())
                    }
                    Err(_) => {
                        println!(
                            "[LicenseRust] Dodo validate: non-JSON response (status={})",
                            status
                        );
                        Ok(format!(
                            "ERR:dodo:validate unexpected response (HTTP {})",
                            status
                        ))
                    }
                }
            }
            Err(e) => {
                // Network failure — log and return tagged error so caller fails-open.
                println!("[LicenseRust] Dodo validate network error: {}", e);
                Ok(format!("ERR:dodo:network:{}", e))
            }
        }
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output)
    }
}

/// Validates an existing Dodo Payments license key against the live API.
///
/// Used for periodic startup checks to detect server-side revocations.
/// Returns a Promise resolving to "OK", "REVOKED", or "ERR:dodo:...".
/// Network errors return "ERR:dodo:network:..." so callers can fail-open.
#[napi]
pub fn validate_dodo_key(license_key: String) -> AsyncTask<ValidateDodoTask> {
    AsyncTask::new(ValidateDodoTask { license_key })
}

// ─── Dodo Payments — Deactivate ──────────────────────────────────────────────

/// Background task that deactivates a specific Dodo license instance via HTTP.
///
/// Must be called with the `instance_id` returned at activation time.
/// This frees the activation slot so the user can activate on a new machine.
///
/// Endpoint: POST https://live.dodopayments.com/licenses/deactivate
/// Auth: None required — public endpoint.
///
/// Request body: { "license_key": "...", "license_key_instance_id": "lki_xxx" }
///
/// Returns:
///   "OK"              — instance successfully deactivated
///   "ERR:dodo:network:<reason>" — network failure (caller should still remove local file)
///   "ERR:dodo:<reason>" — server-side error
pub struct DeactivateDodoTask {
    license_key: String,
    /// The instance ID returned when the license was activated ("lki_xxx" format).
    instance_id: String,
}

impl Task for DeactivateDodoTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .user_agent("Natively/1.0 (license-deactivate)")
            .build()
            .map_err(|e| napi::Error::from_reason(format!("ERR:client:{}", e)))?;

        // Never log the license key or instance_id in full
        let body = serde_json::json!({
            "license_key": self.license_key,
            "license_key_instance_id": self.instance_id,
        });

        let res = client
            .post("https://live.dodopayments.com/licenses/deactivate")
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send();

        match res {
            Ok(response) => {
                let status = response.status().as_u16();
                let body_text = response.text().unwrap_or_else(|_| "no body".to_string());

                // 200 = successfully deactivated
                if status == 200 {
                    println!("[LicenseRust] Dodo deactivation success (status=200)");
                    return Ok("OK".to_string());
                }

                // 404 = instance already deactivated or not found — treat as success
                // (idempotent: if it's already gone, the goal is achieved)
                if status == 404 {
                    println!("[LicenseRust] Dodo deactivation: 404 (already deactivated or not found, treating as OK)");
                    return Ok("OK".to_string());
                }

                let err = serde_json::from_str::<serde_json::Value>(&body_text)
                    .ok()
                    .and_then(|json| {
                        json["error"]["message"]
                            .as_str()
                            .or_else(|| json["detail"].as_str())
                            .or_else(|| json["message"].as_str())
                            .map(|s| s.to_string())
                    })
                    .unwrap_or_else(|| format!("HTTP {}", status));

                println!(
                    "[LicenseRust] Dodo deactivation failed: status={}, err={}",
                    status, err
                );
                Ok(format!("ERR:dodo:{}", err))
            }
            Err(e) => {
                println!("[LicenseRust] Dodo deactivate network error: {}", e);
                Ok(format!("ERR:dodo:network:{}", e))
            }
        }
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output)
    }
}

/// Deactivates a Dodo Payments license activation instance.
///
/// `instance_id` — the activation instance ID (e.g. "lki_xxx") returned at activation time.
/// This is stored in the encrypted license file and passed here to free the slot.
///
/// Returns a Promise resolving to "OK" or "ERR:dodo:<reason>".
/// Network errors return "ERR:dodo:network:..." — callers should still remove the local license
/// file even on network failure (fail-safe: local removal always happens).
#[napi]
pub fn deactivate_dodo_key(
    license_key: String,
    instance_id: String,
) -> AsyncTask<DeactivateDodoTask> {
    AsyncTask::new(DeactivateDodoTask {
        license_key,
        instance_id,
    })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
