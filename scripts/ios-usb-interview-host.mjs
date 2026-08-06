#!/usr/bin/env node
/**
 * Print the Mac host IP to use for iOS USB interview pairing
 * (Personal Hotspot over USB / Internet Sharing bridge).
 *
 * Usage:
 *   node scripts/ios-usb-interview-host.mjs
 *   node scripts/ios-usb-interview-host.mjs --port 4123 --check
 *   node scripts/ios-usb-interview-host.mjs --json
 *
 * See mobile/docs/USB-INTERVIEW.md
 */

import net from 'node:net';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  DEFAULT_PORT,
  buildReport,
} = require('./lib/iosUsbInterviewHost.js');

function parseArgs(argv) {
  let port = DEFAULT_PORT;
  let check = false;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '--check') check = true;
    else if (a === '--port') {
      const next = argv[++i];
      const n = Number(next);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid --port value: ${next}`);
      }
      port = n;
    } else if (a === '--help' || a === '-h') {
      return { help: true };
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return { port, check, json, help: false };
}

function printHelp() {
  console.log(`iOS USB interview host helper

Print the Mac IPv4 to enter in the RN Pairing screen for interview-day USB
(Personal Hotspot over USB). Not an adb-reverse / iproxy reverse tunnel.

  node scripts/ios-usb-interview-host.mjs
  node scripts/ios-usb-interview-host.mjs --port 4123 --check
  node scripts/ios-usb-interview-host.mjs --json

Docs: mobile/docs/USB-INTERVIEW.md
`);
}

/**
 * @param {string} host
 * @param {number} port
 * @param {number} [timeoutMs]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
function checkTcp(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ ok: false, error: 'timeout' });
    }, timeoutMs);
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve({ ok: true });
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message || String(err) });
    });
  });
}

function printHuman(report, checkResult) {
  console.log('=== iOS USB interview host ===');
  console.log(`Platform: ${report.platform}`);
  console.log(report.message);
  if (report.windowsGap) {
    console.log('');
    console.log('Windows status: gap — no verified USB interview path in this ticket.');
    console.log('Use Tailscale or LAN on Windows until a USB path is designed and tested.');
    return;
  }
  console.log(`Port: ${report.port}`);
  console.log(`Pairing tip host (if undetected): ${report.hostHint}`);
  if (report.candidates.length) {
    console.log('Candidates:');
    for (const c of report.candidates) {
      const mark = c.address === report.suggestedHost ? ' *' : '';
      console.log(`  - ${c.address}  (${c.iface}, ${c.kind})${mark}`);
    }
  }
  if (report.suggestedHost) {
    console.log('');
    console.log('RN Pairing:');
    console.log(`  Host: ${report.suggestedHost}`);
    console.log(`  Port: ${report.port}`);
    console.log('  Token: from desktop Sync / QR (Allow LAN on)');
  }
  if (checkResult) {
    console.log('');
    if (checkResult.ok) {
      console.log(`TCP check ${checkResult.host}:${checkResult.port}: OK (something is listening)`);
    } else {
      console.log(
        `TCP check ${checkResult.host}:${checkResult.port}: FAIL (${checkResult.error}). Is Phone Mirror running with Allow LAN?`,
      );
    }
  }
  console.log('');
  console.log('Checklist: cable → Personal Hotspot → helper host → Mirror+Allow LAN → RN USB connect');
  console.log('Full steps: mobile/docs/USB-INTERVIEW.md');
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message || err);
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    printHelp();
    return;
  }

  const report = buildReport({ port: args.port });
  /** @type {{ host: string, port: number, ok: boolean, error?: string }|null} */
  let checkResult = null;

  if (args.check) {
    const host = report.suggestedHost || report.hostHint;
    const result = await checkTcp(host, report.port);
    checkResult = { host, port: report.port, ...result };
  }

  if (args.json) {
    console.log(JSON.stringify({ ...report, check: checkResult }, null, 2));
  } else {
    printHuman(report, checkResult);
  }

  if (report.windowsGap || !report.supported) {
    process.exitCode = report.windowsGap ? 3 : 4;
  } else if (args.check && checkResult && !checkResult.ok) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
