// scripts/lib/sd-interview-sim/replQuietConsole.js
//
// Keep the REPL TTY clean: divert console.* / process stdout+stderr writes
// from the Electron app into a side log file. REPL UI uses `say()` / `sayErr()`
// which write to the real terminal streams.

'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');

/**
 * @param {{ logPath: string, label?: string }} opts
 * @returns {{
 *   say: (...args: unknown[]) => void,
 *   sayErr: (...args: unknown[]) => void,
 *   write: (chunk: string) => void,
 *   logPath: string,
 *   restore: () => void,
 * }}
 */
function installReplQuietConsole(opts) {
  const logPath = opts.logPath;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, '', { flag: 'a' });

  const realConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug ? console.debug.bind(console) : console.log.bind(console),
  };

  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);

  function appendLog(chunk) {
    try {
      fs.appendFileSync(logPath, String(chunk ?? ''), 'utf8');
    } catch {
      /* ignore */
    }
  }

  function stamp(args) {
    const ts = new Date().toISOString();
    const body = util.format(...args);
    appendLog(`[${ts}] ${body}\n`);
  }

  console.log = (...args) => stamp(args);
  console.info = (...args) => stamp(args);
  console.warn = (...args) => stamp(args);
  console.error = (...args) => stamp(args);
  console.debug = (...args) => stamp(args);

  process.stdout.write = (chunk, encoding, cb) => {
    appendLog(chunk);
    if (typeof encoding === 'function') encoding();
    else if (typeof cb === 'function') cb();
    return true;
  };
  process.stderr.write = (chunk, encoding, cb) => {
    appendLog(chunk);
    if (typeof encoding === 'function') encoding();
    else if (typeof cb === 'function') cb();
    return true;
  };

  function say(...args) {
    stdoutWrite(util.format(...args) + '\n');
  }

  function sayErr(...args) {
    stderrWrite(util.format(...args) + '\n');
  }

  function write(chunk) {
    stdoutWrite(String(chunk ?? ''));
  }

  function restore() {
    console.log = realConsole.log;
    console.info = realConsole.info;
    console.warn = realConsole.warn;
    console.error = realConsole.error;
    console.debug = realConsole.debug;
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }

  if (opts.label) {
    stamp([opts.label]);
  }

  return { say, sayErr, write, logPath, restore };
}

module.exports = { installReplQuietConsole };
