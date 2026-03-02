# Logseq Shell

An integrated terminal panel for Logseq.

## What it does

- Adds a terminal icon button in Logseq toolbar
- Adds command palette actions:
  - `Logseq Shell: Toggle panel`
  - `Logseq Shell: Open panel`
- Opens a shell panel docked to **bottom** or **right**
- Includes a **restart session** button (fresh terminal session)
- Supports startup default command
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
3. Click the toolbar terminal icon or run command palette action to open panel.

## Startup in a specific folder (recommended)

Set **Default command** like:

```bash
cd /absolute/path/to/project && clear && codex
```

This is the recommended workflow to open directly in a project folder.

## Plugin settings

- **Dock side**: `bottom` or `right`
- **Panel size**: height (bottom) / width (right)
- **Daemon websocket URL**
- **Default command**
- **Shortcut (all platforms)**
- **Shortcut override for macOS**

### Terminal style

- **Scrollback lines** (default `5000`)
- **Font size**
- **Line height**
- **Font family (optional)**
- **Blinking cursor**

> If you change shortcut settings, reload plugin once to apply the new keybinding.

## Notes

- This plugin gives terminal access to your local machine through the daemon.
- Use only on trusted graphs/devices.
