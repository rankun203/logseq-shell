# logseq-shell

Logseq terminal integration:

- `apps/logseq-shell`: Logseq plugin UI
- `crates/logseq-shelld`: local PTY daemon

## User guide

## Quick install

### 1) Install daemon + auto-start service (macOS Apple Silicon / Ubuntu)

Use direct release binary URLs published by GitHub Actions.

macOS (Apple Silicon):

```bash
mkdir -p "$HOME/.local/bin"
curl -fsSL "https://github.com/rankun203/logseq-shell/releases/latest/download/logseq-shelld-aarch64-apple-darwin.tar.gz" | tar -xzO logseq-shelld-aarch64-apple-darwin > "$HOME/.local/bin/logseq-shelld"
chmod +x "$HOME/.local/bin/logseq-shelld" && "$HOME/.local/bin/logseq-shelld" --install-service
```

Ubuntu (x86_64):

```bash
mkdir -p "$HOME/.local/bin"
curl -fsSL "https://github.com/rankun203/logseq-shell/releases/latest/download/logseq-shelld-x86_64-unknown-linux-gnu.tar.gz" | tar -xzO logseq-shelld-x86_64-unknown-linux-gnu > "$HOME/.local/bin/logseq-shelld"
chmod +x "$HOME/.local/bin/logseq-shelld" && "$HOME/.local/bin/logseq-shelld" --install-service
```

### 2) Install plugin files from Release

```bash
mkdir -p "$HOME/.logseq/plugins" && rm -rf "$HOME/.logseq/plugins/logseq-shell"
curl -fsSL "https://github.com/rankun203/logseq-shell/releases/latest/download/logseq-shell-plugin.tar.gz" | tar -xz -C "$HOME/.logseq/plugins"
mv "$HOME/.logseq/plugins/logseq-shell-plugin" "$HOME/.logseq/plugins/logseq-shell"
```

Then in Logseq desktop:
1. Open **Plugins**
2. Click **Load unpacked plugin**
3. Select folder: `~/.logseq/plugins/logseq-shell`

Default daemon URL in plugin settings:

`ws://127.0.0.1:34981/ws`

---

## Manual install

### Daemon (`logseq-shelld`)

#### Option A: GitHub release binaries (recommended)

1. Open Releases: <https://github.com/rankun203/logseq-shell/releases>
2. Download the archive for your platform (`logseq-shelld-<target>.tar.gz`)
3. Extract and place `logseq-shelld` in your PATH
4. `chmod +x` if needed

#### Option B: Build from source

```bash
cargo build --release -p logseq-shelld
# binary: target/release/logseq-shelld
```

### Start daemon

Foreground run:

```bash
logseq-shelld --host 127.0.0.1 --port 34981
```

Install auto-start service (system default):

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

Check service status:

```bash
logseq-shelld --service-status
```

Uninstall service:

```bash
logseq-shelld --uninstall-service
```

Platform behavior:
- **macOS**: launchd (`~/Library/LaunchAgents/`)
- **Ubuntu/Linux**: systemd user (`~/.config/systemd/user/`)

> Linux tip: keep user services running when logged out:
>
> `sudo loginctl enable-linger $USER`

### Plugin (`logseq-shell`)

#### Option A: GitHub release plugin archive (recommended)

1. Open Releases: <https://github.com/rankun203/logseq-shell/releases>
2. Download `logseq-shell-plugin.tar.gz`
3. Extract it under `~/.logseq/plugins/logseq-shell`
4. In Logseq: **Plugins → Load unpacked plugin** and select that folder

#### Option B: Build from source

```bash
corepack enable
pnpm install
pnpm --filter logseq-shell build
```

Then in Logseq desktop:
1. Open **Plugins**
2. Click **Load unpacked plugin**
3. Select folder: `apps/logseq-shell`

---

## CI/CD and release artifacts

GitHub Actions workflow (`.github/workflows/release-shelld.yml`) automatically:

- builds `logseq-shelld` on:
  - `x86_64-unknown-linux-gnu`
  - `aarch64-apple-darwin`
- builds `logseq-shell` plugin bundle
- uploads build artifacts on `main`/`master` pushes
- on tags like `v0.1.0`, publishes both daemon and plugin archives to GitHub Releases

---

## Development (moved down)

### Prerequisites

- Node.js 22+ (with Corepack)
- Rust toolchain (`rustup` + `cargo`)

If Rust is not installed:

```bash
curl -fsSL https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```

### Install dependencies

```bash
corepack enable
pnpm install
source "$HOME/.cargo/env"
cargo fetch
```

### Build

```bash
# plugin
pnpm --filter logseq-shell build

# daemon
source "$HOME/.cargo/env"
cargo build -p logseq-shelld
```

### Test

```bash
# plugin unit tests + TS checks
pnpm --filter logseq-shell test
pnpm --filter logseq-shell lint

# daemon unit tests
source "$HOME/.cargo/env"
cargo test -p logseq-shelld
```

### Local preview

```bash
pnpm --filter logseq-shell preview --host 127.0.0.1 --port 4173
```

Open: <http://127.0.0.1:4173/>
