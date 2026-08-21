import { execFile } from "child_process";
import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
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

const execFileAsync = promisify(execFile);

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease = false;

let mainWindow: BrowserWindow | null = null;
let lastInfoVersion: string | null = null;
let lastDownloadUrl: string | null = null;
let lastAssetId: number | null = null;
let lastAssetName = "Account-Manager-Setup.exe";
let checking = false;

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

async function ghAuthToken(): Promise<string> {
  for (const bin of ["gh.cmd", "gh.exe", "gh"]) {
    try {
      const { stdout } = await execFileAsync(bin, ["auth", "token"], {
        windowsHide: true,
        timeout: 8000,
      });
      const token = stdout.trim();
      if (token) {
        return token;
      }
    } catch {
      /* try next */
    }
  }
  return "";
}

async function resolveGithubToken(): Promise<string> {
  const fromSettings = getSettings().githubToken?.trim() || "";
  if (fromSettings) {
    return fromSettings;
  }
  const fromEnv = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "").trim();
  if (fromEnv) {
    return fromEnv;
  }
  return ghAuthToken();
}

function githubHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Account-Manager",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function applyFeed(token: string): void {
  try {
    autoUpdater.setFeedURL({
      provider: "github",
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      private: true,
      ...(token ? { token } : {}),
    });
  } catch {
    /* GitHub REST download is the primary path */
  }
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

function markAvailable(latest: string, downloadUrl: string | null, assetId: number | null, assetName: string): void {
  lastInfoVersion = latest;
  lastDownloadUrl = downloadUrl;
  lastAssetId = assetId;
  lastAssetName = assetName;
  state.status = "available";
  state.latestVersion = latest;
  state.percent = 0;
  state.canInstall = true;
  state.downloadUrl = downloadUrl;
  state.message = `Version ${latest} is available. Click to install.`;
  emit();
}

async function fetchGithubLatest(token: string): Promise<{
  version: string;
  downloadUrl: string | null;
  assetId: number | null;
  assetName: string;
}> {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO_SLUG}/releases/latest`, {
    headers: githubHeaders(token),
  });
  if (res.status === 404 || res.status === 401 || res.status === 403) {
    throw Object.assign(
      new Error(
        token
          ? `GitHub returned ${res.status} for ${GITHUB_REPO_SLUG}.`
          : `Private GitHub repo — sign in at ${GITHUB_LATEST_RELEASE_URL} or add a token in Settings.`,
      ),
      { code: "GITHUB_DENIED", status: res.status },
    );
  }
  if (!res.ok) {
    throw new Error(`GitHub releases check failed (${res.status}).`);
  }
  const json = (await res.json()) as {
    tag_name?: string;
    html_url?: string;
    assets?: { id?: number; name?: string; browser_download_url?: string }[];
  };
  const version = (json.tag_name || "").replace(/^v/i, "");
  if (!version) {
    throw new Error("GitHub latest release has no tag.");
  }
  const setup = json.assets?.find(
    (a) => /setup/i.test(a.name || "") && /\.exe$/i.test(a.name || "") && !/portable/i.test(a.name || ""),
  );
  const anyExe = json.assets?.find((a) => /\.exe$/i.test(a.name || "") && !/portable/i.test(a.name || ""));
  const asset = setup || anyExe;
  return {
    version,
    downloadUrl: asset?.browser_download_url || json.html_url || GITHUB_LATEST_RELEASE_URL,
    assetId: asset?.id ?? null,
    assetName: asset?.name || `Account-Manager-Setup-${version}.exe`,
  };
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (checking) {
    return getUpdateState();
  }
  checking = true;
  state.currentVersion = app.getVersion();
  state.packaged = app.isPackaged;
  state.status = "checking";
  state.message = `Checking GitHub (${GITHUB_REPO_SLUG})…`;
  state.percent = 0;
  emit();

  try {
    const token = await resolveGithubToken();
    applyFeed(token);
    const remote = await fetchGithubLatest(token);
    if (compareVersions(remote.version, state.currentVersion) <= 0) {
      markUpToDate(remote.version);
      return getUpdateState();
    }
    markAvailable(remote.version, remote.downloadUrl, remote.assetId, remote.assetName);
    return getUpdateState();
  } catch (err) {
    state.status = "error";
    state.message = err instanceof Error ? err.message : String(err);
    emit();
    return getUpdateState();
  } finally {
    checking = false;
  }
}

async function downloadAsset(token: string, assetId: number, filename: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO_SLUG}/releases/assets/${assetId}`, {
    headers: {
      ...githubHeaders(token),
      Accept: "application/octet-stream",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Could not download installer (${res.status}).`);
  }
  const dest = join(tmpdir(), filename.replace(/[^\w.-]+/g, "_"));
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) {
    throw new Error("Downloaded installer was empty.");
  }
  writeFileSync(dest, buf);
  return dest;
}

export async function downloadUpdate(): Promise<UpdateState> {
  const openFallback = async () => {
    await shell.openExternal(lastDownloadUrl || GITHUB_LATEST_RELEASE_URL);
    state.status = state.status === "error" ? "error" : "available";
    state.message = "Opened the GitHub release page. Download the Setup exe there.";
    emit();
  };

  if (state.status !== "available" && state.status !== "ready" && state.status !== "error") {
    await checkForUpdates();
  }
  if (state.status === "up-to-date") {
    return getUpdateState();
  }
  if (state.status === "error") {
    await openFallback();
    return getUpdateState();
  }

  const token = await resolveGithubToken();
  if (token && lastAssetId) {
    try {
      state.status = "downloading";
      state.message = "Downloading installer from GitHub…";
      state.percent = 10;
      emit();
      const dest = await downloadAsset(token, lastAssetId, lastAssetName);
      state.status = "ready";
      state.percent = 100;
      state.message = "Installer downloaded. Opening it now.";
      emit();
      const opened = await shell.openPath(dest);
      if (opened) {
        throw new Error(opened);
      }
      return getUpdateState();
    } catch (err) {
      state.status = "available";
      state.message = err instanceof Error ? err.message : String(err);
      emit();
      await openFallback();
      return getUpdateState();
    }
  }

  await openFallback();
  return getUpdateState();
}

export function installUpdate(): UpdateState {
  void downloadUpdate();
  return getUpdateState();
}

export function initUpdater(): void {
  state.currentVersion = app.getVersion();
  state.packaged = app.isPackaged;
  state.canInstall = true;

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

  autoUpdater.on("error", () => {
    /* REST download handles failures */
  });
}

export async function maybeAutoCheck(): Promise<void> {
  if (!getSettings().autoCheckUpdates) {
    state.status = "idle";
    state.message = `Running v${state.currentVersion}. Click the version chip to check GitHub.`;
    emit();
    return;
  }
  await checkForUpdates();
}
