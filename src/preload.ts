import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { SessionInfo } from './scanner.mts'
import type { ChatInfo, Layout, Settings } from './types'

const api = {
  pasteImage: (): Promise<string | null> => ipcRenderer.invoke('pasteImage'), // saves the clipboard's image, returns its path
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('copyText', text), // for OSC 52 copy requests from a chat
  exportLayout: (layout: Layout): Promise<{ ok: true; path: string } | { ok: false; error?: string }> => ipcRenderer.invoke('exportLayout', layout),
  importLayout: (): Promise<{ ok: true; layout: Layout } | { ok: false; error?: string }> => ipcRenderer.invoke('importLayout'),
  importTermColors: (): Promise<{ ok: true; name: string; theme: Record<string, string> } | { ok: false; error?: string }> => ipcRenderer.invoke('importTermColors'),
  tourSeen: (): Promise<boolean> => ipcRenderer.invoke('tourSeen'),
  markTourSeen: (): Promise<void> => ipcRenderer.invoke('markTourSeen'),
  editors: (): Promise<{ id: string; label: string }[]> => ipcRenderer.invoke('editors'),
  openFolder: (sessionId: string, how: string): Promise<{ ok: true } | { ok: false; error: string }> => ipcRenderer.invoke('openFolder', sessionId, how), // how: 'finder', 'copy' (its folder) or an editor id
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('pickFolder'),
  resolveDir: (input: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> => ipcRenderer.invoke('resolveDir', input),
  newChat: (cwd: string, prompt?: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> => ipcRenderer.invoke('newChat', cwd, prompt),
  forkChat: (sessionId: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> => ipcRenderer.invoke('forkChat', sessionId),
  resumeChat: (sessionId: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> => ipcRenderer.invoke('resumeChat', sessionId),
  listHistory: (): Promise<SessionInfo[]> => ipcRenderer.invoke('listHistory'),
  addChat: (sessionId: string): Promise<{ ok: true } | { ok: false; error: string }> => ipcRenderer.invoke('addChat', sessionId),
  claudeStatus: (): Promise<{ ok: true; path: string } | { ok: false; error: string }> => ipcRenderer.invoke('claudeStatus'),
  openChat: (id: string): Promise<string | null> => ipcRenderer.invoke('openChat', id),
  listChats: (): Promise<ChatInfo[]> => ipcRenderer.invoke('listChats'),
  loadLayout: (): Promise<Layout> => ipcRenderer.invoke('loadLayout'),
  saveLayout: (layout: Layout): Promise<void> => ipcRenderer.invoke('saveLayout', layout),
  loadSettings: (): Promise<Partial<Settings> | null> => ipcRenderer.invoke('loadSettings'),
  saveSettings: (s: Settings): Promise<void> => ipcRenderer.invoke('saveSettings', s),
  killChat: (id: string): Promise<string | null> => ipcRenderer.invoke('killChat', id), // the card's name if this removed it
  undoRemove: (): Promise<{ ok: true; name: string } | { ok: false }> => ipcRenderer.invoke('undoRemove'),
  answerPrompt: (id: string, question: string, answer: 'yes' | 'no'): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('answerPrompt', id, question, answer),
  ptyWrite: (id: string, data: string) => ipcRenderer.send('pty:write', id, data),
  ptyResize: (id: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', id, cols, rows),
  detach: (id?: string) => ipcRenderer.send('detach', id), // one chat's pane closed, or (no id) all of them
  listFonts: (): Promise<{ name: string; regular: string; bold?: string }[]> => ipcRenderer.invoke('listFonts'),
  getPathForFile: (f: File): string => webUtils.getPathForFile(f), // a dropped file's real path (File.path is gone in current Electron)
  onPtyData: (cb: (id: string, data: string) => void) => { ipcRenderer.on('pty:data', (_e, id, d) => cb(id, d)) },
  onOpenChat: (cb: (id: string) => void) => { ipcRenderer.on('open-chat', (_e, id) => cb(id)) },
  onChatsChanged: (cb: (chats: ChatInfo[]) => void) => { ipcRenderer.on('chats:changed', (_e, c) => cb(c)) },
}

contextBridge.exposeInMainWorld('api', api)
export type Api = typeof api
