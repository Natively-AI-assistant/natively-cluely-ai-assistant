// electron/utils/systemCertificates.ts
//
// Node's TLS trusts the operating system's certificate store too (2026-10-29).
//
// WHY: Node ships its own copy of Mozilla's root list and, unlike Chromium,
// never reads the OS store. Antivirus "HTTPS scanning" (Kaspersky, ESET,
// Avast, Bitdefender…) and corporate TLS inspection (Zscaler, Netskope…)
// re-sign every connection with a root they install only in the Windows
// certificate store or the macOS keychain. Chromium accepts it, so the
// renderer kept working, while every main-process socket — the Natively
// transcription relay (`ws`), Deepgram (Node's WebSocket), Soniox, the
// REST/axios providers, Node `fetch` for the LLMs, gRPC for Google — failed
// with UNABLE_TO_VERIFY_LEAF_SIGNATURE / SELF_SIGNED_CERT_IN_CHAIN. A
// Windows customer only got system audio transcribed after turning off
// Kaspersky, Defender and the firewall.
//
// WHAT: append the OS store to Node's default CA list for this thread, the
// same set Chromium and every browser on the machine already trust. Node
// 24's `tls.getCACertificates('system')` reads the Windows ROOT/CA stores
// and the macOS keychain trust settings; `setDefaultCACertificates` makes
// every later connection that does not pass its own `ca` use the result.
// Connections that pin their own `ca` are untouched.
//
// ONLY USABLE ROOTS (2026-11-18, #759): the store returns more than roots.
// Windows adds its "Intermediate Certification Authorities" (cross-signatures,
// issuing CAs) and certificates that expired years ago. BoringSSL treats every
// entry in the CA list as a trusted issuer, looks there first, and picks one by
// name and key without checking its dates, so an expired twin of a certificate
// the server sends (an old cross-signature has the same name and key) won over
// the valid one: every fetch to api.natively.software failed CERT_HAS_EXPIRED
// on a customer's PC and Pro never activated. Only self-signed certificates
// that have not expired are added; an antivirus or corporate root is one, and a
// chain can only end at one.
//
// SCOPE: per thread. main.ts calls it at startup and each worker that can
// download models calls it at the top of its entry file.
//
// ESCAPE HATCH: NATIVELY_SYSTEM_CA=0 keeps Node's bundled list only.

import * as nodeTls from 'tls';
import { X509Certificate } from 'crypto';

type CaApi = {
  getCACertificates?: (type?: 'default' | 'system' | 'bundled' | 'extra') => string[];
  setDefaultCACertificates?: (certs: ReadonlyArray<string | Buffer>) => void;
};

export interface SystemCertificateDeps {
  tls?: CaApi;
  env?: Record<string, string | undefined>;
  log?: (message: string) => void;
}

export interface SystemCertificateResult {
  /** True when the default CA list now includes the system certificates. */
  applied: boolean;
  /** Certificates read from the OS store. */
  systemCount: number;
  /** Of those, how many were not already in the default list. */
  addedCount: number;
  reason?: 'disabled' | 'unsupported' | 'read-failed' | 'nothing-new' | 'set-failed';
}

function pemKey(pem: string): string {
  return pem.replace(/\s+/g, '');
}

function isUsableRoot(pem: string, now: number): boolean {
  try {
    const cert = new X509Certificate(pem);
    return cert.subject === cert.issuer && cert.validToDate.getTime() > now;
  } catch {
    return false;
  }
}

export function trustSystemCertificates(deps: SystemCertificateDeps = {}): SystemCertificateResult {
  const tls: CaApi = deps.tls ?? (nodeTls as unknown as CaApi);
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((message: string) => console.log(message));

  if (env.NATIVELY_SYSTEM_CA === '0') {
    return { applied: false, systemCount: 0, addedCount: 0, reason: 'disabled' };
  }
  if (typeof tls.getCACertificates !== 'function' || typeof tls.setDefaultCACertificates !== 'function') {
    return { applied: false, systemCount: 0, addedCount: 0, reason: 'unsupported' };
  }

  let defaults: string[];
  let system: string[];
  try {
    defaults = tls.getCACertificates('default');
    system = tls.getCACertificates('system');
  } catch (err) {
    log(`[SystemCA] Could not read the system certificate store: ${(err as Error)?.message ?? err}`);
    return { applied: false, systemCount: 0, addedCount: 0, reason: 'read-failed' };
  }

  const known = new Set(defaults.map(pemKey));
  const now = Date.now();
  const added = system.filter((pem) => {
    const key = pemKey(pem);
    if (known.has(key) || !isUsableRoot(pem, now)) return false;
    known.add(key);
    return true;
  });
  if (added.length === 0) {
    return { applied: false, systemCount: system.length, addedCount: 0, reason: 'nothing-new' };
  }

  try {
    tls.setDefaultCACertificates([...defaults, ...added]);
  } catch (err) {
    log(`[SystemCA] Could not apply the system certificates: ${(err as Error)?.message ?? err}`);
    return { applied: false, systemCount: system.length, addedCount: 0, reason: 'set-failed' };
  }
  log(`[SystemCA] Trusting ${added.length} certificate(s) from the system store (${system.length} read)`);
  return { applied: true, systemCount: system.length, addedCount: added.length };
}
