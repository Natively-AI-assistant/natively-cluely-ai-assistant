import fs from 'fs';
import os from 'os';
import { X509Certificate } from 'crypto';
import { loadDefenceConfig } from './config';

function privateIps(): string[] { return Object.values(os.networkInterfaces()).flatMap(items => items || []).filter(item => item.family === 'IPv4' && !item.internal).map(item => item.address).filter(ip => /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(ip)); }
function configured(value: string): boolean { return !!value && !/^(?:your_|example|changeme|placeholder)/i.test(value); }

export function runDoctor(env: NodeJS.ProcessEnv = process.env) {
  const config = loadDefenceConfig(env); const protocol = config.tls.enabled ? 'https' : 'http'; const hosts = config.host === '0.0.0.0' ? privateIps() : [config.host];
  const companionBase = config.companionPublicUrl || `${protocol}://${config.companionHost}:${config.companionPort}`;
  let certReadable = false; let keyReadable = false; let certificateMatchesHost = false; let certificateNames: string[] = [];
  if (config.tls.enabled) {
    try { const cert = new X509Certificate(fs.readFileSync(config.tls.certPath)); certReadable = true; certificateNames = cert.subjectAltName?.split(',').map(item => item.trim()).slice(0, 12) || []; certificateMatchesHost = hosts.some(host => cert.checkIP(host) || cert.checkHost(host)); } catch { certReadable = false; }
    try { fs.accessSync(config.tls.keyPath, fs.constants.R_OK); keyReadable = true; } catch { keyReadable = false; }
  }
  const notes: string[] = [];
  if (!config.tls.enabled && !config.companionPublicUrl.startsWith('https://')) notes.push('HTTPS is disabled; a physical iPhone cannot grant microphone access to this origin.');
  if (config.companionPublicUrl.startsWith('https://')) notes.push('Companion HTTPS terminates at a reverse proxy or tunnel; verify its certificate on the iPhone.');
  if (config.retrievalTopKAdjusted) notes.push('CBA retrievalTopK was below 3 and has been automatically promoted to 3 for cross-language evidence recall.');
  if (config.publicMode !== 'companion-only') notes.push('Companion-only mode is disabled; do not expose the full admin listener through a tunnel.');
  const companionSecure = config.tls.enabled || config.companionPublicUrl.startsWith('https://');
  const result = {
    status: 'DOCTOR_COMPLETE', projectSourceExists: fs.existsSync(config.projectSourcePath), host: config.host, port: config.port,
    httpsEnabled: config.tls.enabled, certificateReadable: certReadable, privateKeyReadable: keyReadable, certificateMatchesHost,
    certificateNames, companionUrls: config.publicMode === 'companion-only' ? [`${companionBase}/`] : hosts.map(host => `${protocol}://${host}:${config.port}/`), websocketUrls: config.publicMode === 'companion-only' ? [`${companionBase.replace(/^http/, 'ws')}/api/defence/live`] : hosts.map(host => `${config.tls.enabled ? 'wss' : 'ws'}://${host}:${config.port}/api/defence/live`),
    adminLocalOnly: config.adminLocalOnly, publicMode: config.publicMode, adminNotExposed: config.publicMode === 'companion-only', companionHost: config.companionHost, companionPort: config.companionPort,
    stt: { providerConfigured: config.stt.provider !== 'none', endpointConfigured: configured(config.stt.baseUrl), keyConfigured: configured(config.stt.apiKey), modelConfigured: configured(config.stt.model) },
    llm: { providerConfigured: config.llm.provider !== 'none', endpointConfigured: configured(config.llm.baseUrl), keyConfigured: config.llm.provider === 'ollama' || configured(config.llm.apiKey), modelConfigured: configured(config.llm.model) },
    searchDisabled: config.search.provider === 'none', indexExists: fs.existsSync(`${config.indexPath}/manifest.json`), storeAudio: config.storeAudio,
    retrievalTopK: config.retrievalTopK, retrievalTopKAdjusted: config.retrievalTopKAdjusted,
    companionHttpsConfigured: companionSecure,
    externalTlsTrustUnverified: config.companionPublicUrl.startsWith('https://'),
    suitableForIPhoneMicrophone: config.tls.enabled && certReadable && keyReadable && certificateMatchesHost && !config.storeAudio,
    notes,
  };
  return result;
}

if (require.main === module) console.log(JSON.stringify(runDoctor(), null, 2));
