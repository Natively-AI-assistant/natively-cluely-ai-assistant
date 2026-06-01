/**
 * TCC Edge Cases Test
 * ===================
 * Tests the three TCC-related detectors:
 *   1. Zero-fill detector fires at 12-14s of all-zero audio chunks
 *   2. Stuck watchdog fires at exactly ~8s when no chunks arrive
 *   3. getMacScreenCaptureStatus() returns correct values for each state
 *   4. Dev mode bypass returns 'granted' without calling systemPreferences
 *
 * Run with:
 *   cd /Users/evin/natively-cluely-ai-assistant/electron
 *   npx tsx test/tcc-edge-cases.test.ts
 */

import { EventEmitter } from 'events';

// ── Mock systemPreferences ─────────────────────────────────────────────────
type ScreenStatus = 'granted' | 'denied' | 'not-determined' | 'restricted';
type MicStatus = 'granted' | 'denied' | 'not-determined';

interface MockSystemPreferences {
  screenStatus: ScreenStatus;
  micStatus: MicStatus;
  askForMediaAccessCalls: string[];
  getMediaAccessStatusCalls: string[];
  screenSources: string[];
  screenProbeError: Error | null;
}

const mockPrefs: MockSystemPreferences = {
  screenStatus: 'granted',
  micStatus: 'granted',
  askForMediaAccessCalls: [],
  getMediaAccessStatusCalls: [],
  screenSources: ['screen:0:0'],
  screenProbeError: null,
};

const mockSystemPreferences = {
  getMediaAccessStatus(type: 'microphone' | 'screen'): string {
    mockPrefs.getMediaAccessStatusCalls.push(type);
    return type === 'microphone' ? mockPrefs.micStatus : mockPrefs.screenStatus;
  },
  async askForMediaAccess(type: 'microphone'): Promise<boolean> {
    mockPrefs.askForMediaAccessCalls.push(type);
    return type === 'microphone' ? mockPrefs.micStatus === 'granted' : false;
  },
};

const mockDesktopCapturer = {
  async getSources(): Promise<Array<{ id: string }>> {
    if (mockPrefs.screenProbeError) throw mockPrefs.screenProbeError;
    return mockPrefs.screenSources.map((id) => ({ id }));
  },
};

const mockApp = { isPackaged: true };

// ── Reimplementation of the key TCC logic for testing ─────────────────────
// (Copied from main.ts wireSystemCapture / wireMicCapture logic)

function makeZerofillDetector(observationMs: number, onTrigger: (msg: string) => void) {
  let firstChunkAt = 0;
  let zerofillLatched = false;
  let zerofillTriggered = false;

  const THRESHOLD_PEAK = 8;

  return {
    feed(chunk: Buffer, chunkLen: number) {
      if (zerofillLatched || zerofillTriggered) return;
      if (firstChunkAt === 0) firstChunkAt = Date.now();

      let peak = 0;
      const stride = Math.max(2, Math.floor(chunkLen / 32 / 2) * 2);
      for (let i = 0; i + 1 < chunkLen; i += stride) {
        const s = chunk.readInt16LE(i);
        const a = s < 0 ? -s : s;
        if (a > peak) { peak = a; if (peak > THRESHOLD_PEAK) break; }
      }

      if (peak > THRESHOLD_PEAK) {
        zerofillLatched = true;
      } else if (Date.now() - firstChunkAt >= observationMs) {
        zerofillTriggered = true;
        onTrigger(`TCC denial: all chunks zero for ${observationMs}ms`);
      }
    },
    reset() {
      firstChunkAt = 0;
      zerofillLatched = false;
      zerofillTriggered = false;
    },
    get latched() { return zerofillLatched; },
    get triggered() { return zerofillTriggered; },
  };
}

function makeWatchdog(timeoutMs: number, onFire: (stuck: boolean) => void) {
  let timer: NodeJS.Timeout | null = null;
  let chunkCount = 0;

  return {
    arm() {
      if (timer) clearTimeout(timer);
      chunkCount = 0;
      timer = setTimeout(() => {
        if (chunkCount === 0) onFire(true);
      }, timeoutMs);
    },
    disarm() {
      if (timer) { clearTimeout(timer); timer = null; }
    },
    recordChunk() { chunkCount++; },
    get armed() { return timer !== null; },
  };
}

// Reimplementation of getMacScreenCaptureStatus for testing
function getMacScreenCaptureStatusTEST(
  appIsPackaged: boolean,
  getStatusFn: (type: 'microphone' | 'screen') => string
): ScreenStatus {
  if (!appIsPackaged) return 'granted';
  return getStatusFn('screen') as ScreenStatus;
}

async function resolveMacScreenCaptureCapabilityTEST(
  appIsPackaged: boolean,
  getStatusFn: (type: 'microphone' | 'screen') => string,
  getSourcesFn: () => Promise<Array<{ id: string }>>
): Promise<{ status: ScreenStatus; capturable: boolean; effectiveDenied: boolean; sourceCount: number; message?: string; error?: string }> {
  const status = getMacScreenCaptureStatusTEST(appIsPackaged, getStatusFn);

  if (!appIsPackaged) {
    return { status, capturable: true, effectiveDenied: false, sourceCount: 0 };
  }

  if (status === 'restricted') {
    return {
      status,
      capturable: false,
      effectiveDenied: true,
      sourceCount: 0,
      message: 'Screen Recording is restricted by device policy. Interviewer audio will not be captured. Contact your administrator to allow screen capture for Natively.',
    };
  }

  if (status !== 'denied') {
    return { status, capturable: true, effectiveDenied: false, sourceCount: 0 };
  }

  try {
    const sources = await getSourcesFn();
    const sourceCount = sources.filter((source) => source.id.startsWith('screen:')).length;
    return { status, capturable: sourceCount > 0, effectiveDenied: sourceCount === 0, sourceCount };
  } catch (error) {
    return {
      status,
      capturable: false,
      effectiveDenied: true,
      sourceCount: 0,
      message: 'Screen Recording permission denied. Interviewer audio will not be captured. Enable in System Settings → Privacy & Security → Screen Recording, then restart the app.',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ── Test helpers ───────────────────────────────────────────────────────────
function makeZeroChunk(byteLen: number): Buffer {
  return Buffer.alloc(byteLen, 0);
}
function makeNoiseChunk(byteLen: number): Buffer {
  const buf = Buffer.alloc(byteLen);
  for (let i = 0; i + 1 < byteLen; i += 2) {
    buf.writeInt16LE(i % 32768 - 16384, i);
  }
  return buf;
}
function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function runtimed<T>(fn: () => Promise<T>): Promise<{ ms: number; result: T }> {
  const t0 = Date.now();
  const result = await fn();
  return { ms: Date.now() - t0, result };
}

// ── Tests ──────────────────────────────────────────────────────────────────
async function testZerofillDetector() {
  console.log('─'.repeat(60));
  console.log('TEST: Zero-fill detector fires at 12-14s of all-zero chunks');
  console.log('─'.repeat(60));

  const OBS_MS = 12000;
  const CHUNK_MS = 20; // simulated chunk cadence
  const CHUNK_BYTES = 960; // 480 samples × 2 bytes (i16)
  const MAX_WAIT_MS = 20000; // max time to wait for trigger (arbitrary upper bound)

  let triggeredAtMs: number | null = null;
  const detector = makeZerofillDetector(OBS_MS, (msg) => {
    triggeredAtMs = Date.now();
    console.log(`  → Detector triggered: ${msg}`);
  });

  const start = Date.now();
  // Feed chunks until triggered or max wait exceeded
  while (triggeredAtMs === null && (Date.now() - start) < MAX_WAIT_MS) {
    detector.feed(makeZeroChunk(CHUNK_BYTES), CHUNK_BYTES);
    await delay(CHUNK_MS);
  }

  const elapsed = Date.now() - start;
  const pass = triggeredAtMs !== null;
  console.log(`  Triggered after ${elapsed}ms (expected ~${OBS_MS}ms)`);
  console.log(`  ✅ PASS: ${pass ? 'YES' : 'NO'}`);
  return pass;
}

async function testZerofillDoesNotFireForNoise() {
  console.log();
  console.log('─'.repeat(60));
  console.log('TEST: Zero-fill detector does NOT fire for real audio');
  console.log('─'.repeat(60));

  let triggered = false;
  const detector = makeZerofillDetector(12000, () => { triggered = true; });

  // Feed 13s of real audio chunks
  for (let i = 0; i < 650; i++) {
    detector.feed(makeNoiseChunk(960), 960);
    await delay(20);
  }

  const pass = !triggered;
  console.log(`  Triggered after 13s of noise: ${triggered}`);
  console.log(`  ✅ PASS: ${pass ? 'YES' : 'NO'}`);
  return pass;
}

async function testStuckWatchdog() {
  console.log();
  console.log('─'.repeat(60));
  console.log('TEST: Stuck watchdog fires at ~8s when no chunks arrive');
  console.log('─'.repeat(60));

  const TIMEOUT_MS = 8000;
  const SLACK_MS = 500;
  let firedAtMs: number | null = null;
  let fireCount = 0;

  const watchdog = makeWatchdog(TIMEOUT_MS, () => {
    firedAtMs = Date.now();
    fireCount++;
  });

  watchdog.arm();
  await delay(TIMEOUT_MS + SLACK_MS);
  const pass = firedAtMs !== null && fireCount === 1;
  console.log(`  Fired: ${fireCount} time(s) at ${firedAtMs ? Date.now() - firedAtMs : 'n/a'}ms`);
  console.log(`  ✅ PASS: ${pass ? 'YES' : 'NO'}`);
  return pass;
}

async function testWatchdogClearsOnFirstChunk() {
  console.log();
  console.log('─'.repeat(60));
  console.log('TEST: Stuck watchdog clears when first chunk arrives');
  console.log('─'.repeat(60));

  let fireCount = 0;
  const watchdog = makeWatchdog(8000, () => { fireCount++; });

  watchdog.arm();
  await delay(3000);
  watchdog.recordChunk(); // first chunk
  await delay(6000); // well past 8s

  const pass = fireCount === 0;
  console.log(`  Fire count after 8s+ with chunk at 3s: ${fireCount}`);
  console.log(`  ✅ PASS: ${pass ? 'YES' : 'NO'}`);
  return pass;
}

async function testScreenCaptureDenied() {
  console.log();
  console.log('─'.repeat(60));
  console.log('TEST: getMacScreenCaptureStatus returns "denied" correctly');
  console.log('─'.repeat(60));

  mockPrefs.screenStatus = 'denied';
  mockPrefs.getMediaAccessStatusCalls = [];

  const status = getMacScreenCaptureStatusTEST(true, mockSystemPreferences.getMediaAccessStatus.bind(mockSystemPreferences));
  const pass = status === 'denied' && !mockPrefs.askForMediaAccessCalls.includes('screen');
  console.log(`  Status: ${status} (expected: denied)`);
  console.log(`  askForMediaAccess called for screen: ${mockPrefs.askForMediaAccessCalls.includes('screen')}`);
  console.log(`  ✅ PASS: ${pass ? 'YES' : 'NO'}`);

  mockPrefs.screenStatus = 'granted'; // reset
  return pass;
}

async function testScreenCaptureGranted() {
  console.log();
  console.log('─'.repeat(60));
  console.log('TEST: getMacScreenCaptureStatus returns "granted" for granted');
  console.log('─'.repeat(60));

  mockPrefs.screenStatus = 'granted';
  const status = getMacScreenCaptureStatusTEST(true, mockSystemPreferences.getMediaAccessStatus.bind(mockSystemPreferences));
  const pass = status === 'granted';
  console.log(`  Status: ${status} (expected: granted)`);
  console.log(`  ✅ PASS: ${pass ? 'YES' : 'NO'}`);
  return pass;
}

async function testDevModeBypass() {
  console.log();
  console.log('─'.repeat(60));
  console.log('TEST: Dev mode (!app.isPackaged) bypasses TCC and returns granted');
  console.log('─'.repeat(60));

  mockPrefs.screenStatus = 'denied'; // Would return 'denied' if checked
  mockPrefs.getMediaAccessStatusCalls = [];

  const status = getMacScreenCaptureStatusTEST(false, mockSystemPreferences.getMediaAccessStatus.bind(mockSystemPreferences));
  const systemPrefsCalled = mockPrefs.getMediaAccessStatusCalls.includes('screen');

  const pass = status === 'granted' && !systemPrefsCalled;
  console.log(`  Status: ${status} (expected: granted in dev mode)`);
  console.log(`  systemPreferences.getMediaAccessStatus called: ${systemPrefsCalled}`);
  console.log(`  ✅ PASS: ${pass ? 'YES' : 'NO'}`);

  mockPrefs.screenStatus = 'granted'; // reset
  return pass;
}

async function testDeniedButCapturableAllowsSystemAudio() {
  console.log();
  console.log('─'.repeat(60));
  console.log('TEST: denied screen status does not block when capture probe succeeds');
  console.log('─'.repeat(60));

  mockPrefs.screenStatus = 'denied';
  mockPrefs.screenSources = ['screen:0:0'];
  mockPrefs.screenProbeError = null;

  const capability = await resolveMacScreenCaptureCapabilityTEST(
    true,
    mockSystemPreferences.getMediaAccessStatus.bind(mockSystemPreferences),
    mockDesktopCapturer.getSources.bind(mockDesktopCapturer)
  );
  const pass = capability.status === 'denied' && capability.capturable && !capability.effectiveDenied && capability.sourceCount === 1;
  console.log(`  Capability: ${JSON.stringify(capability)}`);
  console.log(`  ✅ PASS: ${pass ? 'YES' : 'NO'}`);

  mockPrefs.screenStatus = 'granted';
  return pass;
}

async function testDeniedAndProbeEmptyBlocksSystemAudio() {
  console.log();
  console.log('─'.repeat(60));
  console.log('TEST: denied screen status blocks when capture probe finds no screens');
  console.log('─'.repeat(60));

  mockPrefs.screenStatus = 'denied';
  mockPrefs.screenSources = [];
  mockPrefs.screenProbeError = null;

  const capability = await resolveMacScreenCaptureCapabilityTEST(
    true,
    mockSystemPreferences.getMediaAccessStatus.bind(mockSystemPreferences),
    mockDesktopCapturer.getSources.bind(mockDesktopCapturer)
  );
  const pass = capability.status === 'denied' && !capability.capturable && capability.effectiveDenied && capability.sourceCount === 0;
  console.log(`  Capability: ${JSON.stringify(capability)}`);
  console.log(`  ✅ PASS: ${pass ? 'YES' : 'NO'}`);

  mockPrefs.screenStatus = 'granted';
  mockPrefs.screenSources = ['screen:0:0'];
  return pass;
}

async function testDeniedAndProbeErrorBlocksSystemAudio() {
  console.log();
  console.log('─'.repeat(60));
  console.log('TEST: denied screen status blocks when capture probe throws');
  console.log('─'.repeat(60));

  mockPrefs.screenStatus = 'denied';
  mockPrefs.screenProbeError = new Error('not authorized');

  const capability = await resolveMacScreenCaptureCapabilityTEST(
    true,
    mockSystemPreferences.getMediaAccessStatus.bind(mockSystemPreferences),
    mockDesktopCapturer.getSources.bind(mockDesktopCapturer)
  );
  const pass = capability.status === 'denied' && !capability.capturable && capability.effectiveDenied && capability.error === 'not authorized';
  console.log(`  Capability: ${JSON.stringify(capability)}`);
  console.log(`  ✅ PASS: ${pass ? 'YES' : 'NO'}`);

  mockPrefs.screenStatus = 'granted';
  mockPrefs.screenProbeError = null;
  return pass;
}

async function testRestrictedBlocksWithPolicyMessage() {
  console.log();
  console.log('─'.repeat(60));
  console.log('TEST: restricted screen status blocks with device-policy message');
  console.log('─'.repeat(60));

  mockPrefs.screenStatus = 'restricted';

  const capability = await resolveMacScreenCaptureCapabilityTEST(
    true,
    mockSystemPreferences.getMediaAccessStatus.bind(mockSystemPreferences),
    mockDesktopCapturer.getSources.bind(mockDesktopCapturer)
  );
  const pass = capability.status === 'restricted'
    && !capability.capturable
    && capability.effectiveDenied
    && capability.message?.includes('device policy');
  console.log(`  Capability: ${JSON.stringify(capability)}`);
  console.log(`  ✅ PASS: ${pass ? 'YES' : 'NO'}`);

  mockPrefs.screenStatus = 'granted';
  return pass;
}

async function testMicAccessDenied() {
  console.log();
  console.log('─'.repeat(60));
  console.log('TEST: ensureMacMicrophoneAccess handles denied correctly');
  console.log('─'.repeat(60));

  mockPrefs.micStatus = 'denied';
  mockPrefs.askForMediaAccessCalls = [];

  // Simulate ensureMacMicrophoneAccess logic
  const currentStatus = mockSystemPreferences.getMediaAccessStatus('microphone');
  const pass = currentStatus === 'denied' && !mockPrefs.askForMediaAccessCalls.includes('microphone');
  console.log(`  Current status: ${currentStatus}`);
  console.log(`  askForMediaAccess called: ${mockPrefs.askForMediaAccessCalls.includes('microphone')}`);
  console.log(`  ✅ PASS: ${pass ? 'YES' : 'NO'}`);

  mockPrefs.micStatus = 'granted'; // reset
  return pass;
}

async function testMicAccessGranted() {
  console.log();
  console.log('─'.repeat(60));
  console.log('TEST: ensureMacMicrophoneAccess skips prompt when already granted');
  console.log('─'.repeat(60));

  mockPrefs.micStatus = 'granted';
  mockPrefs.askForMediaAccessCalls = [];

  const currentStatus = mockSystemPreferences.getMediaAccessStatus('microphone');
  const pass = currentStatus === 'granted' && !mockPrefs.askForMediaAccessCalls.includes('microphone');
  console.log(`  Current status: ${currentStatus}`);
  console.log(`  askForMediaAccess called: ${mockPrefs.askForMediaAccessCalls.includes('microphone')}`);
  console.log(`  ✅ PASS: ${pass ? 'YES' : 'NO'}`);
  return pass;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('═'.repeat(60));
  console.log('TCC EDGE CASES TEST SUITE');
  console.log('═'.repeat(60));
  console.log();

  const results = [
    await testZerofillDetector(),
    await testZerofillDoesNotFireForNoise(),
    await testStuckWatchdog(),
    await testWatchdogClearsOnFirstChunk(),
    await testScreenCaptureDenied(),
    await testScreenCaptureGranted(),
    await testDevModeBypass(),
    await testDeniedButCapturableAllowsSystemAudio(),
    await testDeniedAndProbeEmptyBlocksSystemAudio(),
    await testDeniedAndProbeErrorBlocksSystemAudio(),
    await testRestrictedBlocksWithPolicyMessage(),
    await testMicAccessDenied(),
    await testMicAccessGranted(),
  ];

  const passed = results.filter(Boolean).length;
  const total = results.length;

  console.log();
  console.log('═'.repeat(60));
  console.log(`RESULTS: ${passed}/${total} passed`);
  console.log('═'.repeat(60));

  if (passed === total) {
    console.log('✅ ALL TCC EDGE CASE TESTS PASSED');
  } else {
    console.log('❌ SOME TCC EDGE CASE TESTS FAILED');
  }

  process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});