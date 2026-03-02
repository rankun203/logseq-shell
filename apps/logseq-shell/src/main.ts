import '@logseq/libs'
import '@xterm/xterm/css/xterm.css'
import { createTerminalController } from './terminal/terminal-controller'
import { calcMainUIStyle, type DockSide } from './panel/dock-layout'

type Settings = {
  dockSide: DockSide
  panelSize: number
  daemonUrl: string
  defaultCommand: string
  shortcutBinding: string
  shortcutMac: string
  terminalScrollback: number
  terminalFontSize: number
  terminalLineHeight: number
  terminalFontFamily: string
  terminalCursorBlink: boolean
}

const DEFAULT_SETTINGS: Settings = {
  dockSide: 'bottom',
  panelSize: 320,
  daemonUrl: 'ws://127.0.0.1:34981/ws',
  defaultCommand: '',
  shortcutBinding: 'mod+shift+t',
  shortcutMac: '',
  terminalScrollback: 5000,
  terminalFontSize: 13,
  terminalLineHeight: 1.15,
  terminalFontFamily: '',
  terminalCursorBlink: true
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
    defaultCommand: settings.defaultCommand,
    terminalScrollback: settings.terminalScrollback,
    terminalFontSize: settings.terminalFontSize,
    terminalLineHeight: settings.terminalLineHeight,
    terminalFontFamily: settings.terminalFontFamily,
    terminalCursorBlink: settings.terminalCursorBlink
  })
}

function getTerminalStyleOptions(settings: Settings) {
  return {
    scrollback: Math.max(500, Math.min(100_000, Math.floor(settings.terminalScrollback || 5000))),
    fontSize: Math.max(10, Math.min(28, Number(settings.terminalFontSize || 13))),
    lineHeight: Math.max(1, Math.min(2, Number(settings.terminalLineHeight || 1.15))),
    fontFamily: (settings.terminalFontFamily || '').trim(),
    cursorBlink: Boolean(settings.terminalCursorBlink)
  }
}

function isMacLike(): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
}

function normalizeKey(key: string): string {
  const k = key.toLowerCase()
  if (k === ' ') return 'space'
  return k
}

function eventMatchesShortcut(e: KeyboardEvent, binding: string, macLike: boolean): boolean {
  if (!binding?.trim()) return false

  let needCtrl = false
  let needMeta = false
  let needAlt = false
  let needShift = false
  let key: string | null = null

  for (const raw of binding.toLowerCase().split('+').map((x) => x.trim()).filter(Boolean)) {
    if (raw === 'mod') {
      if (macLike) needMeta = true
      else needCtrl = true
    } else if (raw === 'cmd' || raw === 'command' || raw === 'meta') {
      needMeta = true
    } else if (raw === 'ctrl' || raw === 'control') {
      needCtrl = true
    } else if (raw === 'alt' || raw === 'option') {
      needAlt = true
    } else if (raw === 'shift') {
      needShift = true
    } else {
      key = raw
    }
  }

  const hasExactMods =
    e.ctrlKey === needCtrl &&
    e.metaKey === needMeta &&
    e.altKey === needAlt &&
    e.shiftKey === needShift

  if (!hasExactMods) return false
  if (!key) return true

  return normalizeKey(e.key) === key
}

function setupIframeShortcutToggle() {
  const onKeyDown = (e: KeyboardEvent) => {
    const s = getSettings()
    const macLike = isMacLike()

    const binding =
      macLike && s.shortcutMac?.trim()
        ? s.shortcutMac
        : (s.shortcutBinding || DEFAULT_SETTINGS.shortcutBinding)

    if (!eventMatchesShortcut(e, binding, macLike)) return

    e.preventDefault()
    e.stopPropagation()
    ;(e as any).stopImmediatePropagation?.()
    void togglePanel()
  }

  window.addEventListener('keydown', onKeyDown, true)
}


function getHostViewport(): { width: number; height: number } {
  let width = window.innerWidth
  let height = window.innerHeight

  const candidates: Array<Window | null | undefined> = [window.parent, window.top]
  for (const w of candidates) {
    if (!w || w === window) continue
    try {
      if (typeof w.innerWidth === 'number' && typeof w.innerHeight === 'number') {
        width = Math.max(width, w.innerWidth)
        height = Math.max(height, w.innerHeight)
      }
    } catch {
      // cross-origin frame, ignore
    }
  }

  return { width, height }
}

function clampPanelSize(side: DockSide, size: number): number {
  const preferredMin = 200
  const hardMin = 120
  const viewport = getHostViewport()

  const available = side === 'right'
    ? viewport.width - 160
    : viewport.height - 120

  // Ensure min is never greater than max on small viewports.
  const max = Math.max(hardMin, Math.floor(available))
  const min = Math.min(preferredMin, max)

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
  const style = getTerminalStyleOptions(settings)

  controller = createTerminalController({
    container: terminalEl,
    daemonUrl: settings.daemonUrl,
    defaultCommand: settings.defaultCommand || undefined,
    onStatus: setStatus,
    scrollback: style.scrollback,
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    fontFamily: style.fontFamily || undefined,
    cursorBlink: style.cursorBlink
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

function setDockStyle(ls: any, side: DockSide, size: number, enforceAttrs = false) {
  if (enforceAttrs) ensureDockAttrs(ls)
  ls.setMainUIInlineStyle(calcMainUIStyle(side, size))
  syncRootDockSide(side)
}

async function applyDockStyle(override?: Partial<Pick<Settings, 'dockSide' | 'panelSize'>>) {
  const ls = getLS()
  if (!ls) return

  const s = getSettings()
  const side = override?.dockSide ?? s.dockSide
  const size = clampPanelSize(side, override?.panelSize ?? s.panelSize)

  setDockStyle(ls, side, size, true)
}

function fitAfterOpen() {
  setTimeout(() => controller?.fit(), 30)
  setTimeout(() => controller?.fit(), 120)
}

type DragTarget = { win: Window; doc: Document }

function collectDragTargets(): DragTarget[] {
  const targets: DragTarget[] = []
  const seen = new Set<Window>()

  const push = (w: Window | null | undefined) => {
    if (!w || seen.has(w)) return
    try {
      const doc = w.document
      seen.add(w)
      targets.push({ win: w, doc })
    } catch {
      // cross-origin windows are ignored
    }
  }

  push(window)
  try {
    push(window.parent)
  } catch {
    // ignore
  }
  try {
    push(window.top as Window)
  } catch {
    // ignore
  }

  return targets
}


function setupResizeHandle() {
  const handle = document.getElementById('resize-handle') as HTMLDivElement | null
  if (!handle) return

  handle.onmousedown = (ev: MouseEvent) => {
    if (ev.button !== 0) return

    const ls = getLS()
    const s = getSettings()
    const side = s.dockSide
    const cursor = side === 'right' ? 'ew-resize' : 'ns-resize'

    const startSize = clampPanelSize(side, s.panelSize)
    const startAxis = side === 'right' ? ev.screenX : ev.screenY
    let latestSize = startSize
    let pendingSize = startSize
    let rafId: number | null = null

    const root = getRootEl()
    root?.classList.add('is-resizing')

    const targets = collectDragTargets()
    const prevCursorByDoc = new Map<Document, string>()

    const flush = () => {
      rafId = null
      if (ls) {
        setDockStyle(ls, side, pendingSize, false)
      }
    }

    const scheduleFlush = () => {
      if (rafId != null) return
      rafId = window.requestAnimationFrame(flush)
    }

    const cleanup = () => {
      targets.forEach(({ win, doc }) => {
        win.removeEventListener('mousemove', onMove)
        win.removeEventListener('mouseup', onUp)
        const body = doc.body
        if (body) {
          body.classList.remove('logseq-shell-resizing')
          body.style.cursor = prevCursorByDoc.get(doc) || ''
        }
      })
      root?.classList.remove('is-resizing')

      if (rafId != null) {
        window.cancelAnimationFrame(rafId)
        rafId = null
      }
      flush()
    }

    const onMove = (e: MouseEvent) => {
      const axis = side === 'right' ? e.screenX : e.screenY
      const delta = startAxis - axis
      latestSize = clampPanelSize(side, startSize + delta)
      pendingSize = latestSize
      scheduleFlush()
      e.preventDefault()
    }

    const onUp = () => {
      cleanup()

      if (ls?.updateSettings) {
        ls.updateSettings({ panelSize: latestSize })
      }

      fitAfterOpen()
    }

    targets.forEach(({ win, doc }) => {
      win.addEventListener('mousemove', onMove)
      win.addEventListener('mouseup', onUp)

      const body = doc.body
      if (body) {
        prevCursorByDoc.set(doc, body.style.cursor)
        body.classList.add('logseq-shell-resizing')
        body.style.cursor = cursor
      }
    })

    ev.preventDefault()
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
      key: 'defaultCommand',
      type: 'string',
      default: '',
      title: 'Default command',
      description: 'Optional command auto-runs after shell session is ready'
    },
    {
      key: 'terminalStyleSection',
      type: 'heading',
      default: null,
      title: 'Terminal style',
      description: 'Appearance and scrollback settings for the shell panel'
    },
    {
      key: 'terminalScrollback',
      type: 'number',
      default: 5000,
      title: 'Scrollback lines',
      description: 'How many lines are kept in terminal history (recommended: 5000)'
    },
    {
      key: 'terminalFontSize',
      type: 'number',
      default: 13,
      title: 'Font size',
      description: 'Terminal font size in pixels'
    },
    {
      key: 'terminalLineHeight',
      type: 'number',
      default: 1.15,
      title: 'Line height',
      description: 'Terminal line height multiplier (1.0 to 2.0)'
    },
    {
      key: 'terminalFontFamily',
      type: 'string',
      default: '',
      title: 'Font family (optional)',
      description: 'Leave empty to inherit Logseq default monospaced font'
    },
    {
      key: 'terminalCursorBlink',
      type: 'boolean',
      default: true,
      title: 'Blinking cursor',
      description: 'Enable/disable terminal cursor blink'
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

  setupIframeShortcutToggle()

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
