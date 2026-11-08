// A throwaway "antivirus" certificate chain for TLS tests, built fresh on every
// run so no private key is kept in the repo. Used by
// SystemCertificates2026_10_29.test.mjs and
// src/components/__tests__/SttConnectionBlockedBanner2026_10_29.test.mjs.
// Pure Node (crypto only): no openssl, so it runs the same on macOS and Windows.

import crypto from 'node:crypto';

// Minimal DER for two X.509 v3 certificates: an ECDSA P-256 root (CA:TRUE)
// and a server certificate for localhost / 127.0.0.1 that the root signs.
export function makeFakeAvChain() {
  const len = (n) => (n < 0x80 ? Buffer.from([n]) : (() => {
    const bytes = [];
    for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
    return Buffer.from([0x80 | bytes.length, ...bytes]);
  })());
  const tlv = (tag, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), len(body.length), body]); };
  const seq = (...parts) => tlv(0x30, ...parts);
  const oid = (dotted) => {
    const [a, b, ...rest] = dotted.split('.').map(Number);
    const out = [40 * a + b];
    for (const n of rest) {
      const chunk = [n & 0x7f];
      for (let v = n >> 7; v > 0; v >>= 7) chunk.unshift(0x80 | (v & 0x7f));
      out.push(...chunk);
    }
    return tlv(0x06, Buffer.from(out));
  };
  const name = (cn) => seq(tlv(0x31, seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from(cn)))));
  const time = (d) => tlv(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
  const ext = (id, critical, value) => seq(oid(id), ...(critical ? [tlv(0x01, Buffer.from([0xff]))] : []), tlv(0x04, value));
  const ecdsaSha256 = seq(oid('1.2.840.10045.4.3.2'));
  const now = Date.now();

  function issue({ subject, issuer, publicKey, signingKey, extensions }) {
    const serial = crypto.randomBytes(8);
    serial[0] = (serial[0] & 0x7f) | 0x01;
    const tbs = seq(
      tlv(0xa0, tlv(0x02, Buffer.from([2]))),
      tlv(0x02, serial),
      ecdsaSha256,
      name(issuer),
      seq(time(new Date(now - 86_400_000)), time(new Date(now + 7 * 86_400_000))),
      name(subject),
      publicKey.export({ type: 'spki', format: 'der' }),
      tlv(0xa3, seq(...extensions)),
    );
    const der = seq(tbs, ecdsaSha256, tlv(0x03, Buffer.from([0]), crypto.sign('sha256', tbs, signingKey)));
    return `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
  }

  const root = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const server = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const rootPem = issue({
    subject: 'Natively Test Antivirus Root', issuer: 'Natively Test Antivirus Root',
    publicKey: root.publicKey, signingKey: root.privateKey,
    extensions: [ext('2.5.29.19', true, seq(tlv(0x01, Buffer.from([0xff]))))],
  });
  const serverPem = issue({
    subject: 'localhost', issuer: 'Natively Test Antivirus Root',
    publicKey: server.publicKey, signingKey: root.privateKey,
    extensions: [ext('2.5.29.17', false, seq(tlv(0x82, Buffer.from('localhost')), tlv(0x87, Buffer.from([127, 0, 0, 1]))))],
  });
  return { rootPem, serverPem, serverKeyPem: server.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}
