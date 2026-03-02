import type { ITheme } from '@xterm/xterm'

export const THEME_PROPS = [
  '--ls-primary-background-color',
  '--ls-secondary-background-color',
  '--ls-tertiary-background-color',
  '--ls-border-color',
  '--ls-primary-text-color',
  '--ls-secondary-text-color',
  '--ls-selection-background-color',
  '--ls-a-chosen-bg',
  '--ls-active-primary-color',
  '--ls-link-text-color',
  '--ls-link-text-hover-color',
  '--ls-color-file-sync-error',
  '--ls-color-file-sync-pending',
  '--ls-color-file-sync-idle',
  '--ls-font-family'
] as const

export type ThemeTokenMap = Record<string, string | undefined>

const DEFAULTS = {
  bg: '#111827',
  fg: '#e5e7eb',
  accent: '#3b82f6',
  error: '#ef4444',
  pending: '#f59e0b',
  idle: '#22c55e'
}

function toRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim()
  const normalized = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean.slice(0, 6)

  const n = Number.parseInt(normalized, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function fromRgb([r, g, b]: [number, number, number]): string {
  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${toHex(Math.max(0, Math.min(255, Math.round(r))))}${toHex(Math.max(0, Math.min(255, Math.round(g))))}${toHex(Math.max(0, Math.min(255, Math.round(b))))}`
}

function parseColor(v: string | undefined, fallback: string): string {
  if (!v) return fallback
  const value = v.trim()
  if (value.startsWith('#')) return value
  const rgb = value.match(/rgba?\(([^)]+)\)/i)
  if (rgb) {
    const [r, g, b] = rgb[1].split(',').slice(0, 3).map((x) => Number.parseFloat(x.trim()))
    return fromRgb([r || 0, g || 0, b || 0])
  }
  return fallback
}

function mix(c1: string, c2: string, w: number): string {
  const a = toRgb(parseColor(c1, c1))
  const b = toRgb(parseColor(c2, c2))
  return fromRgb([
    a[0] * (1 - w) + b[0] * w,
    a[1] * (1 - w) + b[1] * w,
    a[2] * (1 - w) + b[2] * w
  ])
}

function shift(c: string, delta: number): string {
  const [r, g, b] = toRgb(parseColor(c, c))
  const f = delta > 0 ? 255 : 0
  const amt = Math.abs(delta)
  return fromRgb([
    r + (f - r) * amt,
    g + (f - g) * amt,
    b + (f - b) * amt
  ])
}

export function buildXtermTheme(tokens: ThemeTokenMap, mode: 'dark' | 'light' = 'dark'): ITheme {
  const bg = parseColor(tokens['--ls-primary-background-color'], DEFAULTS.bg)
  const fg = parseColor(tokens['--ls-primary-text-color'], DEFAULTS.fg)
  const accent = parseColor(tokens['--ls-active-primary-color'] || tokens['--ls-link-text-color'], DEFAULTS.accent)

  const red = parseColor(tokens['--ls-color-file-sync-error'], DEFAULTS.error)
  const yellow = parseColor(tokens['--ls-color-file-sync-pending'], DEFAULTS.pending)
  const green = parseColor(tokens['--ls-color-file-sync-idle'], DEFAULTS.idle)

  const blue = parseColor(tokens['--ls-link-text-color'], accent)
  const selection = parseColor(tokens['--ls-selection-background-color'] || tokens['--ls-a-chosen-bg'], mix(bg, fg, 0.25))

  const brighten = mode === 'dark' ? 0.18 : 0.1

  return {
    background: bg,
    foreground: fg,
    cursor: accent,
    cursorAccent: bg,
    selectionBackground: selection,

    black: mix(fg, bg, 0.78),
    red,
    green,
    yellow,
    blue,
    magenta: mix(blue, red, 0.5),
    cyan: mix(blue, green, 0.5),
    white: mix(fg, bg, 0.12),

    brightBlack: mix(fg, bg, 0.62),
    brightRed: shift(red, brighten),
    brightGreen: shift(green, brighten),
    brightYellow: shift(yellow, brighten),
    brightBlue: parseColor(tokens['--ls-link-text-hover-color'], shift(blue, brighten)),
    brightMagenta: shift(mix(blue, red, 0.5), brighten),
    brightCyan: shift(mix(blue, green, 0.5), brighten),
    brightWhite: shift(mix(fg, bg, 0.12), brighten)
  }
}

export async function resolveThemeTokens(): Promise<ThemeTokenMap> {
  const ls = (globalThis as any).logseq
  if (ls?.UI?.resolveThemeCssPropsVals) {
    const resolved = await ls.UI.resolveThemeCssPropsVals(THEME_PROPS as unknown as string[])
    return resolved || {}
  }

  const css = getComputedStyle(document.documentElement)
  const map: ThemeTokenMap = {}
  for (const p of THEME_PROPS) {
    map[p] = css.getPropertyValue(p)?.trim()
  }
  return map
}
