// scripts/lib/sd-interview-sim/replUi.js
//
// Terminal presentation for the SD interview REPL: colors, word wrap,
// role blocks, spinner, banner. Pure formatting helpers are exported so they
// can be unit tested without a TTY.

'use strict';

const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  italic: '\u001b[3m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  magenta: '\u001b[35m',
  cyan: '\u001b[36m',
  gray: '\u001b[90m',
};

const FENCE_RE = /^\s*```/;

/**
 * Colors are opt-out via NO_COLOR and only default on for a TTY.
 * @param {{ isTTY?: boolean, env?: NodeJS.ProcessEnv }} [opts]
 */
function colorEnabled(opts = {}) {
  const env = opts.env || process.env;
  if (env.NO_COLOR) return false;
  if (env.FORCE_COLOR && env.FORCE_COLOR !== '0') return true;
  return Boolean(opts.isTTY);
}

function makePaint(enabled) {
  return function paint(text, ...styles) {
    if (!enabled || styles.length === 0) return String(text);
    const prefix = styles.map((s) => ANSI[s] || '').join('');
    return `${prefix}${text}${ANSI.reset}`;
  };
}

/** Printable width, ignoring ANSI escapes. */
function visibleWidth(text) {
  // eslint-disable-next-line no-control-regex
  return String(text).replace(/\u001b\[[0-9;]*m/g, '').length;
}

/**
 * Word wrap that leaves fenced code blocks and their indentation untouched.
 *
 * @param {string} text
 * @param {number} width
 * @returns {string[]}
 */
function wrapText(text, width) {
  const max = Math.max(20, Number(width) || 80);
  const out = [];
  let inFence = false;

  for (const rawLine of String(text ?? '').split('\n')) {
    if (FENCE_RE.test(rawLine)) {
      inFence = !inFence;
      out.push(rawLine);
      continue;
    }
    if (inFence || rawLine.trim() === '') {
      out.push(rawLine);
      continue;
    }

    const indentMatch = rawLine.match(/^(\s*(?:[-*+]\s+|\d+\.\s+)?)/);
    const lead = indentMatch ? indentMatch[1] : '';
    const hangingIndent = ' '.repeat(lead.length);
    const words = rawLine.slice(lead.length).split(/\s+/).filter(Boolean);

    if (words.length === 0) {
      out.push(rawLine);
      continue;
    }

    let line = lead;
    let lineHasWord = false;
    for (const word of words) {
      const candidate = lineHasWord ? `${line} ${word}` : `${line}${word}`;
      if (lineHasWord && visibleWidth(candidate) > max) {
        out.push(line);
        line = `${hangingIndent}${word}`;
      } else {
        line = candidate;
      }
      lineHasWord = true;
    }
    out.push(line);
  }

  return out;
}

function formatDuration(ms) {
  const n = Number(ms) || 0;
  if (n < 1000) return `${Math.max(0, Math.round(n))}ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(1)}s`;
  const mins = Math.floor(n / 60_000);
  const secs = Math.round((n % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

/**
 * @param {{ input_tokens?: number, output_tokens?: number, estimated_usd?: number }} [spend]
 */
function formatSpend(spend) {
  if (!spend) return '';
  const tokens = (Number(spend.input_tokens) || 0) + (Number(spend.output_tokens) || 0);
  const parts = [];
  if (tokens > 0) parts.push(`${tokens} tok`);
  const usd = Number(spend.estimated_usd) || 0;
  if (usd > 0) parts.push(`$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`);
  return parts.join(' · ');
}

const ROLE_STYLES = {
  interviewer: { icon: '◆', label: 'Interviewer', color: 'magenta' },
  candidate: { icon: '●', label: 'Candidate', color: 'cyan' },
  you: { icon: '›', label: 'You', color: 'green' },
  system: { icon: '·', label: 'System', color: 'gray' },
};

/**
 * @param {{
 *   isTTY?: boolean,
 *   width?: number,
 *   say: (text: string) => void,
 *   write: (chunk: string) => void,
 *   env?: NodeJS.ProcessEnv,
 * }} opts
 */
function createReplUi(opts) {
  const isTTY = Boolean(opts.isTTY);
  const paint = makePaint(colorEnabled({ isTTY, env: opts.env }));
  const say = opts.say;
  const write = opts.write;

  function width() {
    const forced = Number(opts.width);
    if (Number.isFinite(forced) && forced > 0) return forced;
    const cols = process.stdout && process.stdout.columns;
    return Math.min(100, Math.max(48, Number(cols) || 80));
  }

  function bodyWidth() {
    return width() - 2;
  }

  function rule(char = '─') {
    return paint(char.repeat(width()), 'gray');
  }

  /**
   * @param {'interviewer'|'candidate'|'you'|'system'} role
   * @param {string} text
   * @param {{ meta?: string, subject?: string }} [extra]
   */
  function message(role, text, extra = {}) {
    const style = ROLE_STYLES[role] || ROLE_STYLES.system;
    const head = [
      paint(style.icon, style.color, 'bold'),
      paint(extra.subject || style.label, style.color, 'bold'),
    ].join(' ');
    const meta = extra.meta ? `  ${paint(extra.meta, 'gray')}` : '';

    say('');
    say(`${head}${meta}`);
    for (const line of wrapText(text, bodyWidth())) {
      say(line.trim() === '' ? '' : `  ${line}`);
    }
  }

  function notice(text) {
    say(`${paint('·', 'gray')} ${paint(text, 'gray')}`);
  }

  function success(text) {
    say(`${paint('✓', 'green')} ${text}`);
  }

  function warn(text) {
    say(`${paint('!', 'yellow')} ${paint(text, 'yellow')}`);
  }

  function error(text) {
    say(`${paint('✗', 'red')} ${paint(text, 'red')}`);
  }

  /**
   * @param {{
   *   title: string,
   *   prompt: string,
   *   rows: Array<[string, string]>,
   * }} info
   */
  function banner(info) {
    say('');
    say(`${paint(info.title, 'bold')} ${paint('· system design interview', 'gray')}`);
    say(rule());
    for (const line of wrapText(info.prompt, bodyWidth())) {
      say(paint(line, 'bold'));
    }
    say('');
    const labelWidth = Math.max(...info.rows.map(([k]) => k.length));
    for (const [key, value] of info.rows) {
      say(`${paint(key.padEnd(labelWidth), 'gray')}  ${value}`);
    }
    say(rule());
  }

  /**
   * @param {Array<[string, string]>} commands
   */
  function help(commands) {
    const cmdWidth = Math.max(...commands.map(([c]) => c.length));
    say('');
    say(paint('Commands', 'bold'));
    for (const [cmd, desc] of commands) {
      say(`  ${paint(cmd.padEnd(cmdWidth), 'cyan')}  ${paint(desc, 'gray')}`);
    }
    say('');
  }

  /**
   * @param {'interviewer'|'candidate'} mode
   */
  function promptText(mode) {
    const style = mode === 'candidate' ? ROLE_STYLES.candidate : ROLE_STYLES.interviewer;
    return `${paint(mode, style.color, 'bold')} ${paint('❯', 'gray')} `;
  }

  const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  /**
   * Elapsed-time spinner. No-op renderer when stdout is not a TTY.
   * @param {string} label
   */
  function spinner(label) {
    const started = Date.now();
    let text = label;
    if (!isTTY) {
      return {
        stop: () => Date.now() - started,
        elapsed: () => Date.now() - started,
        setLabel: (next) => {
          text = next;
        },
      };
    }
    let i = 0;
    const render = () => {
      const frame = FRAMES[i++ % FRAMES.length];
      const elapsed = formatDuration(Date.now() - started);
      write(`\r\u001b[2K${paint(frame, 'cyan')} ${paint(`${text} ${elapsed}`, 'gray')}`);
    };
    render();
    const timer = setInterval(render, 90);
    if (typeof timer.unref === 'function') timer.unref();
    return {
      elapsed: () => Date.now() - started,
      setLabel(next) {
        text = next;
        render();
      },
      stop() {
        clearInterval(timer);
        write('\r\u001b[2K');
        return Date.now() - started;
      },
    };
  }

  return {
    paint,
    width,
    message,
    notice,
    success,
    warn,
    error,
    banner,
    help,
    promptText,
    spinner,
    rule: () => say(rule()),
    blank: () => say(''),
  };
}

module.exports = {
  createReplUi,
  wrapText,
  visibleWidth,
  formatDuration,
  formatSpend,
  colorEnabled,
  ROLE_STYLES,
};
