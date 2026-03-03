# logseq-shell

Logseq-shell is a dockable terminal inside Logseq (bottom/right, resizable, keyboard toggle, restart session, default startup command, optional API key auth).

<img width="1095" height="511" alt="image" src="https://github.com/user-attachments/assets/b215d0d1-b4ea-425e-b989-301a86271da2" />

Logseq terminal integration:

- `apps/logseq-shell`: Logseq plugin UI
- `crates/logseq-shelld`: local PTY daemon

## User guide

### 1) Install daemon

Logseq plugins can’t directly spawn terminal subprocesses inside Logseq. This daemon starts and manages the local TTY process, and the plugin connects to it to execute commands.

```bash
cargo install --git https://github.com/rankun203/logseq-shell --tag 0.2.1 logseq-shelld
logseq-shelld --install-service
```

This avoids macOS downloaded-binary quarantine issues and installs from source directly.
`--install-service` now records your current user shell and key environment values (HOME/USER/PATH/LANG) for service runs.

Optional API key auth:

```bash
logseq-shelld --api-key "change-me" --install-service
```

When API key is set on daemon, set the same value in plugin setting **Daemon API key (optional)**. The plugin sends it when opening the websocket connection.

If `cargo` is missing:

```bash
curl -fsSL https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```

If `logseq-shelld` is not found, load Cargo env (or add `~/.cargo/bin` to your shell PATH):

```bash
source "$HOME/.cargo/env"
```

### 2) Install plugin files from Release

```bash
curl -fsSL "https://github.com/rankun203/logseq-shell/releases/latest/download/logseq-shell-plugin.tar.gz" | tar -xz -C "$HOME/.logseq/plugins"
```

Then in Logseq desktop:
1. Open **Plugins**
2. Click **Load unpacked plugin**
3. Select folder: `~/.logseq/plugins/logseq-shell`

Default daemon URL in plugin settings:

`ws://127.0.0.1:34981/ws`

### 3) Service management

```bash
logseq-shelld --service-status
logseq-shelld --uninstall-service
```

Platform behavior:
- **macOS**: launchd (`~/Library/LaunchAgents/`)
- **Ubuntu/Linux**: systemd user (`~/.config/systemd/user/`)

> Linux tip: keep user services running when logged out:
>
> `sudo loginctl enable-linger $USER`

### 4) Upgrade daemon

```bash
cargo install --force --git https://github.com/rankun203/logseq-shell --tag 0.2.1 logseq-shelld
logseq-shelld --install-service
```

### 5) Install logseq-local-http skill

Use this skill when a coding assistant needs to query your local Logseq app via HTTP (search notes, pages, backlinks, journals, and graph traversal).

```bash
cp -R "$(pwd)/apps/skills/logseq-local-http" "$HOME/.codex/skills/"
cp -R "$(pwd)/apps/skills/logseq-local-http" "$HOME/.claude/skills/"
``` 

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
