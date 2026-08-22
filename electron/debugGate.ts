import type { BrowserWindow, IpcMain } from "electron";
import type { DebugMonitorApi } from "../shared/debugTypes";

const noop: DebugMonitorApi = {
  record: () => undefined,
  getEvents: () => [],
  getStats: () => ({
    totalEvents: 0,
    sinceTs: Date.now(),
    hiveCommands: 0,
    hiveTimeouts: 0,
    hiveErrors: 0,
    avgHiveLatencyMs: 0,
    maxHiveLatencyMs: 0,
    mainStalls: 0,
    rendererStalls: 0,
    ipcCalls: 0,
    watcherScans: 0,
  }),
  clear: () => undefined,
  setEnabled: () => undefined,
  isEnabled: () => false,
  attachWindow: () => undefined,
  startMainLoopWatch: () => undefined,
  startRendererWatch: () => undefined,
};

let monitor: DebugMonitorApi = noop;
let loaded = false;

function loadMonitor(): DebugMonitorApi {
  if (loaded) {
    return monitor;
  }
  loaded = true;
  try {
    // Local-only debug bundle (gitignored). Falls back to no-op when missing.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    monitor = require("./debug/monitor").default as DebugMonitorApi;
  } catch {
    monitor = noop;
  }
  return monitor;
}

export function debugMonitor(): DebugMonitorApi {
  return loadMonitor();
}

export function tryStartLocalDebug(mainWindow: BrowserWindow | null, ipcMain: IpcMain): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const register = require("./debug/register") as typeof import("./debug/register");
    register.tryInitLocalDebug(mainWindow, ipcMain);
  } catch {
    /* local debug/register not present */
  }
}
