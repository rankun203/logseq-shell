# Logseq Shell

An integrated terminal panel for Logseq.

## What it does

- Adds a **`>_` toolbar button** in Logseq
- Adds command palette actions:
  - `Logseq Shell: Toggle panel`
  - `Logseq Shell: Open panel`
- Opens a shell panel docked to **bottom** or **right**
- Supports custom working directory and default startup command
- Follows Logseq theme colors (light/dark/custom)

## Important: this plugin needs a local daemon

`logseq-shell` UI connects to `logseq-shelld` on your machine.

Default websocket URL:

`ws://127.0.0.1:34981/ws`

If daemon is not running, panel will open but terminal won't be interactive.

## Quick start

1. Start daemon:

```bash
source "$HOME/.cargo/env"
/path/to/logseq-shell/target/debug/logseq-shelld --host 127.0.0.1 --port 34981
```

2. In Logseq, load plugin (unpacked) from this folder.
3. Click `>_` or run command palette action to open panel.

## Plugin settings

- **Dock side**: `bottom` or `right`
- **Panel size**: height (bottom) / width (right)
- **Daemon websocket URL**
- **Working directory**
- **Default command**
- **Shortcut (all platforms)**
- **Shortcut override for macOS**

> If you change shortcut settings, reload plugin once to apply the new keybinding.

## Notes

- This plugin gives terminal access to your local machine through the daemon.
- Use only on trusted graphs/devices.
