import fs from 'fs';
import os from 'os';
import { X509Certificate } from 'crypto';
import { loadDefenceConfig } from './config';

function privateIps(): string[] { return Object.values(os.networkInterfaces()).flatMap(items => items || []).filter(item => item.family === 'IPv4' && !item.internal).map(item => item.address).filter(ip => /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(ip)); }
function configured(value: string): boolean { return !!value && !/^(?:your_|example|changeme|placeholder)/i.test(value); }

export function runDoctor(env: NodeJS.ProcessEnv = process.env) {
  const config = loadDefenceConfig(env); const protocol = config.tls.enabled ? 'https' : 'http'; const hosts = config.host === '0.0.0.0' ? privateIps() : [config.host];
  let certReadable = false; let keyReadable = false; let certificateMatchesHost = false; let certificateNames: string[] = [];
  if (config.tls.enabled) {
    try { const cert = new X509Certificate(fs.readFileSync(config.tls.certPath)); certReadable = true; certificateNames = cert.subjectAltName?.split(',').map(item => item.trim()).slice(0, 12) || []; certificateMatchesHost = hosts.some(host => cert.checkIP(host) || cert.checkHost(host)); } catch { certReadable = false; }
    try { fs.accessSync(config.tls.keyPath, fs.constants.R_OK); keyReadable = true; } catch { keyReadable = false; }
  }
  const result = {
    status: 'DOCTOR_COMPLETE', projectSourceExists: fs.existsSync(config.projectSourcePath), host: config.host, port: config.port,
    httpsEnabled: config.tls.enabled, certificateReadable: certReadable, privateKeyReadable: keyReadable, certificateMatchesHost,
    certificateNames, companionUrls: hosts.map(host => `${protocol}://${host}:${config.port}/`), websocketUrls: hosts.map(host => `${config.tls.enabled ? 'wss' : 'ws'}://${host}:${config.port}/api/defence/live`),
    adminLocalOnly: config.adminLocalOnly,
    stt: { providerConfigured: config.stt.provider !== 'none', endpointConfigured: configured(config.stt.baseUrl), keyConfigured: configured(config.stt.apiKey), modelConfigured: configured(config.stt.model) },
    llm: { providerConfigured: config.llm.provider !== 'none', endpointConfigured: configured(config.llm.baseUrl), keyConfigured: config.llm.provider === 'ollama' || configured(config.llm.apiKey), modelConfigured: configured(config.llm.model) },
    searchDisabled: config.search.provider === 'none', indexExists: fs.existsSync(`${config.indexPath}/manifest.json`), storeAudio: config.storeAudio,
    suitableForIPhoneMicrophone: config.tls.enabled && certReadable && keyReadable && certificateMatchesHost && !config.storeAudio,
    notes: config.tls.enabled ? [] : ['HTTPS is disabled; a physical iPhone cannot grant microphone access to a private-IP HTTP origin.'],
  };
  return result;
}

if (require.main === module) console.log(JSON.stringify(runDoctor(), null, 2));
