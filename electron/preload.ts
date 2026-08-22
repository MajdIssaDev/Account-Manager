import { contextBridge, ipcRenderer } from "electron";
import type {
  AccountLabel,
  AccountPatch,
  AccountPublic,
  AppSettings,
  HiveCommandResult,
  HiveSendManyResult,
  HiveServerLedgerEntry,
  HiveSession,
  HiveSessionPatch,
  HiveLivenessDelta,
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
  reorderAccounts: (orderedIds: string[]): Promise<IpcResult> =>
    ipcRenderer.invoke("accounts:reorder", orderedIds),
  launch: (id: string): Promise<IpcResult<{ pid: number }>> =>
    ipcRenderer.invoke("accounts:launch", id),
  launchMany: (ids: string[]): Promise<IpcResult> =>
    ipcRenderer.invoke("accounts:launchMany", ids),
  getLaunchBusy: (): Promise<string[]> => ipcRenderer.invoke("launch:busy"),
  close: (id: string): Promise<IpcResult> => ipcRenderer.invoke("accounts:close", id),
  closeAll: (): Promise<IpcResult<{ closed: number }>> => ipcRenderer.invoke("accounts:closeAll"),
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
  pickHiveFolder: (): Promise<string | null> => ipcRenderer.invoke("settings:pickHiveFolder"),
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
  onLaunchBusy: (cb: (ids: string[]) => void): (() => void) => {
    const listener = (_e: unknown, ids: string[]): void => cb(ids);
    ipcRenderer.on("launch:busy", listener);
    return () => ipcRenderer.removeListener("launch:busy", listener);
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
  hiveStatus: (): Promise<HiveSession[]> => ipcRenderer.invoke("hive:status"),
  hiveLedger: (): Promise<HiveServerLedgerEntry[]> => ipcRenderer.invoke("hive:ledger"),
  hiveWorkspace: (): Promise<string> => ipcRenderer.invoke("hive:workspace"),
  setFarmingStackIntent: (input: { userIds: number[]; active: boolean }): Promise<IpcResult<boolean>> =>
    ipcRenderer.invoke("hive:farmingStackIntent", input),
  hiveSend: (
    input: { userId?: number; accountId?: string; op: string; payload?: Record<string, unknown>; timeoutMs?: number },
  ): Promise<IpcResult<HiveCommandResult>> => ipcRenderer.invoke("hive:send", input),
  hiveSendMany: (
    input: { userIds?: number[]; accountIds?: string[]; op: string; payload?: Record<string, unknown>; timeoutMs?: number },
  ): Promise<IpcResult<{ dropped: number; results: HiveSendManyResult[] }>> =>
    ipcRenderer.invoke("hive:sendMany", input),
  setHivePanelOpen: (open: boolean): Promise<IpcResult<boolean>> =>
    ipcRenderer.invoke("hive:panelOpen", open),
  onHiveChanged: (cb: (sessions: HiveSession[]) => void): (() => void) => {
    const listener = (_e: unknown, sessions: HiveSession[]): void => cb(sessions);
    ipcRenderer.on("hive:changed", listener);
    return () => ipcRenderer.removeListener("hive:changed", listener);
  },
  onHiveLivenessChanged: (cb: (deltas: HiveLivenessDelta[]) => void): (() => void) => {
    const listener = (_e: unknown, deltas: HiveLivenessDelta[]): void => cb(deltas);
    ipcRenderer.on("hive:liveness", listener);
    return () => ipcRenderer.removeListener("hive:liveness", listener);
  },
  onHiveSessionPatch: (cb: (patches: HiveSessionPatch[]) => void): (() => void) => {
    const listener = (_e: unknown, patches: HiveSessionPatch[]): void => cb(patches);
    ipcRenderer.on("hive:sessionPatch", listener);
    return () => ipcRenderer.removeListener("hive:sessionPatch", listener);
  },
  onHiveLedgerChanged: (cb: (entries: HiveServerLedgerEntry[]) => void): (() => void) => {
    const listener = (_e: unknown, entries: HiveServerLedgerEntry[]): void => cb(entries);
    ipcRenderer.on("hive:ledgerChanged", listener);
    return () => ipcRenderer.removeListener("hive:ledgerChanged", listener);
  },
  debugGetEvents: (limit?: number) => ipcRenderer.invoke("debug:getEvents", limit),
  debugGetStats: () => ipcRenderer.invoke("debug:getStats"),
  debugClear: (): Promise<boolean> => ipcRenderer.invoke("debug:clear"),
  debugSetEnabled: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke("debug:setEnabled", enabled),
  debugIsEnabled: (): Promise<boolean> => ipcRenderer.invoke("debug:isEnabled"),
  debugRendererPing: (payload: { driftMs?: number; fps?: number }): Promise<boolean> =>
    ipcRenderer.invoke("debug:rendererPing", payload),
  onDebugEvent: (cb: (event: Record<string, unknown>) => void): (() => void) => {
    const listener = (_e: unknown, event: Record<string, unknown>): void => cb(event);
    ipcRenderer.on("debug:event", listener);
    return () => ipcRenderer.removeListener("debug:event", listener);
  },
  onDebugCleared: (cb: () => void): (() => void) => {
    const listener = (): void => cb();
    ipcRenderer.on("debug:cleared", listener);
    return () => ipcRenderer.removeListener("debug:cleared", listener);
  },
  onMaximized: (cb: (maximized: boolean) => void): (() => void) => {
    const listener = (_e: unknown, maximized: boolean): void => cb(maximized);
    ipcRenderer.on("window:maximized", listener);
    return () => ipcRenderer.removeListener("window:maximized", listener);
  },
};

contextBridge.exposeInMainWorld("ram", api);

export type RamApi = typeof api;
