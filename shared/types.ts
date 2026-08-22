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
  bootGeneration?: number;
  serverVerdict?: HiveServerVerdict;
  serverReason?: string;
  threatLevel?: number;
  path: string;
};

export type HiveServerVerdict = "good" | "bad" | "neutral" | "unknown";

export type HiveServerReport = {
  robloxUserId: number;
  username?: string;
  verdict: HiveServerVerdict;
  reason?: string;
  at: number;
  threatLevel?: number;
  chestOpened?: number;
  farmRunning?: boolean;
};

export type HiveServerLedgerEntry = {
  placeId: number;
  jobId: string;
  verdict: HiveServerVerdict;
  good: number;
  bad: number;
  neutral: number;
  reports: HiveServerReport[];
  updatedAt: number;
  path: string;
  latestReason?: string;
};

export type HiveCatalogControl = {
  id: string;
  label: string;
  category: string;
  controlType: string;
  toggleId?: string;
  default?: number;
  min?: number;
  max?: number;
  isInt?: boolean;
  primaryButtonId?: string;
  indexedOnly?: boolean;
  remote: "toggle" | "slider" | "button" | "job" | "unsupported" | string;
  jobId?: string;
};

export const HIVE_STARTABLE_JOBS: { id: string; label: string }[] = [
  { id: "chest_farm", label: "Chest farm" },
  { id: "background_fish", label: "Background fish" },
  { id: "passive_income", label: "Passive income" },
  { id: "afk_playlist", label: "AFK playlist" },
  { id: "mass_sell", label: "Mass sell" },
  { id: "kill_boss", label: "Kill boss" },
  { id: "kill_dragon", label: "Kill dragon" },
  { id: "kill_sea", label: "Kill sea" },
  { id: "treasure_chart", label: "Treasure chart" },
  { id: "progress_story", label: "Progress story" },
  { id: "progress_story_engine", label: "Story engine" },
];

export type HiveSessionPatch = {
  userId: number;
  fields: Partial<Pick<HiveSession, "liveness" | "jobId" | "serverVerdict" | "placeId" | "threatLevel" | "bootGeneration" | "sessionId">>;
};

export type HiveLivenessDelta = {
  userId: number;
  hiveStatus: HiveLiveness;
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

export const CHEST_FARM_SPEEDS = ["Slowest", "Slow", "Default", "Fast"] as const;
export type ChestFarmSpeed = (typeof CHEST_FARM_SPEEDS)[number];

export type FarmingStackConfig = {
  speedPreset: ChestFarmSpeed;
  fish: boolean;
  passive: boolean;
};

export const DEFAULT_FARMING_STACK: FarmingStackConfig = {
  speedPreset: "Default",
  fish: true,
  passive: true,
};

export function normalizeFarmingStack(raw?: Partial<FarmingStackConfig> | null): FarmingStackConfig {
  const speed = raw?.speedPreset;
  const ok = CHEST_FARM_SPEEDS.includes(speed as ChestFarmSpeed);
  return {
    speedPreset: ok ? (speed as ChestFarmSpeed) : DEFAULT_FARMING_STACK.speedPreset,
    fish: raw?.fish !== false,
    passive: raw?.passive !== false,
  };
}

export function farmingStackHivePayload(cfg: FarmingStackConfig): Record<string, unknown> {
  const stack = normalizeFarmingStack(cfg);
  return {
    name: "farming_stack",
    speedPreset: stack.speedPreset,
    fish: stack.fish,
    passive: stack.passive,
    chest: { speedPreset: stack.speedPreset },
  };
}

export function describeFarmingStack(cfg: FarmingStackConfig): string {
  const stack = normalizeFarmingStack(cfg);
  const parts = [stack.speedPreset];
  if (stack.fish) {
    parts.push("fishing");
  }
  if (stack.passive) {
    parts.push("passive");
  }
  if (!stack.fish && !stack.passive) {
    parts.push("chest only");
  }
  return parts.join(" · ");
}

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
  farmingStack: FarmingStackConfig;
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
