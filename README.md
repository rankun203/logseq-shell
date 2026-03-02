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

## Run locally

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

1. Toolbar button (`>_`) appears in Logseq header.
2. Shortcut `mod+shift+t` toggles panel.
3. Settings can switch dock side (`bottom`/`right`) and size.
4. Terminal accepts input and runs commands.
5. If `defaultCommand` is set, it executes on session start.
6. Theme changes (light/dark/custom) update terminal colors.
