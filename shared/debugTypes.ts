export type DebugLevel = "info" | "warn" | "error" | "perf";

export type DebugCategory =
  | "hive"
  | "ipc"
  | "perf"
  | "launch"
  | "watcher"
  | "ui"
  | "toast"
  | "system";

export type DebugEvent = {
  id: string;
  ts: number;
  level: DebugLevel;
  category: DebugCategory;
  message: string;
  detail?: Record<string, unknown>;
  durationMs?: number;
};

export type DebugStats = {
  totalEvents: number;
  sinceTs: number;
  hiveCommands: number;
  hiveTimeouts: number;
  hiveErrors: number;
  avgHiveLatencyMs: number;
  maxHiveLatencyMs: number;
  mainStalls: number;
  rendererStalls: number;
  ipcCalls: number;
  watcherScans: number;
};

export type DebugMonitorApi = {
  record: (
    category: DebugCategory,
    message: string,
    opts?: { level?: DebugLevel; detail?: Record<string, unknown>; durationMs?: number },
  ) => void;
  getEvents: (limit?: number) => DebugEvent[];
  getStats: () => DebugStats;
  clear: () => void;
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => boolean;
  attachWindow: (push: (channel: string, payload: unknown) => void) => void;
  startMainLoopWatch: () => void;
  startRendererWatch: () => void;
};
