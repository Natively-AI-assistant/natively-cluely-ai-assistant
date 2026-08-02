import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createHash, X509Certificate } from 'crypto';
import { loadDefenceConfig } from './config';

function privateIps(): string[] { return Object.values(os.networkInterfaces()).flatMap(items => items || []).filter(item => item.family === 'IPv4' && !item.internal).map(item => item.address).filter(ip => /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(ip)); }
function configured(value: string): boolean { return !!value && !/^(?:your_|example|changeme|placeholder)/i.test(value); }
function baseHost(value: string): string { try { return new URL(value).host; } catch { return ''; } }
function commandVersion(command: string, args: string[]): string | null { try { return execFileSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 3000 }).trim().split(/\r?\n/)[0]; } catch { return null; } }
function nativeModuleDiagnostics() {
  const binaryName = process.platform === 'win32' ? `index.win32-${process.arch}-msvc.node` : '';
  const binaryPath = binaryName ? path.join(process.cwd(), 'native-module', binaryName) : '';
  let binarySha256: string | null = null;
  if (binaryPath && fs.existsSync(binaryPath)) binarySha256 = createHash('sha256').update(fs.readFileSync(binaryPath)).digest('hex').toUpperCase();
  return {
    binaryPresent: Boolean(binarySha256), binaryName: binaryName || null, binarySha256,
    architecture: process.arch, nodeApi: process.versions.napi || null,
    buildToolchain: process.platform === 'win32' ? 'Rust MSVC via napi-rs' : 'Rust via napi-rs',
    rustcVersion: commandVersion('rustc', ['--version']), cargoVersion: commandVersion('cargo', ['--version']),
    sourceCommit: commandVersion('git', ['rev-parse', 'HEAD']), windowsBuild: process.platform === 'win32' ? os.release() : null,
    windowsVersion: process.platform === 'win32' ? os.version() : null,
  };
}

export function runDoctor(env: NodeJS.ProcessEnv = process.env) {
  const config = loadDefenceConfig(env); const protocol = config.tls.enabled ? 'https' : 'http'; const hosts = config.host === '0.0.0.0' ? privateIps() : [config.host];
  const companionBase = config.companionPublicUrl || `${protocol}://${config.companionHost}:${config.companionPort}`;
  let certReadable = false; let keyReadable = false; let certificateMatchesHost = false; let certificateNames: string[] = [];
  if (config.tls.enabled) {
    try { const cert = new X509Certificate(fs.readFileSync(config.tls.certPath)); certReadable = true; certificateNames = cert.subjectAltName?.split(',').map(item => item.trim()).slice(0, 12) || []; certificateMatchesHost = hosts.some(host => cert.checkIP(host) || cert.checkHost(host)); } catch { certReadable = false; }
    try { fs.accessSync(config.tls.keyPath, fs.constants.R_OK); keyReadable = true; } catch { keyReadable = false; }
  }
  const notes: string[] = [];
  if (!config.input.iphoneOutputOnly && !config.tls.enabled && !config.companionPublicUrl.startsWith('https://')) notes.push('HTTPS is disabled; a physical iPhone cannot grant microphone access to this origin.');
  if (config.companionPublicUrl.startsWith('https://')) notes.push('Companion HTTPS terminates at a reverse proxy or tunnel; verify its certificate on the iPhone.');
  if (config.retrievalTopKAdjusted) notes.push('CBA retrievalTopK was below 3 and has been automatically promoted to 3 for cross-language evidence recall.');
  if (config.publicMode !== 'companion-only') notes.push('Companion-only mode is disabled; do not expose the full admin listener through a tunnel.');
  const companionSecure = config.tls.enabled || config.companionPublicUrl.startsWith('https://');
  const result = {
    status: 'DOCTOR_COMPLETE', projectId: config.projectId, projectSourceExists: fs.existsSync(config.projectSourcePath), host: config.host, port: config.port,
    httpsEnabled: config.tls.enabled, certificateReadable: certReadable, privateKeyReadable: keyReadable, certificateMatchesHost,
    certificateNames, companionUrls: config.publicMode === 'companion-only' ? [`${companionBase}/`] : hosts.map(host => `${protocol}://${host}:${config.port}/`), websocketUrls: config.publicMode === 'companion-only' ? [`${companionBase.replace(/^http/, 'ws')}/api/defence/live`] : hosts.map(host => `${config.tls.enabled ? 'wss' : 'ws'}://${host}:${config.port}/api/defence/live`),
    adminLocalOnly: config.adminLocalOnly, publicMode: config.publicMode, adminNotExposed: config.publicMode === 'companion-only', companionHost: config.companionHost, companionPort: config.companionPort,
    stt: { provider: config.stt.provider, baseHost: baseHost(config.stt.baseUrl), model: config.stt.model, providerConfigured: config.stt.provider !== 'none', endpointConfigured: configured(config.stt.baseUrl), keyConfigured: configured(config.stt.apiKey), modelConfigured: configured(config.stt.model) },
    llm: { provider: config.llm.provider, baseHost: baseHost(config.llm.baseUrl), model: config.llm.model, providerConfigured: config.llm.provider !== 'none', endpointConfigured: configured(config.llm.baseUrl), keyConfigured: config.llm.provider === 'ollama' || configured(config.llm.apiKey), modelConfigured: configured(config.llm.model) },
    searchProvider: config.search.provider, searchDisabled: config.search.provider === 'none', indexExists: fs.existsSync(`${config.indexPath}/manifest.json`), storeAudio: config.storeAudio,
    retrievalTopK: config.retrievalTopK, retrievalTopKAdjusted: config.retrievalTopKAdjusted,
    inputMode: config.input.mode, inputSource: config.input.source, iphoneOutputOnly: config.input.iphoneOutputOnly,
    nativeModule: nativeModuleDiagnostics(),
    windowsVad: { minSpeechMs: config.input.vad.minSpeechMs, silenceMs: config.input.vad.silenceMs, maxUtteranceMs: config.input.vad.maxUtteranceMs, partialIntervalMs: config.input.vad.partialIntervalMs },
    companionHttpsConfigured: companionSecure,
    externalTlsTrustUnverified: config.companionPublicUrl.startsWith('https://'),
    suitableForIPhoneMicrophone: config.tls.enabled && certReadable && keyReadable && certificateMatchesHost && !config.storeAudio,
    suitableForIPhoneOutputOnly: config.input.iphoneOutputOnly && companionSecure && !config.storeAudio,
    notes,
  };
  return result;
}

if (require.main === module) console.log(JSON.stringify(runDoctor(), null, 2));
