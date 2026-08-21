import { execFile, spawn } from "child_process";
import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { app, BrowserWindow } from "electron";
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
let lastAssetId: number | null = null;
let lastAssetName = "Account-Manager-Setup.exe";
let pendingInstaller: string | null = null;
let updaterReady = false;
let checking = false;
let downloading = false;

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
    /* REST + silent apply is the fallback */
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

function markAvailable(latest: string, assetId: number | null, assetName: string): void {
  lastInfoVersion = latest;
  lastAssetId = assetId;
  lastAssetName = assetName;
  state.status = "available";
  state.latestVersion = latest;
  state.percent = 0;
  state.canInstall = canInstallUpdates();
  state.downloadUrl = null;
  state.message = state.canInstall
    ? `Version ${latest} is available. Click to apply the new files, then restart.`
    : `Version ${latest} is available. Portable builds can't patch in place — use the installed app.`;
  emit();
}

function markReady(version: string | null, viaUpdater: boolean): void {
  updaterReady = viaUpdater;
  state.status = "ready";
  state.latestVersion = version || lastInfoVersion;
  state.percent = 100;
  state.canInstall = true;
  state.message = `Version ${state.latestVersion} is ready. Restart to apply the new files.`;
  emit();
}

async function fetchGithubLatest(token: string): Promise<{
  version: string;
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
    assets?: { id?: number; name?: string }[];
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
    markAvailable(remote.version, remote.assetId, remote.assetName);
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      /* download path can still use a silent apply */
    }
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
    throw new Error(`Could not download update (${res.status}).`);
  }
  const dest = join(tmpdir(), filename.replace(/[^\w.-]+/g, "_"));
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) {
    throw new Error("Downloaded update was empty.");
  }
  writeFileSync(dest, buf);
  return dest;
}

function downloadWithUpdater(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (updaterReady) {
      resolve();
      return;
    }
    let settled = false;
    const finishOk = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      autoUpdater.off("update-downloaded", finishOk);
      autoUpdater.off("error", finishErr);
      resolve();
    };
    const finishErr = (err: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      autoUpdater.off("update-downloaded", finishOk);
      autoUpdater.off("error", finishErr);
      reject(err);
    };
    const timer = setTimeout(() => {
      finishErr(new Error("Update download timed out."));
    }, 10 * 60 * 1000);
    autoUpdater.once("update-downloaded", finishOk);
    autoUpdater.once("error", finishErr);
    void autoUpdater.downloadUpdate().catch(finishErr);
  });
}

export async function downloadUpdate(): Promise<UpdateState> {
  if (downloading) {
    return getUpdateState();
  }
  if (state.status !== "available" && state.status !== "ready" && state.status !== "error") {
    await checkForUpdates();
  }
  if (state.status === "up-to-date" || state.status === "ready") {
    return getUpdateState();
  }
  if (!canInstallUpdates()) {
    state.status = "available";
    state.message =
      "This copy can't patch files in place. Install with Setup once; later updates replace files and restart.";
    emit();
    return getUpdateState();
  }

  downloading = true;
  state.status = "downloading";
  state.message = "Downloading new files…";
  state.percent = 5;
  emit();

  try {
    const token = await resolveGithubToken();
    applyFeed(token);
    try {
      await autoUpdater.checkForUpdates();
      await downloadWithUpdater();
      markReady(state.latestVersion, true);
      return getUpdateState();
    } catch {
      if (!token || !lastAssetId) {
        throw new Error("Could not download the update files.");
      }
      pendingInstaller = await downloadAsset(token, lastAssetId, lastAssetName);
      markReady(lastInfoVersion, false);
      return getUpdateState();
    }
  } catch (err) {
    state.status = "error";
    state.message = err instanceof Error ? err.message : String(err);
    emit();
    return getUpdateState();
  } finally {
    downloading = false;
  }
}

export function installUpdate(): UpdateState {
  if (!canInstallUpdates()) {
    state.message = "Updates that replace files only work in the installed app.";
    emit();
    return getUpdateState();
  }
  if (state.status !== "ready") {
    void downloadUpdate().then((next) => {
      if (next.status === "ready") {
        applyDownloadedUpdate();
      }
    });
    return getUpdateState();
  }
  applyDownloadedUpdate();
  return getUpdateState();
}

function applyDownloadedUpdate(): void {
  state.message = "Restarting to apply the new files…";
  emit();
  if (updaterReady) {
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return;
  }
  if (pendingInstaller) {
    const setup = pendingInstaller;
    spawn(setup, ["/S"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    setTimeout(() => app.quit(), 400);
  }
}

export function initUpdater(): void {
  state.currentVersion = app.getVersion();
  state.packaged = app.isPackaged;
  state.canInstall = canInstallUpdates();

  autoUpdater.on("download-progress", (progress) => {
    state.status = "downloading";
    state.percent = Math.round(progress.percent);
    state.message = `Downloading new files… ${state.percent}%`;
    emit();
  });

  autoUpdater.on("update-downloaded", (info) => {
    markReady(info.version || lastInfoVersion, true);
  });

  autoUpdater.on("error", () => {
    /* downloadUpdate handles failures */
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
  if (getSettings().autoDownloadUpdates && state.status === "available" && canInstallUpdates()) {
    await downloadUpdate();
  }
}
