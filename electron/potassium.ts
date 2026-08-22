import { spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import { execFile } from "child_process";
import { listProcessPids } from "./roblox";
import { getSettings } from "./store";
import type { PotassiumStatus } from "../shared/types";

const execFileAsync = promisify(execFile);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processBaseName(name: string): string {
  return name.replace(/\.exe$/i, "");
}

export async function potassiumStatus(): Promise<PotassiumStatus> {
  const names = getSettings().potassiumProcessNames.filter(Boolean);
  let running = false;
  for (const name of names) {
    const pids = await listProcessPids(name);
    if (pids.length) {
      running = true;
      break;
    }
  }
  return { running, names };
}

export async function resolvePotassiumExe(): Promise<string | null> {
  const names = getSettings().potassiumProcessNames.filter(Boolean);
  for (const name of names) {
    const base = processBaseName(name);
    try {
      const { stdout } = await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `(Get-Process -Name '${base.replace(/'/g, "''")}' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path)`,
        ],
        { windowsHide: true },
      );
      const path = String(stdout || "").trim();
      if (path && existsSync(path)) {
        return path;
      }
    } catch {
      /* try next name */
    }
  }

  const local = process.env.LOCALAPPDATA || "";
  const candidates = [
    join(local, "Potassium", "Potassium.exe"),
    join(local, "Programs", "Potassium", "Potassium.exe"),
    join(local, "Potassium", "Potassium", "Potassium.exe"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function buildDefaultAttachCommand(exe: string): string {
  return `"${exe}" --attach {pid}`;
}

function splitCommand(command: string): { exe: string; args: string[] } {
  const matches = command.match(/"[^"]+"|\S+/g) || [];
  const parts = matches.map((p) => p.replace(/^"|"$/g, ""));
  const exe = parts.shift() || "";
  return { exe, args: parts };
}

function runAttachCommand(command: string): boolean {
  const { exe, args } = splitCommand(command);
  if (!exe) {
    return false;
  }
  const child = spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: true, shell: false });
  child.unref();
  return true;
}

export async function attachIfRequested(pid: number, accountLabel: string): Promise<string | null> {
  const settings = getSettings();
  if (!settings.attachOnLaunch) {
    return null;
  }

  const status = await potassiumStatus();
  if (!status.running) {
    return "Attach skipped: Potassium is not running.";
  }

  let cmd = (settings.attachCommand || "").trim();
  if (!cmd) {
    const exe = await resolvePotassiumExe();
    if (!exe) {
      return "Attach skipped: set Attach command in Settings (could not find Potassium.exe).";
    }
    cmd = buildDefaultAttachCommand(exe);
  }

  const expanded = cmd
    .replaceAll("{pid}", String(pid))
    .replaceAll("{account}", accountLabel);

  let lastError: string | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      await sleep(1200 * attempt);
    }
    try {
      if (!runAttachCommand(expanded)) {
        lastError = "Attach skipped: attach command is empty.";
        continue;
      }
      return null;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return lastError ? `Attach failed: ${lastError}` : "Attach failed after retries.";
}
