// Apps a card can open its folder in. The renderer only ever names one of these ids; the folder comes from the chat, never from the page.
export const EDITORS = [
  { id: 'code', label: 'VS Code', app: 'Visual Studio Code' },
  { id: 'cursor', label: 'Cursor', app: 'Cursor' },
  { id: 'terminal', label: 'Terminal', app: 'Terminal' },
] as const
export type EditorId = (typeof EDITORS)[number]['id']

/** Which of them are installed (an .app bundle in one of the usual places). */
export function installedEditors(exists: (p: string) => boolean, home: string) {
  return EDITORS.filter((e) => [`/Applications/${e.app}.app`, `${home}/Applications/${e.app}.app`, `/System/Applications/Utilities/${e.app}.app`, `/Applications/Utilities/${e.app}.app`].some(exists))
}
