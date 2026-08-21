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
};

export type AppSettings = {
  robloxPlayerPath: string;
  attachOnLaunch: boolean;
  potassiumProcessNames: string[];
  attachCommand: string;
  autoCheckUpdates: boolean;
  autoDownloadUpdates: boolean;
  githubToken: string;
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
