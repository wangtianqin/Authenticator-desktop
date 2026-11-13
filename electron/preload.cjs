"use strict";

const { contextBridge, ipcRenderer } = require("electron");

async function invoke(channel, payload) {
  const response = await ipcRenderer.invoke(channel, payload);
  if (!response || response.ok !== true) {
    const error = new Error(response?.error?.message || "操作失败。");
    error.code = response?.error?.code || "APP_ERROR";
    throw error;
  }
  return response.data;
}

function subscribe(channel, callback) {
  if (typeof callback !== "function") return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = Object.freeze({
  getState: () => invoke("app:get-state"),
  setup: (payload) => invoke("auth:setup", payload),
  unlock: (password) => invoke("auth:unlock", { password }),
  lock: () => invoke("auth:lock"),
  activity: () => invoke("app:activity"),
  getVault: () => invoke("vault:get"),
  getCodes: () => invoke("vault:codes"),

  previewAccount: (input, id = null) => invoke("account:preview", { input, id }),
  addAccount: (input) => invoke("account:add", { input }),
  updateAccount: (id, input) => invoke("account:update", { id, input }),
  deleteAccount: (id) => invoke("account:delete", { id }),
  setPinned: (id, pinned) => invoke("account:pin", { id, pinned }),
  incrementCounter: (id) => invoke("account:increment", { id }),
  getSecret: (id) => invoke("account:secret", { id }),
  getOtpUri: (id) => invoke("account:uri", { id }),
  reorderAccounts: (ids) => invoke("accounts:reorder", { ids }),

  createGroup: (name, color) => invoke("group:create", { name, color }),
  updateGroup: (id, name, color) => invoke("group:update", { id, name, color }),
  deleteGroup: (id) => invoke("group:delete", { id }),
  updateSettings: (patch) => invoke("settings:update", { patch }),

  changePassword: (currentPassword, newPassword) =>
    invoke("security:change-password", { currentPassword, newPassword }),
  enablePassword: (newPassword) => invoke("security:enable-password", { newPassword }),
  disablePassword: (currentPassword) =>
    invoke("security:disable-password", { currentPassword }),

  inspectImport: (text, password = null) => invoke("import:inspect", { text, password }),
  commitImport: (accounts, groupId = null, skipDuplicates = true, groups = []) =>
    invoke("import:commit", { accounts, groupId, skipDuplicates, groups }),
  pickImportFile: () => invoke("import:pick-file"),
  exportBackup: (kind, password = null) => invoke("export:run", { kind, password }),

  captureScreen: () => invoke("image:capture-screen"),
  pasteImage: () => invoke("image:paste"),
  copyText: (text) => invoke("clipboard:copy", { text }),

  minimizeWindow: () => invoke("window:minimize"),
  toggleMaximize: () => invoke("window:maximize"),
  closeWindow: () => invoke("window:close"),
  isMaximized: () => invoke("window:is-maximized"),

  openExternal: (url) => invoke("app:open-external", { url }),
  openDataFolder: () => invoke("app:open-data-folder"),
  resetApp: (confirmation) => invoke("app:reset", { confirmation }),
  getInfo: () => invoke("app:info"),

  onLocked: (callback) => subscribe("auth:locked", callback),
  onMaximized: (callback) => subscribe("window:maximized", callback),
  onFocusSearch: (callback) => subscribe("app:focus-search", callback),
});

contextBridge.exposeInMainWorld("authenticator", api);
