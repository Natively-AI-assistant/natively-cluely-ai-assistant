import os from 'os';

export type HardwareTier = 'excellent' | 'good' | 'limited';

export interface HardwareInfo {
    arch: string;
    platform: string;
    cpuModel: string;
    isAppleSilicon: boolean;
    totalRamGb: number;
    tier: HardwareTier;
    recommendation: string;
    recommendedModel: string;
}

export function detectHardware(): HardwareInfo {
    const arch = process.arch;
    const platform = process.platform;
    const cpus = os.cpus();
    const cpuModel = cpus[0]?.model ?? 'Unknown';
    const totalRamGb = Math.round(os.totalmem() / (1024 ** 3));

    // Apple Silicon: arm64 on macOS — Metal GPU acceleration, unified memory
    const isAppleSilicon = platform === 'darwin' && arch === 'arm64';
    // Intel Mac: x64 on macOS — CPU only, no Metal
    const isIntelMac = platform === 'darwin' && arch === 'x64';

    let tier: HardwareTier;
    let recommendation: string;
    let recommendedModel: string;

    // Moonshine is the recommended default everywhere — it's purpose-built for
    // streaming (encoder caching + decoder state reuse) and delivers ~100×
    // lower latency than Whisper Large v3 with comparable WER. English-only.
    // For multilingual, the per-platform fallback uses Whisper Large v3 Turbo
    // (multilingual, 6× faster than Large v3) on capable hardware, otherwise
    // standard Whisper variants sized to RAM.
    if (isAppleSilicon) {
        tier = 'excellent';
        recommendation = 'Apple Silicon — CoreML activates Metal GPU via ONNX Runtime. Moonshine Base streams in near real-time on the Neural Engine.';
        recommendedModel = 'onnx-community/moonshine-base-ONNX';
    } else if (isIntelMac) {
        tier = 'limited';
        recommendation = 'Intel Mac — CPU inference with int8 quantization. Moonshine Tiny streams in real-time on CPU; Cloud STT (Groq/Deepgram) recommended for long multilingual sessions.';
        recommendedModel = 'onnx-community/moonshine-tiny-ONNX';
    } else if (platform === 'win32' && totalRamGb >= 8) {
        tier = 'good';
        recommendation = 'Windows — DirectML activates GPU acceleration (NVIDIA, AMD, Intel) via ONNX Runtime. Moonshine Base streams in real-time on most gaming hardware.';
        recommendedModel = totalRamGb >= 16 ? 'onnx-community/moonshine-base-ONNX' : 'onnx-community/moonshine-tiny-ONNX';
    } else if (platform === 'linux') {
        tier = 'good';
        recommendation = 'Linux — ONNX Runtime CPU with int8 quantization. Moonshine Base offers near real-time streaming.';
        recommendedModel = 'onnx-community/moonshine-base-ONNX';
    } else {
        tier = 'limited';
        recommendation = 'Limited hardware — Moonshine Tiny streams in real-time even on minimal CPUs.';
        recommendedModel = 'onnx-community/moonshine-tiny-ONNX';
    }

    return {
        arch,
        platform,
        cpuModel,
        isAppleSilicon,
        totalRamGb,
        tier,
        recommendation,
        recommendedModel,
    };
}
