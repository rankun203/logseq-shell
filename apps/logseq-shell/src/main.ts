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
let runtimeSignature = ''

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

function getRuntimeSignature(settings: Settings): string {
  return JSON.stringify({
    daemonUrl: settings.daemonUrl,
    cwd: settings.cwd,
    defaultCommand: settings.defaultCommand
  })
}

function clampPanelSize(side: DockSide, size: number): number {
  const min = 200
  const max = side === 'right'
    ? Math.max(min, window.innerWidth - 160)
    : Math.max(min, window.innerHeight - 120)
  return Math.min(max, Math.max(min, Math.round(size)))
}

function getRootEl(): HTMLElement | null {
  return document.querySelector('.shell-root') as HTMLElement | null
}

function syncRootDockSide(side: DockSide) {
  const root = getRootEl()
  if (root) root.dataset.dockSide = side
}

function renderRoot() {
  const app = document.getElementById('app')
  if (!app) return

  if (app.dataset.rendered === '1') return

  app.innerHTML = `
    <div class="shell-root" data-dock-side="bottom">
      <div id="resize-handle" class="resize-handle" aria-hidden="true"></div>
      <div class="terminal-wrap" id="terminal"></div>
    </div>
  `
  app.dataset.rendered = '1'
}

function setStatus(_text: string) {
  // reserved for future status indicator UI
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
}

function ensureMounted() {
  if (!document.getElementById('app')?.dataset.rendered) {
    renderRoot()
  }
  if (!controller) {
    mountTerminal()
  }
}

function ensureDockAttrs(ls: any) {
  // Logseq may restore a previous draggable layout and ignore positional keys.
  // Disable that mode so we always control bottom/right docking.
  const attrs: any = { draggable: false, resizable: false }
  attrs['data-inited_layout'] = ''
  ls.setMainUIAttrs(attrs)
}

async function applyDockStyle(override?: Partial<Pick<Settings, 'dockSide' | 'panelSize'>>) {
  const ls = getLS()
  if (!ls) return

  const s = getSettings()
  const side = override?.dockSide ?? s.dockSide
  const size = clampPanelSize(side, override?.panelSize ?? s.panelSize)

  ensureDockAttrs(ls)
  ls.setMainUIInlineStyle(calcMainUIStyle(side, size))
  syncRootDockSide(side)
}

function fitAfterOpen() {
  setTimeout(() => controller?.fit(), 30)
  setTimeout(() => controller?.fit(), 120)
}

function setupResizeHandle() {
  const handle = document.getElementById('resize-handle') as HTMLDivElement | null
  if (!handle) return

  handle.onpointerdown = (ev: PointerEvent) => {
    const ls = getLS()
    const s = getSettings()
    const side = s.dockSide
    const startSize = s.panelSize
    const startX = ev.clientX
    const startY = ev.clientY
    let latestSize = startSize

    const root = getRootEl()
    root?.classList.add('is-resizing')

    handle.setPointerCapture?.(ev.pointerId)
    ev.preventDefault()

    const onMove = (e: PointerEvent) => {
      const delta = side === 'right' ? (startX - e.clientX) : (startY - e.clientY)
      latestSize = clampPanelSize(side, startSize + delta)
      void applyDockStyle({ dockSide: side, panelSize: latestSize })
      controller?.fit()
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      root?.classList.remove('is-resizing')

      if (ls?.updateSettings) {
        ls.updateSettings({ panelSize: latestSize })
      }

      fitAfterOpen()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
}

async function openPanel() {
  const ls = getLS()
  if (!ls) return
  ensureMounted()
  setupResizeHandle()
  await applyDockStyle()
  ls.showMainUI({ autoFocus: false })
  fitAfterOpen()
}

async function togglePanel() {
  const ls = getLS()
  if (!ls) return
  ensureMounted()
  setupResizeHandle()
  await applyDockStyle()
  ls.toggleMainUI({ autoFocus: false })
  fitAfterOpen()
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
      description: 'Absolute path preferred. ~ is supported by daemon.'
    },
    {
      key: 'defaultCommand',
      type: 'string',
      default: '',
      title: 'Default command',
      description: 'Optional command auto-runs after shell session is ready'
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
      '<a class="button" data-on-click="toggleShellPanel" title="Toggle Logseq Shell" aria-label="Toggle Logseq Shell"><i class="ti ti-terminal-2" style="font-size:18px"></i></a>'
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
  runtimeSignature = getRuntimeSignature(s)

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
    const current = getSettings()
    const nextSignature = getRuntimeSignature(current)
    const runtimeChanged = nextSignature !== runtimeSignature
    runtimeSignature = nextSignature

    void applyDockStyle()
    setupResizeHandle()

    if (controller && runtimeChanged) {
      mountTerminal()
      fitAfterOpen()
    } else {
      controller?.fit()
    }
  })
}

function startPreviewMode() {
  renderRoot()
  mountTerminal()
  setupResizeHandle()
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
    setStatus('ready')
    void applyDockStyle()
    ls.hideMainUI?.({ restoreEditingCursor: false })
  }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[logseq-shell] failed to initialize', err)
  })
}

main()
