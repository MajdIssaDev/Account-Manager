import { execFile, spawn } from "child_process";
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

export function findRobloxPlayer(explicitPath?: string): string | null {
  if (explicitPath && existsSync(explicitPath)) {
    return explicitPath;
  }
  const versions = join(process.env.LOCALAPPDATA || "", "Roblox", "Versions");
  if (!existsSync(versions)) {
    return null;
  }
  const candidates: { path: string; mtime: number }[] = [];
  for (const name of readdirSync(versions)) {
    const exe = join(versions, name, PLAYER);
    if (existsSync(exe)) {
      candidates.push({ path: exe, mtime: statSync(exe).mtimeMs });
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.path || null;
}

async function waitForNewPid(before: number[], timeoutMs = 20000): Promise<number> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const now = await listProcessPids(PLAYER);
    const fresh = now.filter((p) => !before.includes(p));
    if (fresh.length) {
      return fresh[fresh.length - 1];
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(
    "Roblox started but a new client PID was not found. If you need two clients, enable multi-instance first.",
  );
}

export async function launchAccount(cookieEnc: string): Promise<number> {
  const settings = getSettings();
  const exe = findRobloxPlayer(settings.robloxPlayerPath || undefined);
  if (!exe) {
    throw new Error("RobloxPlayerBeta.exe not found. Set the path in Settings.");
  }
  const cookie = decryptCookie(cookieEnc);
  const ticket = await createAuthenticationTicket(cookie);
  const before = await listProcessPids(PLAYER);
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
  try {
    return await waitForNewPid(before);
  } catch (err) {
    if (child.pid && isPidAlive(child.pid)) {
      return child.pid;
    }
    throw err;
  }
}

export async function closePid(pid: number): Promise<void> {
  await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"]).catch(() => undefined);
}
