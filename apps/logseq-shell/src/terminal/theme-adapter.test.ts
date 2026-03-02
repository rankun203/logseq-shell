import { describe, it, expect } from 'vitest'
import { buildXtermTheme } from './theme-adapter'

describe('theme adapter', () => {
  it('maps core logseq tokens into xterm theme', () => {
    const theme = buildXtermTheme({
      '--ls-primary-background-color': '#0f172a',
      '--ls-primary-text-color': '#e2e8f0',
      '--ls-link-text-color': '#3b82f6',
      '--ls-selection-background-color': '#334155',
      '--ls-color-file-sync-error': '#ef4444',
      '--ls-color-file-sync-pending': '#f59e0b',
      '--ls-color-file-sync-idle': '#22c55e'
    }, 'dark')

    expect(theme.background).toBe('#0f172a')
    expect(theme.foreground).toBe('#e2e8f0')
    expect(theme.blue).toBe('#3b82f6')
    expect(theme.red).toBe('#ef4444')
    expect(theme.yellow).toBe('#f59e0b')
    expect(theme.green).toBe('#22c55e')
    expect(theme.selectionBackground).toBe('#334155')
  })

  it('has deterministic defaults when tokens are missing', () => {
    const theme = buildXtermTheme({}, 'dark')
    expect(theme.background).toBe('#111827')
    expect(theme.foreground).toBe('#e5e7eb')
    expect(theme.cursor).toBeDefined()
    expect(theme.brightBlue).toBeDefined()
  })
})
