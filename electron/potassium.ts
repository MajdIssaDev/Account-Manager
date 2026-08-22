import { spawn } from "child_process";
import { existsSync, mkdirSync, unlinkSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { promisify } from "util";
import { execFile as execFileCb } from "child_process";
import { listProcessPids } from "./roblox";
import { getSettings } from "./store";
import type { PotassiumStatus } from "../shared/types";

const execFileAsync = promisify(execFileCb);
const AUTOEXEC_SCRIPT = "AccountManager_Cloud.lua";
const POTASSIUM_IMAGE = "Potassium.exe";

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

function potassiumAutoexecPath(): string {
  return join(potassiumDir(), "autoexec", AUTOEXEC_SCRIPT);
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
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, `${JSON.stringify(value, null, 4)}\n`, "utf8");
}

function autoAttachEnabledIn(settings: Record<string, unknown>): boolean {
  return settings.auto_attach === true || settings.autoAttach === true;
}

export function removeManagedAutoexec(): void {
  const path = potassiumAutoexecPath();
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  }
}

export function syncPotassiumAttachPreference(enabled: boolean): { previousAutoAttach: boolean } {
  const dir = potassiumDir();
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      return { previousAutoAttach: false };
    }
  }
  const settingsPath = potassiumSettingsPath();
  const next = readJsonObject(settingsPath);
  const previousAutoAttach = autoAttachEnabledIn(next);
  next.auto_attach = enabled;
  next.autoAttach = enabled;
  next.auto_inject = enabled;
  next.autoInject = enabled;
  writeJsonObject(settingsPath, next);
  removeManagedAutoexec();
  return { previousAutoAttach };
}

export async function potassiumStatus(): Promise<PotassiumStatus> {
  const names = getSettings().potassiumProcessNames.filter(Boolean);
  const check = names.length ? names : [POTASSIUM_IMAGE];
  let running = false;
  for (const name of check) {
    const pids = await listProcessPids(name);
    if (pids.length) {
      running = true;
      break;
    }
  }
  return { running, names: check };
}

export async function resolvePotassiumExe(): Promise<string | null> {
  const names = getSettings().potassiumProcessNames.filter(Boolean);
  const check = names.length ? names : [POTASSIUM_IMAGE];
  for (const name of check) {
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

const UIA_ATTACH_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
$proc = Get-Process -Name 'Potassium' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { exit 1 }
$root = [System.Windows.Automation.AutomationElement]::RootElement
$pidCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$proc.Id)
$scope = [System.Windows.Automation.TreeScope]::Descendants
$clicked = $false
function Invoke-Named($el) {
  try {
    $pat = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    if ($pat) { $pat.Invoke(); return $true }
  } catch {}
  return $false
}
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $pidCond)
if ($wins.Count -eq 0) {
  $one = $root.FindFirst($scope, $pidCond)
  if ($one) { $wins = @($one) }
}
foreach ($win in $wins) {
  $btnType = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
  $buttons = $win.FindAll($scope, $btnType)
  foreach ($b in $buttons) {
    $name = [string]$b.Current.Name
    if ($name -match '(?i)attach to running' -or ($name -match '(?i)attach' -and $name -notmatch '(?i)detach')) {
      if (Invoke-Named $b) { $clicked = $true; break }
    }
  }
  if ($clicked) { break }
  $all = $win.FindAll($scope, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($el in $all) {
    $name = [string]$el.Current.Name
    if ($name -match '(?i)attach to running clients') {
      if (Invoke-Named $el) { $clicked = $true; break }
    }
  }
  if ($clicked) { break }
}
if ($clicked) { exit 0 }
exit 3
`.trim();

let lastAttachClickAt = 0;
let attachClickInflight: Promise<boolean> | null = null;

async function clickPotassiumAttachUi(): Promise<boolean> {
  if (attachClickInflight) {
    return attachClickInflight;
  }
  if (Date.now() - lastAttachClickAt < 2000) {
    return true;
  }
  attachClickInflight = (async () => {
    try {
      await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", UIA_ATTACH_SCRIPT],
        { windowsHide: true, timeout: 8000 },
      );
      lastAttachClickAt = Date.now();
      return true;
    } catch {
      return false;
    } finally {
      attachClickInflight = null;
    }
  })();
  return attachClickInflight;
}

async function stopPotassium(): Promise<void> {
  const names = getSettings().potassiumProcessNames.filter(Boolean);
  const check = names.length ? names : [POTASSIUM_IMAGE];
  for (const name of check) {
    const pids = await listProcessPids(name);
    for (const pid of pids) {
      await execFileAsync("taskkill", ["/PID", String(pid), "/F"]).catch(() => undefined);
    }
  }
  for (let i = 0; i < 20; i++) {
    if (!(await potassiumStatus()).running) {
      return;
    }
    await sleep(150);
  }
}

async function spawnPotassium(): Promise<string | null> {
  const exe = await resolvePotassiumExe();
  if (!exe) {
    return "Attach skipped: Potassium.exe not found.";
  }
  spawn(exe, [], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  for (let i = 0; i < 24; i++) {
    await sleep(250);
    if ((await potassiumStatus()).running) {
      await sleep(400);
      return null;
    }
  }
  return "Attach skipped: Potassium did not start.";
}

export async function ensurePotassiumRunning(): Promise<string | null> {
  const settings = getSettings();
  if (!settings.attachOnLaunch) {
    removeManagedAutoexec();
    return null;
  }
  const { previousAutoAttach } = syncPotassiumAttachPreference(true);
  const status = await potassiumStatus();
  const robloxPids = await listProcessPids("RobloxPlayerBeta.exe");
  // Potassium only reads auto_attach at startup. Restart it when turning the
  // setting on, but never while Roblox clients are already open (that detaches them).
  if (status.running && !previousAutoAttach && robloxPids.length === 0) {
    await stopPotassium();
    syncPotassiumAttachPreference(true);
    const err = await spawnPotassium();
    if (err) {
      return err;
    }
    return null;
  }
  if (status.running) {
    return null;
  }
  return spawnPotassium();
}

export type AttachOptions = {
  background?: boolean;
};

export async function attachIfRequested(
  pid: number,
  accountLabel: string,
  _userId?: number,
  opts: AttachOptions = {},
): Promise<string | null> {
  const settings = getSettings();
  if (!settings.attachOnLaunch) {
    return null;
  }

  const startErr = await ensurePotassiumRunning();
  if (startErr) {
    return startErr;
  }

  const exe = await resolvePotassiumExe();
  let cmd = (settings.attachCommand || "").trim();
  if (cmd) {
    const expanded = cmd.split("{pid}").join(String(pid)).split("{account}").join(accountLabel);
    await runAttachCommand(expanded);
  } else if (exe) {
    await runAttachCommand(`"${exe}" --attach ${pid}`);
  }

  await sleep(900);
  let clicked = await clickPotassiumAttachUi();
  if (!clicked) {
    await sleep(1500);
    clicked = await clickPotassiumAttachUi();
  }
  if (!clicked) {
    await sleep(2000);
    await clickPotassiumAttachUi();
  }

  if (opts.background) {
    return null;
  }
  return null;
}
