import { join } from "path";
import {
  app,
  BrowserWindow,
  ipcMain,
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
  patchAccount,
  removeAccount,
  setSettings,
  touchLastLogin,
  updateLabel,
  upsertAccount,
} from "./store";
import { attachIfRequested, potassiumStatus } from "./potassium";
import { closePid, isPidAlive, launchAccount } from "./roblox";
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
let mainWindow: BrowserWindow | null = null;
let loginWindow: BrowserWindow | null = null;

function publicAccounts(): AccountPublic[] {
  return listStoredAccounts().map((a) => {
    const pid = pidByAccount.get(a.id);
    const running = typeof pid === "number" && isPidAlive(pid);
    if (!running && pid) {
      pidByAccount.delete(a.id);
    }
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
    };
  });
}

function emitAccounts(): void {
  mainWindow?.webContents.send("accounts:changed", publicAccounts());
}

function emitSettings(): void {
  mainWindow?.webContents.send("settings:changed", getSettings());
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

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 740,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: "#12151c",
    title: "Account Manager",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  attachUpdaterWindow(mainWindow);
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
    pidByAccount.delete(id);
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

  const launchOne = async (id: string): Promise<IpcResult<{ pid: number }>> => {
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
      pidByAccount.set(id, pid);
      touchLastLogin(id);
      emitAccounts();
      const warn = await attachIfRequested(pid, row.username);
      if (warn) {
        mainWindow?.webContents.send("toast", warn);
      }
      return ok({ pid });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  };

  ipcMain.handle("accounts:launch", (_e, id: string) => launchOne(id));

  ipcMain.handle("accounts:launchMany", async (_e, ids: string[]) => {
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids) {
      const res = await launchOne(id);
      results.push({ id, ok: res.ok, error: res.error });
      await new Promise((r) => setTimeout(r, 700));
    }
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

  ipcMain.handle("accounts:close", async (_e, id: string): Promise<IpcResult> => {
    const pid = pidByAccount.get(id);
    if (!pid) {
      return fail("That client is not running.");
    }
    await closePid(pid);
    pidByAccount.delete(id);
    emitAccounts();
    return ok();
  });

  ipcMain.handle("accounts:focus", async (_e, id: string): Promise<IpcResult> => {
    const pid = pidByAccount.get(id);
    if (!pid || !isPidAlive(pid)) {
      pidByAccount.delete(id);
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
    emitAccounts();
    emitSettings();
    return next;
  });
  ipcMain.handle("potassium:status", () => potassiumStatus());
  ipcMain.handle("updater:state", () => getUpdateState());
  ipcMain.handle("updater:check", () => checkForUpdates());
  ipcMain.handle("updater:download", () => downloadUpdate());
  ipcMain.handle("updater:install", () => installUpdate());
}

app.whenReady().then(() => {
  initUpdater();
  registerIpc();
  createMainWindow();
  void maybeAutoCheck();
  setInterval(() => {
    let dirty = false;
    for (const [id, pid] of pidByAccount) {
      if (!isPidAlive(pid)) {
        pidByAccount.delete(id);
        dirty = true;
      }
    }
    if (dirty) {
      emitAccounts();
    }
  }, 1500);
});

app.on("window-all-closed", () => {
  app.quit();
});
