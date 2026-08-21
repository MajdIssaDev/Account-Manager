import { contextBridge, ipcRenderer } from "electron";
import type {
  AccountLabel,
  AccountPatch,
  AccountPublic,
  AppSettings,
  IpcResult,
  LoginMode,
  PotassiumStatus,
  QuickCreds,
  UpdateState,
} from "../shared/types";

const api = {
  listAccounts: (): Promise<AccountPublic[]> => ipcRenderer.invoke("accounts:list"),
  addCookie: (cookie: string): Promise<IpcResult<AccountPublic>> =>
    ipcRenderer.invoke("accounts:addCookie", cookie),
  openLogin: (mode: LoginMode, creds?: QuickCreds): Promise<IpcResult<AccountPublic>> =>
    ipcRenderer.invoke("accounts:openLogin", mode, creds),
  remove: (id: string): Promise<IpcResult> => ipcRenderer.invoke("accounts:remove", id),
  patchAccount: (id: string, patch: AccountPatch): Promise<IpcResult> =>
    ipcRenderer.invoke("accounts:patch", id, patch),
  launch: (id: string): Promise<IpcResult<{ pid: number }>> =>
    ipcRenderer.invoke("accounts:launch", id),
  launchMany: (ids: string[]): Promise<IpcResult> =>
    ipcRenderer.invoke("accounts:launchMany", ids),
  close: (id: string): Promise<IpcResult> => ipcRenderer.invoke("accounts:close", id),
  focus: (id: string): Promise<IpcResult> => ipcRenderer.invoke("accounts:focus", id),
  createLabel: (name: string, color: string): Promise<IpcResult<AccountLabel>> =>
    ipcRenderer.invoke("labels:create", name, color),
  updateLabel: (id: string, patch: { name?: string; color?: string }): Promise<IpcResult<AccountLabel>> =>
    ipcRenderer.invoke("labels:update", id, patch),
  deleteLabel: (id: string): Promise<IpcResult> => ipcRenderer.invoke("labels:delete", id),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke("settings:get"),
  setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke("settings:set", patch),
  pickRobloxFolder: (): Promise<string | null> => ipcRenderer.invoke("settings:pickRobloxFolder"),
  resolveRoblox: (): Promise<string | null> => ipcRenderer.invoke("settings:resolveRoblox"),
  potassiumStatus: (): Promise<PotassiumStatus> => ipcRenderer.invoke("potassium:status"),
  getUpdateState: (): Promise<UpdateState> => ipcRenderer.invoke("updater:state"),
  checkUpdates: (): Promise<UpdateState> => ipcRenderer.invoke("updater:check"),
  downloadUpdate: (): Promise<UpdateState> => ipcRenderer.invoke("updater:download"),
  installUpdate: (): Promise<UpdateState> => ipcRenderer.invoke("updater:install"),
  minimize: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
  toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke("window:toggleMaximize"),
  closeWindow: (): Promise<void> => ipcRenderer.invoke("window:close"),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke("window:isMaximized"),
  onAccountsChanged: (cb: (accounts: AccountPublic[]) => void): (() => void) => {
    const listener = (_e: unknown, accounts: AccountPublic[]): void => cb(accounts);
    ipcRenderer.on("accounts:changed", listener);
    return () => ipcRenderer.removeListener("accounts:changed", listener);
  },
  onToast: (cb: (message: string) => void): (() => void) => {
    const listener = (_e: unknown, message: string): void => cb(message);
    ipcRenderer.on("toast", listener);
    return () => ipcRenderer.removeListener("toast", listener);
  },
  onUpdateState: (cb: (state: UpdateState) => void): (() => void) => {
    const listener = (_e: unknown, next: UpdateState): void => cb(next);
    ipcRenderer.on("updater:state", listener);
    return () => ipcRenderer.removeListener("updater:state", listener);
  },
  onSettingsChanged: (cb: (settings: AppSettings) => void): (() => void) => {
    const listener = (_e: unknown, next: AppSettings): void => cb(next);
    ipcRenderer.on("settings:changed", listener);
    return () => ipcRenderer.removeListener("settings:changed", listener);
  },
  onMaximized: (cb: (maximized: boolean) => void): (() => void) => {
    const listener = (_e: unknown, maximized: boolean): void => cb(maximized);
    ipcRenderer.on("window:maximized", listener);
    return () => ipcRenderer.removeListener("window:maximized", listener);
  },
};

contextBridge.exposeInMainWorld("ram", api);

export type RamApi = typeof api;
