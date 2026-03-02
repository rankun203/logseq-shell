#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

source "$HOME/.cargo/env"

echo "[1/2] Starting logseq-shelld on 127.0.0.1:34981"
cargo run -p logseq-shelld -- --host 127.0.0.1 --port 34981 &
DAEMON_PID=$!

cleanup() {
  echo "Stopping logseq-shelld (pid=$DAEMON_PID)"
  kill "$DAEMON_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "[2/2] Starting plugin dev server"
pnpm --filter logseq-shell dev
