export type DockSide = 'bottom' | 'right'

export function calcMainUIStyle(side: DockSide, size: number): Record<string, string> {
  const common = {
    position: 'fixed',
    zIndex: '2000',
    overflow: 'hidden',
    background: 'var(--ls-secondary-background-color, var(--ls-primary-background-color, #111))'
  }

  if (side === 'right') {
    return {
      ...common,
      // explicit resets so previous "bottom" values don't leak
      left: 'auto',
      bottom: 'auto',
      borderTop: 'none',

      top: 'var(--ls-headbar-height, 40px)',
      right: '0',
      width: `${size}px`,
      height: 'calc(100vh - var(--ls-headbar-height, 40px))',
      boxShadow: '-8px 0 16px rgba(0,0,0,0.2)',
      borderLeft: '1px solid var(--ls-border-color, #333)'
    }
  }

  return {
    ...common,
    // explicit resets so previous "right" values don't leak
    top: 'auto',
    width: 'auto',
    borderLeft: 'none',

    left: '0',
    right: '0',
    bottom: '0',
    height: `${size}px`,
    boxShadow: '0 -8px 16px rgba(0,0,0,0.2)',
    borderTop: '1px solid var(--ls-border-color, #333)'
  }
}
