import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  unwatchFile,
  watch,
  writeFileSync,
  type FSWatcher,
} from "fs";
import { access, readFile, unlink } from "fs/promises";
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
  HiveSessionPatch,
} from "../shared/types";

type HiveHooks = {
  getSettings: () => AppSettings;
  onChange: (sessions: HiveSession[]) => void;
  onLivenessChange: (deltas: { userId: number; hiveStatus: HiveLiveness }[]) => void;
  onSessionPatch: (patches: HiveSessionPatch[]) => void;
  onLedgerChange: (entries: HiveServerLedgerEntry[]) => void;
  isHivePanelOpen: () => boolean;
};

type FileStat = { mtimeMs: number; size: number };

const EMIT_DEBOUNCE_MS = 200;
const FULL_SCAN_INTERVAL_MS = 30_000;
const LEDGER_CACHE_TTL_MS = 5_000;

let hooks: HiveHooks | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let watcher: FSWatcher | null = null;
let ledgerWatcher: FSWatcher | null = null;
let watchedDir = "";
let watchedLedgerDir = "";
let lastFingerprint = "";
let lastLedgerFingerprint = "";
let lastFullSessionScanAt = 0;
let lastFullLedgerScanAt = 0;
let lastLedgerScanAt = 0;
let sessionEmitTimer: ReturnType<typeof setTimeout> | null = null;
let ledgerEmitTimer: ReturnType<typeof setTimeout> | null = null;
let hivePanelOpen = false;

const sessions = new Map<number, HiveSession>();
const sessionFileStats = new Map<string, FileStat>();
const sessionPathByUserId = new Map<number, string>();
const ledgerFileStats = new Map<string, FileStat>();
const ledgerEntries: HiveServerLedgerEntry[] = [];

export function setHivePanelOpen(open: boolean): void {
  hivePanelOpen = open === true;
}

export function isHivePanelOpen(): boolean {
  return hivePanelOpen;
}

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

function sessionFingerprint(list: HiveSession[]): string {
  return list
    .map((s) => `${s.userId}:${s.liveness}:${s.jobId || ""}:${s.serverVerdict || ""}`)
    .sort()
    .join("|");
}

function sessionFieldsFingerprint(session: HiveSession): string {
  return `${session.liveness}:${session.jobId || ""}:${session.serverVerdict || ""}:${session.placeId || ""}:${session.threatLevel || ""}`;
}

function readSessionFile(filePath: string, now: number, ttl: number): HiveSession | null {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
    return classify(parsed, filePath, now, ttl);
  } catch {
    return null;
  }
}

function refreshSessionTtl(): boolean {
  const now = Date.now();
  const ttl = ttlMs();
  let changed = false;
  for (const [userId, session] of sessions) {
    const last = session.lastHeartbeatAt || 0;
    let liveness: HiveLiveness = "connected";
    if (!session.connected || session.alive === false) {
      liveness = "offline";
    } else if (!last || now - last > ttl) {
      liveness = "stale";
    }
    if (liveness !== session.liveness) {
      sessions.set(userId, { ...session, liveness });
      changed = true;
    }
  }
  return changed;
}

function scanSessions(forceFull = false): HiveSession[] {
  const settings = hooks?.getSettings();
  const root = join(hiveRoot(settings), "sessions");
  const now = Date.now();
  const ttl = ttlMs(settings);
  const doFull = forceFull || now - lastFullSessionScanAt >= FULL_SCAN_INTERVAL_MS;

  if (!existsSync(root)) {
    if (sessions.size > 0) {
      sessions.clear();
      sessionFileStats.clear();
      sessionPathByUserId.clear();
    }
    return listSessions();
  }

  let names: string[] = [];
  try {
    names = readdirSync(root).filter((name) => name.toLowerCase().endsWith(".json"));
  } catch {
    names = [];
  }

  const seenPaths = new Set<string>();
  for (const name of names) {
    const filePath = join(root, name);
    seenPaths.add(filePath);
    let stat: FileStat;
    try {
      const s = statSync(filePath);
      stat = { mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      continue;
    }
    const cached = sessionFileStats.get(filePath);
    if (!doFull && cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      continue;
    }
    sessionFileStats.set(filePath, stat);
    const session = readSessionFile(filePath, now, ttl);
    if (session) {
      const prev = sessions.get(session.userId);
      sessions.set(session.userId, session);
      sessionPathByUserId.set(session.userId, filePath);
      if (prev && sessionFieldsFingerprint(prev) !== sessionFieldsFingerprint(session)) {
        /* field diff handled in emit */
      }
    }
  }

  if (doFull) {
    lastFullSessionScanAt = now;
    for (const [path] of sessionFileStats) {
      if (!seenPaths.has(path)) {
        sessionFileStats.delete(path);
      }
    }
    for (const [userId, path] of sessionPathByUserId) {
      if (!seenPaths.has(path)) {
        sessions.delete(userId);
        sessionPathByUserId.delete(userId);
      }
    }
  }

  refreshSessionTtl();
  return listSessions();
}

function collectSessionPatches(prev: Map<number, HiveSession>, next: HiveSession[]): HiveSessionPatch[] {
  const patches: HiveSessionPatch[] = [];
  const nextMap = new Map(next.map((s) => [s.userId, s]));
  for (const session of next) {
    const old = prev.get(session.userId);
    if (!old) {
      patches.push({ userId: session.userId, fields: { liveness: session.liveness, jobId: session.jobId, serverVerdict: session.serverVerdict, placeId: session.placeId, threatLevel: session.threatLevel } });
      continue;
    }
    const fields: HiveSessionPatch["fields"] = {};
    if (old.liveness !== session.liveness) fields.liveness = session.liveness;
    if (old.jobId !== session.jobId) fields.jobId = session.jobId;
    if (old.serverVerdict !== session.serverVerdict) fields.serverVerdict = session.serverVerdict;
    if (old.placeId !== session.placeId) fields.placeId = session.placeId;
    if (old.threatLevel !== session.threatLevel) fields.threatLevel = session.threatLevel;
    if (Object.keys(fields).length > 0) {
      patches.push({ userId: session.userId, fields });
    }
  }
  for (const userId of prev.keys()) {
    if (!nextMap.has(userId)) {
      patches.push({ userId, fields: { liveness: "offline" } });
    }
  }
  return patches;
}

function emitSessionsIfChanged(force = false): HiveSession[] {
  const prev = new Map(sessions);
  const list = scanSessions(force);
  const nextFp = sessionFingerprint(list);
  const fpChanged = force || nextFp !== lastFingerprint;

  const patches = collectSessionPatches(prev, list);
  const livenessDeltas = patches
    .filter((p) => p.fields.liveness !== undefined)
    .map((p) => ({ userId: p.userId, hiveStatus: p.fields.liveness! }));

  if (livenessDeltas.length > 0) {
    hooks?.onLivenessChange(livenessDeltas);
  }
  if (patches.length > 0) {
    hooks?.onSessionPatch(patches);
  }

  if (fpChanged) {
    lastFingerprint = nextFp;
    const panelOpen = hooks?.isHivePanelOpen() ?? hivePanelOpen;
    if (panelOpen) {
      hooks?.onChange(list);
    }
  }
  return list;
}

function scheduleSessionEmit(force = false): void {
  if (force) {
    if (sessionEmitTimer) {
      clearTimeout(sessionEmitTimer);
      sessionEmitTimer = null;
    }
    emitSessionsIfChanged(true);
    return;
  }
  if (sessionEmitTimer) {
    return;
  }
  sessionEmitTimer = setTimeout(() => {
    sessionEmitTimer = null;
    emitSessionsIfChanged(false);
  }, EMIT_DEBOUNCE_MS);
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
      scheduleSessionEmit(false);
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

function scanLedger(forceFull = false): HiveServerLedgerEntry[] {
  const root = join(hiveRoot(), "servers");
  const now = Date.now();
  const doFull = forceFull || now - lastFullLedgerScanAt >= FULL_SCAN_INTERVAL_MS;
  const next: HiveServerLedgerEntry[] = [];

  if (!existsSync(root)) {
    ledgerEntries.length = 0;
    ledgerFileStats.clear();
    lastLedgerScanAt = now;
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

  const seenPaths = new Set<string>();
  for (const placeDir of placeDirs) {
    let files: string[] = [];
    try {
      files = readdirSync(placeDir).filter((name) => name.toLowerCase().endsWith(".json"));
    } catch {
      files = [];
    }
    for (const name of files) {
      const filePath = join(placeDir, name);
      seenPaths.add(filePath);
      let stat: FileStat;
      try {
        const s = statSync(filePath);
        stat = { mtimeMs: s.mtimeMs, size: s.size };
      } catch {
        continue;
      }
      const cached = ledgerFileStats.get(filePath);
      if (!doFull && cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        const existing = ledgerEntries.find((e) => e.path === filePath);
        if (existing) {
          next.push(existing);
        }
        continue;
      }
      ledgerFileStats.set(filePath, stat);
      const entry = parseLedgerFile(filePath);
      if (entry) {
        next.push(entry);
      }
    }
  }

  if (doFull) {
    lastFullLedgerScanAt = now;
    for (const [path] of ledgerFileStats) {
      if (!seenPaths.has(path)) {
        ledgerFileStats.delete(path);
      }
    }
  }

  next.sort((a, b) => b.updatedAt - a.updatedAt);
  ledgerEntries.length = 0;
  ledgerEntries.push(...next);
  lastLedgerScanAt = now;
  return next;
}

function ledgerFingerprint(list: HiveServerLedgerEntry[]): string {
  return list
    .map((e) => `${e.placeId}:${e.jobId}:${e.verdict}:${e.updatedAt}`)
    .sort()
    .join("|");
}

function emitLedgerIfChanged(force = false): HiveServerLedgerEntry[] {
  const list = scanLedger(force);
  const next = ledgerFingerprint(list);
  if (force || next !== lastLedgerFingerprint) {
    lastLedgerFingerprint = next;
    hooks?.onLedgerChange(list);
  }
  return list;
}

function scheduleLedgerEmit(force = false): void {
  if (force) {
    if (ledgerEmitTimer) {
      clearTimeout(ledgerEmitTimer);
      ledgerEmitTimer = null;
    }
    emitLedgerIfChanged(true);
    return;
  }
  if (ledgerEmitTimer) {
    return;
  }
  ledgerEmitTimer = setTimeout(() => {
    ledgerEmitTimer = null;
    emitLedgerIfChanged(false);
  }, EMIT_DEBOUNCE_MS);
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
      scheduleLedgerEmit(false);
    });
  } catch {
    ledgerWatcher = null;
  }
}

export function listLedger(): HiveServerLedgerEntry[] {
  if (ledgerEntries.length === 0 || Date.now() - lastLedgerScanAt > LEDGER_CACHE_TTL_MS) {
    scanLedger(false);
  }
  return [...ledgerEntries];
}

export function ledgerSnapshot(force = false): HiveServerLedgerEntry[] {
  if (!force && ledgerEntries.length > 0 && Date.now() - lastLedgerScanAt <= LEDGER_CACHE_TTL_MS) {
    return [...ledgerEntries];
  }
  return scanLedger(force);
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
    try {
      await access(outboxPath);
      const raw = await readFile(outboxPath, "utf8");
      const parsed = JSON.parse(raw) as HiveCommandResult;
      try {
        await unlink(outboxPath);
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
    } catch {
      await sleep(100);
    }
  }
  return { v: 1, id: cmdId, ok: false, error: "timeout" };
}

export async function sendMany(
  userIds: number[],
  op: string,
  payload: Record<string, unknown> = {},
  timeoutMs = 25000,
): Promise<{ dropped: number; results: HiveSendManyResult[] }> {
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
  emitSessionsIfChanged(true);
  emitLedgerIfChanged(true);
  pollTimer = setInterval(() => {
    attachWatcher();
    attachLedgerWatcher();
    refreshSessionTtl();
    emitSessionsIfChanged(false);
  }, 1000);
}

export function reloadHiveWatcher(): void {
  if (!hooks) {
    return;
  }
  attachWatcher();
  attachLedgerWatcher();
  emitSessionsIfChanged(true);
  emitLedgerIfChanged(true);
}

export function hiveStatusSnapshot(): HiveSession[] {
  if (sessions.size === 0) {
    scanSessions(true);
  }
  return listSessions();
}
