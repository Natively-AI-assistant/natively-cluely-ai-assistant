import { NVIDIA_NIM_STT_MODEL_CONFIG, DEFAULT_NVIDIA_NIM_STT_MODEL } from './NvidiaNimStreamingSTT';
import { createNvcfStreamingRecognize } from './rivaProto';

const PROBE_TIMEOUT_MS = 15000;
/** 100ms of silence at 16 kHz mono 16-bit — enough to open a real session. */
const PROBE_AUDIO_BYTES = 3200;

/**
 * Verify an NVIDIA API key against the hosted Riva ASR endpoint.
 *
 * Settles on ANY terminal outcome. Riva emits a response only when it has a
 * result, so a working key normally produces a clean half-close with no 'data'
 * at all — an earlier version waited for 'data' alone and reported a perfectly
 * valid key as "connection timed out" after the full 15s. Reaching end/OK
 * already proves the bearer token and function-id were accepted; bad
 * credentials arrive as a gRPC error (UNAUTHENTICATED / PERMISSION_DENIED).
 */
export async function probeNvidiaNimStt(
    apiKey: string,
    model: string = DEFAULT_NVIDIA_NIM_STT_MODEL,
    openStream: typeof createNvcfStreamingRecognize = createNvcfStreamingRecognize,
): Promise<{ success: boolean; error?: string }> {
    const config = NVIDIA_NIM_STT_MODEL_CONFIG[model] || NVIDIA_NIM_STT_MODEL_CONFIG[DEFAULT_NVIDIA_NIM_STT_MODEL];
    let stream: any;
    try {
        stream = openStream(apiKey, config.functionId);
        await new Promise<void>((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                try { stream.cancel(); } catch { /* already gone */ }
                reject(new Error('NVIDIA NIM speech connection timed out'));
            }, PROBE_TIMEOUT_MS);
            const done = (error?: Error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (error) reject(error); else resolve();
            };
            stream.once('error', (error: Error) => done(error));
            stream.once('data', () => done());
            stream.once('end', () => done());
            stream.once('status', (status: { code?: number; details?: string }) => {
                // 0 === grpc.status.OK. An undefined code means grpc-js reported
                // completion without a status object; treat that as success too,
                // since a real failure always arrives as 'error'.
                const code = status?.code;
                done(code === undefined || code === 0 ? undefined : new Error(status?.details || `gRPC status ${code}`));
            });
            stream.write({
                streamingConfig: {
                    config: {
                        encoding: 'LINEAR_PCM',
                        sampleRateHertz: 16000,
                        languageCode: config.languageCode,
                        maxAlternatives: 1,
                    },
                    interimResults: true,
                },
            });
            stream.write({ audioContent: Buffer.alloc(PROBE_AUDIO_BYTES) });
            stream.end();
        });
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error?.details || error?.message || 'NVIDIA NIM speech connection failed' };
    } finally {
        try { stream?.cancel(); } catch { /* already closed */ }
    }
}
