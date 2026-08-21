import { execFile, spawn, spawnSync, type ChildProcess } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import { createAuthenticationTicket } from "./auth";
import { decryptCookie, getSettings } from "./store";

const execFileAsync = promisify(execFile);
const PLAYER = "RobloxPlayerBeta.exe";

export async function listProcessPids(imageName: string): Promise<number[]> {
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
    return pids;
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

export function resolveRobloxPlayer(): string | null {
  const settings = getSettings();
  if (settings.useDefaultRobloxFolder) {
    return newestPlayerIn(defaultRobloxVersionsDir());
  }
  const custom = (settings.robloxPlayerPath || "").trim();
  if (!custom) {
    return null;
  }
  if (existsSync(custom) && custom.toLowerCase().endsWith(".exe")) {
    return custom;
  }
  return newestPlayerIn(custom);
}

async function waitForNewPid(before: number[], timeoutMs = 25000): Promise<number> {
  const start = Date.now();
  let candidate: number | null = null;
  let seenAt = 0;
  while (Date.now() - start < timeoutMs) {
    const now = await listProcessPids(PLAYER);
    const fresh = now.filter((p) => !before.includes(p) && isPidAlive(p));
    if (fresh.length) {
      const pid = fresh[fresh.length - 1];
      if (candidate !== pid) {
        candidate = pid;
        seenAt = Date.now();
      } else if (Date.now() - seenAt >= 600) {
        return pid;
      }
    } else {
      candidate = null;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error("Roblox started but a second client did not stay open.");
}

function unlockHelperPath(): string | null {
  const candidates = [
    join(__dirname, "../../build/roblox-unlock.exe"),
    join(process.resourcesPath || "", "roblox-unlock.exe"),
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

function releaseRobloxSingleton(): void {
  const exe = unlockHelperPath();
  if (!exe) {
    return;
  }
  spawnSync(exe, [], { windowsHide: true, timeout: 4000, stdio: "ignore" });
}

export function beginSingletonWatch(): void {
  watchRefs += 1;
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
  });
}

export function endSingletonWatch(): void {
  watchRefs = Math.max(0, watchRefs - 1);
  if (watchRefs > 0) {
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

export async function launchAccount(cookieEnc: string): Promise<number> {
  const settings = getSettings();
  const exe = resolveRobloxPlayer();
  if (!exe) {
    throw new Error(
      settings.useDefaultRobloxFolder
        ? "RobloxPlayerBeta.exe not found in the default Roblox Versions folder."
        : "RobloxPlayerBeta.exe not found in the custom folder. Pick a folder that contains it, or use Default folder.",
    );
  }
  const cookie = decryptCookie(cookieEnc);
  const ticket = await createAuthenticationTicket(cookie);
  beginSingletonWatch();
  try {
    releaseRobloxSingleton();
    const before = await listProcessPids(PLAYER);
    if (before.length > 0 && !unlockHelperPath()) {
      throw new Error("Cannot start another client: multi-client helper is missing. Rebuild the app.");
    }
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
      { detached: true, stdio: "ignore", windowsHide: false },
    );
    child.unref();
    return await waitForNewPid(before);
  } finally {
    endSingletonWatch();
  }
}

export async function closePid(pid: number): Promise<void> {
  await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"]).catch(() => undefined);
}
