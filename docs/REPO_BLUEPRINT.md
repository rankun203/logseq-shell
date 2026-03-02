# logseq-shell Monorepo Blueprint

Status: draft v1

## 1) Project scope

This monorepo contains two deliverables:

- **`logseq-shell`**: Logseq plugin (TypeScript) that provides an integrated terminal panel.
- **`logseq-shelld`**: Local daemon (Rust) that hosts PTY sessions and streams terminal I/O over WebSocket.

Core UX targets:

1. Click plugin icon or hotkey => terminal panel toggles.
2. Panel dock: **bottom** or **right**.
3. Configurable terminal working directory.
4. Configurable default command (auto-run on new session optional).
5. Theme should visually blend into current Logseq style/theme.

---

## 2) Recommended repository layout

```text
logseq-shell/
  apps/
    logseq-shell/                    # plugin app (TypeScript + Vite)
      src/
        main.ts
        ui/
          App.tsx
          terminal/
            terminal-controller.ts   # xterm lifecycle + addons
            theme-adapter.ts         # Logseq token -> xterm theme mapping
            ws-client.ts
          panel/
            dock-layout.ts           # bottom/right sizing + animation
      public/
      package.json
      logseq-plugin.edn

  crates/
    logseq-shelld/                   # Rust daemon
      src/
        main.rs
        config.rs
        server/
          http.rs
          ws.rs
          auth.rs
        pty/
          manager.rs
          session.rs
          io_pump.rs
          resize.rs
        protocol/
          mod.rs
          messages.rs
      Cargo.toml

  docs/
    REPO_BLUEPRINT.md
    THEME_MAPPING.md
    PROTOCOL_V1.md
    INSTALL.md
    DEV.md

  scripts/
    dev.sh                           # run plugin dev + daemon dev together
    release.sh

  .github/
    workflows/
      ci.yml
      release.yml

  package.json                       # root workspace tooling
  pnpm-workspace.yaml
  Cargo.toml                         # workspace cargo
  README.md
```

---

## 3) Architecture overview

## 3.1 Plugin (`logseq-shell`)

Responsibilities:
- Render terminal panel UI.
- Register toolbar icon + shortcut.
- Maintain plugin settings.
- Connect to daemon and forward terminal events.
- Resolve Logseq theme tokens and map to xterm theme.

Key APIs to use:
- `logseq.App.registerUIItem('toolbar', ...)`
- `logseq.App.registerCommandShortcut(...)`
- `logseq.showMainUI() / hideMainUI() / toggleMainUI()`
- `logseq.setMainUIInlineStyle(...)`
- `logseq.useSettingsSchema(...)`
- `logseq.App.onThemeModeChanged(...)`
- `logseq.UI.resolveThemeCssPropsVals(...)`

## 3.2 Daemon (`logseq-shelld`)

Responsibilities:
- Spawn/manage PTY sessions (cross-platform).
- Stream PTY output to plugin with low-latency backpressure-aware transport.
- Accept stdin/write, resize, kill, heartbeat commands.
- Enforce localhost-only + token auth by default.

Recommended stack:
- PTY: `portable-pty`
- Async runtime: `tokio`
- WebSocket: `tokio-tungstenite` (v1); optional `fastwebsockets` path later
- Config: `serde` + TOML
- CLI: `clap`

---

## 4) Protocol (v1 summary)

Transport:
- WS on `127.0.0.1:<port>`
- Text frames: control JSON
- Binary frames: raw PTY bytes

Control messages:
- `hello`
- `spawn {cwd, shell, env?, command?, cols, rows}`
- `resize {sessionId, cols, rows}`
- `input {sessionId, data}` (optional if binary input not used)
- `close {sessionId}`
- `ping` / `pong`

Server events:
- `ready {sessionId}`
- `exit {sessionId, code, signal?}`
- `error {code, message}`
- `stats` (optional)

Backpressure requirements:
- bounded per-session output queue
- pause/resume PTY reader when queue crosses watermarks
- never drop bytes silently (emit warning/error if hard cap exceeded)

---

## 5) Plugin settings schema (v1)

- `dockSide`: `"bottom" | "right"` (default: `bottom`)
- `panelSize`: number (px or ratio)
- `cwdMode`: `"graph" | "custom"`
- `cwdCustomPath`: string
- `defaultCommand`: string
- `autoRunDefaultCommand`: boolean
- `daemonUrl`: string (default `ws://127.0.0.1:34981/ws`)
- `autoConnect`: boolean
- `followLogseqTheme`: boolean (default `true`)
- `terminalFontSize`: number
- `terminalFontFamily`: string (default from `--ls-font-family`)
- `renderer`: `"auto" | "webgl" | "canvas"`

---

## 6) Docking behavior

- Bottom dock:
  - full width
  - configurable height
  - slide-up animation
- Right dock:
  - full height below top bar
  - configurable width
  - slide-left animation

Persist last dock side + panel size in plugin settings.

---

## 7) Theme integration strategy (must-have)

Use Logseq theme tokens as source of truth. On mount and on every theme change:

1. Resolve token values through `logseq.UI.resolveThemeCssPropsVals(...)`.
2. Build xterm theme object from resolved values.
3. Apply to terminal instance live (`terminal.options.theme = ...`).

Important: support both multiple themes and mode switches by subscribing to `onThemeModeChanged` and re-resolving tokens.

Detailed mapping spec: `docs/THEME_MAPPING.md`.

---

## 8) Performance + stability guardrails

- p95 keystroke echo latency target: < 35ms local.
- No output corruption for large streams (stress with >100MB text).
- PTY session isolation: one crashed shell must not kill daemon.
- Hard idle timeout and cleanup for detached sessions.
- Structured logs with session id correlation.

Suggested tests:
- burst output (`yes`, `seq`, large `cat`)
- interactive TUIs (`vim`, `htop`, `fzf`, `python`, `node` REPL)
- rapid resize spam
- reconnect after daemon restart

---

## 9) Release/distribution plan

- `logseq-shell` plugin bundle: release artifact + marketplace package.
- `logseq-shelld` binaries: GitHub Releases (macOS/linux/windows).
- Homebrew tap distribution for daemon:
  - tap repo: `homebrew-tap`
  - install: `brew tap <owner>/tap && brew install logseq-shelld`
  - optional service: `brew services start logseq-shelld`

---

## 10) Milestones

### M1: Vertical slice
- daemon spawn + IO + resize
- plugin xterm view + connect + toolbar toggle

### M2: Product UX
- bottom/right dock, shortcut, settings UI, cwd/default command

### M3: Theme parity
- full token mapping + live updates + renderer fallback

### M4: Hardening
- backpressure tuning, soak tests, crash recovery, packaging

### M5: Release
- GitHub release automation + Homebrew tap + docs polish
