import type { AccountPublic, HiveSession } from "../shared/types";
import type { HiveFanoutBatch } from "./useHiveTarget";

type SendMany = (
  op: string,
  payload?: Record<string, unknown>,
  timeoutMs?: number,
) => Promise<HiveFanoutBatch | null>;

export function sessionsForConnected(
  connected: AccountPublic[],
  sessions: HiveSession[],
): { account: AccountPublic; session: HiveSession | undefined }[] {
  return connected.map((account) => ({
    account,
    session: sessions.find((s) => s.userId === account.userId),
  }));
}

export function groupByJobId(connected: AccountPublic[], sessions: HiveSession[]): Map<string, AccountPublic[]> {
  const map = new Map<string, AccountPublic[]>();
  for (const { account, session } of sessionsForConnected(connected, sessions)) {
    const jobId = session?.jobId?.trim();
    if (!jobId) {
      continue;
    }
    const list = map.get(jobId) || [];
    list.push(account);
    map.set(jobId, list);
  }
  return map;
}

export function accountsToHopForDedupe(connected: AccountPublic[], sessions: HiveSession[]): AccountPublic[] {
  const hop: AccountPublic[] = [];
  for (const group of groupByJobId(connected, sessions).values()) {
    if (group.length <= 1) {
      continue;
    }
    const sorted = [...group].sort((a, b) => a.userId - b.userId);
    hop.push(...sorted.slice(1));
  }
  return hop;
}

export function duplicateJobCount(connected: AccountPublic[], sessions: HiveSession[]): number {
  let n = 0;
  for (const group of groupByJobId(connected, sessions).values()) {
    if (group.length > 1) {
      n += group.length - 1;
    }
  }
  return n;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function waitForUniqueServers(
  connected: AccountPublic[],
  timeoutMs = 45000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sessions = await window.ram.hiveStatus();
    if (accountsToHopForDedupe(connected, sessions).length === 0) {
      return true;
    }
    await sleep(2000);
  }
  return false;
}

export async function dedupeServers(
  connected: AccountPublic[],
  sessions: HiveSession[],
): Promise<{ hopped: number; batch: HiveFanoutBatch | null }> {
  const hopAccounts = accountsToHopForDedupe(connected, sessions);
  if (hopAccounts.length === 0) {
    return { hopped: 0, batch: null };
  }
  const targeted = await window.ram.hiveSendMany({
    accountIds: hopAccounts.map((a) => a.id),
    op: "travel.hop",
    payload: { quiet: true, reason: "hive-dedupe" },
    timeoutMs: 35000,
  });
  return {
    hopped: hopAccounts.length,
    batch:
      targeted.ok && targeted.data
        ? { dropped: targeted.data.dropped, results: targeted.data.results }
        : null,
  };
}

export async function loadFpsCapState(accountId: string): Promise<{ enabled: boolean; cap: number }> {
  const [farm, unfocused, slider] = await Promise.all([
    window.ram.hiveSend({ accountId, op: "toggle.get", payload: { key: "FarmFpsCapBtn" }, timeoutMs: 12000 }),
    window.ram.hiveSend({ accountId, op: "toggle.get", payload: { key: "UnfocusedFpsCapBtn" }, timeoutMs: 12000 }),
    window.ram.hiveSend({ accountId, op: "slider.get", payload: { id: "UnfocusedFpsCapValue" }, timeoutMs: 12000 }),
  ]);
  const farmOn = farm.data?.data?.on === true;
  const unfocusedOn = unfocused.data?.data?.on === true;
  const cap = Number(slider.data?.data?.value);
  return {
    enabled: farmOn || unfocusedOn,
    cap: Number.isFinite(cap) ? Math.max(15, Math.min(60, Math.floor(cap))) : 20,
  };
}

export async function applyFpsCap(
  sendMany: SendMany,
  enabled: boolean,
  cap: number,
): Promise<HiveFanoutBatch | null> {
  const value = Math.max(15, Math.min(60, Math.floor(cap)));
  if (enabled) {
    await sendMany("slider.set", { id: "UnfocusedFpsCapValue", value });
    await sendMany("toggle.set", { key: "FarmFpsCapBtn", on: true });
    return sendMany("toggle.set", { key: "UnfocusedFpsCapBtn", on: true });
  }
  await sendMany("toggle.set", { key: "FarmFpsCapBtn", on: false });
  return sendMany("toggle.set", { key: "UnfocusedFpsCapBtn", on: false });
}

export async function startPlaylistWithDedupe(
  connected: AccountPublic[],
  sendMany: SendMany,
  onToast: (msg: string) => void,
): Promise<HiveFanoutBatch | null> {
  let sessions = await window.ram.hiveStatus();
  const dupN = duplicateJobCount(connected, sessions);
  if (dupN > 0) {
    onToast(`Same server detected — hopping ${dupN} client${dupN === 1 ? "" : "s"}…`);
    await dedupeServers(connected, sessions);
    const ok = await waitForUniqueServers(connected, 45000);
    sessions = await window.ram.hiveStatus();
    if (!ok && duplicateJobCount(connected, sessions) > 0) {
      onToast("Still waiting on unique servers — starting playlist anyway.");
    } else if (ok) {
      onToast("Each client is on its own server.");
    }
  }
  return sendMany("jobs.start", { job: "afk_playlist" }, 30000);
}
