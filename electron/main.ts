import { existsSync } from "fs";
import { join } from "path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  session,
  shell,
} from "electron";
import { CHROME_UA, fetchAuthenticatedUser, normalizeCookie } from "./auth";
import {
  createLabel,
  deleteLabel,
  getAccount,
  getSettings,
  listStoredAccounts,
  loadRuntimes,
  patchAccount,
  removeAccount,
  reorderAccounts,
  saveRuntimes,
  setSettings,
  touchLastLogin,
  updateLabel,
  upsertAccount,
} from "./store";
import { attachIfRequested, potassiumStatus } from "./potassium";
import {
  closeAllRoblox,
  closePid,
  isPidAlive,
  isRobloxPlayerPid,
  launchAccount,
  listProcessPids,
  prepareNextLaunch,
  resolveRobloxPlayer,
  setPersistentUnlock,
} from "./roblox";
import { focusPid } from "./windows";
import {
  attachUpdaterWindow,
  checkForUpdates,
  downloadUpdate,
  getUpdateState,
  initUpdater,
  installUpdate,
  maybeAutoCheck,
} from "./updater";
import { startHiveWatcher, reloadHiveWatcher, livenessFor, sendCommand, sendMany, hiveStatusSnapshot, hiveWorkspacePath } from "./hive";
import type {
  AccountPatch,
  AccountPublic,
  AppSettings,
  IpcResult,
  LoginMode,
  QuickCreds,
} from "../shared/types";

app.setName("Account Manager");
app.setPath("userData", join(app.getPath("appData"), "AccountManager"));

const pidByAccount = new Map<string, number>();
const pidMisses = new Map<string, number>();
let mainWindow: BrowserWindow | null = null;
let loginWindow: BrowserWindow | null = null;

const LAUNCH_JOB_TIMEOUT_MS = 75_000;
const LAUNCH_GAP_MS = 2_500;
const PID_MISS_LIMIT = 3;

type LaunchJob = {
  id: string;
  resolve: (result: IpcResult<{ pid: number }>) => void;
};

const launchQueue: LaunchJob[] = [];
let launchActiveId: string | null = null;
let launchPumpRunning = false;

function persistRuntimes(): void {
  const map: Record<string, number> = {};
  pidByAccount.forEach((pid, id) => {
    map[id] = pid;
  });
  try {
    saveRuntimes(map);
  } catch {
    /* keep memory map even if disk write fails */
  }
}

function syncUnlockFromPids(): void {
  setPersistentUnlock(pidByAccount.size > 0);
}

function rememberPid(id: string, pid: number): void {
  for (const [other, otherPid] of Array.from(pidByAccount.entries())) {
    if (otherPid === pid && other !== id) {
      pidByAccount.delete(other);
      pidMisses.delete(other);
    }
  }
  pidByAccount.set(id, pid);
  pidMisses.delete(id);
  persistRuntimes();
  syncUnlockFromPids();
}

function forgetPid(id: string): void {
  pidMisses.delete(id);
  if (pidByAccount.delete(id)) {
    persistRuntimes();
    syncUnlockFromPids();
  }
}

function forgetAllPids(): void {
  pidMisses.clear();
  if (pidByAccount.size === 0) {
    setPersistentUnlock(false);
    return;
  }
  pidByAccount.clear();
  persistRuntimes();
  setPersistentUnlock(false);
}

async function restoreRuntimes(): Promise<number> {
  const saved = loadRuntimes();
  const known = new Set(listStoredAccounts().map((a) => a.id));
  const live = new Set(await listProcessPids("RobloxPlayerBeta.exe"));
  const claimed = new Set<number>();
  let restored = 0;
  pidByAccount.clear();
  pidMisses.clear();
  for (const [id, pid] of Object.entries(saved)) {
    if (!known.has(id) || !live.has(pid) || claimed.has(pid)) {
      continue;
    }
    if (!isPidAlive(pid)) {
      continue;
    }
    if (!(await isRobloxPlayerPid(pid))) {
      continue;
    }
    pidByAccount.set(id, pid);
    claimed.add(pid);
    restored += 1;
  }
  persistRuntimes();
  syncUnlockFromPids();
  return restored;
}

function publicAccounts(): AccountPublic[] {
  return listStoredAccounts().map((a) => {
    const pid = pidByAccount.get(a.id);
    const running = typeof pid === "number" && isPidAlive(pid);
    return {
      id: a.id,
      userId: a.userId,
      username: a.username,
      displayName: a.displayName,
      avatarUrl: a.avatarUrl,
      lastLoginAt: a.lastLoginAt,
      createdAt: a.createdAt,
      running,
      pid: running ? pid! : null,
      labelIds: a.labelIds || [],
      inactive: Boolean(a.inactive),
      sortOrder: typeof a.sortOrder === "number" ? a.sortOrder : 0,
      hiveStatus: livenessFor(a.userId),
    };
  });
}

function emitAccounts(): void {
  mainWindow?.webContents.send("accounts:changed", publicAccounts());
}

function emitLaunchBusy(): void {
  const ids = new Set<string>();
  if (launchActiveId) {
    ids.add(launchActiveId);
  }
  for (const job of launchQueue) {
    ids.add(job.id);
  }
  mainWindow?.webContents.send("launch:busy", Array.from(ids));
}

function emitSettings(): void {
  mainWindow?.webContents.send("settings:changed", getSettings());
}

function resolveHiveUserId(accountId?: string, userId?: number): number | null {
  if (typeof userId === "number" && Number.isFinite(userId) && userId > 0) {
    return Math.floor(userId);
  }
  if (accountId) {
    const row = getAccount(accountId);
    if (row && row.userId > 0) {
      return row.userId;
    }
  }
  return null;
}

function resolveHiveUserIds(accountIds?: string[], userIds?: number[]): number[] {
  const out: number[] = [];
  for (const id of accountIds || []) {
    const uid = resolveHiveUserId(id);
    if (uid) {
      out.push(uid);
    }
  }
  for (const uid of userIds || []) {
    const n = resolveHiveUserId(undefined, uid);
    if (n) {
      out.push(n);
    }
  }
  return Array.from(new Set(out));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ok<T>(data?: T): IpcResult<T> {
  return { ok: true, data };
}

function fail<T = void>(error: string): IpcResult<T> {
  return { ok: false, error };
}

async function saveCookie(cookieRaw: string): Promise<AccountPublic> {
  const cookie = normalizeCookie(cookieRaw);
  const profile = await fetchAuthenticatedUser(cookie);
  const row = upsertAccount({ ...profile, cookie });
  emitAccounts();
  return publicAccounts().find((a) => a.id === row.id)!;
}

function windowIcon(): string | undefined {
  const dev = join(__dirname, "../../build/icon.png");
  if (existsSync(dev)) {
    return dev;
  }
  return undefined;
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 740,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: "#0b0e16",
    title: "Account Manager",
    icon: windowIcon(),
    frame: false,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  attachUpdaterWindow(mainWindow);
  const emitMaximized = () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send("window:maximized", mainWindow.isMaximized());
  };
  mainWindow.on("maximize", emitMaximized);
  mainWindow.on("unmaximize", emitMaximized);
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    emitMaximized();
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.on("closed", () => {
    attachUpdaterWindow(null);
    mainWindow = null;
  });
}

const FILL_LOGIN = (username: string, password: string): string => `
(() => {
  if (window.__ramFilled) return true;
  const user = ${JSON.stringify(username)};
  const pass = ${JSON.stringify(password)};
  const setVal = (el, v) => {
    const proto = el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, v);
    else el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const inputs = Array.from(document.querySelectorAll("input"));
  const userInput = inputs.find((i) =>
    ["text", "email", "username"].includes((i.type || "").toLowerCase())
    || /user|email|account/i.test(i.name + i.id + i.placeholder + i.autocomplete)
  );
  const passInput = inputs.find((i) => (i.type || "").toLowerCase() === "password");
  if (!userInput || !passInput) return false;
  setVal(userInput, user);
  setVal(passInput, pass);
  const buttons = Array.from(document.querySelectorAll("button, input[type=submit]"));
  const submit = buttons.find((b) => /log\\s*in|sign\\s*in|continue/i.test(b.textContent || b.value || ""));
  window.__ramFilled = true;
  if (submit) submit.click();
  else passInput.form && passInput.form.requestSubmit();
  return true;
})();
`;

async function openLoginWindow(mode: LoginMode, creds?: QuickCreds): Promise<IpcResult<AccountPublic>> {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return fail("An add-account window is already open.");
  }
  const partition = `temp:ram-add-${Date.now()}`;
  const ses = session.fromPartition(partition);
  const url =
    mode === "signup"
      ? "https://www.roblox.com/CreateAccount"
      : "https://www.roblox.com/login";

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: IpcResult<AccountPublic>) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
      }
    };

    loginWindow = new BrowserWindow({
      width: 480,
      height: 720,
      parent: mainWindow || undefined,
      modal: false,
      title: mode === "signup" ? "Create Roblox account" : "Log in to Roblox",
      icon: windowIcon(),
      backgroundColor: "#1a1a1a",
      autoHideMenuBar: true,
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    loginWindow.webContents.setUserAgent(CHROME_UA);

    let capturing = false;
    const tryCookie = async (value: string) => {
      if (settled || capturing) {
        return;
      }
      capturing = true;
      try {
        const account = await saveCookie(value);
        await ses.clearStorageData();
        finish(ok(account));
      } catch (err) {
        capturing = false;
        const message = err instanceof Error ? err.message : String(err);
        mainWindow?.webContents.send("toast", message);
      }
    };

    const checkCookies = async () => {
      try {
        const cookies = await ses.cookies.get({});
        const rbx = cookies.find((c) => c.name === ".ROBLOSECURITY" && c.value);
        if (rbx?.value) {
          await tryCookie(rbx.value);
        }
      } catch {
        /* ignore */
      }
    };

    ses.cookies.on("changed", (_e, cookie, _cause, removed) => {
      if (!removed && cookie.name === ".ROBLOSECURITY" && cookie.value) {
        void tryCookie(cookie.value);
      }
    });

    const poll = setInterval(() => {
      if (settled) {
        clearInterval(poll);
        return;
      }
      void checkCookies();
    }, 1000);

    let fillTries = 0;
    const fillTimer =
      mode === "quick" && creds?.username && creds.password
        ? setInterval(() => {
            if (settled || fillTries > 25 || !loginWindow || loginWindow.isDestroyed()) {
              clearInterval(fillTimer);
              return;
            }
            fillTries += 1;
            void loginWindow.webContents
              .executeJavaScript(FILL_LOGIN(creds.username, creds.password))
              .catch(() => undefined);
          }, 800)
        : null;

    loginWindow.webContents.on("did-finish-load", () => {
      if (mode === "quick" && creds?.username && creds.password) {
        void loginWindow?.webContents
          .executeJavaScript(FILL_LOGIN(creds.username, creds.password))
          .catch(() => undefined);
      }
    });

    loginWindow.on("closed", () => {
      clearInterval(poll);
      if (fillTimer) {
        clearInterval(fillTimer);
      }
      loginWindow = null;
      void ses.clearStorageData();
      if (!settled) {
        finish(fail("Add account cancelled."));
      }
    });

    void loginWindow.loadURL(url);
  });
}

function registerIpc(): void {
  ipcMain.handle("accounts:list", () => publicAccounts());

  ipcMain.handle("accounts:addCookie", async (_e, cookie: string): Promise<IpcResult<AccountPublic>> => {
    try {
      const account = await saveCookie(cookie);
      return ok(account);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(
    "accounts:openLogin",
    async (_e, mode: LoginMode, creds?: QuickCreds): Promise<IpcResult<AccountPublic>> => {
      try {
        return await openLoginWindow(mode, creds);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  ipcMain.handle("accounts:remove", (_e, id: string): IpcResult => {
    const pid = pidByAccount.get(id);
    if (pid && isPidAlive(pid)) {
      return fail("Close this client before removing the account.");
    }
    forgetPid(id);
    if (!removeAccount(id)) {
      return fail("Account not found.");
    }
    emitAccounts();
    return ok();
  });

  ipcMain.handle("accounts:patch", (_e, id: string, patch: AccountPatch): IpcResult => {
    if (!patchAccount(id, patch)) {
      return fail("Account not found.");
    }
    emitAccounts();
    return ok();
  });

  ipcMain.handle("accounts:reorder", (_e, orderedIds: string[]): IpcResult => {
    if (!Array.isArray(orderedIds) || !orderedIds.length) {
      return fail("Nothing to reorder.");
    }
    if (!reorderAccounts(orderedIds)) {
      return fail("Could not reorder accounts.");
    }
    emitAccounts();
    return ok();
  });

  ipcMain.handle("labels:create", (_e, name: string, color: string) => {
    const label = createLabel(name, color);
    emitAccounts();
    emitSettings();
    return ok(label);
  });

  ipcMain.handle("labels:update", (_e, id: string, patch: { name?: string; color?: string }) => {
    const label = updateLabel(id, patch);
    if (!label) {
      return fail("Label not found.");
    }
    emitAccounts();
    emitSettings();
    return ok(label);
  });

  ipcMain.handle("labels:delete", (_e, id: string): IpcResult => {
    if (!deleteLabel(id)) {
      return fail("That label cannot be deleted.");
    }
    emitAccounts();
    emitSettings();
    return ok();
  });

  const launchOne = async (
    id: string,
    cancelled?: { value: boolean },
  ): Promise<IpcResult<{ pid: number }>> => {
    const row = getAccount(id);
    if (!row) {
      return fail("Account not found.");
    }
    const existing = pidByAccount.get(id);
    if (existing && isPidAlive(existing)) {
      return fail("This account is already running. Use Focus.");
    }
    try {
      const pid = await launchAccount(row.cookieEnc);
      if (cancelled?.value) {
        return fail("Launch timed out — moved on so the queue cannot stay stuck.");
      }
      rememberPid(id, pid);
      touchLastLogin(id);
      emitAccounts();
      const warn = await attachIfRequested(pid, row.username);
      if (warn) {
        mainWindow?.webContents.send("toast", warn);
      }
      return ok({ pid });
    } catch (err) {
      if (cancelled?.value) {
        return fail("Launch timed out — moved on so the queue cannot stay stuck.");
      }
      return fail(err instanceof Error ? err.message : String(err));
    }
  };

  const enqueueLaunch = (id: string): Promise<IpcResult<{ pid: number }>> => {
    const existing = pidByAccount.get(id);
    if (existing && isPidAlive(existing)) {
      return Promise.resolve(fail("This account is already running. Use Focus."));
    }
    if (launchActiveId === id || launchQueue.some((job) => job.id === id)) {
      return Promise.resolve(fail("This account is already queued to launch."));
    }
    return new Promise((resolve) => {
      launchQueue.push({ id, resolve });
      emitLaunchBusy();
      void pumpLaunchQueue();
    });
  };

  const pumpLaunchQueue = async (): Promise<void> => {
    if (launchPumpRunning) {
      return;
    }
    launchPumpRunning = true;
    try {
      while (launchQueue.length > 0) {
        const job = launchQueue.shift()!;
        launchActiveId = job.id;
        emitLaunchBusy();

        let settled = false;
        const finish = (result: IpcResult<{ pid: number }>) => {
          if (settled) {
            return;
          }
          settled = true;
          job.resolve(result);
        };

        const cancelled = { value: false };
        const pending = launchOne(job.id, cancelled);
        const timedOut = sleep(LAUNCH_JOB_TIMEOUT_MS).then(() => null as null);
        try {
          const result = await Promise.race([pending, timedOut]);
          if (result === null) {
            cancelled.value = true;
            finish(fail("Launch timed out — moved on so the queue cannot stay stuck."));
            // Brief grace so a hung launch can finish without blocking forever.
            await Promise.race([pending.then(() => undefined, () => undefined), sleep(15_000)]);
          } else {
            finish(result);
          }
        } catch (err) {
          finish(fail(err instanceof Error ? err.message : String(err)));
        }

        launchActiveId = null;
        emitLaunchBusy();
        if (launchQueue.length > 0) {
          await prepareNextLaunch();
          await sleep(LAUNCH_GAP_MS);
        }
      }
    } finally {
      launchPumpRunning = false;
      launchActiveId = null;
      emitLaunchBusy();
      if (launchQueue.length > 0) {
        void pumpLaunchQueue();
      }
    }
  };
  ipcMain.handle("accounts:launch", (_e, id: string) => enqueueLaunch(id));

  ipcMain.handle("accounts:launchMany", async (_e, ids: string[]) => {
    const list = Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && id) : [];
    const unique = Array.from(new Set(list));
    if (!unique.length) {
      return fail("No accounts to launch.");
    }
    const results = await Promise.all(
      unique.map(async (id) => {
        const res = await enqueueLaunch(id);
        return { id, ok: res.ok, error: res.error };
      }),
    );
    const failed = results.filter((r) => !r.ok);
    if (failed.length && failed.length === results.length) {
      return fail(failed[0]?.error || "Could not launch selected accounts.");
    }
    if (failed.length) {
      mainWindow?.webContents.send(
        "toast",
        `Launched ${results.length - failed.length}, ${failed.length} failed.`,
      );
    }
    return ok(results);
  });

  ipcMain.handle("launch:busy", () => {
    const ids = new Set<string>();
    if (launchActiveId) {
      ids.add(launchActiveId);
    }
    for (const job of launchQueue) {
      ids.add(job.id);
    }
    return Array.from(ids);
  });

  ipcMain.handle("accounts:close", async (_e, id: string): Promise<IpcResult> => {
    const pid = pidByAccount.get(id);
    if (!pid) {
      return fail("That client is not running.");
    }
    await closePid(pid);
    forgetPid(id);
    emitAccounts();
    return ok();
  });

  ipcMain.handle("accounts:closeAll", async (): Promise<IpcResult<{ closed: number }>> => {
    const closed = await closeAllRoblox();
    forgetAllPids();
    emitAccounts();
    return ok({ closed });
  });

  ipcMain.handle("accounts:focus", async (_e, id: string): Promise<IpcResult> => {
    const pid = pidByAccount.get(id);
    if (!pid || !isPidAlive(pid)) {
      forgetPid(id);
      emitAccounts();
      return fail("That client is not running.");
    }
    try {
      await focusPid(pid);
      return ok();
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle("settings:get", () => getSettings());
  ipcMain.handle("settings:set", (_e, patch: Partial<AppSettings>) => {
    const next = setSettings(patch);
    reloadHiveWatcher();
    emitAccounts();
    emitSettings();
    return next;
  });
  ipcMain.handle("settings:pickRobloxFolder", async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const picked = await dialog.showOpenDialog(win || undefined, {
      title: "Choose Roblox folder",
      properties: ["openDirectory"],
    });
    if (picked.canceled || !picked.filePaths[0]) {
      return null;
    }
    return picked.filePaths[0];
  });
  ipcMain.handle("settings:pickHiveFolder", async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const picked = await dialog.showOpenDialog(win || undefined, {
      title: "Choose CloudFarm writefile workspace (folder containing CloudFarmHive)",
      properties: ["openDirectory"],
    });
    if (picked.canceled || !picked.filePaths[0]) {
      return null;
    }
    return picked.filePaths[0];
  });
  ipcMain.handle("settings:resolveRoblox", () => resolveRobloxPlayer());
  ipcMain.handle("potassium:status", () => potassiumStatus());
  ipcMain.handle("updater:state", () => getUpdateState());
  ipcMain.handle("updater:check", () => checkForUpdates());
  ipcMain.handle("updater:download", () => downloadUpdate());
  ipcMain.handle("updater:install", () => installUpdate());
  ipcMain.handle("window:minimize", () => {
    mainWindow?.minimize();
  });
  ipcMain.handle("window:toggleMaximize", () => {
    if (!mainWindow) {
      return false;
    }
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return mainWindow.isMaximized();
  });
  ipcMain.handle("window:close", () => {
    mainWindow?.close();
  });
  ipcMain.handle("window:isMaximized", () => Boolean(mainWindow?.isMaximized()));

  ipcMain.handle("hive:status", () => hiveStatusSnapshot());
  ipcMain.handle("hive:workspace", () => hiveWorkspacePath());
  ipcMain.handle("hive:send", async (_e, input: { userId?: number; accountId?: string; op: string; payload?: Record<string, unknown>; timeoutMs?: number }) => {
    const userId = resolveHiveUserId(input?.accountId, input?.userId);
    if (!userId) {
      return fail("Unknown hive account.");
    }
    const result = await sendCommand(userId, String(input?.op || ""), input?.payload || {}, Number(input?.timeoutMs) || 25000);
    return ok(result);
  });
  ipcMain.handle("hive:sendMany", async (_e, input: { userIds?: number[]; accountIds?: string[]; op: string; payload?: Record<string, unknown>; timeoutMs?: number }) => {
    const userIds = resolveHiveUserIds(input?.accountIds, input?.userIds);
    if (!userIds.length) {
      return fail("No hive accounts selected.");
    }
    const batch = await sendMany(userIds, String(input?.op || ""), input?.payload || {}, Number(input?.timeoutMs) || 25000);
    if (batch.dropped > 0) {
      mainWindow?.webContents.send(
        "toast",
        `${batch.dropped} client${batch.dropped === 1 ? "" : "s"} offline — excluded from hive command.`,
      );
    }
    return ok(batch);
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  initUpdater();
  registerIpc();
  startHiveWatcher({
    getSettings,
    onChange: () => {
      emitAccounts();
      mainWindow?.webContents.send("hive:changed", hiveStatusSnapshot());
    },
  });
  const restored = await restoreRuntimes();
  createMainWindow();
  if (restored > 0) {
    mainWindow?.webContents.once("did-finish-load", () => {
      mainWindow?.webContents.send(
        "toast",
        `Reconnected ${restored} running Roblox client${restored === 1 ? "" : "s"}.`,
      );
      emitAccounts();
      emitLaunchBusy();
    });
  }
  void maybeAutoCheck();
  setInterval(() => {
    void (async () => {
      const live = new Set(await listProcessPids("RobloxPlayerBeta.exe"));
      let dirty = false;
      for (const [id, pid] of Array.from(pidByAccount.entries())) {
        const alive = live.has(pid) && isPidAlive(pid);
        if (alive) {
          pidMisses.delete(id);
          continue;
        }
        const misses = (pidMisses.get(id) || 0) + 1;
        pidMisses.set(id, misses);
        if (misses >= PID_MISS_LIMIT) {
          forgetPid(id);
          dirty = true;
        }
      }
      if (dirty) {
        emitAccounts();
      }
    })();
  }, 1500);
});

app.on("before-quit", () => {
  persistRuntimes();
});

app.on("window-all-closed", () => {
  persistRuntimes();
  app.quit();
});
