import type { AccountPublic, HiveSession } from "../shared/types";
import type { HiveFanoutBatch } from "./useHiveTarget";

type SendMany = (
  op: string,
  payload?: Record<string, unknown>,
  timeoutMs?: number,
) => Promise<HiveFanoutBatch | null>;

type JoinCandidate = {
  id: string;
  placeId: number;
  seaName?: string;
};

type AfterBootCommand = {
  op: string;
  payload?: Record<string, unknown>;
};

type AssignUniqueOptions = {
  afterBoot?: AfterBootCommand;
};

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
  return hop.sort((a, b) => a.userId - b.userId);
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

function reservedJobIds(
  connected: AccountPublic[],
  sessions: HiveSession[],
  hopAccountIds: Set<string>,
): Set<string> {
  const reserved = new Set<string>();
  for (const { account, session } of sessionsForConnected(connected, sessions)) {
    const jobId = session?.jobId?.trim();
    if (!jobId || hopAccountIds.has(account.id)) {
      continue;
    }
    reserved.add(jobId);
  }
  return reserved;
}

async function browseJoinCandidates(
  browseAccountId: string,
  excludeJobIds: string[],
): Promise<JoinCandidate[]> {
  const res = await window.ram.hiveSend({
    accountId: browseAccountId,
    op: "server.browse",
    payload: { excludeJobIds, limit: 40 },
    timeoutMs: 30000,
  });
  const servers = res.data?.data?.servers;
  if (!Array.isArray(servers)) {
    return [];
  }
  return servers.filter(
    (row): row is JoinCandidate =>
      typeof row === "object" &&
      row !== null &&
      typeof (row as JoinCandidate).id === "string" &&
      typeof (row as JoinCandidate).placeId === "number",
  );
}

async function waitForAccountUnique(
  account: AccountPublic,
  connected: AccountPublic[],
  timeoutMs = 45000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sessions = await window.ram.hiveStatus();
    const mySession = sessions.find((s) => s.userId === account.userId);
    const myJob = mySession?.jobId?.trim();
    if (!myJob) {
      await sleep(2000);
      continue;
    }
    const shared = connected.some((other) => {
      if (other.userId === account.userId) {
        return false;
      }
      const session = sessions.find((s) => s.userId === other.userId);
      return session?.jobId?.trim() === myJob;
    });
    if (!shared) {
      return true;
    }
    await sleep(2000);
  }
  return false;
}

async function waitForHiveBooted(accountId: string, timeoutMs = 90000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await window.ram.hiveSend({ accountId, op: "status", timeoutMs: 15000 });
    if (res.ok && res.data?.data?.bootComplete === true) {
      return true;
    }
    await sleep(3000);
  }
  return false;
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

export async function assignUniqueServers(
  connected: AccountPublic[],
  sessions: HiveSession[],
  onToast: (msg: string) => void,
  options: AssignUniqueOptions = {},
): Promise<{ assigned: number; hoppedAccountIds: Set<string> }> {
  const hopAccounts = accountsToHopForDedupe(connected, sessions);
  const hoppedAccountIds = new Set<string>();
  if (hopAccounts.length === 0) {
    return { assigned: 0, hoppedAccountIds };
  }

  const browseAccountId = connected[0]?.id;
  if (!browseAccountId) {
    return { assigned: 0, hoppedAccountIds };
  }

  const hopAccountIds = new Set(hopAccounts.map((a) => a.id));
  const reserved = reservedJobIds(connected, sessions, hopAccountIds);
  let assigned = 0;
  const joinPayloadBase: Record<string, unknown> = {
    quiet: true,
    claim: true,
    reason: "hive-dedupe",
  };
  if (options.afterBoot) {
    joinPayloadBase.afterBoot = options.afterBoot;
  }

  for (const account of hopAccounts) {
    hoppedAccountIds.add(account.id);
    const excludeJobIds = [...reserved];
    const candidates = await browseJoinCandidates(browseAccountId, excludeJobIds);
    let joined = false;

    for (const pick of candidates) {
      const res = await window.ram.hiveSend({
        accountId: account.id,
        op: "travel.join",
        payload: {
          ...joinPayloadBase,
          placeId: pick.placeId,
          jobId: pick.id,
          seaName: pick.seaName,
        },
        timeoutMs: 35000,
      });
      if (res.ok && res.data?.ok) {
        reserved.add(pick.id);
        joined = true;
        assigned += 1;
        break;
      }
      excludeJobIds.push(pick.id);
      reserved.add(pick.id);
    }

    if (!joined) {
      onToast(`Fallback hop for @${account.username}…`);
      await window.ram.hiveSend({
        accountId: account.id,
        op: "travel.hop",
        payload: {
          quiet: true,
          noStagger: true,
          reason: "hive-dedupe-fallback",
          ...(options.afterBoot ? { afterBoot: options.afterBoot } : {}),
        },
        timeoutMs: 35000,
      });
      assigned += 1;
    }

    await waitForAccountUnique(account, connected, 45000);
    sessions = await window.ram.hiveStatus();
  }

  if (options.afterBoot && hoppedAccountIds.size > 0) {
    onToast("Waiting for hopped clients to reload CloudFarm…");
    for (const accountId of hoppedAccountIds) {
      await waitForHiveBooted(accountId, 90000);
    }
  }

  return { assigned, hoppedAccountIds };
}

export async function dedupeServers(
  connected: AccountPublic[],
  sessions: HiveSession[],
  onToast?: (msg: string) => void,
): Promise<{ hopped: number; batch: HiveFanoutBatch | null }> {
  const hopAccounts = accountsToHopForDedupe(connected, sessions);
  if (hopAccounts.length === 0) {
    return { hopped: 0, batch: null };
  }
  const { assigned } = await assignUniqueServers(connected, sessions, onToast || (() => undefined));
  return { hopped: assigned, batch: null };
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

async function ensureUniqueServersBeforeFarm(
  connected: AccountPublic[],
  onToast: (msg: string) => void,
  options: AssignUniqueOptions = {},
): Promise<Set<string>> {
  let sessions = await window.ram.hiveStatus();
  const dupN = duplicateJobCount(connected, sessions);
  if (dupN <= 0) {
    return new Set<string>();
  }
  onToast(`Same server detected — assigning unique servers for ${dupN} client${dupN === 1 ? "" : "s"}…`);
  const { hoppedAccountIds } = await assignUniqueServers(connected, sessions, onToast, options);
  const ok = await waitForUniqueServers(connected, 45000);
  sessions = await window.ram.hiveStatus();
  if (!ok && duplicateJobCount(connected, sessions) > 0) {
    onToast("Still waiting on unique servers — starting anyway.");
  } else if (ok) {
    onToast("Each client is on its own server.");
  }
  return hoppedAccountIds;
}

async function sendPresetToReadyAccounts(
  connected: AccountPublic[],
  skippedAccountIds: Set<string>,
  presetName: string,
): Promise<HiveFanoutBatch | null> {
  const targets = connected.filter((account) => !skippedAccountIds.has(account.id));
  if (targets.length === 0) {
    return null;
  }
  const res = await window.ram.hiveSendMany({
    accountIds: targets.map((account) => account.id),
    op: "preset.apply",
    payload: { name: presetName },
    timeoutMs: 30000,
  });
  return res.ok && res.data ? { dropped: res.data.dropped, results: res.data.results } : null;
}

export async function startPlaylistWithDedupe(
  connected: AccountPublic[],
  sendMany: SendMany,
  onToast: (msg: string) => void,
): Promise<HiveFanoutBatch | null> {
  await ensureUniqueServersBeforeFarm(connected, onToast);
  return sendMany("jobs.start", { job: "afk_playlist" }, 30000);
}

export async function startFarmingStackWithDedupe(
  connected: AccountPublic[],
  _sendMany: SendMany,
  onToast: (msg: string) => void,
): Promise<HiveFanoutBatch | null> {
  const afterBoot = { op: "preset.apply", payload: { name: "farming_stack" } };
  const hoppedAccountIds = await ensureUniqueServersBeforeFarm(connected, onToast, { afterBoot });
  if (hoppedAccountIds.size > 0) {
    onToast("Hopped clients will auto-start farming stack after CloudFarm reloads.");
  }
  return sendPresetToReadyAccounts(connected, hoppedAccountIds, "farming_stack");
}
