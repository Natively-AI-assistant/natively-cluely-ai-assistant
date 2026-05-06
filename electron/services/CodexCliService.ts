import { spawn } from 'child_process';

export interface CodexCliConfig {
  enabled: boolean;
  path: string;
  model: string;
  fastModel: string;
  timeoutMs: number;
}

export interface CodexCliRunOptions {
  prompt: string;
  model: string;
  timeoutMs: number;
  imagePaths?: string[];
}

export const DEFAULT_CODEX_CLI_CONFIG: CodexCliConfig = {
  enabled: false,
  path: 'codex',
  model: 'gpt-5.4',
  fastModel: 'gpt-5.3-codex-spark',
  timeoutMs: 60_000,
};

export class CodexCliService {
  public static buildArgs(model: string, imagePaths: string[] = []): string[] {
    const args = [
      'exec',
      '--json',
      '--color',
      'never',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--model',
      model,
    ];
    for (const imagePath of imagePaths) {
      if (!imagePath) continue;
      args.push('--image', imagePath);
    }
    return args;
  }

  public static normalizeConfig(config: Partial<CodexCliConfig> = {}): CodexCliConfig {
    const timeoutMs = Number(config.timeoutMs);
    return {
      enabled: !!config.enabled,
      path: (config.path || DEFAULT_CODEX_CLI_CONFIG.path).trim() || DEFAULT_CODEX_CLI_CONFIG.path,
      model: (config.model || DEFAULT_CODEX_CLI_CONFIG.model).trim() || DEFAULT_CODEX_CLI_CONFIG.model,
      fastModel: (config.fastModel || DEFAULT_CODEX_CLI_CONFIG.fastModel).trim() || DEFAULT_CODEX_CLI_CONFIG.fastModel,
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_CODEX_CLI_CONFIG.timeoutMs,
    };
  }

  public static async validateExecutable(path: string, timeoutMs = 10_000): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const child = spawn(path, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        resolve({ success: false, error: `Codex CLI validation timed out for "${path}".` });
      }, timeoutMs);

      child.stderr.on('data', chunk => {
        stderr += chunk.toString();
      });
      child.on('error', error => {
        clearTimeout(timer);
        resolve({ success: false, error: `Codex CLI was not found at "${path}". ${error.message}` });
      });
      child.on('close', code => {
        clearTimeout(timer);
        if (code === 0) resolve({ success: true });
        else resolve({ success: false, error: `Codex CLI validation failed for "${path}"${stderr ? `: ${this.sanitize(stderr)}` : '.'}` });
      });
    });
  }

  public static async run(path: string, options: CodexCliRunOptions): Promise<string> {
    const result = await this.collect(path, options);
    const normalized = this.extractText(result.stdout);
    if (normalized) return normalized;
    throw new Error(result.stderr || 'Codex CLI returned an empty response.');
  }

  public static async *stream(path: string, options: CodexCliRunOptions): AsyncGenerator<string, void, unknown> {
    const args = this.buildArgs(options.model, options.imagePaths);
    const child = spawn(path, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let lineBuffer = '';
    let emitted = false;

    const timer = setTimeout(() => child.kill('SIGTERM'), options.timeoutMs);
    child.stdin.write(options.prompt);
    child.stdin.end();

    const queue: string[] = [];
    let finished = false;
    let failure: Error | null = null;
    let notify: (() => void) | null = null;
    const wake = () => {
      if (notify) {
        notify();
        notify = null;
      }
    };

    child.stdout.on('data', chunk => {
      const text = chunk.toString();
      stdout += text;
      lineBuffer += text;
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() || '';
      for (const line of lines) {
        const extracted = this.extractText(line);
        if (extracted) {
          emitted = true;
          queue.push(extracted);
        }
      }
      wake();
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', error => {
      clearTimeout(timer);
      failure = new Error(`Codex CLI was not found at "${path}". ${error.message}`);
      finished = true;
      wake();
    });

    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 && !failure) {
        failure = new Error(`Codex CLI exited with code ${code}${stderr ? `: ${this.sanitize(stderr)}` : ''}`);
      }
      finished = true;
      wake();
    });

    while (!finished || queue.length > 0) {
      while (queue.length > 0) yield queue.shift()!;
      if (finished) break;
      await new Promise<void>(resolve => { notify = resolve; });
    }

    if (failure) throw failure;
    if (!emitted) {
      const normalized = this.extractText(stdout);
      if (normalized) yield normalized;
      else throw new Error(stderr ? this.sanitize(stderr) : 'Codex CLI returned an empty response.');
    }
  }

  private static async collect(path: string, options: CodexCliRunOptions): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(path, this.buildArgs(options.model, options.imagePaths), { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        settle(() => reject(new Error(`Codex CLI timed out after ${options.timeoutMs}ms.`)));
      }, options.timeoutMs);

      child.stdout.on('data', chunk => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', chunk => {
        stderr += chunk.toString();
      });
      child.on('error', error => {
        settle(() => reject(new Error(`Codex CLI was not found at "${path}". ${error.message}`)));
      });
      child.on('close', code => {
        settle(() => {
          if (code === 0) resolve({ stdout, stderr: this.sanitize(stderr) });
          else reject(new Error(`Codex CLI exited with code ${code}${stderr ? `: ${this.sanitize(stderr)}` : ''}`));
        });
      });

      child.stdin.write(options.prompt);
      child.stdin.end();
    });
  }

  public static extractText(raw: string): string {
    const text = raw.trim();
    if (!text) return '';

    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    let sawJson = false;
    const extracted = lines.map(line => {
      const parsed = this.tryParseJson(line);
      if (parsed.ok) {
        sawJson = true;
        return this.findText(parsed.value);
      }
      return '';
    }).filter(Boolean).join('');
    if (extracted.trim()) return extracted.trim();
    if (sawJson && lines.every(line => this.tryParseJson(line).ok)) return '';

    return text
      .replace(/^\s*```(?:json)?/i, '')
      .replace(/```\s*$/i, '')
      .trim();
  }

  private static tryParseJson(line: string): { ok: true; value: any } | { ok: false } {
    try {
      return { ok: true, value: JSON.parse(line) };
    } catch {
      return { ok: false };
    }
  }

  private static findText(value: any): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(item => this.findText(item)).filter(Boolean).join('');
    if (typeof value !== 'object') return '';

    if (value.type === 'error' || value.type === 'thread.started' || value.type === 'turn.started' || value.type === 'turn.completed' || value.type === 'turn.failed') return '';
    if (value.item?.type === 'error') return '';
    if (value.item?.type === 'agent_message') return this.findText(value.item.text);
    if (value.type === 'agent_message') return this.findText(value.text);

    for (const key of ['delta', 'text', 'content', 'output_text', 'output', 'response']) {
      const candidate = this.findText(value[key]);
      if (candidate) return candidate;
    }
    if (value.message) return this.findText(value.message);
    if (value.item) return this.findText(value.item);
    if (value.data) return this.findText(value.data);
    return '';
  }

  private static sanitize(text: string): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, 1000);
  }
}
