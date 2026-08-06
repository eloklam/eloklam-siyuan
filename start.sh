#!/usr/bin/env bash
# start.sh — dev boot for the SiYuan fork
# Starts: SiYuan-Kernel (dev) + webpack watch (app) + Electron UI
# Stop:   Ctrl+C in this terminal (stops kernel + webpack too)
#
# Usage:  ./start.sh [workspace]
#         default workspace: /home/eloklam/SiYuan
# Logs:   /tmp/siyuan-kernel.log  /tmp/siyuan-webpack.log
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$REPO/app"
KERNEL="$APP/kernel/SiYuan-Kernel"
PORT="${SIYUAN_PORT:-6806}"
WORKSPACE="${1:-/home/eloklam/SiYuan}"

KERNEL_LOG=/tmp/siyuan-kernel.log
WEBPACK_LOG=/tmp/siyuan-webpack.log
KERNEL_PID=""
WEBPACK_PID=""

cleanup() {
    echo
    echo "[start.sh] stopping kernel + webpack..."
    [ -n "$WEBPACK_PID" ] && kill "$WEBPACK_PID" 2>/dev/null
    [ -n "$KERNEL_PID" ] && kill "$KERNEL_PID" 2>/dev/null
    wait 2>/dev/null
    echo "[start.sh] stopped."
}
trap cleanup EXIT INT TERM

# --- 1. Kernel -------------------------------------------------------------
if (echo > /dev/tcp/127.0.0.1/"$PORT") 2>/dev/null; then
    echo "[start.sh] kernel already listening on :$PORT, skipping start"
else
    echo "[start.sh] starting kernel on :$PORT (workspace: $WORKSPACE)"
    "$KERNEL" serve --mode dev --port "$PORT" --workspace "$WORKSPACE" >"$KERNEL_LOG" 2>&1 &
    KERNEL_PID=$!
    for i in $(seq 1 60); do
        if (echo > /dev/tcp/127.0.0.1/"$PORT") 2>/dev/null; then
            echo "[start.sh] kernel up on :$PORT (pid $KERNEL_PID)"
            break
        fi
        if ! kill -0 "$KERNEL_PID" 2>/dev/null; then
            echo "[start.sh] kernel died, see $KERNEL_LOG"
            tail -20 "$KERNEL_LOG"
            exit 1
        fi
        sleep 1
    done
fi

# --- 2. webpack watch ------------------------------------------------------
if [ -f /tmp/siyuan-webpack.pid ] && kill -0 "$(cat /tmp/siyuan-webpack.pid)" 2>/dev/null; then
    echo "[start.sh] webpack watch already running (pid $(cat /tmp/siyuan-webpack.pid)), skipping start"
    WEBPACK_PID="$(cat /tmp/siyuan-webpack.pid)"
else
    echo "[start.sh] starting webpack watch..."
    (cd "$APP" && exec pnpm run dev >"$WEBPACK_LOG" 2>&1) &
    WEBPACK_PID=$!
    echo "$WEBPACK_PID" > /tmp/siyuan-webpack.pid
    echo "[start.sh] waiting for first webpack build (log: $WEBPACK_LOG)..."
    for i in $(seq 1 240); do
        if grep -q "compiled successfully\|compiled with errors" "$WEBPACK_LOG" 2>/dev/null; then
            echo "[start.sh] webpack build done"
            break
        fi
        if ! kill -0 "$WEBPACK_PID" 2>/dev/null; then
            echo "[start.sh] webpack died, see $WEBPACK_LOG"
            tail -30 "$WEBPACK_LOG"
            exit 1
        fi
        sleep 2
    done
fi

# --- 3. Electron (foreground; Ctrl+C stops everything) ---------------------
echo "[start.sh] launching Electron..."
cd "$APP" || exit 1
pnpm start
