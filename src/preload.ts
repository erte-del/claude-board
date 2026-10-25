import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { SessionInfo } from './scanner.mts'
import type { ChatInfo, Layout, Settings } from './types'

const api = {
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('pickFolder'),
  resolveDir: (input: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> => ipcRenderer.invoke('resolveDir', input),
  newChat: (cwd: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> => ipcRenderer.invoke('newChat', cwd),
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
  killChat: (id: string): Promise<void> => ipcRenderer.invoke('killChat', id),
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
