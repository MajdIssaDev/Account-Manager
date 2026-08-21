import { contextBridge, ipcRenderer } from "electron";
import type {
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
  launch: (id: string): Promise<IpcResult<{ pid: number }>> =>
    ipcRenderer.invoke("accounts:launch", id),
  close: (id: string): Promise<IpcResult> => ipcRenderer.invoke("accounts:close", id),
  focus: (id: string): Promise<IpcResult> => ipcRenderer.invoke("accounts:focus", id),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke("settings:get"),
  setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke("settings:set", patch),
  potassiumStatus: (): Promise<PotassiumStatus> => ipcRenderer.invoke("potassium:status"),
  getUpdateState: (): Promise<UpdateState> => ipcRenderer.invoke("updater:state"),
  checkUpdates: (): Promise<UpdateState> => ipcRenderer.invoke("updater:check"),
  downloadUpdate: (): Promise<UpdateState> => ipcRenderer.invoke("updater:download"),
  installUpdate: (): Promise<UpdateState> => ipcRenderer.invoke("updater:install"),
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
};

contextBridge.exposeInMainWorld("ram", api);

export type RamApi = typeof api;
