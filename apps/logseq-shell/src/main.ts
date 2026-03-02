import '@xterm/xterm/css/xterm.css'
import { createTerminalController } from './terminal/terminal-controller'
import { calcMainUIStyle, type DockSide } from './panel/dock-layout'

type Settings = {
  dockSide: DockSide
  panelSize: number
  daemonUrl: string
  cwd: string
  defaultCommand: string
}

const DEFAULT_SETTINGS: Settings = {
  dockSide: 'bottom',
  panelSize: 320,
  daemonUrl: 'ws://127.0.0.1:34981/ws',
  cwd: '',
  defaultCommand: ''
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
  const app = document.getElementById('app')!
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
}

function setStatus(text: string) {
  const status = document.getElementById('shell-status')
  if (status) status.textContent = text
}

function mountTerminal() {
  const terminalEl = document.getElementById('terminal')!
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

async function applyDockStyle() {
  const ls = getLS()
  if (!ls) return
  const s = getSettings()
  ls.setMainUIInlineStyle(calcMainUIStyle(s.dockSide, s.panelSize))
}

async function togglePanel() {
  const ls = getLS()
  if (!ls) return
  await applyDockStyle()
  ls.toggleMainUI({ autoFocus: false })
  setTimeout(() => controller?.fit(), 30)
}

function setupLogseq() {
  const ls = getLS()
  if (!ls) return

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
      title: 'Daemon websocket URL'
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
    }
  ])

  ls.provideModel({
    toggleShellPanel: () => void togglePanel()
  })

  ls.App.registerUIItem(
    'toolbar',
    `<a class="button" data-on-click="toggleShellPanel" title="Toggle Logseq Shell">>_</a>`
  )

  ls.App.registerCommandShortcut(
    { binding: 'mod+shift+t' },
    () => void togglePanel()
  )

  ls.onSettingsChanged(() => {
    void applyDockStyle()
    controller?.fit()
  })
}

function startPreviewMode() {
  setStatus('preview mode (no logseq API)')
}

function main() {
  renderRoot()
  mountTerminal()

  const ls = getLS()
  if (ls?.ready) {
    setupLogseq()
    ls.ready(() => {
      setStatus('ready')
      void applyDockStyle()
      ls.hideMainUI?.({ restoreEditingCursor: false })
    })
  } else {
    startPreviewMode()
  }
}

main()
