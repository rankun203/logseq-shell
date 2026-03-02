import '@logseq/libs'
import '@xterm/xterm/css/xterm.css'
import { createTerminalController } from './terminal/terminal-controller'
import { calcMainUIStyle, type DockSide } from './panel/dock-layout'

type Settings = {
  dockSide: DockSide
  panelSize: number
  daemonUrl: string
  cwd: string
  defaultCommand: string
  shortcutBinding: string
  shortcutMac: string
}

const DEFAULT_SETTINGS: Settings = {
  dockSide: 'bottom',
  panelSize: 320,
  daemonUrl: 'ws://127.0.0.1:34981/ws',
  cwd: '',
  defaultCommand: '',
  shortcutBinding: 'mod+shift+t',
  shortcutMac: ''
}

let controller: ReturnType<typeof createTerminalController> | null = null

function getLS(): any | null {
  return (globalThis as any).logseq ?? null
}

function getSettings(): Settings {
  const ls = getLS()
  if (!ls?.settings) return DEFAULT_SETTINGS
  return {
    ...DEFAULT_SETTINGS,
    ...ls.settings
  }
}

function renderRoot() {
  const app = document.getElementById('app')
  if (!app) return

  if (app.dataset.rendered === '1') return

  app.innerHTML = `
    <div class="shell-root">
      <div class="shell-toolbar">
        <button id="reconnect-btn">Reconnect</button>
        <button id="fit-btn">Fit</button>
        <span class="status" id="shell-status">booting...</span>
      </div>
      <div class="terminal-wrap" id="terminal"></div>
    </div>
  `
  app.dataset.rendered = '1'
}

function setStatus(text: string) {
  const status = document.getElementById('shell-status')
  if (status) status.textContent = text
}

function mountTerminal() {
  const terminalEl = document.getElementById('terminal')
  if (!terminalEl) return

  const settings = getSettings()

  controller?.dispose()
  controller = createTerminalController({
    container: terminalEl,
    daemonUrl: settings.daemonUrl,
    cwd: settings.cwd || undefined,
    defaultCommand: settings.defaultCommand || undefined,
    onStatus: setStatus
  })

  document.getElementById('reconnect-btn')?.addEventListener('click', () => mountTerminal())
  document.getElementById('fit-btn')?.addEventListener('click', () => controller?.fit())
}

function ensureMounted() {
  if (!document.getElementById('app')?.dataset.rendered) {
    renderRoot()
  }
  if (!controller) {
    mountTerminal()
  }
}

async function applyDockStyle() {
  const ls = getLS()
  if (!ls) return
  const s = getSettings()
  ls.setMainUIInlineStyle(calcMainUIStyle(s.dockSide, s.panelSize))
}

async function openPanel() {
  const ls = getLS()
  if (!ls) return
  ensureMounted()
  await applyDockStyle()
  ls.showMainUI({ autoFocus: false })
  setTimeout(() => controller?.fit(), 30)
}

async function togglePanel() {
  const ls = getLS()
  if (!ls) return
  ensureMounted()
  await applyDockStyle()
  ls.toggleMainUI({ autoFocus: false })
  setTimeout(() => controller?.fit(), 30)
}

function registerSettingsSchema(ls: any) {
  ls.useSettingsSchema([
    {
      key: 'dockSide',
      type: 'enum',
      enumChoices: ['bottom', 'right'],
      default: 'bottom',
      title: 'Dock side',
      description: 'Where to place the terminal panel'
    },
    {
      key: 'panelSize',
      type: 'number',
      default: 320,
      title: 'Panel size (px)',
      description: 'Bottom: height. Right: width.'
    },
    {
      key: 'daemonUrl',
      type: 'string',
      default: 'ws://127.0.0.1:34981/ws',
      title: 'Daemon websocket URL',
      description: 'Example: ws://127.0.0.1:34981/ws'
    },
    {
      key: 'cwd',
      type: 'string',
      default: '',
      title: 'Working directory',
      description: 'Leave blank to use daemon default'
    },
    {
      key: 'defaultCommand',
      type: 'string',
      default: '',
      title: 'Default command',
      description: 'Optional command auto-runs after spawn'
    },
    {
      key: 'shortcutBinding',
      type: 'string',
      default: 'mod+shift+t',
      title: 'Shortcut (all platforms)',
      description: 'Requires plugin reload to rebind'
    },
    {
      key: 'shortcutMac',
      type: 'string',
      default: '',
      title: 'Shortcut override for macOS',
      description: 'Optional, e.g. cmd+shift+t. Requires plugin reload.'
    }
  ])
}

function setupLogseq() {
  const ls = getLS()
  if (!ls) return

  registerSettingsSchema(ls)

  ls.provideModel({
    toggleShellPanel: () => void togglePanel(),
    openShellPanel: () => void openPanel()
  })

  ls.App.registerUIItem('toolbar', {
    key: 'logseq-shell-toggle',
    template:
      '<a class="button" data-on-click="toggleShellPanel" title="Toggle Logseq Shell" aria-label="Toggle Logseq Shell" style="display:inline-flex;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" ry="2"></rect><path d="m7 8 3 3-3 3"></path><path d="M12 14h5"></path></svg></a>'
  })

  ls.App.registerCommandPalette(
    {
      key: 'logseq-shell-toggle-panel',
      label: 'Logseq Shell: Toggle panel'
    },
    () => void togglePanel()
  )

  ls.App.registerCommandPalette(
    {
      key: 'logseq-shell-open-panel',
      label: 'Logseq Shell: Open panel'
    },
    () => void openPanel()
  )

  const s = getSettings()
  ls.App.registerCommandShortcut(
    {
      mode: 'global',
      binding: s.shortcutBinding || DEFAULT_SETTINGS.shortcutBinding,
      mac: s.shortcutMac || undefined
    },
    () => void togglePanel(),
    {
      key: 'logseq-shell-shortcut-toggle',
      label: 'Logseq Shell: Toggle panel'
    }
  )

  ls.onSettingsChanged(() => {
    void applyDockStyle()
    controller?.fit()
  })
}

function startPreviewMode() {
  renderRoot()
  mountTerminal()
  setStatus('preview mode (no Logseq host API)')
}

function main() {
  const ls = getLS()
  if (!ls?.ready) {
    startPreviewMode()
    return
  }

  ls.ready(() => {
    setupLogseq()
    renderRoot()
    mountTerminal()
    setStatus('ready')
    void applyDockStyle()
    ls.hideMainUI?.({ restoreEditingCursor: false })
  }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[logseq-shell] failed to initialize', err)
  })
}

main()
