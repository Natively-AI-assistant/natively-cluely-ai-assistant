#!/bin/bash
# ==============================================================================
# NATIVELY AI - ULTRA-ROBUST LINUX LAUNCHER
# ==============================================================================
# This script ensures a clean execution environment by managing zombie processes,
# port conflicts, and orchestrating the Vite-Electron lifecycle.
# ==============================================================================

# --- Configuration ---
APP_DIR="/home/gamp/Desktop/OpenSource/natively-cluely-ai-assistant"
LOG_FILE="/home/gamp/natively-launcher.log"
VITE_PORT=5180
ELECTRON_FLAGS="--no-sandbox"

# Ensure we are in the correct directory
cd "$APP_DIR" || { echo "Error: Could not cd to $APP_DIR"; exit 1; }

# Redirect all output to log file for diagnostics
exec > >(tee -a "$LOG_FILE") 2>&1
echo "--------------------------------------------------------------------------"
echo "🚀 Launching Natively AI | $(date '+%Y-%m-%d %H:%M:%S')"
echo "--------------------------------------------------------------------------"

# --- 1. Deep Cleanup Phase ---
echo "[1/5] Performing deep cleanup..."

# Kill any existing Electron processes associated with this project folder
# We use pgrep -f to find the path, then kill them to avoid "Another instance" errors.
PROJECT_PIDS=$(pgrep -f "natively-cluely-ai-assistant")
if [ -n "$PROJECT_PIDS" ]; then
    echo "  -> Found existing project processes: $PROJECT_PIDS. Terminating..."
    echo "$PROJECT_PIDS" | xargs kill -9 > /dev/null 2>&1
fi

# Force clear the Vite port
echo "  -> Clearing port $VITE_PORT..."
fuser -k ${VITE_PORT}/tcp > /dev/null 2>&1

# --- 2. Vite Server Initiation ---
echo "[2/5] Starting Vite development server..."
# Run Vite in the background. We use 'nohup' and redirect to avoid hang-ups.
# We capture the PID to ensure we can kill it when the app closes.
npm run dev -- --port $VITE_PORT --strictPort > /dev/null 2>&1 &
VITE_PID=$!
echo "  -> Vite started with PID: $VITE_PID"

# --- 3. Health Check Phase ---
echo "[3/5] Verifying server readiness..."
MAX_RETRIES=30
COUNT=0
until curl -s "http://localhost:$VITE_PORT" > /dev/null || [ $COUNT -eq $MAX_RETRIES ]; do
    printf "."
    sleep 0.5
    ((COUNT++))
done
echo ""

if [ $COUNT -eq $MAX_RETRIES ]; then
    echo "❌ ERROR: Vite server failed to become ready at http://localhost:$VITE_PORT"
    kill -9 $VITE_PID > /dev/null 2>&1
    exit 1
fi
echo "  -> Server is online and healthy."

# --- 4. Application Launch ---
echo "[4/5] Launching Electron application..."
# We run Electron in the foreground of this script.
# This allows the script to wait for the app to close before cleaning up.
npx cross-env NODE_ENV=development electron . $ELECTRON_FLAGS

# --- 5. Teardown Phase ---
echo "[5/5] Application closed. Cleaning up resources..."
if [ -n "$VITE_PID" ]; then
    echo "  -> Terminating Vite server (PID: $VITE_PID)..."
    kill -9 $VITE_PID > /dev/null 2>&1
fi

echo "--------------------------------------------------------------------------"
echo "✅ Session ended at $(date '+%Y-%m-%d %H:%M:%S')"
echo "--------------------------------------------------------------------------"
