# WhisperLive Setup for Natively Local STT

Natively's `Local STT` provider connects to a running WhisperLive WebSocket server. Natively does not install or start WhisperLive for you.

Official reference: `https://github.com/collabora/WhisperLive`

## 1. Recommended First Setup

Use the Faster Whisper backend first. It is the simplest path and works on CPU, though GPU is faster.

```powershell
cd C:\path\to\projects
git clone https://github.com/collabora/WhisperLive.git
cd WhisperLive
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install whisper-live
```

Install the server dependencies used by `run_server.py`:

```powershell
pip install -r requirements\server.txt
```

If `pip install whisper-live` does not include the repo scripts you want to run directly, install the repo in editable mode:

```powershell
pip install -e .
```

If `python run_server.py ...` fails with `ModuleNotFoundError: No module named 'fastapi'`, the server requirements were not installed into the active virtual environment. Re-activate the venv and rerun:

```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements\server.txt
python -m pip show fastapi
```

## 2. Start the WhisperLive Server

Start with Float32 mode, which is what Natively uses by default:

```powershell
python run_server.py --port 9090 --backend faster_whisper --max_clients 4 --max_connection_time 14400
```

Why these values:

- `--port 9090`: matches Natively's default `ws://127.0.0.1:9090`.
- `--backend faster_whisper`: simplest backend to get working first.
- `--max_clients 4`: Natively may connect both system audio and microphone.
- `--max_connection_time 14400`: allows up to 4-hour sessions.

Keep this terminal open while using Natively.

## 3. Configure Natively

In Natively:

1. Open Settings -> Audio -> Speech Provider.
2. Select `Local STT`.
3. Set Server URL to:

```text
ws://127.0.0.1:9090
```

4. Set Model to:

```text
small
```

5. Keep Audio Format as `Float32`.
6. Click `Save`.
7. Click `Test Connection`.

Then start a meeting/audio capture flow.

## 4. Optional PCM16 Mode

Natively can send 16-bit PCM instead of Float32, but WhisperLive must be started with `--raw_pcm_input`:

```powershell
python run_server.py --port 9090 --backend faster_whisper --max_clients 4 --max_connection_time 14400 --raw_pcm_input
```

Then set Natively -> Local STT -> Audio Format to `PCM16`.

Use Float32 unless you have a reason to test PCM16.

## 5. GPU Setup Options

You can keep the Python virtual environment you already created, but GPU acceleration is usually cleaner through Docker on Windows.

For this machine, `nvidia-smi` confirms an NVIDIA GeForce RTX 3080 Laptop GPU is available. Docker is not currently installed, and WSL is not currently installed. So the shortest reliable GPU path is:

1. Install WSL2.
2. Install Docker Desktop.
3. Enable Docker Desktop's WSL2 backend.
4. Run the official WhisperLive GPU container.

### Option A: NVIDIA GPU with Docker

Use this if you have an NVIDIA GPU. This is the recommended Windows GPU path.

Install:

- Latest NVIDIA driver
- Docker Desktop with WSL2 backend enabled
- NVIDIA Container Toolkit support through Docker Desktop/WSL2

If WSL is not installed yet, open PowerShell as Administrator and run:

```powershell
wsl --install
```

Restart Windows if prompted. Then install Docker Desktop from `https://www.docker.com/products/docker-desktop/`.

After installing Docker Desktop:

1. Open Docker Desktop.
2. Go to Settings -> General.
3. Enable `Use the WSL 2 based engine`.
4. Wait until Docker says it is running.

Verify Docker can see your GPU:

```powershell
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
```

If that prints your GPU, start WhisperLive:

```powershell
docker run -it --gpus all -p 9090:9090 ghcr.io/collabora/whisperlive-gpu:latest
```

Then in Natively:

- Server URL: `ws://127.0.0.1:9090`
- Audio Format: `Float32`
- Model: `small` or `base` first

### Option B: NVIDIA TensorRT

TensorRT can be faster, but it is more setup-heavy because you must build TensorRT engines. WhisperLive's docs currently recommend Docker for this backend.

Use TensorRT only after the regular GPU Docker image is working.

### Option C: Intel GPU / OpenVINO

Use this if your machine has an Intel iGPU/dGPU and you want OpenVINO acceleration.

Docker command from WhisperLive:

```powershell
docker run -it --device=/dev/dri -p 9090:9090 ghcr.io/collabora/whisperlive-openvino
```

This is more Linux/WSL-oriented because `/dev/dri` must be available inside the runtime.

### Option D: Native Python GPU

You can try to make the existing `.venv` use GPU libraries, but on Windows this is more fragile than Docker because CUDA, cuDNN, PyTorch/CTranslate2, and Python wheels must line up exactly.

If you want the fastest route, do not spend time converting the current `.venv`; run the GPU Docker image and point Natively at the same `ws://127.0.0.1:9090` URL.

To confirm whether your current Python venv is using CUDA, run:

```powershell
cd C:\path\to\projects\WhisperLive
.\.venv\Scripts\Activate.ps1
python -c "import torch; print('cuda available:', torch.cuda.is_available()); print('torch cuda:', torch.version.cuda)"
```

If this prints `cuda available: False`, the current venv is CPU-only.

## 6. Model Choices

Start with:

```text
small
```

If latency is too high, try:

```text
base
```

If accuracy is too low and your machine can handle it, try:

```text
medium
```

The first run may take longer because Whisper/Faster Whisper models need to download and cache.

## 7. Docker CPU Alternative

WhisperLive also publishes Docker images. CPU-only:

```powershell
docker run -it -p 9090:9090 ghcr.io/collabora/whisperlive-cpu:latest
```

After the container is listening on `9090`, use the same Natively settings.

## 8. Sanity Checks

Check that the port is listening:

```powershell
Test-NetConnection 127.0.0.1 -Port 9090
```

Expected result includes:

```text
TcpTestSucceeded : True
```

If Natively's `Test Connection` fails:

- Confirm the WhisperLive terminal is still running.
- Confirm Natively URL is `ws://127.0.0.1:9090`, not `http://`.
- Confirm no firewall prompt is blocking Python.
- Restart WhisperLive and click `Test Connection` again.

## 9. Notes for Better Results

- Use headphones to reduce speaker-to-microphone bleed.
- Use `small` or `base` for lower latency.
- Use `medium` only if your machine has enough CPU/GPU headroom.
- Keep Server VAD enabled in Natively unless it clips words.
- For long meetings, keep `--max_connection_time` higher than the expected meeting length.
