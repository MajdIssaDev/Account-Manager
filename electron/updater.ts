import { app, BrowserWindow, shell } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateState } from "../shared/types";
import {
  GITHUB_LATEST_RELEASE_URL,
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_REPO_SLUG,
} from "../shared/github";
import { getSettings } from "./store";

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease = false;

let mainWindow: BrowserWindow | null = null;
let lastInfoVersion: string | null = null;
let lastDownloadUrl: string | null = null;

const state: UpdateState = {
  currentVersion: app.getVersion(),
  latestVersion: null,
  status: "idle",
  message: "Not checked yet.",
  percent: 0,
  packaged: app.isPackaged,
  canInstall: false,
  downloadUrl: null,
};

function emit(): void {
  mainWindow?.webContents.send("updater:state", { ...state });
}

export function getUpdateState(): UpdateState {
  return { ...state };
}

export function attachUpdaterWindow(win: BrowserWindow | null): void {
  mainWindow = win;
}

export function canInstallUpdates(): boolean {
  return app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR;
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Account-Manager",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token =
    getSettings().githubToken?.trim() ||
    process.env.GH_TOKEN ||
    process.env.GITHUB_TOKEN ||
    "";
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function applyFeed(): void {
  const token = getSettings().githubToken?.trim() || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  autoUpdater.setFeedURL({
    provider: "github",
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    private: true,
    ...(token ? { token } : {}),
  });
}

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, "").split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, "").split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) {
      return 1;
    }
    if (da < db) {
      return -1;
    }
  }
  return 0;
}

function markUpToDate(latest: string): void {
  state.status = "up-to-date";
  state.latestVersion = latest;
  state.percent = 0;
  state.canInstall = false;
  state.downloadUrl = null;
  state.message = `You're up to date (v${state.currentVersion}).`;
  emit();
}

function markAvailable(latest: string, downloadUrl: string | null): void {
  lastInfoVersion = latest;
  lastDownloadUrl = downloadUrl;
  state.status = "available";
  state.latestVersion = latest;
  state.percent = 0;
  state.canInstall = canInstallUpdates();
  state.downloadUrl = downloadUrl;
  state.message = state.canInstall
    ? `Version ${latest} is available on GitHub.`
    : `Version ${latest} is available. Get the new installer from GitHub Releases.`;
  emit();
}

async function fetchGithubLatest(): Promise<{ version: string; downloadUrl: string | null }> {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO_SLUG}/releases/latest`, {
    headers: githubHeaders(),
  });
  if (res.status === 404) {
    throw Object.assign(new Error(`No GitHub releases found for ${GITHUB_REPO_SLUG}.`), {
      code: "NO_RELEASE",
    });
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `GitHub returned ${res.status}. This private repo needs access — open ${GITHUB_LATEST_RELEASE_URL} while signed in, or add a read-only GitHub token in Settings.`,
    );
  }
  if (!res.ok) {
    throw new Error(`GitHub releases check failed (${res.status}).`);
  }
  const json = (await res.json()) as {
    tag_name?: string;
    html_url?: string;
    assets?: { name?: string; browser_download_url?: string }[];
  };
  const version = (json.tag_name || "").replace(/^v/i, "");
  if (!version) {
    throw new Error("GitHub latest release has no tag.");
  }
  const setup = json.assets?.find(
    (a) => /setup/i.test(a.name || "") && /\.exe$/i.test(a.name || "") && !/portable/i.test(a.name || ""),
  );
  const anyExe = json.assets?.find((a) => /\.exe$/i.test(a.name || "") && !/portable/i.test(a.name || ""));
  return {
    version,
    downloadUrl: setup?.browser_download_url || anyExe?.browser_download_url || json.html_url || GITHUB_LATEST_RELEASE_URL,
  };
}

export async function checkForUpdates(): Promise<UpdateState> {
  state.currentVersion = app.getVersion();
  state.packaged = app.isPackaged;
  state.status = "checking";
  state.message = `Checking GitHub (${GITHUB_REPO_SLUG})…`;
  state.percent = 0;
  emit();

  try {
    applyFeed();
    const remote = await fetchGithubLatest();
    if (compareVersions(remote.version, state.currentVersion) <= 0) {
      markUpToDate(remote.version);
      return getUpdateState();
    }
    markAvailable(remote.version, remote.downloadUrl);
    const settings = getSettings();
    if (state.canInstall && settings.autoDownloadUpdates) {
      await downloadUpdate();
    }
    return getUpdateState();
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "NO_RELEASE") {
      markUpToDate(state.currentVersion);
      state.message = `You're on v${state.currentVersion}. No GitHub release has been published yet.`;
      emit();
      return getUpdateState();
    }
    state.status = "error";
    state.message = err instanceof Error ? err.message : String(err);
    emit();
    return getUpdateState();
  }
}

export async function downloadUpdate(): Promise<UpdateState> {
  const openFallback = async () => {
    await shell.openExternal(lastDownloadUrl || GITHUB_LATEST_RELEASE_URL);
    state.message = "Opened the GitHub release page for the installer.";
    emit();
  };

  if (!canInstallUpdates()) {
    await openFallback();
    return getUpdateState();
  }
  if (state.status !== "available" && state.status !== "ready" && state.status !== "error") {
    await checkForUpdates();
  }
  if (state.status === "up-to-date") {
    return getUpdateState();
  }
  try {
    applyFeed();
    state.status = "downloading";
    state.message = "Downloading update from GitHub…";
    state.percent = 0;
    emit();
    await autoUpdater.checkForUpdates();
    await autoUpdater.downloadUpdate();
    return getUpdateState();
  } catch {
    await openFallback();
    state.status = "available";
    return getUpdateState();
  }
}

export function installUpdate(): UpdateState {
  if (!canInstallUpdates()) {
    state.status = "error";
    state.message = "This build cannot self-update. Install the new setup from GitHub Releases.";
    emit();
    return getUpdateState();
  }
  autoUpdater.quitAndInstall(false, true);
  return getUpdateState();
}

export function initUpdater(): void {
  state.currentVersion = app.getVersion();
  state.packaged = app.isPackaged;
  state.canInstall = canInstallUpdates();

  autoUpdater.on("download-progress", (progress) => {
    state.status = "downloading";
    state.percent = Math.round(progress.percent);
    state.message = `Downloading update… ${state.percent}%`;
    emit();
  });

  autoUpdater.on("update-downloaded", (info) => {
    state.status = "ready";
    state.latestVersion = info.version || lastInfoVersion;
    state.percent = 100;
    state.canInstall = true;
    state.message = `Version ${state.latestVersion} is downloaded. Restart to install.`;
    emit();
  });

  autoUpdater.on("error", (err) => {
    if (state.status === "up-to-date" || state.status === "available" || state.status === "ready") {
      return;
    }
    state.status = "error";
    state.message = err.message || String(err);
    emit();
  });
}

export async function maybeAutoCheck(): Promise<void> {
  if (!getSettings().autoCheckUpdates) {
    state.status = "idle";
    state.message = `Running v${state.currentVersion}.`;
    emit();
    return;
  }
  await checkForUpdates();
}
