import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let app: ElectronApplication | undefined;
let overlay: Page;
let userDataDir: string | undefined;

const LONG_CODE_TOKEN = 'abcdefghijklmnopqrstuvwxyz'.repeat(14);
const CODE_RESPONSE = `## Explicação

\`\`\`ts
const valorMuitoLongo = "${LONG_CODE_TOKEN}";
\`\`\``;

const waitForAnimationFrames = (page: Page, count = 2) =>
  page.evaluate(
    (frames) =>
      new Promise<void>((resolve) => {
        const next = (remaining: number) => {
          if (remaining <= 0) {
            resolve();
            return;
          }
          requestAnimationFrame(() => next(remaining - 1));
        };
        next(frames);
      }),
    count,
  );

async function canonicalPath(value: string) {
  const realPath = await fs.realpath(path.resolve(value));
  const normalized = path.normalize(realPath).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

async function readElectronUserDataPath(application: ElectronApplication) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await application.evaluate(({ app: electronApp }) =>
        electronApp.getPath('userData'),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/execution context was destroyed/i.test(message) || attempt === 19) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error('Electron userData path could not be read');
}

function execFileText(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      executable,
      args,
      { encoding: 'utf8', env, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `${executable} failed: ${error.message}${stderr ? `\n${stderr}` : ''}`,
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

type WindowsProcessInfo = {
  ProcessId: number;
  ParentProcessId: number;
  Name: string | null;
  ExecutablePath: string | null;
  CommandLine: string | null;
};

async function windowsProcessesForProfile(profileDir: string): Promise<WindowsProcessInfo[]> {
  const script = [
    '$needle = $env:NATIVELY_E2E_PROFILE;',
    'Get-CimInstance Win32_Process |',
    '  Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 } |',
    '  Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine |',
    '  ConvertTo-Json -Compress',
  ].join(' ');
  const stdout = await execFileText(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { ...process.env, NATIVELY_E2E_PROFILE: profileDir },
  );
  if (!stdout.trim()) return [];
  const parsed = JSON.parse(stdout) as WindowsProcessInfo | WindowsProcessInfo[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function assertE2EProfileGuard(
  application: ElectronApplication,
  profileDir: string,
): Promise<number> {
  const canonicalProfile = await canonicalPath(profileDir);
  const tempPrefix = path
    .normalize(path.resolve(os.tmpdir(), 'natively-overlay-e2e-'))
    .replace(/[\\/]+$/, '');
  const canonicalPrefix = process.platform === 'win32'
    ? tempPrefix.toLowerCase()
    : tempPrefix;
  if (!canonicalProfile.startsWith(canonicalPrefix)) {
    throw new Error(`Refusing Electron teardown outside E2E temp prefix: ${profileDir}`);
  }

  const expectedArg = `--user-data-dir=${profileDir}`;
  const childProcess = application.process();
  const pid = childProcess.pid;
  if (!pid) throw new Error('Refusing Electron teardown without a process PID');

  if (process.platform === 'win32') {
    const exactProfileToken = new RegExp(
      `(?:^|[\\s'"])${escapeRegex(expectedArg)}(?=$|[\\s'"])`,
      'i',
    );
    const expectedExecutable = await canonicalPath(
      path.resolve('node_modules/electron/dist/electron.exe'),
    );
    const processInfos = await windowsProcessesForProfile(profileDir);
    const candidates: WindowsProcessInfo[] = [];
    for (const processInfo of processInfos) {
      if (
        processInfo.Name?.toLowerCase() !== 'electron.exe' ||
        !processInfo.ExecutablePath ||
        !processInfo.CommandLine ||
        /(?:^|\s)--type=/.test(processInfo.CommandLine) ||
        !exactProfileToken.test(processInfo.CommandLine)
      ) {
        continue;
      }
      const actualExecutable = await canonicalPath(processInfo.ExecutablePath);
      if (actualExecutable === expectedExecutable) candidates.push(processInfo);
    }
    if (candidates.length !== 1) {
      throw new Error(
        `Refusing Electron teardown: expected exactly one canonical Electron root for ${profileDir}, received ${candidates.map((candidate) => candidate.ProcessId).join(', ') || 'none'}`,
      );
    }
    return candidates[0].ProcessId;
  }

  const profileArgs = childProcess.spawnargs.filter((arg) =>
    arg.startsWith('--user-data-dir='),
  );
  if (profileArgs.length !== 1 || profileArgs[0] !== expectedArg) {
    throw new Error(
      `Refusing Electron teardown: expected exactly ${expectedArg}, received ${profileArgs.join(', ') || 'none'}`,
    );
  }
  return pid;
}

async function processIdsForProfile(profileDir: string) {
  if (process.platform === 'win32') {
    const script = [
      '$needle = $env:NATIVELY_E2E_PROFILE;',
      'Get-CimInstance Win32_Process |',
      '  Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 } |',
      '  ForEach-Object { $_.ProcessId }',
    ].join(' ');
    const stdout = await execFileText(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { ...process.env, NATIVELY_E2E_PROFILE: profileDir },
    );
    return stdout
      .split(/\r?\n/)
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0);
  }

  const stdout = await execFileText('ps', ['-axo', 'pid=,command=']);
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.includes(profileDir))
    .map((line) => Number(line.trim().split(/\s+/, 1)[0]))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function waitForChildExit(
  childProcess: ReturnType<ElectronApplication['process']>,
  timeoutMs: number,
) {
  if (childProcess.exitCode !== null || typeof childProcess.signalCode === 'string') {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Electron PID ${childProcess.pid} did not exit in ${timeoutMs}ms`)),
      timeoutMs,
    );
    childProcess.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function terminateElectronApplication(
  application: ElectronApplication,
  profileDir: string,
) {
  const targetPid = await assertE2EProfileGuard(application, profileDir);
  const childProcess = application.process();

  const processExited = waitForChildExit(childProcess, 15_000);
  const connectionClosed = application.waitForEvent('close', { timeout: 15_000 });
  if (process.platform === 'win32') {
    await execFileText('taskkill.exe', ['/PID', String(targetPid), '/T', '/F']);
  } else {
    childProcess.kill('SIGKILL');
  }
  await Promise.all([processExited, connectionClosed]);

  const remainingPids = await processIdsForProfile(profileDir);
  if (remainingPids.length > 0) {
    throw new Error(
      `Refusing E2E profile deletion; processes still use ${profileDir}: ${remainingPids.join(', ')}`,
    );
  }
}

async function windowByRoute(
  application: ElectronApplication,
  route: 'launcher' | 'overlay',
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const page = application
      .windows()
      .find((candidate) => candidate.url().includes(`window=${route}`));
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${route} window was not created`);
}

async function sendOverlay(channel: string, payload?: unknown) {
  const application = app;
  if (!application) throw new Error('Electron application is not running');

  await application.evaluate(
    ({ BrowserWindow }, args) => {
      const win = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().includes('window=overlay'),
      );
      if (!win) throw new Error('overlay BrowserWindow not found');
      win.webContents.send(args.channel, args.payload);
    },
    { channel, payload },
  );
}

async function transcript(
  speaker: 'interviewer' | 'user',
  text: string,
  final: boolean,
  timestamp: number,
) {
  await sendOverlay('native-audio-transcript', {
    speaker,
    text,
    final,
    timestamp,
    confidence: 0.98,
  });
}

async function suggestion(text: string) {
  await sendOverlay('suggestion-generated', {
    question: 'Pergunta de teste',
    suggestion: text,
    confidence: 0.95,
  });
}

async function setPreference(key: string, value: boolean) {
  await overlay.evaluate(
    ({ storageKey, enabled }) => {
      localStorage.setItem(storageKey, String(enabled));
      window.dispatchEvent(new Event('storage'));
    },
    { storageKey: key, enabled: value },
  );
  await waitForAnimationFrames(overlay);
}

async function seedMeeting() {
  const base = Date.now() - 10_000;
  for (let index = 0; index < 8; index += 1) {
    await transcript(
      index % 2 === 0 ? 'interviewer' : 'user',
      `Fala ${index} em português para validar a ordem e a quebra de linha.`,
      true,
      base + index * 1000,
    );
  }
  await transcript(
    'interviewer',
    'Esta é uma parcial longa que precisa continuar visível por várias linhas sem ser cortada lateralmente mesmo quando o painel está compacto e o texto ainda está chegando.',
    false,
    base + 9000,
  );
  await suggestion('Resposta curta e objetiva para a reunião.');
  await expect(overlay.getByTestId('transcript-segment')).toHaveCount(8);
}

async function expandToGrid() {
  const toggle = overlay.getByRole('button', { name: 'Expand panel width' });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(overlay.getByTestId('overlay-workspace')).toHaveAttribute(
    'data-workspace-mode',
    'grid',
  );
}

async function fillScrollableHistory() {
  const base = Date.now() - 60_000;
  for (let index = 0; index < 36; index += 1) {
    await transcript(
      index % 2 === 0 ? 'interviewer' : 'user',
      `Trecho ${index}: conteúdo adicional suficientemente longo para criar histórico vertical independente na timeline da reunião.`,
      true,
      base + index * 1200,
    );
  }
  for (let index = 0; index < 14; index += 1) {
    await suggestion(
      `Resposta ${index}: orientação detalhada do copiloto para criar uma lista vertical longa, preservar o histórico e comprovar a rolagem independente entre os dois painéis.`,
    );
  }
}

async function pauseAboveBottom(locator: ReturnType<Page['getByTestId']>) {
  await expect
    .poll(() => locator.evaluate((node) => node.scrollHeight - node.clientHeight))
    .toBeGreaterThan(120);
  await locator.evaluate((node) => {
    node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight - 100);
    node.dispatchEvent(new Event('scroll'));
  });
  await expect
    .poll(() =>
      locator.evaluate(
        (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
      ),
    )
    .toBeGreaterThan(8);
}

test.beforeEach(async () => {
  userDataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'natively-overlay-e2e-'),
  );
  const launchEnv = { ...process.env };
  delete launchEnv.ELECTRON_RUN_AS_NODE;
  delete launchEnv.NATIVELY_E2E;
  Object.assign(launchEnv, {
    NODE_ENV: 'test',
    NATIVELY_DEV_BYPASS_SCREEN_TCC: '1',
    NATIVELY_DISABLE_ONBOARDING_ORCH: '1',
    NATIVELY_TEST_USERDATA: userDataDir,
  });

  app = await electron.launch({
    args: [
      `--user-data-dir=${userDataDir}`,
      `--force-device-scale-factor=${process.env.NATIVELY_E2E_SCALE ?? '1'}`,
      path.resolve('dist-electron/electron/main.js'),
    ],
    env: launchEnv,
    timeout: 60_000,
  });

  const actualUserDataDir = await readElectronUserDataPath(app);
  const [expectedCanonicalUserData, actualCanonicalUserData] = await Promise.all([
    canonicalPath(userDataDir),
    canonicalPath(actualUserDataDir),
  ]);
  expect(
    actualCanonicalUserData,
    `Electron userData isolation failed: expected ${userDataDir}, received ${actualUserDataDir}`,
  ).toBe(expectedCanonicalUserData);

  const launcher = await windowByRoute(app, 'launcher');
  await launcher.waitForLoadState('domcontentloaded');
  await launcher.evaluate(async () => {
    if (!window.electronAPI?.setWindowMode) {
      throw new Error('real preload did not expose setWindowMode');
    }
    await window.electronAPI.setWindowMode('overlay');
  });

  overlay = await windowByRoute(app, 'overlay');
  await overlay.waitForLoadState('domcontentloaded');
  await expect(overlay.getByTestId('overlay-workspace')).toBeVisible();
  await waitForAnimationFrames(overlay);
});

test.afterEach(async () => {
  const application = app;
  const profileDir = userDataDir;
  if (!application || !profileDir) return;

  await terminateElectronApplication(application, profileDir);
  app = undefined;
  await fs.rm(profileDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
  userDataDir = undefined;
});

test('compact mode uses tabs, keeps footer visible and wraps Portuguese text', async () => {
  await seedMeeting();

  const workspace = overlay.getByTestId('overlay-workspace');
  await expect(workspace).toHaveAttribute('data-workspace-mode', 'tabs');
  await expect(overlay.getByTestId('compact-tabs')).toBeVisible();
  await expect(overlay.getByTestId('overlay-footer')).toBeVisible();

  const partial = overlay.getByTestId('transcript-partial');
  await expect(partial).toContainText('Esta é uma parcial longa');
  const overflow = await partial.evaluate((node) => ({
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth,
    whiteSpace: getComputedStyle(node).whiteSpace,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  expect(overflow.whiteSpace).not.toBe('nowrap');

  const actionButtons = overlay.getByTestId('overlay-actions').getByRole('button');
  await expect(actionButtons).toHaveCount(5);
  for (const actionButton of await actionButtons.all()) {
    await expect(actionButton).toBeVisible();
  }
  const actionRows = await actionButtons.evaluateAll((buttons) =>
      [...new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top)))],
  );
  expect(actionRows.length).toBeLessThanOrEqual(2);

  await overlay.getByRole('tab', { name: /Copiloto/ }).click();
  await expect(overlay.getByText('Resposta curta e objetiva')).toBeVisible();
  await expect(overlay.getByTestId('overlay-footer')).toBeVisible();
});

test('expanded mode uses a contained 42/58 grid with local code overflow', async () => {
  await seedMeeting();
  await expandToGrid();
  await suggestion(CODE_RESPONSE);

  const transcriptColumn = overlay.getByTestId('transcript-column');
  const assistantColumn = overlay.getByTestId('assistant-column');
  const [left, right] = await Promise.all([
    transcriptColumn.boundingBox(),
    assistantColumn.boundingBox(),
  ]);
  expect(left).not.toBeNull();
  expect(right).not.toBeNull();
  expect(left!.x + left!.width).toBeLessThanOrEqual(right!.x + 4);
  expect(left!.width).toBeGreaterThan(230);
  expect(right!.width).toBeGreaterThan(left!.width);
  const transcriptRatio = left!.width / (left!.width + right!.width);
  expect(transcriptRatio).toBeGreaterThan(0.4);
  expect(transcriptRatio).toBeLessThan(0.44);

  const pageOverflow = await overlay.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(1);

  const pre = assistantColumn.locator('pre').first();
  await expect(pre).toBeVisible();
  const codeOverflow = await pre.evaluate((node) => ({
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth,
  }));
  expect(codeOverflow.scrollWidth).toBeGreaterThan(codeOverflow.clientWidth + 2);
  const assistantOverflow = await assistantColumn.evaluate(
    (node) => node.scrollWidth - node.clientWidth,
  );
  expect(assistantOverflow).toBeLessThanOrEqual(1);
});

test('panes keep independent paused scroll and DOM identity through hide and show', async () => {
  await seedMeeting();
  await fillScrollableHistory();
  await expandToGrid();

  const transcriptScroll = overlay.getByTestId('transcript-scroll');
  const assistantScroll = overlay.getByTestId('assistant-scroll');
  await pauseAboveBottom(transcriptScroll);
  await pauseAboveBottom(assistantScroll);
  const transcriptBefore = await transcriptScroll.evaluate((node) => node.scrollTop);
  const assistantBefore = await assistantScroll.evaluate((node) => node.scrollTop);

  await transcript(
    'interviewer',
    'Nova final enquanto o usuário consulta o histórico.',
    true,
    Date.now(),
  );
  await expect(
    overlay
      .getByTestId('transcript-column')
      .getByRole('button', { name: /Ir ao vivo/ }),
  ).toBeVisible();
  expect(await transcriptScroll.evaluate((node) => node.scrollTop)).toBeCloseTo(
    transcriptBefore,
    0,
  );
  expect(await assistantScroll.evaluate((node) => node.scrollTop)).toBeCloseTo(
    assistantBefore,
    0,
  );

  await suggestion('Nova resposta enquanto o copiloto também está pausado.');
  await expect(
    overlay
      .getByTestId('assistant-column')
      .getByRole('button', { name: /Ir ao vivo/ }),
  ).toBeVisible();
  expect(await transcriptScroll.evaluate((node) => node.scrollTop)).toBeCloseTo(
    transcriptBefore,
    0,
  );

  await overlay.evaluate(() => {
    const transcriptNode = document.querySelector('[data-testid="transcript-scroll"]');
    const assistantNode = document.querySelector('[data-testid="assistant-scroll"]');
    (transcriptNode as HTMLElement & { __stamp?: string }).__stamp = 'transcript';
    (assistantNode as HTMLElement & { __stamp?: string }).__stamp = 'assistant';
  });

  await sendOverlay('toggle-expand');
  await overlay.waitForTimeout(700);
  await sendOverlay('toggle-expand');
  await overlay.waitForTimeout(700);

  expect(
    await overlay.evaluate(
      () =>
        (
          document.querySelector('[data-testid="transcript-scroll"]') as HTMLElement & {
            __stamp?: string;
          }
        ).__stamp,
    ),
  ).toBe('transcript');
  expect(
    await overlay.evaluate(
      () =>
        (
          document.querySelector('[data-testid="assistant-scroll"]') as HTMLElement & {
            __stamp?: string;
          }
        ).__stamp,
    ),
  ).toBe('assistant');
  expect(await transcriptScroll.evaluate((node) => node.scrollTop)).toBeCloseTo(
    transcriptBefore,
    0,
  );
  expect(await assistantScroll.evaluate((node) => node.scrollTop)).toBeCloseTo(
    assistantBefore,
    0,
  );
});

test('transcript preference and compact keyboard tabs preserve the mounted hidden pane', async () => {
  await seedMeeting();
  const transcriptTab = overlay.getByRole('tab', { name: /Ao vivo/ });
  const copilotTab = overlay.getByRole('tab', { name: /Copiloto/ });

  await transcriptTab.focus();
  await transcriptTab.press('ArrowRight');
  await expect(copilotTab).toHaveAttribute('aria-selected', 'true');
  await expect(copilotTab).toBeFocused();
  await copilotTab.press('ArrowLeft');
  await expect(transcriptTab).toHaveAttribute('aria-selected', 'true');
  await transcriptTab.press('End');
  await expect(copilotTab).toHaveAttribute('aria-selected', 'true');
  await copilotTab.press('Home');
  await expect(transcriptTab).toHaveAttribute('aria-selected', 'true');
  await transcriptTab.press('ArrowRight');

  const transcriptPanel = overlay.locator('#overlay-panel-transcript');
  await expect(transcriptPanel).toHaveAttribute('aria-hidden', 'true');
  await expect(transcriptPanel).toHaveAttribute('inert', '');
  await expect(transcriptPanel).toHaveCSS('visibility', 'hidden');
  expect(
    await transcriptPanel.evaluate((node) => node.contains(document.activeElement)),
  ).toBe(false);

  await setPreference('natively_interviewer_transcript', false);
  await expect(overlay.getByTestId('compact-tabs')).toHaveCount(0);
  await expect(transcriptPanel).toHaveAttribute('aria-hidden', 'true');
  await expect(overlay.getByTestId('assistant-column')).toBeVisible();
  await expect(overlay.getByTestId('overlay-footer')).toBeVisible();
  const [assistantBox, footerBox] = await Promise.all([
    overlay.getByTestId('assistant-column').boundingBox(),
    overlay.getByTestId('overlay-footer').boundingBox(),
  ]);
  expect(assistantBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect(Math.abs(assistantBox!.x - footerBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(assistantBox!.width - footerBox!.width)).toBeLessThanOrEqual(1);

  await setPreference('natively_interviewer_transcript', true);
  await expect(overlay.getByTestId('compact-tabs')).toBeVisible();
  await expect(overlay.getByRole('tab', { name: /Copiloto/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(overlay.getByText('Fala 0 em português')).toBeAttached();
});

test('per-pane auto-scroll and go-live do not mutate the saved preference', async () => {
  await seedMeeting();
  await fillScrollableHistory();
  await overlay.getByRole('tab', { name: /Copiloto/ }).click();
  const assistantScroll = overlay.getByTestId('assistant-scroll');

  await setPreference('natively_auto_scroll', false);
  await pauseAboveBottom(assistantScroll);
  const pausedTop = await assistantScroll.evaluate((node) => node.scrollTop);
  await suggestion('Sugestão com auto-scroll desativado.');
  await expect(
    overlay
      .getByTestId('assistant-column')
      .getByRole('button', { name: /Ir ao vivo/ }),
  ).toBeVisible();
  expect(await assistantScroll.evaluate((node) => node.scrollTop)).toBeCloseTo(
    pausedTop,
    0,
  );

  await overlay
    .getByTestId('assistant-column')
    .getByRole('button', { name: /Ir ao vivo/ })
    .click();
  expect(
    await overlay.evaluate(() => localStorage.getItem('natively_auto_scroll')),
  ).toBe('false');

  await setPreference('natively_auto_scroll', true);
  await assistantScroll.evaluate((node) => {
    node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight - 4);
    node.dispatchEvent(new Event('scroll'));
  });
  await expect
    .poll(() =>
      assistantScroll.evaluate(
        (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
      ),
    )
    .toBeLessThanOrEqual(8);
  await waitForAnimationFrames(overlay);
  await suggestion('Sugestão seguinte que deve manter o painel no fundo.');
  await expect
    .poll(() =>
      assistantScroll.evaluate(
        (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
      ),
    )
    .toBeLessThanOrEqual(8);
});

test('reduced motion snaps and rapid width reversal cannot restore stale grid state', async () => {
  await seedMeeting();
  const workspace = overlay.getByTestId('overlay-workspace');
  const readWidthState = () =>
    overlay.evaluate(() => ({
      mode: document
        .querySelector('[data-testid="overlay-workspace"]')
        ?.getAttribute('data-workspace-mode'),
      width: document
        .querySelector('[data-shell-card]')
        ?.getBoundingClientRect().width,
    }));

  await overlay.emulateMedia({ reducedMotion: 'reduce' });
  await waitForAnimationFrames(overlay);
  await overlay.getByRole('button', { name: 'Expand panel width' }).click();
  await waitForAnimationFrames(overlay);
  const reducedExpanded = await readWidthState();
  expect(reducedExpanded.mode).toBe('grid');
  expect(reducedExpanded.width).toBeGreaterThanOrEqual(731.5);
  expect(reducedExpanded.width).toBeLessThanOrEqual(732.5);

  await overlay.getByRole('button', { name: 'Collapse panel width' }).click();
  await waitForAnimationFrames(overlay);
  const reducedCollapsed = await readWidthState();
  expect(reducedCollapsed.mode).toBe('tabs');
  expect(reducedCollapsed.width).toBeGreaterThanOrEqual(599.5);
  expect(reducedCollapsed.width).toBeLessThanOrEqual(600.5);
  await overlay.waitForTimeout(800);
  const reducedSettled = await readWidthState();
  expect(reducedSettled.mode).toBe('tabs');
  expect(reducedSettled.width).toBeGreaterThanOrEqual(599.5);
  expect(reducedSettled.width).toBeLessThanOrEqual(600.5);

  await overlay.emulateMedia({ reducedMotion: 'no-preference' });
  await waitForAnimationFrames(overlay);
  await overlay.getByRole('button', { name: 'Expand panel width' }).click();
  const reversingToggle = overlay.getByRole('button', {
    name: 'Collapse panel width',
  });
  await expect(reversingToggle).toBeVisible();
  await reversingToggle.click();
  await expect(workspace).toHaveAttribute('data-workspace-mode', 'tabs');
  await overlay.waitForTimeout(1_200);
  const rapidSettled = await readWidthState();
  expect(rapidSettled.mode).toBe('tabs');
  expect(rapidSettled.width).toBeGreaterThanOrEqual(599.5);
  expect(rapidSettled.width).toBeLessThanOrEqual(600.5);
});
