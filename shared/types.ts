export type AccountLabel = {
  id: string;
  name: string;
  color: string;
  builtin: boolean;
};

export type HiveLiveness = "connected" | "stale" | "offline";

export type AccountPublic = {
  id: string;
  userId: number;
  username: string;
  displayName: string;
  avatarUrl: string;
  lastLoginAt: string | null;
  createdAt: string;
  running: boolean;
  pid: number | null;
  labelIds: string[];
  inactive: boolean;
  sortOrder: number;
  hiveStatus: HiveLiveness;
};

export type ThemeId = "midnight" | "ocean" | "ember" | "forest" | "violet" | "mono";

export type ThemePreset = {
  id: ThemeId;
  name: string;
};

export const THEME_PRESETS: ThemePreset[] = [
  { id: "midnight", name: "Midnight" },
  { id: "ocean", name: "Ocean" },
  { id: "ember", name: "Ember" },
  { id: "forest", name: "Forest" },
  { id: "violet", name: "Violet" },
  { id: "mono", name: "Mono" },
];

export const DEFAULT_LABELS: AccountLabel[] = [
  { id: "label-main", name: "Main", color: "#4f6ef7", builtin: true },
  { id: "label-alt", name: "Alt", color: "#5eead4", builtin: true },
];

export const LABEL_SWATCHES = [
  "#4f6ef7",
  "#5eead4",
  "#f59e0b",
  "#f07178",
  "#a78bfa",
  "#34d399",
  "#fb7185",
  "#38bdf8",
];

export type HiveSession = {
  userId: number;
  liveness: HiveLiveness;
  connected: boolean;
  alive: boolean;
  lastHeartbeatAt: number | null;
  sessionId?: string;
  placeId?: number;
  jobId?: string;
  path: string;
};

export type HiveCommandResult = {
  v: number;
  id: string;
  ok: boolean;
  error?: string;
  data?: Record<string, unknown>;
};

export type HiveSendManyResult = {
  userId: number;
  accountId?: string;
  ok: boolean;
  error?: string;
  skipped?: boolean;
  data?: Record<string, unknown>;
};

export type HiveInventoryItem = {
  name: string;
  amount?: number;
  count?: number;
  rarity?: number;
  category?: string;
  key?: string;
};

export type AppSettings = {
  robloxPlayerPath: string;
  attachOnLaunch: boolean;
  potassiumProcessNames: string[];
  attachCommand: string;
  autoCheckUpdates: boolean;
  autoDownloadUpdates: boolean;
  githubToken: string;
  labels: AccountLabel[];
  themeId: ThemeId;
  tutorialDone: boolean;
  useDefaultRobloxFolder: boolean;
  hiveWorkspacePath: string;
  hiveHeartbeatTtlMs: number;
  hiveRelaunchUi: boolean;
};

export type LoginMode = "login" | "signup" | "quick";

export type QuickCreds = {
  username: string;
  password: string;
};

export type IpcResult<T = void> = {
  ok: boolean;
  error?: string;
  data?: T;
};

export type PotassiumStatus = {
  running: boolean;
  names: string[];
};

export type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "ready"
  | "error";

export type UpdateState = {
  currentVersion: string;
  latestVersion: string | null;
  status: UpdateStatus;
  message: string;
  percent: number;
  packaged: boolean;
  canInstall: boolean;
  downloadUrl: string | null;
};

export type AccountPatch = {
  labelIds?: string[];
  inactive?: boolean;
};
