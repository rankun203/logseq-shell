# logseq-shell

Logseq terminal integration:

- `apps/logseq-shell`: Logseq plugin UI
- `crates/logseq-shelld`: local PTY daemon

## User guide

## 1) Install the daemon (`logseq-shelld`)

### Option A: GitHub release binaries (recommended)

1. Open Releases: <https://github.com/rankun203/logseq-shell/releases>
2. Download the archive for your platform (`logseq-shelld-<target>.tar.gz`)
3. Extract and place `logseq-shelld` in your PATH

### Option B: Build from source

```bash
cargo build --release -p logseq-shelld
# binary: target/release/logseq-shelld
```

## 2) Start daemon

### Run once in foreground

```bash
logseq-shelld --host 127.0.0.1 --port 34981
```

### Install as auto-start service (system default)

```bash
logseq-shelld --install-service
```

Optional customization:

```bash
logseq-shelld \
  --host 127.0.0.1 \
  --port 34981 \
  --service-name logseq-shelld \
  --install-service
```

Platform behavior:

- **macOS**: installs a LaunchAgent in `~/Library/LaunchAgents/` (launchd)
- **Ubuntu/Linux**: installs a systemd user unit in `~/.config/systemd/user/`

> Linux tip: if you want user services to keep running even when logged out, run once:
>
> `sudo loginctl enable-linger $USER`

## 3) Install the Logseq plugin

Currently this repo ships as an unpacked plugin.

```bash
pnpm install
pnpm --filter logseq-shell build
```

Then in Logseq desktop:

1. Open **Plugins**
2. Click **Load unpacked plugin**
3. Select folder: `apps/logseq-shell`

Default daemon URL in plugin settings:

`ws://127.0.0.1:34981/ws`

## CI/CD and releases

GitHub Actions workflow (`.github/workflows/release-shelld.yml`) automatically:

- builds `logseq-shelld` on `main`/`master` for:
  - `x86_64-unknown-linux-gnu`
  - `x86_64-apple-darwin`
  - `aarch64-apple-darwin`
- uploads build artifacts to workflow runs
- when pushing a tag like `v0.1.0`, publishes binary archives to GitHub Releases

---

## Development (moved down)

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

## Local preview

```bash
pnpm --filter logseq-shell preview --host 127.0.0.1 --port 4173
```

Open: <http://127.0.0.1:4173/>
