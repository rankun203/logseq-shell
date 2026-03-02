export type DockSide = 'bottom' | 'right'

export function calcMainUIStyle(side: DockSide, size: number): string {
  if (side === 'right') {
    return [
      'position:fixed',
      'top:40px',
      'right:0',
      `width:${size}px`,
      'height:calc(100vh - 40px)',
      'z-index: 2000',
      'box-shadow: -8px 0 16px rgba(0,0,0,0.2)',
      'border-left: 1px solid var(--ls-border-color, #333)',
      'background: var(--ls-primary-background-color, #111)',
      'overflow: hidden'
    ].join(';')
  }

  return [
    'position:fixed',
    'left:0',
    'right:0',
    'bottom:0',
    `height:${size}px`,
    'z-index: 2000',
    'box-shadow: 0 -8px 16px rgba(0,0,0,0.2)',
    'border-top: 1px solid var(--ls-border-color, #333)',
    'background: var(--ls-primary-background-color, #111)',
    'overflow: hidden'
  ].join(';')
}
