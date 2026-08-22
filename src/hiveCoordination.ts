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
  onHoppedReady?: (account: AccountPublic) => Promise<void>;
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

const SEA_PLACE_IDS = new Set([12604352060, 15449776494]);

let farmingStackInFlight = false;

async function snapshotInSea(accounts: AccountPublic[]): Promise<AccountPublic[]> {
  const sessions = await window.ram.hiveStatus();
  return accounts.filter((account) => {
    const session = sessions.find((s) => s.userId === account.userId);
    return !!(session?.placeId && SEA_PLACE_IDS.has(session.placeId) && session.liveness === "connected");
  });
}

async function waitForAnyInSea(accounts: AccountPublic[], timeoutMs = 20000): Promise<AccountPublic[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await snapshotInSea(accounts);
    if (ready.length > 0) {
      return ready;
    }
    await sleep(1500);
  }
  return snapshotInSea(accounts);
}

async function applyFarmingStack(account: AccountPublic): Promise<boolean> {
  const res = await window.ram.hiveSend({
    accountId: account.id,
    op: "preset.apply",
    payload: { name: "farming_stack" },
    timeoutMs: 25000,
  });
  return res.ok === true && res.data?.ok === true;
}

function isSoloInSea(account: AccountPublic, connected: AccountPublic[], sessions: HiveSession[]): boolean {
  const mine = sessions.find((s) => s.userId === account.userId);
  const jobId = mine?.jobId?.trim();
  if (!jobId || !mine?.placeId || !SEA_PLACE_IDS.has(mine.placeId) || mine.liveness !== "connected") {
    return false;
  }
  return !connected.some((other) => {
    if (other.userId === account.userId) {
      return false;
    }
    return sessions.find((s) => s.userId === other.userId)?.jobId?.trim() === jobId;
  });
}

async function applyFarmingStackWithRetry(account: AccountPublic, attempts = 8): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const sessions = await window.ram.hiveStatus();
    const mine = sessions.find((s) => s.userId === account.userId);
    if (mine?.placeId && SEA_PLACE_IDS.has(mine.placeId) && mine.liveness === "connected") {
      const ok = await applyFarmingStack(account);
      if (ok) {
        return true;
      }
    }
    await sleep(2000);
  }
  return false;
}

function allOccupiedJobIds(connected: AccountPublic[], sessions: HiveSession[]): Set<string> {
  const occupied = new Set<string>();
  for (const { session } of sessionsForConnected(connected, sessions)) {
    const jobId = session?.jobId?.trim();
    if (jobId) {
      occupied.add(jobId);
    }
  }
  return occupied;
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
    const inSea = !!(mySession?.placeId && SEA_PLACE_IDS.has(mySession.placeId) && mySession.liveness === "connected");
    if (!myJob || !inSea) {
      await sleep(1500);
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
    await sleep(1500);
  }
  return false;
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

  let occupied = allOccupiedJobIds(connected, sessions);
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
    const excludeJobIds = [...occupied];
    const candidates = await browseJoinCandidates(browseAccountId, excludeJobIds);
    let joined = false;

    for (const pick of candidates) {
      if (occupied.has(pick.id)) {
        continue;
      }
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
        occupied.add(pick.id);
        joined = true;
        assigned += 1;
        break;
      }
      excludeJobIds.push(pick.id);
      occupied.add(pick.id);
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

    await waitForAccountUnique(account, connected, 25000);
    sessions = await window.ram.hiveStatus();
    occupied = allOccupiedJobIds(connected, sessions);

    if (options.onHoppedReady) {
      await options.onHoppedReady(account);
    } else if (options.afterBoot) {
      await window.ram.hiveSend({
        accountId: account.id,
        op: options.afterBoot.op,
        payload: options.afterBoot.payload || {},
        timeoutMs: 25000,
      });
    }
  }

  if (options.afterBoot && hoppedAccountIds.size > 0) {
    onToast("Hopped clients finished server assignment.");
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
  if (farmingStackInFlight) {
    onToast("Farming stack is already running — wait for hops to finish.");
    return null;
  }
  farmingStackInFlight = true;
  const results: { userId: number; ok: boolean; error?: string }[] = [];
  const started = new Set<string>();
  try {
    let inSea = await snapshotInSea(connected);
    if (inSea.length === 0) {
      onToast("Waiting for a client to enter a sea…");
      inSea = await waitForAnyInSea(connected, 20000);
    }
    if (inSea.length === 0) {
      onToast("No client is in-sea yet — join a sea, then click Farming stack.");
      return null;
    }

    await window.ram.setFarmingStackIntent({
      userIds: connected.map((account) => account.userId),
      active: true,
    });

    const startSolos = async (): Promise<AccountPublic[]> => {
      const sessions = await window.ram.hiveStatus();
      const ready = inSea.filter((account) => !started.has(account.id) && isSoloInSea(account, connected, sessions));
      if (ready.length > 0) {
        onToast(`Starting farm on ${ready.length} solo client${ready.length === 1 ? "" : "s"}…`);
        await Promise.all(
          ready.map(async (account) => {
            started.add(account.id);
            const ok = await applyFarmingStackWithRetry(account);
            results.push({ userId: account.userId, ok, error: ok ? undefined : "preset_failed" });
            if (ok) {
              onToast(`@${account.username} is farming.`);
            }
          }),
        );
      }
      return accountsToHopForDedupe(inSea, sessions).filter((account) => !started.has(account.id));
    };

    const hopAccounts = await startSolos();
    if (hopAccounts.length > 0) {
      onToast(`Moving ${hopAccounts.length} client${hopAccounts.length === 1 ? "" : "s"} off shared servers…`);
      const sessions = await window.ram.hiveStatus();
      await assignUniqueServers(inSea, sessions, onToast, {
        afterBoot: { op: "preset.apply", payload: { name: "farming_stack" } },
        onHoppedReady: async (account) => {
          started.add(account.id);
          const ok = await applyFarmingStackWithRetry(account);
          results.push({ userId: account.userId, ok, error: ok ? undefined : "preset_failed" });
          if (ok) {
            onToast(`@${account.username} is solo — farming started.`);
          }
          await startSolos();
        },
      });
    }

    const deadline = Date.now() + 60000;
    while (started.size < inSea.length && Date.now() < deadline) {
      await startSolos();
      if (started.size >= inSea.length) {
        break;
      }
      await sleep(2000);
    }

    return { dropped: 0, results };
  } finally {
    farmingStackInFlight = false;
  }
}
