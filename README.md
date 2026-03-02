# logseq-shell monorepo

- `apps/logseq-shell`: Logseq plugin (TypeScript + xterm.js)
- `crates/logseq-shelld`: local PTY daemon (Rust)

## Prerequisites

- Node.js 22+
- pnpm 10+
- Rust toolchain (`rustup` + `cargo`)

If Rust is not installed:

```bash
curl -fsSL https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```

## Install dependencies

```bash
pnpm install
source "$HOME/.cargo/env"
cargo fetch
```

## Build

```bash
# plugin
pnpm --filter logseq-shell build

# daemon
source "$HOME/.cargo/env"
cargo build -p logseq-shelld
```

## Test

```bash
# plugin unit tests + TS checks
pnpm --filter logseq-shell test
pnpm --filter logseq-shell lint

# daemon unit tests
source "$HOME/.cargo/env"
cargo test -p logseq-shelld
```

## Self-install as OS service (macOS + Ubuntu)

`logseq-shelld` can install itself as an auto-start background service:

```bash
logseq-shelld --install-service
```

You can also customize runtime and service name:

```bash
logseq-shelld   --host 127.0.0.1   --port 34981   --service-name logseq-shelld   --install-service
```

Platform behavior:

- **macOS**: writes a LaunchAgent plist to `~/Library/LaunchAgents/` and loads it with `launchctl`.
- **Ubuntu/Linux (systemd user)**: writes `~/.config/systemd/user/<service>.service` and runs `systemctl --user enable --now`.

> Tip: install from a stable binary path first (e.g. Homebrew) before running `--install-service`, so service upgrades stay predictable.

## Homebrew service install (logseq-shelld)

This repo includes a Homebrew formula at `Formula/logseq-shelld.rb` with a service definition.

### Option A: install directly from local repo

```bash
brew install --HEAD ./Formula/logseq-shelld.rb
brew services start logseq-shelld
```

### Option B: install from tap

```bash
brew tap rankun203/logseq-shell https://github.com/rankun203/logseq-shell
brew install --HEAD rankun203/logseq-shell/logseq-shelld
brew services start logseq-shelld
```

Service management:

```bash
brew services list
brew services restart logseq-shelld
brew services stop logseq-shelld
```

By default service runs:

```bash
logseq-shelld --host 127.0.0.1 --port 34981
```

## Run locally (without Homebrew service)

### Start daemon

```bash
source "$HOME/.cargo/env"
./target/debug/logseq-shelld --host 127.0.0.1 --port 34981
```

### Preview plugin UI in browser (without Logseq host APIs)

```bash
pnpm --filter logseq-shell preview --host 127.0.0.1 --port 4173
```

Open: http://127.0.0.1:4173/

## Load plugin in Logseq (desktop)

1. Build plugin: `pnpm --filter logseq-shell build`
2. In Logseq: **Plugins → Load unpacked plugin**
3. Select folder: `apps/logseq-shell`
4. Start daemon (`logseq-shelld`) before opening panel.

## Manual smoke test checklist

1. Toolbar terminal icon appears in Logseq header.
2. Shortcut `mod+shift+t` toggles panel.
3. Settings can switch dock side (`bottom`/`right`) and size.
4. Terminal accepts input and runs commands.
5. If `defaultCommand` is set (e.g. `cd /path && clear && codex`), it executes on session start.
6. Theme changes (light/dark/custom) update terminal colors.
