#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-rankun203/logseq-shell}"
BIN_DIR="${LOGSEQ_SHELLD_BIN_DIR:-$HOME/.local/bin}"

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64|aarch64) TARGET="aarch64-apple-darwin" ;;
      x86_64) echo "Intel macOS binary is not published. Build from source instead." >&2; exit 1 ;;
      *) echo "Unsupported macOS arch: $ARCH" >&2; exit 1 ;;
    esac
    ;;
  Linux)
    case "$ARCH" in
      x86_64) TARGET="x86_64-unknown-linux-gnu" ;;
      *) echo "Unsupported Linux arch: $ARCH" >&2; exit 1 ;;
    esac
    ;;
  *)
    echo "Unsupported OS: $OS" >&2
    exit 1
    ;;
esac

ASSET="logseq-shelld-${TARGET}.tar.gz"
URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "Downloading ${ASSET} ..."
curl -fsSL "$URL" -o "$TMP_DIR/$ASSET"
tar -xzf "$TMP_DIR/$ASSET" -C "$TMP_DIR"

SRC_BIN="$TMP_DIR/logseq-shelld-${TARGET}"
if [[ ! -f "$SRC_BIN" ]]; then
  echo "Binary not found in release archive: $SRC_BIN" >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
install -m 755 "$SRC_BIN" "$BIN_DIR/logseq-shelld"

echo "Installed: $BIN_DIR/logseq-shelld"

if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo
  echo "Add to PATH if needed:"
  echo "  export PATH=\"$BIN_DIR:\$PATH\""
fi

echo
"$BIN_DIR/logseq-shelld" --install-service

echo "Service installed and started."
