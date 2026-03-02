export type DockSide = 'bottom' | 'right'

export function calcMainUIStyle(side: DockSide, size: number): Record<string, string> {
  if (side === 'right') {
    return {
      position: 'fixed',
      top: 'var(--ls-headbar-height, 40px)',
      right: '0',
      width: `${size}px`,
      height: 'calc(100vh - var(--ls-headbar-height, 40px))',
      zIndex: '2000',
      boxShadow: '-8px 0 16px rgba(0,0,0,0.2)',
      borderLeft: '1px solid var(--ls-border-color, #333)',
      background: 'var(--ls-primary-background-color, #111)',
      overflow: 'hidden'
    }
  }

  return {
    position: 'fixed',
    left: '0',
    right: '0',
    bottom: '0',
    height: `${size}px`,
    zIndex: '2000',
    boxShadow: '0 -8px 16px rgba(0,0,0,0.2)',
    borderTop: '1px solid var(--ls-border-color, #333)',
    background: 'var(--ls-primary-background-color, #111)',
    overflow: 'hidden'
  }
}
