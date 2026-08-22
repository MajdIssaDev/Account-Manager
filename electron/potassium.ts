import { spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import { request as httpRequest } from "http";
import { execFile as execFileCb } from "child_process";
import { listProcessPids } from "./roblox";
import { getSettings } from "./store";
import { hiveWorkspacePath } from "./hive";
import type { PotassiumStatus } from "../shared/types";

const execFileAsync = promisify(execFileCb);

const AUTOEXEC_SCRIPT = "AccountManager_Cloud.lua";
const AUTOEXEC_SOURCE = `-- Account Manager: auto-run CloudFarm after Potassium attaches
repeat task.wait() until game:IsLoaded()
task.wait(1.5)
if isfile("Cloud.lua") then
	loadfile("Cloud.lua")()
elseif isfile("CloudFarm.lua") then
	loadfile("CloudFarm.lua")()
elseif isfile("CloudFarm script folder/init.lua") then
	loadfile("CloudFarm script folder/init.lua")()
end
`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processBaseName(name: string): string {
  return name.replace(/\.exe$/i, "");
}

function potassiumDir(): string {
  return join(process.env.LOCALAPPDATA || "", "Potassium");
}

function potassiumSettingsPath(): string {
  return join(potassiumDir(), "settings.json");
}

function potassiumAutoexecDir(): string {
  return join(potassiumDir(), "autoexec");
}

function readJsonObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeJsonObject(path: string, value: Record<string, unknown>): void {
  writeFileSync(path, `${JSON.stringify(value, null, 4)}\n`, "utf8");
}

export function syncPotassiumAttachPreference(enabled: boolean): void {
  const dir = potassiumDir();
  if (!existsSync(dir)) {
    return;
  }
  const settingsPath = potassiumSettingsPath();
  const next = readJsonObject(settingsPath);
  next.auto_attach = enabled;
  next.autoAttach = enabled;
  writeJsonObject(settingsPath, next);

  if (!enabled) {
    return;
  }
  const autoexecDir = potassiumAutoexecDir();
  if (!existsSync(autoexecDir)) {
    mkdirSync(autoexecDir, { recursive: true });
  }
  const autoexecPath = join(autoexecDir, AUTOEXEC_SCRIPT);
  if (!existsSync(autoexecPath) || readFileSync(autoexecPath, "utf8") !== AUTOEXEC_SOURCE) {
    writeFileSync(autoexecPath, AUTOEXEC_SOURCE, "utf8");
  }
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

function runAttachCommand(command: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const { exe, args } = splitCommand(command);
    if (!exe) {
      resolve({ ok: false, error: "empty command" });
      return;
    }
    const child = spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: true, shell: false });
    child.on("error", (err) => resolve({ ok: false, error: err.message }));
    child.on("spawn", () => {
      child.unref();
      resolve({ ok: true });
    });
  });
}

async function tryHttpAttach(pid: number): Promise<boolean> {
  const paths = [
    `/attach/${pid}`,
    `/api/attach/${pid}`,
    `/v1/attach/${pid}`,
    `/attach?pid=${pid}`,
  ];
  const ports = [8225, 9765, 8080];
  for (const port of ports) {
    for (const path of paths) {
      const ok = await new Promise<boolean>((resolve) => {
        const req = httpRequest(
          {
            hostname: "127.0.0.1",
            port,
            path,
            method: "POST",
            timeout: 1200,
          },
          (res) => {
            res.resume();
            resolve((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300);
          },
        );
        req.on("timeout", () => {
          req.destroy();
          resolve(false);
        });
        req.on("error", () => resolve(false));
        req.end();
      });
      if (ok) {
        return true;
      }
    }
  }
  return false;
}

async function trySpawnAttachVariants(exe: string, pid: number): Promise<boolean> {
  const variants: string[][] = [
    ["--attach", String(pid)],
    ["--pid", String(pid)],
    ["attach", String(pid)],
    ["-a", String(pid)],
  ];
  for (const args of variants) {
    const result = await runAttachCommand(`"${exe}" ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`);
    if (result.ok) {
      return true;
    }
  }
  return false;
}

function hiveSessionPath(userId: number): string {
  return join(hiveWorkspacePath(), "CloudFarmHive", "sessions", `${userId}.json`);
}

async function waitForHiveInjected(userId: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const path = hiveSessionPath(userId);
    if (existsSync(path)) {
      try {
        const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
        const bootComplete = raw.bootComplete === true || (raw.status as Record<string, unknown> | undefined)?.bootComplete === true;
        const connected = raw.connected !== false;
        if (bootComplete && connected) {
          return true;
        }
      } catch {
        /* keep polling */
      }
    }
    await sleep(1500);
  }
  return false;
}

export async function attachIfRequested(
  pid: number,
  accountLabel: string,
  userId?: number,
): Promise<string | null> {
  const settings = getSettings();
  if (!settings.attachOnLaunch) {
    return null;
  }

  syncPotassiumAttachPreference(true);

  let status = await potassiumStatus();
  const exe = await resolvePotassiumExe();
  if (!status.running) {
    if (exe) {
      spawn(exe, [], { detached: true, stdio: "ignore", windowsHide: true }).unref();
      await sleep(3500);
      status = await potassiumStatus();
    }
    if (!status.running) {
      return "Attach skipped: start Potassium first (Account Manager enabled auto-attach + autoexec when possible).";
    }
  }

  await sleep(2000);

  let cmd = (settings.attachCommand || "").trim();
  if (!cmd && exe) {
    cmd = buildDefaultAttachCommand(exe);
  }

  if (cmd) {
    const expanded = cmd.replaceAll("{pid}", String(pid)).replaceAll("{account}", accountLabel);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await sleep(1200 * attempt);
      }
      const result = await runAttachCommand(expanded);
      if (result.ok) {
        break;
      }
    }
  }

  if (exe) {
    await trySpawnAttachVariants(exe, pid);
  }
  await tryHttpAttach(pid);

  if (typeof userId === "number" && userId > 0) {
    const injected = await waitForHiveInjected(userId, 45000);
    if (injected) {
      return null;
    }
  }

  return "Potassium attach not confirmed. Enable Auto Attach in Potassium settings — Account Manager installed autoexec/Cloud.lua loader.";
}
