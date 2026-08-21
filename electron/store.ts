import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { app, safeStorage } from "electron";
import type { AccountLabel, AccountPatch, AppSettings, ThemeId } from "../shared/types";
import { DEFAULT_LABELS } from "../shared/types";

export type StoredAccount = {
  id: string;
  userId: number;
  username: string;
  displayName: string;
  avatarUrl: string;
  cookieEnc: string;
  lastLoginAt: string | null;
  createdAt: string;
  labelIds: string[];
  inactive: boolean;
  sortOrder: number;
};

type FileShape = {
  accounts: StoredAccount[];
  settings: AppSettings;
};

const DEFAULT_SETTINGS: AppSettings = {
  robloxPlayerPath: "",
  attachOnLaunch: false,
  potassiumProcessNames: ["Potassium.exe"],
  attachCommand: "",
  autoCheckUpdates: true,
  autoDownloadUpdates: true,
  githubToken: "",
  labels: DEFAULT_LABELS.map((l) => ({ ...l })),
  themeId: "midnight",
  tutorialDone: false,
  useDefaultRobloxFolder: true,
};

function dataDir(): string {
  return join(app.getPath("appData"), "AccountManager");
}

function dataFile(): string {
  return join(dataDir(), "store.json");
}

function runtimesFile(): string {
  return join(dataDir(), "runtimes.json");
}

export type RuntimeMap = Record<string, number>;

export function loadRuntimes(): RuntimeMap {
  const file = runtimesFile();
  if (!existsSync(file)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as RuntimeMap;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const next: RuntimeMap = {};
    for (const [id, pid] of Object.entries(parsed)) {
      const n = Number(pid);
      if (typeof id === "string" && id && Number.isFinite(n) && n > 0) {
        next[id] = Math.floor(n);
      }
    }
    return next;
  } catch {
    return {};
  }
}

export function saveRuntimes(map: RuntimeMap): void {
  const dir = dataDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(runtimesFile(), JSON.stringify(map, null, 2), "utf8");
}

function emptyStore(): FileShape {
  return { accounts: [], settings: { ...DEFAULT_SETTINGS, labels: DEFAULT_LABELS.map((l) => ({ ...l })) } };
}

function normalizeAccount(raw: StoredAccount, index = 0): StoredAccount {
  return {
    ...raw,
    labelIds: Array.isArray(raw.labelIds) ? raw.labelIds : [],
    inactive: Boolean(raw.inactive),
    sortOrder: typeof raw.sortOrder === "number" && Number.isFinite(raw.sortOrder) ? raw.sortOrder : index,
  };
}

function normalizeLabels(input: unknown): AccountLabel[] {
  const list = Array.isArray(input) ? (input as AccountLabel[]) : [];
  const cleaned = list
    .filter((l) => l && typeof l.id === "string" && typeof l.name === "string")
    .map((l) => ({
      id: l.id,
      name: String(l.name).trim() || "Label",
      color: l.color || "#4f6ef7",
      builtin: Boolean(l.builtin),
    }));
  const hasMain = cleaned.some((l) => l.id === "label-main");
  const hasAlt = cleaned.some((l) => l.id === "label-alt");
  const next = [...cleaned];
  if (!hasMain) {
    next.unshift({ ...DEFAULT_LABELS[0] });
  }
  if (!hasAlt) {
    const alt = { ...DEFAULT_LABELS[1] };
    const mainIdx = next.findIndex((l) => l.id === "label-main");
    next.splice(mainIdx + 1, 0, alt);
  }
  return next;
}

function normalizeSettings(raw: Partial<AppSettings> | undefined): AppSettings {
  const merged: AppSettings = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  merged.labels = normalizeLabels(merged.labels);
  const themes: ThemeId[] = ["midnight", "ocean", "ember", "forest", "violet", "mono"];
  if (!themes.includes(merged.themeId)) {
    merged.themeId = "midnight";
  }
  merged.githubToken = merged.githubToken || "";
  merged.tutorialDone = Boolean(merged.tutorialDone);
  if (raw && typeof raw.useDefaultRobloxFolder !== "boolean") {
    merged.useDefaultRobloxFolder = !String(merged.robloxPlayerPath || "").trim();
  } else {
    merged.useDefaultRobloxFolder = Boolean(merged.useDefaultRobloxFolder);
  }
  return merged;
}

function readRaw(): FileShape {
  const file = dataFile();
  if (!existsSync(file)) {
    return emptyStore();
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as FileShape;
    return {
      accounts: Array.isArray(parsed.accounts)
        ? parsed.accounts.map((a, i) => normalizeAccount(a, i))
        : [],
      settings: normalizeSettings(parsed.settings),
    };
  } catch {
    return emptyStore();
  }
}

function writeRaw(data: FileShape): void {
  const dir = dataDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(dataFile(), JSON.stringify(data, null, 2), "utf8");
}

export function getSettings(): AppSettings {
  return normalizeSettings(readRaw().settings);
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const data = readRaw();
  const next: AppSettings = { ...data.settings, ...patch };
  if (Array.isArray(patch.potassiumProcessNames)) {
    next.potassiumProcessNames = patch.potassiumProcessNames
      .map((s) => String(s).trim())
      .filter(Boolean);
  }
  if (Array.isArray(patch.labels)) {
    next.labels = normalizeLabels(patch.labels);
  }
  data.settings = normalizeSettings(next);
  writeRaw(data);
  return data.settings;
}

export function listStoredAccounts(): StoredAccount[] {
  return [...readRaw().accounts].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
}

export function encryptCookie(cookie: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows encryption (DPAPI) is not available.");
  }
  return safeStorage.encryptString(cookie).toString("base64");
}

export function decryptCookie(cookieEnc: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows encryption (DPAPI) is not available.");
  }
  return safeStorage.decryptString(Buffer.from(cookieEnc, "base64"));
}

export function upsertAccount(profile: {
  userId: number;
  username: string;
  displayName: string;
  avatarUrl: string;
  cookie: string;
}): StoredAccount {
  const data = readRaw();
  const cookieEnc = encryptCookie(profile.cookie);
  const existing = data.accounts.find((a) => a.userId === profile.userId);
  if (existing) {
    existing.username = profile.username;
    existing.displayName = profile.displayName;
    existing.avatarUrl = profile.avatarUrl;
    existing.cookieEnc = cookieEnc;
    writeRaw(data);
    return existing;
  }
  const maxOrder = data.accounts.reduce((m, a) => Math.max(m, a.sortOrder ?? 0), -1);
  const row: StoredAccount = {
    id: randomUUID(),
    userId: profile.userId,
    username: profile.username,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    cookieEnc,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    labelIds: [],
    inactive: false,
    sortOrder: maxOrder + 1,
  };
  data.accounts.push(row);
  writeRaw(data);
  return row;
}

/** Persist a full account order (ids in display order). Unknown ids are ignored. */
export function reorderAccounts(orderedIds: string[]): boolean {
  const data = readRaw();
  if (!orderedIds.length) {
    return false;
  }
  const byId = new Map(data.accounts.map((a) => [a.id, a]));
  const seen = new Set<string>();
  let order = 0;
  for (const id of orderedIds) {
    const row = byId.get(id);
    if (!row || seen.has(id)) {
      continue;
    }
    row.sortOrder = order++;
    seen.add(id);
  }
  for (const row of data.accounts) {
    if (!seen.has(row.id)) {
      row.sortOrder = order++;
    }
  }
  writeRaw(data);
  return true;
}

export function patchAccount(id: string, patch: AccountPatch): StoredAccount | undefined {
  const data = readRaw();
  const row = data.accounts.find((a) => a.id === id);
  if (!row) {
    return undefined;
  }
  if (Array.isArray(patch.labelIds)) {
    const allowed = new Set(data.settings.labels.map((l) => l.id));
    row.labelIds = patch.labelIds.filter((lid) => allowed.has(lid));
  }
  if (typeof patch.inactive === "boolean") {
    row.inactive = patch.inactive;
  }
  writeRaw(data);
  return row;
}

export function createLabel(name: string, color: string): AccountLabel {
  const data = readRaw();
  const label: AccountLabel = {
    id: randomUUID(),
    name: name.trim() || "Label",
    color: color || "#4f6ef7",
    builtin: false,
  };
  data.settings.labels = normalizeLabels([...data.settings.labels, label]);
  writeRaw(data);
  return label;
}

export function updateLabel(id: string, patch: { name?: string; color?: string }): AccountLabel | undefined {
  const data = readRaw();
  const row = data.settings.labels.find((l) => l.id === id);
  if (!row) {
    return undefined;
  }
  if (typeof patch.name === "string" && patch.name.trim()) {
    row.name = patch.name.trim();
  }
  if (typeof patch.color === "string" && patch.color.trim()) {
    row.color = patch.color.trim();
  }
  writeRaw(data);
  return row;
}

export function deleteLabel(id: string): boolean {
  const data = readRaw();
  const row = data.settings.labels.find((l) => l.id === id);
  if (!row || row.builtin) {
    return false;
  }
  data.settings.labels = data.settings.labels.filter((l) => l.id !== id);
  for (const account of data.accounts) {
    account.labelIds = account.labelIds.filter((lid) => lid !== id);
  }
  writeRaw(data);
  return true;
}

export function removeAccount(id: string): boolean {
  const data = readRaw();
  const next = data.accounts.filter((a) => a.id !== id);
  if (next.length === data.accounts.length) {
    return false;
  }
  data.accounts = next;
  writeRaw(data);
  return true;
}

export function touchLastLogin(id: string): void {
  const data = readRaw();
  const row = data.accounts.find((a) => a.id === id);
  if (!row) {
    return;
  }
  row.lastLoginAt = new Date().toISOString();
  writeRaw(data);
}

export function getAccount(id: string): StoredAccount | undefined {
  return readRaw().accounts.find((a) => a.id === id);
}

export function cookieHeader(cookie: string): string {
  const raw = cookie.trim();
  if (raw.toLowerCase().startsWith(".roblosecurity=")) {
    return raw;
  }
  return `.ROBLOSECURITY=${raw}`;
}
