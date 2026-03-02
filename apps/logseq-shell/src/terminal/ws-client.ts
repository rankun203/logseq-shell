export type ShellStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'session-ready'
  | 'session-exited'
  | 'error'

export type ClientEvent =
  | { type: 'status'; status: ShellStatus; detail?: string }
  | { type: 'output'; chunk: Uint8Array }
  | { type: 'ready'; sessionId: string }
  | { type: 'exit'; code: number; signal?: string }

export class ShellClient {
  private ws: WebSocket | null = null
  private sessionId: string | null = null

  constructor(
    private readonly url: string,
    private readonly emit: (event: ClientEvent) => void
  ) {}

  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return

    this.emit({ type: 'status', status: 'connecting' })
    const ws = new WebSocket(this.url)
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      this.emit({ type: 'status', status: 'connected' })
      this.send({ type: 'hello', client: 'logseq-shell/0.1.0' })
    }

    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        const msg = JSON.parse(ev.data) as any
        if (msg.type === 'ready') {
          this.sessionId = msg.sessionId
          this.emit({ type: 'ready', sessionId: msg.sessionId })
          this.emit({ type: 'status', status: 'session-ready' })
        } else if (msg.type === 'exit') {
          this.emit({ type: 'exit', code: msg.code ?? 0, signal: msg.signal })
          this.emit({ type: 'status', status: 'session-exited' })
        } else if (msg.type === 'error') {
          this.emit({ type: 'status', status: 'error', detail: msg.message || 'daemon error' })
        }
      } else {
        const bytes = new Uint8Array(ev.data as ArrayBuffer)
        this.emit({ type: 'output', chunk: bytes })
      }
    }

    ws.onerror = () => {
      this.emit({ type: 'status', status: 'error', detail: 'websocket failure' })
    }

    ws.onclose = () => {
      this.emit({ type: 'status', status: 'disconnected' })
      this.ws = null
      this.sessionId = null
    }

    this.ws = ws
  }

  disconnect() {
    this.ws?.close()
    this.ws = null
    this.sessionId = null
  }

  spawn(payload: { cwd?: string; command?: string; cols: number; rows: number }) {
    this.send({ type: 'spawn', ...payload })
  }

  input(data: string) {
    if (!this.sessionId) return
    this.send({ type: 'input', sessionId: this.sessionId, data })
  }

  resize(cols: number, rows: number) {
    if (!this.sessionId) return
    this.send({ type: 'resize', sessionId: this.sessionId, cols, rows })
  }

  closeSession() {
    if (!this.sessionId) return
    this.send({ type: 'close', sessionId: this.sessionId })
  }

  private send(payload: unknown) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify(payload))
  }
}
