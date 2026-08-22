import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  unwatchFile,
  watch,
  writeFileSync,
  type FSWatcher,
} from "fs";
import { basename, dirname, join } from "path";
import { randomUUID } from "crypto";
import type {
  AppSettings,
  HiveCommandResult,
  HiveLiveness,
  HiveSendManyResult,
  HiveServerLedgerEntry,
  HiveServerVerdict,
  HiveSession,
} from "../shared/types";

type HiveHooks = {
  getSettings: () => AppSettings;
  onChange: (sessions: HiveSession[]) => void;
  onLedgerChange: (entries: HiveServerLedgerEntry[]) => void;
};

let hooks: HiveHooks | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let watcher: FSWatcher | null = null;
let ledgerWatcher: FSWatcher | null = null;
let watchedDir = "";
let watchedLedgerDir = "";
let lastFingerprint = "";
let lastLedgerFingerprint = "";
const sessions = new Map<number, HiveSession>();
const ledgerEntries: HiveServerLedgerEntry[] = [];

export function hiveWorkspacePath(settings?: AppSettings): string {
  const explicit = String(settings?.hiveWorkspacePath || hooks?.getSettings().hiveWorkspacePath || "").trim();
  const local = process.env.LOCALAPPDATA || "";
  const candidates = [
    explicit,
    join(local, "Potassium", "workspace", "AO project"),
    join(local, "Potassium", "workspace"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (basename(candidate) === "CloudFarmHive" && existsSync(candidate)) {
      return dirname(candidate);
    }
    if (existsSync(join(candidate, "CloudFarmHive"))) {
      return candidate;
    }
  }
  return explicit || candidates[1] || candidates[0] || "";
}

export function hiveRoot(settings?: AppSettings): string {
  return join(hiveWorkspacePath(settings), "CloudFarmHive");
}

function ttlMs(settings?: AppSettings): number {
  const n = Number((settings || hooks?.getSettings())?.hiveHeartbeatTtlMs);
  return Number.isFinite(n) && n >= 1000 ? n : 5000;
}

function classify(raw: Record<string, unknown>, filePath: string, now: number, ttl: number): HiveSession | null {
  const userId = Number(raw.robloxUserId ?? raw.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    return null;
  }
  const connected = raw.connected !== false;
  const alive = raw.alive !== false;
  const last =
    Number(raw.lastHeartbeatAtMs) ||
    (Number(raw.lastHeartbeatAt) > 1e12 ? Number(raw.lastHeartbeatAt) : Number(raw.lastHeartbeatAt) * 1000) ||
    (Number(raw.updatedAt) > 1e12 ? Number(raw.updatedAt) : Number(raw.updatedAt) * 1000) ||
    0;
  let liveness: HiveLiveness = "connected";
  if (!connected || !alive) {
    liveness = "offline";
  } else if (!last || now - last > ttl) {
    liveness = "stale";
  }
  return {
    userId: Math.floor(userId),
    liveness,
    connected,
    alive,
    lastHeartbeatAt: last || null,
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : undefined,
    placeId: Number(raw.placeId) || undefined,
    jobId: typeof raw.jobId === "string" ? raw.jobId : undefined,
    serverVerdict: typeof raw.serverVerdict === "string" ? (raw.serverVerdict as HiveServerVerdict) : undefined,
    serverReason: typeof raw.serverReason === "string" ? raw.serverReason : undefined,
    threatLevel: Number(raw.threatLevel) || undefined,
    path: filePath,
  };
}

function scan(): HiveSession[] {
  const settings = hooks?.getSettings();
  const root = join(hiveRoot(settings), "sessions");
  const now = Date.now();
  const ttl = ttlMs(settings);
  const next = new Map<number, HiveSession>();
  if (existsSync(root)) {
    let files: string[] = [];
    try {
      files = readdirSync(root).filter((name) => name.toLowerCase().endsWith(".json"));
    } catch {
      files = [];
    }
    for (const name of files) {
      const filePath = join(root, name);
      try {
        const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
        const session = classify(parsed, filePath, now, ttl);
        if (session) {
          next.set(session.userId, session);
        }
      } catch {
        /* skip unreadable session */
      }
    }
  }
  sessions.clear();
  next.forEach((session, id) => {
    sessions.set(id, session);
  });
  return listSessions();
}

function fingerprint(list: HiveSession[]): string {
  return list
    .map((s) => `${s.userId}:${s.liveness}`)
    .sort()
    .join("|");
}

function emitIfChanged(force = false): HiveSession[] {
  const list = scan();
  const next = fingerprint(list);
  if (force || next !== lastFingerprint) {
    lastFingerprint = next;
    hooks?.onChange(list);
  }
  emitLedgerIfChanged(force);
  return list;
}

function attachWatcher(): void {
  const dir = join(hiveRoot(), "sessions");
  if (watchedDir === dir && watcher) {
    return;
  }
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  if (watchedDir) {
    unwatchFile(watchedDir);
  }
  watchedDir = dir;
  if (!existsSync(dir)) {
    return;
  }
  try {
    watcher = watch(dir, { persistent: true }, () => {
      emitIfChanged();
    });
  } catch {
    watcher = null;
  }
}

export function listSessions(): HiveSession[] {
  return Array.from(sessions.values()).sort((a, b) => a.userId - b.userId);
}

function latestReasonFromReports(reports: unknown): string | undefined {
  if (!Array.isArray(reports)) {
    return undefined;
  }
  let bestAt = 0;
  let bestReason: string | undefined;
  for (const row of reports) {
    if (row && typeof row === "object") {
      const at = Number((row as { at?: number }).at) || 0;
      const reason = (row as { reason?: string }).reason;
      if (at >= bestAt && typeof reason === "string" && reason !== "") {
        bestAt = at;
        bestReason = reason;
      }
    }
  }
  return bestReason;
}

function parseLedgerFile(filePath: string): HiveServerLedgerEntry | null {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
    const placeId = Number(parsed.placeId);
    const jobId = typeof parsed.jobId === "string" ? parsed.jobId : "";
    if (!Number.isFinite(placeId) || placeId <= 0 || !jobId) {
      return null;
    }
    const reports = Array.isArray(parsed.reports) ? parsed.reports : [];
    return {
      placeId: Math.floor(placeId),
      jobId,
      verdict: (typeof parsed.verdict === "string" ? parsed.verdict : "unknown") as HiveServerVerdict,
      good: Number(parsed.good) || 0,
      bad: Number(parsed.bad) || 0,
      neutral: Number(parsed.neutral) || 0,
      reports: reports as HiveServerLedgerEntry["reports"],
      updatedAt:
        Number(parsed.updatedAt) > 1e12
          ? Math.floor(Number(parsed.updatedAt) / 1000)
          : Number(parsed.updatedAt) || 0,
      path: filePath,
      latestReason:
        typeof parsed.latestReason === "string"
          ? parsed.latestReason
          : latestReasonFromReports(reports),
    };
  } catch {
    return null;
  }
}

function scanLedger(): HiveServerLedgerEntry[] {
  const root = join(hiveRoot(), "servers");
  const next: HiveServerLedgerEntry[] = [];
  if (!existsSync(root)) {
    ledgerEntries.length = 0;
    return next;
  }
  let placeDirs: string[] = [];
  try {
    placeDirs = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(root, d.name));
  } catch {
    placeDirs = [];
  }
  for (const placeDir of placeDirs) {
    let files: string[] = [];
    try {
      files = readdirSync(placeDir).filter((name) => name.toLowerCase().endsWith(".json"));
    } catch {
      files = [];
    }
    for (const name of files) {
      const entry = parseLedgerFile(join(placeDir, name));
      if (entry) {
        next.push(entry);
      }
    }
  }
  next.sort((a, b) => b.updatedAt - a.updatedAt);
  ledgerEntries.length = 0;
  ledgerEntries.push(...next);
  return next;
}

function ledgerFingerprint(list: HiveServerLedgerEntry[]): string {
  return list
    .map((e) => `${e.placeId}:${e.jobId}:${e.verdict}:${e.updatedAt}`)
    .sort()
    .join("|");
}

function emitLedgerIfChanged(force = false): HiveServerLedgerEntry[] {
  const list = scanLedger();
  const next = ledgerFingerprint(list);
  if (force || next !== lastLedgerFingerprint) {
    lastLedgerFingerprint = next;
    hooks?.onLedgerChange(list);
  }
  return list;
}

function attachLedgerWatcher(): void {
  const dir = join(hiveRoot(), "servers");
  if (watchedLedgerDir === dir && ledgerWatcher) {
    return;
  }
  if (ledgerWatcher) {
    ledgerWatcher.close();
    ledgerWatcher = null;
  }
  watchedLedgerDir = dir;
  if (!existsSync(dir)) {
    return;
  }
  try {
    ledgerWatcher = watch(dir, { persistent: true, recursive: true }, () => {
      emitLedgerIfChanged();
    });
  } catch {
    ledgerWatcher = null;
  }
}

export function listLedger(): HiveServerLedgerEntry[] {
  if (ledgerEntries.length === 0) {
    scanLedger();
  }
  return [...ledgerEntries];
}

export function ledgerSnapshot(): HiveServerLedgerEntry[] {
  return scanLedger();
}

export function getSession(userId: number): HiveSession | undefined {
  return sessions.get(userId);
}

export function livenessFor(userId: number): HiveLiveness {
  return sessions.get(userId)?.liveness || "offline";
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendCommand(
  userId: number,
  op: string,
  payload: Record<string, unknown> = {},
  timeoutMs = 25000,
): Promise<HiveCommandResult> {
  const uid = Math.floor(Number(userId));
  if (!Number.isFinite(uid) || uid <= 0) {
    return { v: 1, id: "", ok: false, error: "invalid_user" };
  }
  const cmdId = randomUUID();
  const root = hiveRoot();
  const inboxDir = join(root, "inbox", String(uid));
  const outboxDir = join(root, "outbox", String(uid));
  ensureDir(inboxDir);
  ensureDir(outboxDir);
  const inboxPath = join(inboxDir, `${cmdId}.json`);
  const outboxPath = join(outboxDir, `${cmdId}.json`);
  const envelope = {
    v: 1,
    id: cmdId,
    op,
    target: { robloxUserId: uid },
    payload: payload || {},
  };
  writeFileSync(inboxPath, JSON.stringify(envelope), "utf8");
  const deadline = Date.now() + Math.max(1000, timeoutMs);
  while (Date.now() < deadline) {
    if (existsSync(outboxPath)) {
      try {
        const raw = readFileSync(outboxPath, "utf8");
        const parsed = JSON.parse(raw) as HiveCommandResult;
        try {
          unlinkSync(outboxPath);
        } catch {
          /* keep outbox if locked */
        }
        return {
          v: Number(parsed.v) || 1,
          id: String(parsed.id || cmdId),
          ok: parsed.ok === true,
          error: parsed.ok === true ? undefined : String(parsed.error || "failed"),
          data: parsed.data && typeof parsed.data === "object" ? parsed.data : {},
        };
      } catch (err) {
        return { v: 1, id: cmdId, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    await sleep(100);
  }
  return { v: 1, id: cmdId, ok: false, error: "timeout" };
}

export async function sendMany(
  userIds: number[],
  op: string,
  payload: Record<string, unknown> = {},
  timeoutMs = 25000,
): Promise<{ dropped: number; results: HiveSendManyResult[] }> {
  emitIfChanged();
  const unique = Array.from(new Set(userIds.map((id) => Math.floor(Number(id))).filter((id) => id > 0)));
  const live: number[] = [];
  const dropped: HiveSendManyResult[] = [];
  for (const userId of unique) {
    if (livenessFor(userId) === "connected") {
      live.push(userId);
    } else {
      dropped.push({
        userId,
        ok: false,
        skipped: true,
        error: "offline",
      });
    }
  }
  const results = await Promise.all(
    live.map(async (userId) => {
      const result = await sendCommand(userId, op, payload, timeoutMs);
      return {
        userId,
        ok: result.ok,
        error: result.error,
        data: result.data,
      } satisfies HiveSendManyResult;
    }),
  );
  return { dropped: dropped.length, results: [...dropped, ...results] };
}

export function startHiveWatcher(next: HiveHooks): void {
  hooks = next;
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  attachWatcher();
  attachLedgerWatcher();
  emitIfChanged(true);
  emitLedgerIfChanged(true);
  pollTimer = setInterval(() => {
    attachWatcher();
    attachLedgerWatcher();
    emitIfChanged();
  }, 1000);
}

export function reloadHiveWatcher(): void {
  if (!hooks) {
    return;
  }
  attachWatcher();
  attachLedgerWatcher();
  emitIfChanged(true);
  emitLedgerIfChanged(true);
}

export function hiveStatusSnapshot(): HiveSession[] {
  if (sessions.size === 0) {
    scan();
  }
  return listSessions();
}
