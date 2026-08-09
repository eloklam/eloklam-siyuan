#!/usr/bin/env bash
# Runtime wrapper for task 2b701867f434 — launches SiYuan 3.7.4-alpha.6 dev runtime
# from worktree /home/eloklam/orca/workspaces/SiYuan/runtime-correct-374 against
# workspace /home/eloklam/SiYuan with CDP 9222 and Electron sandbox disabled.
# This wrapper is debug/runtime-only; it does not modify any source file.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$REPO/app"
KERNEL="$APP/kernel/SiYuan-Kernel"
PORT="${SIYUAN_PORT:-6806}"
WORKSPACE="${1:-/home/eloklam/SiYuan}"
export ELECTRON_DISABLE_SANDBOX=1

KERNEL_LOG=/tmp/siyuan-kernel.log
WEBPACK_LOG=/tmp/siyuan-webpack.log
KERNEL_PID=""
WEBPACK_PID=""

cleanup() {
    echo
    echo "[runtime] stopping kernel + webpack..."
    [ -n "$WEBPACK_PID" ] && kill "$WEBPACK_PID" 2>/dev/null
    [ -n "$KERNEL_PID" ] && kill "$KERNEL_PID" 2>/dev/null
    wait 2>/dev/null
    echo "[runtime] stopped."
}
trap cleanup EXIT INT TERM

# --- 1. Kernel -------------------------------------------------------------
if (echo > /dev/tcp/127.0.0.1/"$PORT") 2>/dev/null; then
    echo "[runtime] kernel already listening on :$PORT, skipping start"
else
    echo "[runtime] starting kernel on :$PORT (workspace: $WORKSPACE)"
    "$KERNEL" serve --mode dev --port "$PORT" --wd "$APP" --workspace "$WORKSPACE" >"$KERNEL_LOG" 2>&1 &
    KERNEL_PID=$!
    for i in $(seq 1 90); do
        if (echo > /dev/tcp/127.0.0.1/"$PORT") 2>/dev/null; then
            echo "[runtime] kernel up on :$PORT (pid $KERNEL_PID)"
            break
        fi
        if ! kill -0 "$KERNEL_PID" 2>/dev/null; then
            echo "[runtime] kernel died, see $KERNEL_LOG"
            tail -30 "$KERNEL_LOG"
            exit 1
        fi
        sleep 1
    done
fi

# --- 2. webpack watch ------------------------------------------------------
if [ -f /tmp/siyuan-webpack.pid ] && kill -0 "$(cat /tmp/siyuan-webpack.pid)" 2>/dev/null; then
    echo "[runtime] webpack watch already running (pid $(cat /tmp/siyuan-webpack.pid)), skipping start"
    WEBPACK_PID="$(cat /tmp/siyuan-webpack.pid)"
else
    echo "[runtime] starting webpack watch..."
    (cd "$APP" && exec pnpm run dev >"$WEBPACK_LOG" 2>&1) &
    WEBPACK_PID=$!
    echo "$WEBPACK_PID" > /tmp/siyuan-webpack.pid
    echo "[runtime] waiting for first webpack build (log: $WEBPACK_LOG)..."
    for i in $(seq 1 300); do
        if grep -q "compiled successfully\|compiled with errors" "$WEBPACK_LOG" 2>/dev/null; then
            echo "[runtime] webpack build done"
            break
        fi
        if ! kill -0 "$WEBPACK_PID" 2>/dev/null; then
            echo "[runtime] webpack died, see $WEBPACK_LOG"
            tail -30 "$WEBPACK_LOG"
            exit 1
        fi
        sleep 2
    done
fi

# --- 3. Electron (foreground; Ctrl+C stops everything) ---------------------
echo "[runtime] launching Electron with CDP 9222..."
cd "$APP" || exit 1
NODE_ENV=development ./node_modules/.bin/electron ./electron/main.js --remote-debugging-port=9222
