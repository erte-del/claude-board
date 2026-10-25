// Colour presets for the chat terminal. "default" keeps what the app always had (xterm's palette on #1e1e1e). The others are the
// published palettes of those themes, typed in by hand, so a shade may be a little off from the original.
export type TermTheme = Record<string, string>
const ansi = (c: string[], b: string[]) => Object.fromEntries(['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'].flatMap((n, i) => [[n, c[i]], [`bright${n[0].toUpperCase()}${n.slice(1)}`, b[i]]]))

export const TERM_THEMES: { id: string; label: string; theme: TermTheme }[] = [
  { id: 'default', label: 'Default (dark)', theme: { background: '#1e1e1e' } },
  { id: 'dracula', label: 'Dracula', theme: { background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', selectionBackground: '#44475a', ...ansi(['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2'], ['#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff']) } },
  { id: 'solarized-dark', label: 'Solarized Dark', theme: { background: '#002b36', foreground: '#839496', cursor: '#93a1a1', selectionBackground: '#073642', ...ansi(['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5'], ['#586e75', '#cb4b16', '#93a1a1', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3']) } },
  { id: 'one-dark', label: 'One Dark', theme: { background: '#282c34', foreground: '#abb2bf', cursor: '#528bff', selectionBackground: '#3e4451', ...ansi(['#3f4451', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#d7dae0'], ['#4f5666', '#ff616e', '#a5e075', '#f0a45d', '#4dc4ff', '#de73ff', '#4cd1e0', '#e6e6e6']) } },
  { id: 'github-dark', label: 'GitHub Dark', theme: { background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff', selectionBackground: '#264f78', ...ansi(['#484f58', '#ff7b72', '#3fb950', '#d29922', '#58a6ff', '#bc8cff', '#39c5cf', '#b1bac4'], ['#6e7681', '#ffa198', '#56d364', '#e3b341', '#79c0ff', '#d2a8ff', '#56d4dd', '#f0f6fc']) } },
  { id: 'macos-dark', label: 'macOS Dark (Pro)', theme: { background: '#000000', foreground: '#f2f2f2', cursor: '#4d4d4d', selectionBackground: '#414141', ...ansi(['#000000', '#990000', '#00a600', '#999900', '#0000b2', '#b200b2', '#00a6b2', '#bfbfbf'], ['#666666', '#e50000', '#00d900', '#e5e500', '#0000ff', '#e500e5', '#00e5e5', '#e5e5e5']) } },
  { id: 'macos-light', label: 'macOS Light (Basic)', theme: { background: '#ffffff', foreground: '#000000', cursor: '#000000', selectionBackground: '#b3d7ff', ...ansi(['#000000', '#990000', '#00a600', '#999900', '#0000b2', '#b200b2', '#00a6b2', '#bfbfbf'], ['#666666', '#e50000', '#00d900', '#e5e500', '#0000ff', '#e500e5', '#00e5e5', '#e5e5e5']) } },
]

/** The theme for a saved id; an unknown id (a preset removed later, a hand-edited file) falls back to the default. */
export const termTheme = (id: string | undefined): TermTheme => (TERM_THEMES.find((t) => t.id === id) ?? TERM_THEMES[0]).theme
