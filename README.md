# logseq-shell

Logseq terminal integration:

- `apps/logseq-shell`: Logseq plugin UI
- `crates/logseq-shelld`: local PTY daemon

## User guide

### 1) Install daemon (recommended)

```bash
cargo install --git https://github.com/rankun203/logseq-shell --tag v1.0.2 logseq-shelld
~/.cargo/bin/logseq-shelld --install-service
```

This avoids macOS downloaded-binary quarantine issues and installs from source directly.
`--install-service` now records your current user shell and key environment values (HOME/USER/PATH/LANG) for service runs.

If `cargo` is missing:

```bash
curl -fsSL https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
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

### 3) Service management

```bash
~/.cargo/bin/logseq-shelld --service-status
~/.cargo/bin/logseq-shelld --uninstall-service
```

Platform behavior:
- **macOS**: launchd (`~/Library/LaunchAgents/`)
- **Ubuntu/Linux**: systemd user (`~/.config/systemd/user/`)

> Linux tip: keep user services running when logged out:
>
> `sudo loginctl enable-linger $USER`

### 4) Upgrade daemon

```bash
cargo install --force --git https://github.com/rankun203/logseq-shell --tag v1.0.2 logseq-shelld
~/.cargo/bin/logseq-shelld --install-service
```

---

## CI/CD and release artifacts

GitHub Actions workflow (`.github/workflows/release-shelld.yml`) automatically:

- builds `logseq-shelld` on:
  - `x86_64-unknown-linux-gnu`
  - `aarch64-apple-darwin`
- builds `logseq-shell` plugin bundle
- uploads build artifacts on `main`/`master` pushes
- on tags like `v1.0.2`, publishes both daemon and plugin archives to GitHub Releases

---

## Development (below)

### Prerequisites

- Node.js 22+ (with Corepack)
- Rust toolchain (`rustup` + `cargo`)

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
