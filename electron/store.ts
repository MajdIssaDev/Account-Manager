import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { app, safeStorage } from "electron";
import type { AppSettings } from "../shared/types";

export type StoredAccount = {
  id: string;
  userId: number;
  username: string;
  displayName: string;
  avatarUrl: string;
  cookieEnc: string;
  lastLoginAt: string | null;
  createdAt: string;
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
};

function dataDir(): string {
  return join(app.getPath("appData"), "AccountManager");
}

function dataFile(): string {
  return join(dataDir(), "store.json");
}

function emptyStore(): FileShape {
  return { accounts: [], settings: { ...DEFAULT_SETTINGS } };
}

function readRaw(): FileShape {
  const file = dataFile();
  if (!existsSync(file)) {
    return emptyStore();
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as FileShape;
    return {
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
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
  return { ...DEFAULT_SETTINGS, ...readRaw().settings };
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const data = readRaw();
  const next: AppSettings = { ...data.settings, ...patch };
  if (Array.isArray(patch.potassiumProcessNames)) {
    next.potassiumProcessNames = patch.potassiumProcessNames
      .map((s) => String(s).trim())
      .filter(Boolean);
  }
  data.settings = next;
  writeRaw(data);
  return data.settings;
}

export function listStoredAccounts(): StoredAccount[] {
  return readRaw().accounts;
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
  const row: StoredAccount = {
    id: randomUUID(),
    userId: profile.userId,
    username: profile.username,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    cookieEnc,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
  };
  data.accounts.push(row);
  writeRaw(data);
  return row;
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
