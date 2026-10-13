#!/usr/bin/env bash
# Shared desktop: a nested X display (Xephyr) running its own Plasma desktop,
# for screen sharing.
#
# Brave runs inside the nested desktop with ANGLE-on-Vulkan, so pages see the
# real GPU instead of software rendering. A Meet "Entire screen" share captures
# only the nested display, so windows on the real desktop (e.g. the Natively
# overlay) stay out of the share.
#
# The nested Plasma session uses its own D-Bus session and its own config/data/
# cache dirs, so it never touches your real desktop's settings, and an empty
# Desktop folder so your real ~/Desktop files are not shown to viewers.
#
# The Natively browser extension (natively-browser/dist) is loaded into that
# Brave unpacked, so DOM capture works there; pair it once from its popup.
# Natively's screenshots follow the nested display while it runs (marker file).
#
# Usage: shared-desktop.sh [WIDTHxHEIGHT]      (default 1920x1080)
# Env:   NATIVELY_EXTENSION_DIR  built extension dir (default: <repo>/natively-browser/dist)
# Close the Xephyr window (or Ctrl+C here) to tear everything down.

set -euo pipefail

SIZE="${1:-1920x1080}"
STATE="${SHARED_DESKTOP_HOME:-$HOME/.local/share/shared-desktop}"
PROFILE="${SHARED_DESKTOP_PROFILE:-$HOME/.config/brave-shared-desktop}"
HOST_DISPLAY="${DISPLAY:?DISPLAY is not set — run this from your desktop session}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_DIR="${NATIVELY_EXTENSION_DIR:-$SCRIPT_DIR/../../natively-browser/dist}"
if [ ! -f "$EXTENSION_DIR/manifest.json" ]; then
  echo "Natively browser extension not built at $EXTENSION_DIR" >&2
  echo "Build it with: (cd natively-browser && npm install && npm run build)" >&2
  exit 1
fi
EXTENSION_DIR="$(cd "$EXTENSION_DIR" && pwd)"

if ! [[ "$SIZE" =~ ^[0-9]+x[0-9]+$ ]]; then
  echo "Size must look like 1920x1080, got: $SIZE" >&2
  exit 2
fi
for bin in Xephyr kwin_x11 plasmashell dbus-run-session brave-browser xclip setsid; do
  command -v "$bin" >/dev/null || { echo "Missing required program: $bin" >&2; exit 1; }
done

# First free display number from :1 up.
n=1
while [ -e "/tmp/.X11-unix/X$n" ] || [ -e "/tmp/.X$n-lock" ]; do n=$((n + 1)); done
NESTED=":$n"
LOG="/tmp/shared-desktop-$n.log"
: > "$LOG"

# Isolated XDG dirs for the nested session, with an empty Desktop folder.
mkdir -p "$STATE"/{config,data,cache,Desktop} "$PROFILE"
cat > "$STATE/config/user-dirs.dirs" <<EOF
XDG_DESKTOP_DIR="$STATE/Desktop"
EOF

# Natively reads this to capture screenshots from the shared display (see
# electron/platform/linuxScreenshot.ts). Written once the display is up.
MARKER="$STATE/display"
PIDFILE="$STATE/pid"   # lets Natively stop this session

pids=()        # plain child processes
groups=()      # process groups (nested session) — killed as a whole
cleanup() {
  trap - EXIT INT TERM
  for g in "${groups[@]}"; do kill -TERM -- "-$g" 2>/dev/null || true; done
  for p in "${pids[@]}"; do kill -TERM "$p" 2>/dev/null || true; done
  sleep 2
  # plasmashell can linger after its display is gone; make sure the group is gone.
  for g in "${groups[@]}"; do kill -KILL -- "-$g" 2>/dev/null || true; done
  wait 2>/dev/null || true
  # Natively captures this display while the marker exists; drop it if still ours.
  if [ "$(cat "$MARKER" 2>/dev/null)" = "$NESTED" ]; then rm -f "$MARKER"; fi
  if [ "$(cat "$PIDFILE" 2>/dev/null)" = "$$" ]; then rm -f "$PIDFILE"; fi
  echo "Shared desktop $NESTED stopped."
}
trap cleanup EXIT INT TERM

echo "Starting Xephyr on $NESTED at $SIZE ..."
Xephyr "$NESTED" -screen "$SIZE" -resizeable -ac -br -title "Shared desktop ($NESTED)" -no-host-grab \
  >>"$LOG" 2>&1 &
xephyr_pid=$!
pids+=("$xephyr_pid")

for _ in $(seq 1 50); do
  [ -e "/tmp/.X11-unix/X$n" ] && break
  kill -0 "$xephyr_pid" 2>/dev/null || { echo "Xephyr exited during startup; see $LOG" >&2; exit 1; }
  sleep 0.1
done
[ -e "/tmp/.X11-unix/X$n" ] || { echo "Xephyr did not create display $NESTED; see $LOG" >&2; exit 1; }
printf '%s\n' "$NESTED" > "$MARKER"
printf '%s\n' "$$" > "$PIDFILE"

# Nested Plasma session (window manager + panel + Brave) in its own process group.
# Compositing off: inside Xephyr it would run on llvmpipe for nothing.
setsid env DISPLAY="$NESTED" \
  XDG_CONFIG_HOME="$STATE/config" XDG_DATA_HOME="$STATE/data" XDG_CACHE_HOME="$STATE/cache" \
  KWIN_COMPOSE=N \
  dbus-run-session -- sh -c '
    kwin_x11 &
    sleep 1
    plasmashell &
    # Start Brave only once the desktop has settled: Plasma owns its bus name and
    # the screen configuration (kscreen applies it for a few seconds after
    # login) has stopped changing for 2s. Brave started during that window
    # crashed at startup (SIGSEGV/SIGILL, no output).
    for _ in $(seq 1 60); do
      dbus-send --session --print-reply --dest=org.freedesktop.DBus / \
        org.freedesktop.DBus.NameHasOwner string:org.kde.plasmashell 2>/dev/null \
        | grep -q "boolean true" && break
      sleep 0.25
    done
    prev=""; stable=0
    for _ in $(seq 1 120); do
      cur="$(xrandr --current 2>/dev/null)"
      if [ "$cur" = "$prev" ]; then
        stable=$((stable + 1)); [ "$stable" -ge 8 ] && break
      else
        stable=0; prev="$cur"
      fi
      sleep 0.25
    done
    brave-browser --user-data-dir="$1" --no-first-run --no-default-browser-check --password-store=basic \
      --load-extension="$2" \
      --use-angle=vulkan --enable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE \
      --start-maximized https://meet.google.com &
    wait
  ' shared-desktop "$PROFILE" "$EXTENSION_DIR" >>"$LOG" 2>&1 &
groups+=("$!")

# Clipboard bridge (text only), both directions; a change on either side wins.
clip_get() { DISPLAY="$1" timeout 1 xclip -o -selection clipboard 2>/dev/null || true; }
clip_set() { printf '%s' "$2" | DISPLAY="$1" xclip -i -selection clipboard 2>/dev/null || true; }
(
  last_host="$(clip_get "$HOST_DISPLAY")"
  last_nested="$(clip_get "$NESTED")"
  while sleep 0.5; do
    host="$(clip_get "$HOST_DISPLAY")"
    nested="$(clip_get "$NESTED")"
    if [ "$host" != "$last_host" ] && [ -n "$host" ]; then
      clip_set "$NESTED" "$host"; nested="$host"
    elif [ "$nested" != "$last_nested" ] && [ -n "$nested" ]; then
      clip_set "$HOST_DISPLAY" "$nested"; host="$nested"
    fi
    last_host="$host"; last_nested="$nested"
  done
) &
pids+=("$!")

echo
echo "Shared desktop is up on $NESTED (log: $LOG)."
echo "  - Join Meet in that window and share \"Entire screen\": only $NESTED is captured."
echo "  - Keep Natively on your real desktop, on top of the Xephyr window."
echo "  - Natively screenshots now capture $NESTED, not your real desktop."
echo "  - Natively extension loaded; first time only: click its icon -> Connect to Natively."
echo "  - Use the taskbar inside the window to open anything else you want to show."
echo "  - Close the Xephyr window or press Ctrl+C here to stop."

wait "$xephyr_pid" || true
