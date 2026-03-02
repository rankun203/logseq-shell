# logseq-shell Theme Mapping (Logseq -> xterm.js)

Status: draft v1

Goal: make terminal visuals feel native inside Logseq across different themes/modes.

## 1) Token source

Primary source (plugin API):
- `logseq.UI.resolveThemeCssPropsVals(props)`

Theme change hooks:
- `logseq.App.onThemeModeChanged(...)`
- (optional) `logseq.App.onThemeChanged(...)`

## 2) xterm theme keys to populate

Required xterm keys:
- `background`
- `foreground`
- `cursor`
- `cursorAccent`
- `selectionBackground`
- ANSI 16 colors:
  - `black red green yellow blue magenta cyan white`
  - `brightBlack brightRed brightGreen brightYellow brightBlue brightMagenta brightCyan brightWhite`

## 3) Direct token mapping

Use these Logseq tokens first:

| xterm key | Logseq token candidates |
|---|---|
| background | `--ls-primary-background-color` |
| foreground | `--ls-primary-text-color` |
| selectionBackground | `--ls-selection-background-color`, fallback `--ls-a-chosen-bg` |
| cursor | `--ls-active-primary-color`, fallback `--ls-link-text-color` |
| cursorAccent | `--ls-primary-background-color` |
| blue | `--ls-link-text-color` |
| brightBlue | `--ls-link-text-hover-color`, fallback lighten(blue) |
| red | `--ls-color-file-sync-error` |
| yellow | `--ls-color-file-sync-pending` |
| green | `--ls-color-file-sync-idle` |

Additional style tokens (non-xterm, panel chrome):
- panel bg: `--ls-secondary-background-color`
- border: `--ls-border-color`
- muted text: `--ls-secondary-text-color`
- hover bg: `--ls-tertiary-background-color`

## 4) Derived colors (when token missing)

Some ANSI colors are not directly exposed by Logseq tokens. Derive with deterministic rules:

- `black` = mix(foreground 22%, background 78%)
- `white` = mix(foreground 88%, background 12%)
- `magenta` = hue-shift(blue, +55deg)
- `cyan` = hue-shift(blue, -35deg)
- `bright*` = lighten(base, 12% for dark mode, 8% for light mode)

If `green/yellow/red` tokens are unavailable, synthesize from accent hues with contrast checks.

## 5) Contrast and accessibility

Enforce minimum contrast checks:
- foreground vs background >= WCAG AA for normal text where practical.
- If contrast fails, nudge foreground toward high-contrast endpoint.

Selection handling:
- ensure selected text remains readable by choosing alpha-adjusted selection color.

## 6) Runtime application flow

1. Resolve token bundle via `resolveThemeCssPropsVals`.
2. Build terminal theme object.
3. Apply to xterm instance immediately.
4. On theme mode/theme change event, repeat steps 1-3.
5. Debounce re-application (e.g., 50-100ms) to avoid flicker during rapid style updates.

## 7) Renderer behavior

- Preferred: `webgl` renderer for heavy output.
- Fallback to canvas/default when context loss or unsupported GPU.
- On renderer switch, re-apply theme object.

## 8) Recommended token query set

```ts
const THEME_PROPS = [
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
]
```

## 9) UX defaults

- `followLogseqTheme = true` by default.
- No independent terminal theme picker unless explicitly enabled by user.
- If custom palette enabled, keep "Sync with Logseq" toggle one click away.
