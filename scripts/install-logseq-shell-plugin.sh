#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-rankun203/logseq-shell}"
DEST_DIR="${LOGSEQ_SHELL_PLUGIN_DIR:-$HOME/.logseq/plugins/logseq-shell}"
ASSET="logseq-shell-plugin.tar.gz"
URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "Downloading ${ASSET} ..."
curl -fsSL "$URL" -o "$TMP_DIR/$ASSET"
tar -xzf "$TMP_DIR/$ASSET" -C "$TMP_DIR"

SRC_DIR="$TMP_DIR/logseq-shell-plugin"
if [[ ! -d "$SRC_DIR" ]]; then
  echo "Plugin folder not found in release archive: $SRC_DIR" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST_DIR")"
rm -rf "$DEST_DIR"
cp -R "$SRC_DIR" "$DEST_DIR"

echo "Installed plugin files to: $DEST_DIR"
echo

echo "Next: In Logseq desktop -> Plugins -> Load unpacked plugin -> $DEST_DIR"
