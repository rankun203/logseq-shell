import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { buildXtermTheme, resolveThemeTokens } from './theme-adapter'
import { ShellClient } from './ws-client'

export type ControllerOptions = {
  container: HTMLElement
  daemonUrl: string
  cwd?: string
  defaultCommand?: string
  onStatus: (text: string) => void
}

export function createTerminalController(opts: ControllerOptions) {
  const term = new Terminal({
    convertEol: false,
    fontSize: 13,
    lineHeight: 1.15,
    fontFamily:
      'var(--ls-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)',
    cursorBlink: true,
    allowProposedApi: false
  })

  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.open(opts.container)

  let spawned = false

  const client = new ShellClient(opts.daemonUrl, async (event) => {
    if (event.type === 'output') {
      term.write(new TextDecoder().decode(event.chunk))
    } else if (event.type === 'status') {
      if (event.status === 'connected' && !spawned) {
        fitAddon.fit()
        client.spawn({
          cwd: opts.cwd,
          command: undefined,
          cols: term.cols,
          rows: term.rows
        })
        spawned = true
      }

      if (event.status === 'disconnected') {
        spawned = false
      }

      opts.onStatus(event.detail ? `${event.status}: ${event.detail}` : event.status)
    } else if (event.type === 'ready') {
      opts.onStatus(`session ${event.sessionId}`)
      if (opts.defaultCommand?.trim()) {
        client.input(`${opts.defaultCommand}\r`)
      }
    } else if (event.type === 'exit') {
      term.writeln(`\r\n[logseq-shelld exited code=${event.code}${event.signal ? ` signal=${event.signal}` : ''}]`)
    }
  })

  const applyTheme = async () => {
    try {
      const ls = (globalThis as any).logseq
      const mode = ls?.baseInfo?.theme === 'light' ? 'light' : 'dark'
      term.options.theme = buildXtermTheme(await resolveThemeTokens(), mode)
    } catch (e) {
      // ignore startup/theme resolution issues and keep defaults
      // eslint-disable-next-line no-console
      console.warn('[logseq-shell] theme apply skipped', e)
    }
  }

  const resize = () => {
    fitAddon.fit()
    client.resize(term.cols, term.rows)
  }

  term.onData((data) => client.input(data))

  client.connect()
  window.addEventListener('resize', resize)
  void applyTheme()

  const ls = (globalThis as any).logseq
  if (ls?.App?.onThemeModeChanged && ls?.connected) {
    try {
      ls.App.onThemeModeChanged(() => void applyTheme())
    } catch {
      // ignore when not connected yet
    }
  }

  return {
    term,
    fit: resize,
    dispose() {
      window.removeEventListener('resize', resize)
      client.closeSession()
      client.disconnect()
      term.dispose()
    }
  }
}
