import { spawn } from "child_process";
import { listProcessPids } from "./roblox";
import { getSettings } from "./store";
import type { PotassiumStatus } from "../shared/types";

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

function splitCommand(command: string): { exe: string; args: string[] } {
  const matches = command.match(/"[^"]+"|\S+/g) || [];
  const parts = matches.map((p) => p.replace(/^"|"$/g, ""));
  const exe = parts.shift() || "";
  return { exe, args: parts };
}

export async function attachIfRequested(pid: number, accountLabel: string): Promise<string | null> {
  const settings = getSettings();
  if (!settings.attachOnLaunch) {
    return null;
  }
  const cmd = (settings.attachCommand || "").trim();
  if (!cmd) {
    return "Attach skipped: set an attach command in Settings.";
  }
  const status = await potassiumStatus();
  if (!status.running) {
    return "Attach skipped: Potassium is not running.";
  }
  const expanded = cmd
    .replaceAll("{pid}", String(pid))
    .replaceAll("{account}", accountLabel);
  const { exe, args } = splitCommand(expanded);
  if (!exe) {
    return "Attach skipped: attach command is empty.";
  }
  const child = spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: true, shell: false });
  child.unref();
  return null;
}
