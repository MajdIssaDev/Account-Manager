import { execFile, spawn, spawnSync, type ChildProcess } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import { createAuthenticationTicket } from "./auth";
import { decryptCookie, getSettings } from "./store";

const execFileAsync = promisify(execFile);
const PLAYER = "RobloxPlayerBeta.exe";
const INSTALLER_NAMES = ["RobloxPlayerInstaller.exe", "RobloxStudioInstaller.exe"];

export async function listProcessPids(imageName: string): Promise<number[]> {
  const fromTasklist = await listPidsViaTasklist(imageName);
  if (fromTasklist.length) {
    return fromTasklist;
  }
  return listPidsViaPowerShell(imageName);
}

async function listPidsViaTasklist(imageName: string): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync("tasklist", [
      "/FI",
      `IMAGENAME eq ${imageName}`,
      "/FO",
      "CSV",
      "/NH",
    ]);
    const pids: number[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const cols = line.match(/"(?:[^"]|"")*"/g);
      if (!cols || cols.length < 2) {
        continue;
      }
      const pid = Number(cols[1].replace(/"/g, ""));
      if (Number.isFinite(pid) && pid > 0) {
        pids.push(pid);
      }
    }
    return Array.from(new Set(pids));
  } catch {
    return [];
  }
}

async function listPidsViaPowerShell(imageName: string): Promise<number[]> {
  const name = imageName.replace(/\.exe$/i, "").replace(/'/g, "");
  if (!name) {
    return [];
  }
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Get-Process -Name '${name}' -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }`,
      ],
      { windowsHide: true, timeout: 6000 },
    );
    const pids: number[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const pid = Number(line.trim());
      if (Number.isFinite(pid) && pid > 0) {
        pids.push(pid);
      }
    }
    return Array.from(new Set(pids));
  } catch {
    return [];
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function isRobloxPlayerPid(pid: number): Promise<boolean> {
  if (!isPidAlive(pid)) {
    return false;
  }
  const pids = await listProcessPids(PLAYER);
  return pids.includes(pid);
}

export function defaultRobloxVersionsDir(): string {
  return join(process.env.LOCALAPPDATA || "", "Roblox", "Versions");
}

function newestPlayerIn(dir: string): string | null {
  if (!existsSync(dir)) {
    return null;
  }
  const direct = join(dir, PLAYER);
  if (existsSync(direct)) {
    return direct;
  }
  const candidates: { path: string; mtime: number }[] = [];
  try {
    for (const name of readdirSync(dir)) {
      const exe = join(dir, name, PLAYER);
      if (existsSync(exe)) {
        candidates.push({ path: exe, mtime: statSync(exe).mtimeMs });
      }
    }
  } catch {
    return null;
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.path || null;
}

export function findRobloxPlayer(explicitPath?: string): string | null {
  if (explicitPath) {
    const trimmed = explicitPath.trim();
    if (trimmed) {
      if (existsSync(trimmed) && trimmed.toLowerCase().endsWith(".exe")) {
        return trimmed;
      }
      const fromCustom = newestPlayerIn(trimmed);
      if (fromCustom) {
        return fromCustom;
      }
    }
  }
  return newestPlayerIn(defaultRobloxVersionsDir());
}

function playerDir(exe: string): string {
  return join(exe, "..");
}

async function runningPlayerExe(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "(Get-Process -Name 'RobloxPlayerBeta' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path)",
      ],
      { windowsHide: true, timeout: 6000 },
    );
    const path = stdout.trim();
    if (path && existsSync(path) && path.toLowerCase().endsWith("robloxplayerbeta.exe")) {
      return path;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function resolveRobloxPlayerForLaunch(): Promise<string | null> {
  const running = await runningPlayerExe();
  if (running) {
    return running;
  }
  return resolveRobloxPlayer();
}

export function resolveRobloxPlayer(): string | null {
  const settings = getSettings();
  const pick = (path: string | null): string | null => {
    if (!path) {
      return null;
    }
    if (!path.toLowerCase().endsWith("robloxplayerbeta.exe")) {
      return null;
    }
    return path;
  };
  if (settings.useDefaultRobloxFolder) {
    return pick(newestPlayerIn(defaultRobloxVersionsDir()));
  }
  const custom = (settings.robloxPlayerPath || "").trim();
  if (!custom) {
    return null;
  }
  if (existsSync(custom) && custom.toLowerCase().endsWith("robloxplayerbeta.exe")) {
    return custom;
  }
  return pick(newestPlayerIn(custom));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Kill installer processes only — never /T, or we also kill RobloxPlayerBeta parents. */
async function killInstallersNow(): Promise<boolean> {
  let killed = false;
  for (const name of INSTALLER_NAMES) {
    const pids = await listProcessPids(name);
    if (!pids.length) {
      continue;
    }
    for (const pid of pids) {
      await execFileAsync("taskkill", ["/PID", String(pid), "/F"]).catch(() => undefined);
      killed = true;
    }
  }
  return killed;
}

/** Kill orphan installer processes once at least one player is already up. */
async function cleanupInstallerSplash(): Promise<void> {
  const players = await listProcessPids(PLAYER);
  if (!players.length) {
    return;
  }
  await killInstallersNow();
}

async function waitUntilAppears(before: number[], timeoutMs = 45000, fast = false): Promise<number> {
  const start = Date.now();
  let candidate: number | null = null;
  let seenAt = 0;
  const holdMs = fast ? 40 : 80;
  const pollMs = fast ? 40 : 60;
  while (Date.now() - start < timeoutMs) {
    const now = await listProcessPids(PLAYER);
    const fresh = now.filter((p) => !before.includes(p) && isPidAlive(p));
    if (fresh.length) {
      const pid = fresh[fresh.length - 1];
      if (candidate !== pid) {
        candidate = pid;
        seenAt = Date.now();
      } else if (Date.now() - seenAt >= holdMs) {
        return pid;
      }
    } else {
      candidate = null;
    }
    await sleep(pollMs);
  }
  throw new Error("Roblox did not start a new client.");
}

async function waitUntilStable(
  initial: number,
  before: number[],
  holdMs = 3500,
  timeoutMs = 45000,
  fast = false,
): Promise<number> {
  if (fast) {
    holdMs = Math.min(holdMs, 180);
  } else {
    holdMs = Math.min(holdMs, 320);
  }
  const start = Date.now();
  let current = initial;
  let heldAt = Date.now();
  let missing = 0;
  const pollMs = fast ? 40 : 60;
  while (Date.now() - start < timeoutMs) {
    const now = await listProcessPids(PLAYER);
    const fresh = now.filter((p) => !before.includes(p) && isPidAlive(p));
    if (!fresh.includes(current)) {
      if (!fresh.length) {
        missing += 1;
        if (missing >= 6) {
          throw new Error("The new client closed before it finished starting.");
        }
      } else {
        missing = 0;
        current = fresh[fresh.length - 1];
        heldAt = Date.now();
      }
    } else if (Date.now() - heldAt >= holdMs) {
      return current;
    } else {
      missing = 0;
    }
    await sleep(pollMs);
  }
  throw new Error("The new client closed before it finished starting.");
}

/** Keep closing ROBLOX_singleton on running clients until the next launch can start. */
async function unlockUntilReady(rounds = 12): Promise<void> {
  if (isPersistentUnlockActive()) {
    releaseRobloxSingleton();
    return;
  }
  const n = Math.min(rounds, 4);
  for (let i = 0; i < n; i++) {
    releaseRobloxSingleton();
    await sleep(40);
  }
}

function unlockHelperPath(): string | null {
  const candidates = [
    join(process.resourcesPath || "", "roblox-unlock.exe"),
    join(__dirname, "../../build/roblox-unlock.exe"),
    join(__dirname, "../build/roblox-unlock.exe"),
  ];
  for (const path of candidates) {
    if (path && existsSync(path)) {
      return path;
    }
  }
  return null;
}

let watcher: ChildProcess | null = null;
let watchRefs = 0;
let persistUnlock = false;

export function isPersistentUnlockActive(): boolean {
  return persistUnlock || (watcher !== null && !watcher.killed);
}

export type LaunchAccountOptions = {
  /** Pre-fetched Roblox auth ticket (skips network round-trip). */
  ticket?: string;
  /** Shorter stability waits when more clients are queued. */
  fast?: boolean;
};

function releaseRobloxSingleton(): void {
  const exe = unlockHelperPath();
  if (!exe) {
    return;
  }
  spawnSync(exe, [], { windowsHide: true, timeout: 4000, stdio: "ignore" });
}

function startWatcher(): void {
  if (watcher && !watcher.killed) {
    return;
  }
  const exe = unlockHelperPath();
  if (!exe) {
    return;
  }
  watcher = spawn(exe, ["--watch"], {
    stdio: ["pipe", "ignore", "ignore"],
    windowsHide: true,
    detached: false,
  });
  watcher.on("exit", () => {
    watcher = null;
    if (persistUnlock || watchRefs > 0) {
      startWatcher();
    }
  });
}

function stopWatcherIfIdle(): void {
  if (persistUnlock || watchRefs > 0) {
    return;
  }
  if (!watcher) {
    return;
  }
  try {
    watcher.stdin?.end();
  } catch {
    /* ignore */
  }
  try {
    watcher.kill();
  } catch {
    /* ignore */
  }
  watcher = null;
}

export function beginSingletonWatch(): void {
  watchRefs += 1;
  startWatcher();
}

export function endSingletonWatch(): void {
  watchRefs = Math.max(0, watchRefs - 1);
  stopWatcherIfIdle();
}

/** Keep multi-client unlock alive while any managed client is running. */
export function setPersistentUnlock(enabled: boolean): void {
  persistUnlock = enabled;
  if (enabled) {
    startWatcher();
    releaseRobloxSingleton();
  } else {
    stopWatcherIfIdle();
  }
}

/** Called between queued launches: unlock existing clients, then wait. */
export async function prepareNextLaunch(): Promise<void> {
  await cleanupInstallerSplash();
  releaseRobloxSingleton();
}

function spawnPlayer(exe: string, ticket: string): void {
  const child = spawn(
    exe,
    [
      "--app",
      "--authenticationUrl",
      "https://auth.roblox.com/v1/authentication-ticket/redeem",
      "--authenticationTicket",
      ticket,
      "--launchtime",
      String(Date.now()),
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
      cwd: playerDir(exe),
    },
  );
  child.unref();
}

export async function launchAccount(cookieEnc: string, opts: LaunchAccountOptions = {}): Promise<number> {
  const fast = opts.fast === true;
  const settings = getSettings();
  const exe = await resolveRobloxPlayerForLaunch();
  if (!exe) {
    throw new Error(
      settings.useDefaultRobloxFolder
        ? "RobloxPlayerBeta.exe not found in the default Roblox Versions folder."
        : "RobloxPlayerBeta.exe not found in the custom folder. Pick a folder that contains it, or use Default folder.",
    );
  }
  if (!exe.toLowerCase().endsWith("robloxplayerbeta.exe")) {
    throw new Error("Launch path must be RobloxPlayerBeta.exe (not the installer).");
  }
  if (!unlockHelperPath()) {
    throw new Error("Cannot start clients: multi-client helper is missing. Rebuild the app.");
  }

  const cookie = decryptCookie(cookieEnc);
  const ticket = opts.ticket?.trim() || (await createAuthenticationTicket(cookie));

  const before = await listProcessPids(PLAYER);
  const hadClients = before.length > 0 || isPersistentUnlockActive();
  beginSingletonWatch();
  try {
    await unlockUntilReady(hadClients ? 2 : 1);
    spawnPlayer(exe, ticket);

    const appeared = await waitUntilAppears(before, 45000, fast);
    const stable = await waitUntilStable(appeared, before, fast ? 180 : 320, 45000, fast);

    void cleanupInstallerSplash();
    releaseRobloxSingleton();
    if (!isPidAlive(stable)) {
      throw new Error("The new client closed before it finished starting.");
    }
    return stable;
  } finally {
    endSingletonWatch();
  }
}

export async function closePid(pid: number): Promise<void> {
  await execFileAsync("taskkill", ["/PID", String(pid), "/F"]).catch(() => undefined);
}

export async function closeAllRoblox(): Promise<number> {
  const pids = await listProcessPids(PLAYER);
  if (pids.length) {
    await execFileAsync("taskkill", ["/IM", PLAYER, "/T", "/F"]).catch(() => undefined);
  }
  await killInstallersNow();
  return pids.length;
}
