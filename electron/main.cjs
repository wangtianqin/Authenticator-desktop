"use strict";

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  dialog,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  nativeImage,
  powerMonitor,
  safeStorage,
  screen,
  session,
  shell,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { VaultError, VaultStore } = require("./vault-store.cjs");
const {
  BackupError,
  createEncryptedBackup,
  createExtensionBackup,
  createOtpAuthText,
  createPlainBackup,
  inspectImport,
} = require("./backup.cjs");
const { OtpError } = require("./otp.cjs");

const APP_ID = "cc.authenticator.desktop";
const APP_NAME = "Authenticator Desktop";
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

let mainWindow = null;
let tray = null;
let vaultStore = null;
let dataDir = null;
let quitRequested = false;
let autoLockTimer = null;
let clipboardTimer = null;
let clipboardPrevious = "";
let clipboardCopied = "";
let lastActivity = Date.now();
let failedUnlocks = 0;
let unlockBlockedUntil = 0;
let rendererMaximized = false;

app.setName(APP_NAME);
app.setAppUserModelId(APP_ID);

if (process.env.AUTHENTICATOR_SMOKE === "1") {
  app.commandLine.appendSwitch(
    "remote-debugging-port",
    process.env.AUTHENTICATOR_DEBUG_PORT || "9229"
  );
}
if (process.env.AUTHENTICATOR_DISABLE_GPU === "1") {
  app.disableHardwareAcceleration();
}

function resolveDataDir() {
  if (process.env.AUTHENTICATOR_DATA_DIR) {
    return path.resolve(process.env.AUTHENTICATOR_DATA_DIR);
  }
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return path.join(process.env.PORTABLE_EXECUTABLE_DIR, "AuthenticatorDesktopData");
  }
  return app.getPath("userData");
}

dataDir = resolveDataDir();
fs.mkdirSync(dataDir, { recursive: true });
app.setPath("userData", dataDir);

function logError(label, error) {
  const line = `[${new Date().toISOString()}] ${label}: ${
    error && error.stack ? error.stack : String(error)
  }\n`;
  try {
    const logPath = path.join(dataDir, "app.log");
    try {
      const stats = fs.statSync(logPath);
      if (stats.size > 2 * 1024 * 1024) {
        fs.renameSync(logPath, `${logPath}.old`);
      }
    } catch {
      // The log does not exist yet.
    }
    fs.appendFileSync(logPath, line, "utf8");
  } catch {
    // Logging must never break the app.
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showWindow();
  });
}

function windowIconPath() {
  return path.join(__dirname, "..", "assets", "icon.png");
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    title: APP_NAME,
    backgroundColor: "#0c1517",
    icon: windowIconPath(),
    roundedCorners: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged || process.env.AUTHENTICATOR_ALLOW_DEVTOOLS === "1",
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  Menu.setApplicationMenu(null);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on("maximize", () => {
    rendererMaximized = true;
    mainWindow?.webContents.send("window:maximized", true);
  });
  mainWindow.on("unmaximize", () => {
    rendererMaximized = false;
    mainWindow?.webContents.send("window:maximized", false);
  });
  mainWindow.on("minimize", () => {
    if (
      vaultStore?.isUnlocked() &&
      vaultStore.getSettings().lockOnMinimize &&
      vaultStore.getState().mode === "password"
    ) {
      lockVault("minimize");
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.on("close", () => {
    if (!quitRequested) {
      quitRequested = true;
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const current = mainWindow?.webContents.getURL();
    if (url !== current) {
      event.preventDefault();
      openExternalUrl(url);
    }
  });
  mainWindow.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logError("render-process-gone", JSON.stringify(details));
    if (!quitRequested && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.reload();
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function openExternalUrl(url) {
  try {
    const parsed = new URL(url);
    const allowedHosts = new Set([
      "github.com",
      "authenticator.cc",
      "www.electronjs.org",
      "support.microsoft.com",
    ]);
    if (parsed.protocol === "https:" && allowedHosts.has(parsed.hostname)) {
      shell.openExternal(parsed.toString());
    }
  } catch {
    // Ignore malformed or disallowed URLs.
  }
}

function setupTray() {
  try {
    const icon = nativeImage.createFromPath(windowIconPath());
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    tray.setToolTip(APP_NAME);
    const rebuild = () => {
      const items = [
        { label: "显示验证器", click: showWindow },
        {
          label: "立即锁定",
          enabled: Boolean(vaultStore?.isUnlocked()),
          click: () => lockVault("tray"),
        },
        { type: "separator" },
        {
          label: "退出",
          click: () => {
            quitRequested = true;
            app.quit();
          },
        },
      ];
      tray?.setContextMenu(Menu.buildFromTemplate(items));
    };
    rebuild();
    tray.on("double-click", showWindow);
    tray.on("click", showWindow);
    tray.on("right-click", rebuild);
  } catch (error) {
    logError("tray", error);
  }
}

function registerShortcut() {
  try {
    const ok = globalShortcut.register("CommandOrControl+Shift+A", () => {
      showWindow();
      mainWindow?.webContents.send("app:focus-search");
    });
    if (!ok) logError("global-shortcut", "Ctrl+Shift+A 已被其他程序占用");
  } catch (error) {
    logError("global-shortcut", error);
  }
}

function clearClipboardTimer() {
  if (clipboardTimer) {
    clearTimeout(clipboardTimer);
    clipboardTimer = null;
  }
}

function clearCopiedClipboard() {
  clearClipboardTimer();
  if (clipboardCopied && clipboard.readText() === clipboardCopied) {
    if (clipboardPrevious) clipboard.writeText(clipboardPrevious);
    else clipboard.clear();
  }
  clipboardCopied = "";
  clipboardPrevious = "";
}

function copyToClipboard(text, clearSeconds) {
  if (typeof text !== "string" || !text || text.length > 4096) {
    throw new VaultError("没有可复制的内容。", "INVALID_CLIPBOARD");
  }
  clearClipboardTimer();
  clipboardPrevious = clipboard.readText();
  clipboard.writeText(text);
  clipboardCopied = text;
  if (clearSeconds > 0) {
    clipboardTimer = setTimeout(() => {
      if (clipboard.readText() === clipboardCopied) {
        if (clipboardPrevious) clipboard.writeText(clipboardPrevious);
        else clipboard.clear();
      }
      clipboardCopied = "";
      clipboardPrevious = "";
      clipboardTimer = null;
    }, clearSeconds * 1000);
    clipboardTimer.unref?.();
  }
  return { copied: true, clearSeconds };
}

function lockVault(reason = "manual") {
  if (!vaultStore?.isUnlocked()) return vaultStore?.getState();
  vaultStore.lock();
  clearCopiedClipboard();
  lastActivity = 0;
  mainWindow?.webContents.send("auth:locked", { reason });
  if (tray) {
    tray.setToolTip(`${APP_NAME}（已锁定）`);
  }
  return vaultStore.getState();
}

function checkAutoLock() {
  if (!vaultStore?.isUnlocked()) return;
  const minutes = vaultStore.getAutoLockMinutes();
  if (!minutes) return;
  if (Date.now() - lastActivity >= minutes * 60 * 1000) {
    lockVault("timeout");
  }
}

function touchActivity() {
  if (vaultStore?.isUnlocked()) lastActivity = Date.now();
}

function assertTrustedSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new VaultError("未授权的请求。", "UNTRUSTED_SENDER");
  }
}

function handle(channel, handler) {
  ipcMain.handle(channel, async (event, args) => {
    try {
      assertTrustedSender(event);
      const data = await handler(args || {}, event);
      return { ok: true, data };
    } catch (error) {
      const code =
        error?.code ||
        (error instanceof OtpError
          ? "INVALID_OTP"
          : error instanceof BackupError
            ? "INVALID_BACKUP"
            : "APP_ERROR");
      const quietCodes = new Set(["WRONG_PASSWORD", "TOO_MANY_ATTEMPTS", "LOCKED"]);
      if (!quietCodes.has(code)) {
        logError(`ipc:${channel}`, error);
      }
      return {
        ok: false,
        error: {
          code,
          message: error?.message || "操作失败。",
        },
      };
    }
  });
}

function requireUnlocked() {
  if (!vaultStore.isUnlocked()) {
    throw new VaultError("保险库已锁定。", "LOCKED");
  }
}

function registerIpc() {
  handle("app:get-state", async () => ({
    ...vaultStore.getState(),
    platform: process.platform,
    versions: {
      app: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
  }));

  handle("auth:setup", async ({ mode, password }) => {
    if (vaultStore.getState().initialized) {
      throw new VaultError("保险库已经初始化。", "ALREADY_INITIALIZED");
    }
    if (mode === "password" && typeof password !== "string") {
      throw new VaultError("请输入主密码。", "PASSWORD_REQUIRED");
    }
    const vault = await vaultStore.initialize({ mode, password });
    lastActivity = Date.now();
    return { state: vaultStore.getState(), vault };
  });

  handle("auth:unlock", async ({ password }) => {
    const now = Date.now();
    if (now < unlockBlockedUntil) {
      throw new VaultError(
        `尝试次数过多，请等待 ${Math.ceil((unlockBlockedUntil - now) / 1000)} 秒。`,
        "TOO_MANY_ATTEMPTS"
      );
    }
    try {
      const vault = await vaultStore.unlock(password);
      failedUnlocks = 0;
      lastActivity = Date.now();
      if (tray) tray.setToolTip(APP_NAME);
      return { state: vaultStore.getState(), vault };
    } catch (error) {
      if (error.code === "WRONG_PASSWORD") {
        failedUnlocks += 1;
        if (failedUnlocks >= 3) {
          unlockBlockedUntil = Date.now() + Math.min(30000, 1000 * 2 ** (failedUnlocks - 3));
        }
      }
      throw error;
    }
  });

  handle("auth:lock", async () => {
    lockVault("manual");
    return vaultStore.getState();
  });

  handle("app:activity", async () => {
    touchActivity();
    return { ok: true };
  });

  handle("vault:get", async () => {
    requireUnlocked();
    return vaultStore.getRendererVault();
  });

  handle("vault:codes", async () => {
    requireUnlocked();
    return vaultStore.getCodes(Date.now());
  });

  handle("account:preview", async ({ input, id }) => {
    requireUnlocked();
    return vaultStore.preview(input || {}, id || null);
  });

  handle("account:add", async ({ input }) => {
    requireUnlocked();
    const account = await vaultStore.addAccount(input || {});
    return { account, vault: vaultStore.getRendererVault() };
  });

  handle("account:update", async ({ id, input }) => {
    requireUnlocked();
    if (!id) throw new VaultError("缺少验证码标识。", "INVALID_REQUEST");
    const account = await vaultStore.updateAccount(id, input || {});
    return { account, vault: vaultStore.getRendererVault() };
  });

  handle("account:delete", async ({ id }) => {
    requireUnlocked();
    await vaultStore.deleteAccount(id);
    return { vault: vaultStore.getRendererVault() };
  });

  handle("account:pin", async ({ id, pinned }) => {
    requireUnlocked();
    const account = await vaultStore.setPinned(id, Boolean(pinned));
    return { account, vault: vaultStore.getRendererVault() };
  });

  handle("account:increment", async ({ id }) => {
    requireUnlocked();
    const result = await vaultStore.incrementCounter(id);
    return { ...result, vault: vaultStore.getRendererVault() };
  });

  handle("account:secret", async ({ id }) => {
    requireUnlocked();
    return vaultStore.getSecret(id);
  });

  handle("account:uri", async ({ id }) => {
    requireUnlocked();
    return vaultStore.getOtpUri(id);
  });

  handle("accounts:reorder", async ({ ids }) => {
    requireUnlocked();
    await vaultStore.reorder(ids);
    return { vault: vaultStore.getRendererVault() };
  });

  handle("group:create", async ({ name, color }) => {
    requireUnlocked();
    const group = await vaultStore.createGroup({ name, color });
    return { group, vault: vaultStore.getRendererVault() };
  });

  handle("group:update", async ({ id, name, color }) => {
    requireUnlocked();
    const group = await vaultStore.updateGroup(id, { name, color });
    return { group, vault: vaultStore.getRendererVault() };
  });

  handle("group:delete", async ({ id }) => {
    requireUnlocked();
    await vaultStore.deleteGroup(id);
    return { vault: vaultStore.getRendererVault() };
  });

  handle("settings:update", async ({ patch }) => {
    requireUnlocked();
    const settings = await vaultStore.updateSettings(patch || {});
    touchActivity();
    return { settings, vault: vaultStore.getRendererVault() };
  });

  handle("security:change-password", async ({ currentPassword, newPassword }) => {
    requireUnlocked();
    const result = await vaultStore.changePassword(currentPassword, newPassword);
    touchActivity();
    return { ...result, state: vaultStore.getState() };
  });

  handle("security:enable-password", async ({ newPassword }) => {
    requireUnlocked();
    const result = await vaultStore.protectWithPassword(newPassword);
    lastActivity = Date.now();
    return { ...result, state: vaultStore.getState(), vault: vaultStore.getRendererVault() };
  });

  handle("security:disable-password", async ({ currentPassword }) => {
    requireUnlocked();
    const result = await vaultStore.removePassword(currentPassword);
    return { ...result, state: vaultStore.getState(), vault: vaultStore.getRendererVault() };
  });

  handle("import:inspect", async ({ text, password }) => {
    requireUnlocked();
    return inspectImport({ text, password: password || null });
  });

  handle("import:commit", async ({ accounts, groupId, skipDuplicates, groups }) => {
    requireUnlocked();
    if (!Array.isArray(accounts) || !accounts.length) {
      throw new BackupError("没有可导入的验证码。", "INVALID_BACKUP");
    }
    if (accounts.length > 2000) {
      throw new BackupError("一次最多导入 2000 个验证码。", "TOO_MANY_ACCOUNTS");
    }
    const result = await vaultStore.importAccounts(accounts, {
      groupId: groupId || null,
      skipDuplicates: skipDuplicates !== false,
      groups: Array.isArray(groups) ? groups.slice(0, 200) : [],
    });
    touchActivity();
    return { ...result, vault: vaultStore.getRendererVault() };
  });

  handle("export:run", async ({ kind, password }) => {
    requireUnlocked();
    const payload = await vaultStore.exportPayload();
    let content;
    let extension;
    let label;
    if (kind === "encrypted") {
      content = await createEncryptedBackup(payload, password);
      extension = "authbackup";
      label = "加密备份";
    } else if (kind === "plain") {
      content = createPlainBackup(payload);
      extension = "json";
      label = "明文备份";
    } else if (kind === "otpauth") {
      content = createOtpAuthText(payload);
      extension = "txt";
      label = "otpauth 文本";
      if (!content.trim()) {
        throw new BackupError(
          "当前账户均无法导出为 otpauth 链接（例如 Steam 验证码）。",
          "EXPORT_EMPTY"
        );
      }
    } else if (kind === "extension") {
      content = createExtensionBackup(payload);
      extension = "json";
      label = "插件兼容备份";
    } else {
      throw new BackupError("未知的导出格式。", "INVALID_EXPORT");
    }
    const date = new Date().toISOString().slice(0, 10);
    const baseName = {
      encrypted: "Authenticator-加密备份",
      plain: "Authenticator-明文备份",
      otpauth: "Authenticator-otpauth",
      extension: "Authenticator-插件兼容备份",
    }[kind];
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: `导出${label}`,
      defaultPath: path.join(app.getPath("documents"), `${baseName}-${date}.${extension}`),
      filters: [
        {
          name: label,
          extensions: [extension],
        },
      ],
      properties: ["showOverwriteConfirmation", "createDirectory"],
    });
    if (canceled || !filePath) return { cancelled: true };
    await fs.promises.writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
    if (kind !== "otpauth") {
      await vaultStore.updateSettings({ lastBackupAt: new Date().toISOString() });
    }
    return {
      cancelled: false,
      path: filePath,
      bytes: Buffer.byteLength(content, "utf8"),
      vault: vaultStore.getRendererVault(),
    };
  });

  handle("import:pick-file", async () => {
    requireUnlocked();
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: "选择备份文件",
      properties: ["openFile"],
      filters: [
        { name: "备份文件", extensions: ["json", "txt", "authbackup"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (canceled || !filePaths.length) return { cancelled: true };
    const filePath = filePaths[0];
    const stat = await fs.promises.stat(filePath);
    if (stat.size > MAX_IMPORT_BYTES) {
      throw new BackupError("备份文件超过 20 MB，无法导入。", "FILE_TOO_LARGE");
    }
    const text = await fs.promises.readFile(filePath, "utf8");
    return { cancelled: false, name: path.basename(filePath), text };
  });

  handle("image:capture-screen", async () => {
    requireUnlocked();
    const displays = screen.getAllDisplays();
    const maxWidth = Math.min(
      4096,
      Math.max(...displays.map((display) => display.size.width * display.scaleFactor), 1920)
    );
    const maxHeight = Math.min(
      2560,
      Math.max(...displays.map((display) => display.size.height * display.scaleFactor), 1080)
    );
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: maxWidth, height: maxHeight },
      fetchWindowIcons: false,
    });
    return {
      images: sources
        .filter((source) => !source.thumbnail.isEmpty())
        .map((source) => ({
          name: source.name,
          dataUrl: source.thumbnail.toDataURL(),
        })),
    };
  });

  handle("image:paste", async () => {
    requireUnlocked();
    const image = clipboard.readImage();
    if (image.isEmpty()) return { image: null };
    return { image: image.toDataURL() };
  });

  handle("clipboard:copy", async ({ text }) => {
    requireUnlocked();
    const seconds = Number(vaultStore.getSettings().clipboardClearSeconds) || 0;
    return copyToClipboard(text, seconds);
  });

  handle("window:minimize", async () => {
    mainWindow?.minimize();
    return { minimized: true };
  });

  handle("window:maximize", async () => {
    if (!mainWindow) return { maximized: false };
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return { maximized: mainWindow.isMaximized() };
  });

  handle("window:close", async () => {
    quitRequested = true;
    mainWindow?.close();
    return { closed: true };
  });

  handle("window:is-maximized", async () => ({
    maximized: Boolean(mainWindow?.isMaximized()),
    platform: process.platform,
  }));

  handle("app:open-external", async ({ url }) => {
    openExternalUrl(url);
    return { opened: true };
  });

  handle("app:open-data-folder", async () => {
    requireUnlocked();
    const error = await shell.openPath(vaultStore.dataDir);
    if (error) throw new VaultError(error, "OPEN_FOLDER_FAILED");
    return { opened: true };
  });

  handle("app:reset", async ({ confirmation }) => {
    if (confirmation !== "删除全部数据") {
      throw new VaultError("确认文字不正确。", "CONFIRMATION_REQUIRED");
    }
    clearClipboardTimer();
    await vaultStore.reset();
    failedUnlocks = 0;
    unlockBlockedUntil = 0;
    lastActivity = 0;
    return { state: vaultStore.getState() };
  });

  handle("app:info", async () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    dataDir: vaultStore.dataDir,
    packaged: app.isPackaged,
    platform: process.platform,
  }));
}

function installPermissionHandlers() {
  const isAppUrl = (url) => {
    if (!url) return false;
    try {
      if (url.startsWith("file://")) return true;
      if (process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL)) {
        return true;
      }
    } catch {
      return false;
    }
    return false;
  };
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission === "media" && isAppUrl(details.requestingUrl || webContents.getURL())) {
      callback(true);
      return;
    }
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return permission === "media" && isAppUrl(requestingOrigin || webContents.getURL());
  });
}

async function bootstrap() {
  try {
    await app.whenReady();
    installPermissionHandlers();
    vaultStore = new VaultStore(dataDir, { appVersion: app.getVersion() });
    await vaultStore.init();
    registerIpc();
    createWindow();
    setupTray();
    registerShortcut();
    autoLockTimer = setInterval(checkAutoLock, 10_000);
    autoLockTimer.unref?.();
    powerMonitor.on("suspend", () => lockVault("suspend"));
    powerMonitor.on("lock-screen", () => lockVault("screen-lock"));
    app.on("activate", () => {
      if (!mainWindow) createWindow();
      showWindow();
    });
    app.on("before-quit", () => {
      quitRequested = true;
      clearClipboardTimer();
      vaultStore?.lock();
    });
    app.on("will-quit", () => {
      globalShortcut.unregisterAll();
      autoLockTimer && clearInterval(autoLockTimer);
    });
  } catch (error) {
    logError("bootstrap", error);
    dialog.showErrorBox(
      "Authenticator Desktop 启动失败",
      `应用无法启动：${error.message}\n\n数据目录：${dataDir}`
    );
    app.quit();
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

process.on("uncaughtException", (error) => {
  if (error && (error.code === "EPIPE" || error.code === "ERR_STREAM_DESTROYED")) return;
  logError("uncaughtException", error);
});
process.on("unhandledRejection", (error) => {
  logError("unhandledRejection", error);
});

if (gotLock) bootstrap();

module.exports = {
  get mainWindow() {
    return mainWindow;
  },
};
