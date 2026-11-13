"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { safeStorage } = require("electron");
const {
  OtpError,
  buildOtpUri,
  generateCode,
  makeAccount,
} = require("./otp.cjs");

const VAULT_FORMAT = "authenticator-desktop-vault";
const VAULT_VERSION = 1;
const DEFAULT_THEME = "system";
const SETTING_KEYS = new Set([
  "theme",
  "compact",
  "autoLockMinutes",
  "clipboardClearSeconds",
  "showCodes",
  "lockOnMinimize",
  "lastBackupAt",
]);
const GROUP_COLORS = ["#14b8a6", "#6366f1", "#f59e0b", "#ec4899", "#0ea5e9", "#84cc16", "#f97316", "#8b5cf6"];

class VaultError extends Error {
  constructor(message, code = "VAULT_ERROR") {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

function defaultSettings() {
  return {
    theme: DEFAULT_THEME,
    compact: false,
    autoLockMinutes: 5,
    clipboardClearSeconds: 30,
    showCodes: true,
    lockOnMinimize: false,
    lastBackupAt: null,
  };
}

function defaultVault() {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    accounts: [],
    groups: [],
    settings: defaultSettings(),
  };
}

function clampString(value, max) {
  return String(value ?? "").replace(/\u0000/g, "").slice(0, max);
}

function sanitizeSettings(input = {}) {
  const settings = defaultSettings();
  if (input.theme === "light" || input.theme === "dark" || input.theme === "system") {
    settings.theme = input.theme;
  }
  settings.compact = Boolean(input.compact);
  const autoLock = Number(input.autoLockMinutes);
  if (Number.isFinite(autoLock) && autoLock >= 0 && autoLock <= 1440) {
    settings.autoLockMinutes = Math.round(autoLock);
  }
  const clipboard = Number(input.clipboardClearSeconds);
  if (Number.isFinite(clipboard) && clipboard >= 0 && clipboard <= 300) {
    settings.clipboardClearSeconds = Math.round(clipboard);
  }
  settings.showCodes = input.showCodes !== false;
  settings.lockOnMinimize = Boolean(input.lockOnMinimize);
  settings.lastBackupAt = input.lastBackupAt
    ? clampString(input.lastBackupAt, 40)
    : null;
  return settings;
}

function sanitizeGroup(group, index) {
  if (!group || typeof group !== "object") return null;
  const id = clampString(group.id, 80);
  if (!id) return null;
  const name = clampString(group.name, 60).trim();
  if (!name) return null;
  return {
    id,
    name,
    color: /^#[0-9a-f]{6}$/i.test(group.color || "")
      ? group.color
      : GROUP_COLORS[index % GROUP_COLORS.length],
    order: Number.isFinite(Number(group.order)) ? Number(group.order) : index,
    createdAt: group.createdAt || new Date().toISOString(),
  };
}

function sanitizeAccount(account, index) {
  if (!account || typeof account !== "object" || !account.secret) return null;
  const id = clampString(account.id, 80) || crypto.randomUUID();
  const type = ["totp", "hotp", "steam"].includes(account.type)
    ? account.type
    : "totp";
  const secretType = account.secretType === "hex" ? "hex" : "base32";
  const digits = type === "steam" ? 5 : Number(account.digits) || 6;
  return {
    id,
    type,
    issuer: clampString(account.issuer, 200),
    account: clampString(account.account, 200),
    secret: clampString(account.secret, 2048),
    secretType,
    algorithm: ["SHA1", "SHA256", "SHA512"].includes(account.algorithm)
      ? account.algorithm
      : "SHA1",
    digits: Math.min(10, Math.max(1, Math.round(digits))),
    period:
      type === "totp"
        ? Math.min(86400, Math.max(5, Math.round(Number(account.period) || 30)))
        : 30,
    counter:
      type === "hotp"
        ? Math.max(0, Number.isSafeInteger(Number(account.counter)) ? Number(account.counter) : 0)
        : 0,
    pinned: Boolean(account.pinned),
    groupId: account.groupId ? clampString(account.groupId, 80) : null,
    notes: clampString(account.notes, 1000),
    order: Number.isFinite(Number(account.order)) ? Number(account.order) : index,
    createdAt: account.createdAt || new Date().toISOString(),
    updatedAt: account.updatedAt || new Date().toISOString(),
  };
}

function sanitizeVault(raw) {
  if (!raw || typeof raw !== "object") throw new VaultError("保险库数据损坏。", "INVALID_VAULT");
  const vault = defaultVault();
  vault.createdAt = raw.createdAt || vault.createdAt;
  vault.updatedAt = raw.updatedAt || vault.updatedAt;
  vault.groups = Array.isArray(raw.groups)
    ? raw.groups.map(sanitizeGroup).filter(Boolean)
    : [];
  const groupIds = new Set(vault.groups.map((group) => group.id));
  vault.accounts = Array.isArray(raw.accounts)
    ? raw.accounts.map(sanitizeAccount).filter(Boolean)
    : [];
  vault.accounts.sort((a, b) => a.order - b.order);
  vault.accounts.forEach((account, index) => {
    account.order = index;
    if (account.groupId && !groupIds.has(account.groupId)) account.groupId = null;
  });
  vault.settings = sanitizeSettings(raw.settings || {});
  return vault;
}

function publicAccount(account) {
  return {
    id: account.id,
    type: account.type,
    issuer: account.issuer,
    account: account.account,
    secretType: account.secretType,
    algorithm: account.algorithm,
    digits: account.digits,
    period: account.period,
    counter: account.counter,
    pinned: account.pinned,
    groupId: account.groupId,
    notes: account.notes,
    order: account.order,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function kdfParams() {
  if (process.env.AUTHENTICATOR_FAST_KDF === "1") {
    return { N: 4096, r: 8, p: 1 };
  }
  return { N: 32768, r: 8, p: 1 };
}

function deriveKey(password, salt, params) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      32,
      {
        N: params.N,
        r: params.r,
        p: params.p,
        maxmem: 128 * 1024 * 1024,
      },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      }
    );
  });
}

function parseKdf(envelope) {
  const N = Number(envelope?.kdf?.N);
  const r = Number(envelope?.kdf?.r);
  const p = Number(envelope?.kdf?.p);
  const valid =
    Number.isInteger(N) &&
    N >= 1024 &&
    N <= 1048576 &&
    (N & (N - 1)) === 0 &&
    Number.isInteger(r) &&
    r >= 1 &&
    r <= 32 &&
    Number.isInteger(p) &&
    p >= 1 &&
    p <= 16;
  if (!valid) throw new VaultError("保险库的密钥派生参数无效。", "INVALID_VAULT");
  return { N, r, p };
}

function encryptWithKey(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptWithKey(payload, key) {
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");
  if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) {
    throw new VaultError("保险库文件损坏。", "INVALID_VAULT");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function secureCompare(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function deviceProtectionAvailable() {
  return Boolean(
    safeStorage &&
      typeof safeStorage.isEncryptionAvailable === "function" &&
      safeStorage.isEncryptionAvailable()
  );
}

class VaultStore {
  constructor(dataDir, { appVersion = "1.0.0" } = {}) {
    this.dataDir = dataDir;
    this.appVersion = appVersion;
    this.vaultPath = path.join(dataDir, "vault.json");
    this.backupPath = path.join(dataDir, "vault.backup.json");
    this.envelope = null;
    this.vault = null;
    this.key = null;
    this.salt = null;
    this.kdf = null;
    this.warning = null;
    this.opQueue = Promise.resolve();
    this.lastSavedAt = null;
  }

  async init() {
    await fs.promises.mkdir(this.dataDir, { recursive: true });
    await this.loadEnvelope();
  }

  async readJson(filePath) {
    const raw = await fs.promises.readFile(filePath, "utf8");
    return JSON.parse(raw);
  }

  validateEnvelope(envelope) {
    if (!envelope || envelope.format !== VAULT_FORMAT) {
      throw new VaultError("不是有效的保险库文件。", "INVALID_VAULT");
    }
    if (envelope.mode !== "password" && envelope.mode !== "device") {
      throw new VaultError("未知的保险库安全模式。", "INVALID_VAULT");
    }
    return envelope;
  }

  async loadEnvelope() {
    let primaryError = null;
    try {
      this.envelope = this.validateEnvelope(await this.readJson(this.vaultPath));
      return;
    } catch (error) {
      if (error.code !== "ENOENT") primaryError = error;
    }
    try {
      const backup = this.validateEnvelope(await this.readJson(this.backupPath));
      this.envelope = backup;
      this.warning = "检测到保险库文件异常，已从上一份自动备份恢复。";
      return;
    } catch (error) {
      if (error.code !== "ENOENT") {
        this.warning = primaryError
          ? `保险库文件异常：${primaryError.message}`
          : `备份文件异常：${error.message}`;
      }
    }
    if (primaryError && primaryError.code !== "ENOENT") {
      this.warning = `无法读取保险库：${primaryError.message}`;
    }
    this.envelope = null;
  }

  getState() {
    const initialized = Boolean(this.envelope);
    return {
      initialized,
      locked: !this.vault,
      mode: this.envelope?.mode || null,
      version: this.appVersion,
      dataDir: this.dataDir,
      warning: this.warning,
      deviceProtectionAvailable: deviceProtectionAvailable(),
    };
  }

  isUnlocked() {
    return Boolean(this.vault);
  }

  requireUnlocked() {
    if (!this.vault) throw new VaultError("保险库已锁定。", "LOCKED");
    return this.vault;
  }

  getSettings() {
    return this.vault ? { ...this.vault.settings } : defaultSettings();
  }

  getAutoLockMinutes() {
    if (!this.vault || this.envelope?.mode !== "password") return 0;
    return Number(this.vault.settings.autoLockMinutes) || 0;
  }

  async initialize({ mode, password }) {
    if (this.envelope) throw new VaultError("保险库已初始化。", "ALREADY_INITIALIZED");
    if (mode !== "password" && mode !== "device") {
      throw new VaultError("请选择有效的安全模式。", "INVALID_MODE");
    }
    if (mode === "password") {
      this.validateNewPassword(password);
      this.salt = crypto.randomBytes(16);
      this.kdf = kdfParams();
      this.key = await deriveKey(password, this.salt, this.kdf);
      this.envelope = {
        format: VAULT_FORMAT,
        version: VAULT_VERSION,
        mode: "password",
        kdf: {
          name: "scrypt",
          salt: this.salt.toString("base64"),
          ...this.kdf,
        },
      };
    } else {
      if (!deviceProtectionAvailable()) {
        throw new VaultError(
          "此电脑无法使用 Windows 数据保护，请改用主密码模式。",
          "DEVICE_PROTECTION_UNAVAILABLE"
        );
      }
      this.envelope = {
        format: VAULT_FORMAT,
        version: VAULT_VERSION,
        mode: "device",
      };
      this.key = null;
      this.salt = null;
      this.kdf = null;
    }
    this.vault = defaultVault();
    try {
      await this.persist();
    } catch (error) {
      this.vault = null;
      this.envelope = null;
      this.key = null;
      this.salt = null;
      this.kdf = null;
      throw error;
    }
    return this.getRendererVault();
  }

  validateNewPassword(password) {
    if (typeof password !== "string" || password.length < 8) {
      throw new VaultError("主密码至少需要 8 个字符。", "WEAK_PASSWORD");
    }
    if (password.length > 256) {
      throw new VaultError("主密码过长。", "INVALID_PASSWORD");
    }
  }

  async unlock(password) {
    if (!this.envelope) throw new VaultError("保险库尚未初始化。", "NOT_INITIALIZED");
    if (this.envelope.mode === "password") {
      if (typeof password !== "string" || !password) {
        throw new VaultError("请输入主密码。", "PASSWORD_REQUIRED");
      }
      const salt = Buffer.from(this.envelope.kdf.salt, "base64");
      const params = parseKdf(this.envelope);
      let key;
      try {
        key = await deriveKey(password, salt, params);
        const plaintext = decryptWithKey(this.envelope, key);
        this.vault = sanitizeVault(JSON.parse(plaintext));
        this.key = key;
        this.salt = salt;
        this.kdf = params;
        this.lastSavedAt = this.envelope.updatedAt || null;
        this.warning = null;
        return this.getRendererVault();
      } catch (error) {
        if (error instanceof VaultError && error.code === "INVALID_VAULT") {
          throw new VaultError("保险库文件损坏，无法解密。", "INVALID_VAULT");
        }
        throw new VaultError("主密码不正确。", "WRONG_PASSWORD");
      }
    }

    if (!deviceProtectionAvailable()) {
      throw new VaultError(
        "Windows 数据保护当前不可用，无法打开保险库。",
        "DEVICE_PROTECTION_UNAVAILABLE"
      );
    }
    try {
      const encrypted = Buffer.from(this.envelope.ciphertext, "base64");
      const plaintext = safeStorage.decryptString(encrypted);
      this.vault = sanitizeVault(JSON.parse(plaintext));
      this.key = null;
      this.salt = null;
      this.lastSavedAt = this.envelope.updatedAt || null;
      this.warning = null;
      return this.getRendererVault();
    } catch {
      throw new VaultError(
        "无法使用 Windows 数据保护解密保险库。请确认当前 Windows 用户没有变化。",
        "DEVICE_DECRYPT_FAILED"
      );
    }
  }

  lock() {
    this.vault = null;
    this.key = null;
    this.salt = null;
    this.kdf = null;
    return { locked: true };
  }

  async persist() {
    if (!this.vault) throw new VaultError("没有可保存的保险库。", "LOCKED");
    this.vault.updatedAt = new Date().toISOString();
    const plaintext = JSON.stringify(this.vault);
    const envelope = {
      format: VAULT_FORMAT,
      version: VAULT_VERSION,
      mode: this.envelope.mode,
      updatedAt: this.vault.updatedAt,
    };
    if (this.envelope.mode === "password") {
      if (!this.key) throw new VaultError("保险库密钥不可用。", "LOCKED");
      Object.assign(envelope, {
        kdf: {
          name: "scrypt",
          salt: this.salt.toString("base64"),
          ...this.kdf,
        },
        ...encryptWithKey(plaintext, this.key),
      });
    } else {
      if (!deviceProtectionAvailable()) {
        throw new VaultError(
          "Windows 数据保护当前不可用，无法保存。",
          "DEVICE_PROTECTION_UNAVAILABLE"
        );
      }
      envelope.ciphertext = safeStorage
        .encryptString(plaintext)
        .toString("base64");
    }
    await this.writeEnvelope(envelope);
    this.envelope = envelope;
    this.lastSavedAt = this.vault.updatedAt;
  }

  async writeEnvelope(envelope) {
    const tempPath = `${this.vaultPath}.tmp`;
    const payload = JSON.stringify(envelope, null, 2);
    await fs.promises.mkdir(this.dataDir, { recursive: true });
    try {
      const existing = await fs.promises.readFile(this.vaultPath, "utf8");
      await fs.promises.writeFile(this.backupPath, existing, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await fs.promises.writeFile(tempPath, payload, { encoding: "utf8", mode: 0o600 });
    await fs.promises.rename(tempPath, this.vaultPath);
  }

  enqueue(operation) {
    const run = this.opQueue.then(operation, operation);
    this.opQueue = run.catch(() => undefined);
    return run;
  }

  async mutate(mutator) {
    this.requireUnlocked();
    return this.enqueue(async () => {
      this.requireUnlocked();
      const result = await mutator(this.vault);
      await this.persist();
      return result;
    });
  }

  getRendererVault() {
    const vault = this.requireUnlocked();
    return {
      accounts: vault.accounts.map(publicAccount),
      groups: vault.groups.map((group) => ({ ...group })),
      settings: { ...vault.settings },
      meta: {
        createdAt: vault.createdAt,
        updatedAt: vault.updatedAt,
        lastSavedAt: this.lastSavedAt,
        securityMode: this.envelope.mode,
        dataDir: this.dataDir,
        version: this.appVersion,
        warning: this.warning,
      },
    };
  }

  getCodes(at = Date.now()) {
    const vault = this.requireUnlocked();
    const codes = {};
    for (const account of vault.accounts) {
      try {
        codes[account.id] = { ok: true, ...generateCode(account, at) };
      } catch (error) {
        codes[account.id] = {
          ok: false,
          error: error instanceof OtpError ? error.message : "无法生成验证码",
        };
      }
    }
    return { codes, serverNow: at };
  }

  groupExists(groupId) {
    return Boolean(groupId && this.vault.groups.some((group) => group.id === groupId));
  }

  async addAccount(input) {
    return this.mutate((vault) => {
      const account = makeAccount(input);
      if (account.groupId && !this.groupExists(account.groupId)) account.groupId = null;
      account.order = vault.accounts.length
        ? Math.max(...vault.accounts.map((entry) => entry.order)) + 1
        : 0;
      vault.accounts.push(account);
      return publicAccount(account);
    });
  }

  async importAccounts(inputs, { groupId = null, skipDuplicates = true, groups = [] } = {}) {
    return this.mutate((vault) => {
      const groupMap = new Map();
      const groupsAdded = [];
      if (!groupId && Array.isArray(groups)) {
        for (const source of groups) {
          const name = clampString(source?.name, 60).trim();
          if (!name) continue;
          let target = vault.groups.find(
            (group) => group.name.toLowerCase() === name.toLowerCase()
          );
          if (!target) {
            target = {
              id: crypto.randomUUID(),
              name,
              color: /^#[0-9a-f]{6}$/i.test(source.color || "")
                ? source.color
                : GROUP_COLORS[vault.groups.length % GROUP_COLORS.length],
              order: vault.groups.length,
              createdAt: new Date().toISOString(),
            };
            vault.groups.push(target);
            groupsAdded.push({ ...target });
          }
          if (source.id) groupMap.set(String(source.id), target.id);
        }
      }
      const existingFingerprints = new Set(
        vault.accounts.map((account) =>
          crypto
            .createHash("sha256")
            .update(`${account.type}|${account.secret}|${account.issuer}|${account.account}`)
            .digest("hex")
        )
      );
      const added = [];
      const skipped = [];
      const targetGroup = this.groupExists(groupId) ? groupId : null;
      for (const input of inputs) {
        try {
          const desiredGroup = targetGroup || groupMap.get(input.groupId) || input.groupId || null;
          const account = makeAccount({ ...input, groupId: desiredGroup });
          const fingerprint = crypto
            .createHash("sha256")
            .update(`${account.type}|${account.secret}|${account.issuer}|${account.account}`)
            .digest("hex");
          if (skipDuplicates && existingFingerprints.has(fingerprint)) {
            skipped.push({ issuer: account.issuer, account: account.account, reason: "duplicate" });
            continue;
          }
          existingFingerprints.add(fingerprint);
          account.groupId = this.groupExists(account.groupId) ? account.groupId : null;
          account.order = vault.accounts.length
            ? Math.max(...vault.accounts.map((entry) => entry.order)) + 1
            : 0;
          vault.accounts.push(account);
          added.push(publicAccount(account));
        } catch (error) {
          skipped.push({
            issuer: input.issuer || "",
            account: input.account || "",
            reason: error.message,
          });
        }
      }
      return { added, skipped, groupsAdded };
    });
  }

  async updateAccount(id, input) {
    return this.mutate((vault) => {
      const index = vault.accounts.findIndex((account) => account.id === id);
      if (index === -1) throw new VaultError("找不到该验证码。", "ACCOUNT_NOT_FOUND");
      const existing = vault.accounts[index];
      const updated = makeAccount(
        {
          ...input,
          groupId: input.groupId === undefined ? existing.groupId : input.groupId,
          secret: input.secret || existing.secret,
        },
        existing
      );
      updated.id = existing.id;
      updated.order = existing.order;
      updated.createdAt = existing.createdAt;
      if (updated.groupId && !this.groupExists(updated.groupId)) updated.groupId = null;
      vault.accounts[index] = updated;
      return publicAccount(updated);
    });
  }

  async deleteAccount(id) {
    return this.mutate((vault) => {
      const index = vault.accounts.findIndex((account) => account.id === id);
      if (index === -1) throw new VaultError("找不到该验证码。", "ACCOUNT_NOT_FOUND");
      vault.accounts.splice(index, 1);
      vault.accounts.forEach((account, order) => {
        account.order = order;
      });
      return { deleted: true };
    });
  }

  async setPinned(id, pinned) {
    return this.mutate((vault) => {
      const account = vault.accounts.find((entry) => entry.id === id);
      if (!account) throw new VaultError("找不到该验证码。", "ACCOUNT_NOT_FOUND");
      account.pinned = Boolean(pinned);
      account.updatedAt = new Date().toISOString();
      return publicAccount(account);
    });
  }

  async reorder(ids) {
    return this.mutate((vault) => {
      if (!Array.isArray(ids) || !ids.length) return { reordered: false };
      const byId = new Map(vault.accounts.map((account) => [account.id, account]));
      let order = 0;
      const used = new Set();
      for (const id of ids) {
        const account = byId.get(id);
        if (!account || used.has(id)) continue;
        account.order = order++;
        used.add(id);
      }
      for (const account of vault.accounts) {
        if (!used.has(account.id)) account.order = order++;
      }
      vault.accounts.sort((a, b) => a.order - b.order);
      return { reordered: true };
    });
  }

  async incrementCounter(id) {
    return this.mutate((vault) => {
      const account = vault.accounts.find((entry) => entry.id === id);
      if (!account) throw new VaultError("找不到该验证码。", "ACCOUNT_NOT_FOUND");
      if (account.type !== "hotp") {
        throw new VaultError("只有 HOTP 验证码需要手动递增计数器。", "NOT_HOTP");
      }
      account.counter += 1;
      account.updatedAt = new Date().toISOString();
      return { counter: account.counter, ...generateCode(account, Date.now()) };
    });
  }

  async preview(input, id = null) {
    const existing = id
      ? this.requireUnlocked().accounts.find((account) => account.id === id)
      : null;
    const account = makeAccount(
      {
        ...input,
        secret: input.secret || existing?.secret || "",
        secretType: input.secretType || existing?.secretType,
      },
      existing
    );
    return generateCode(account, Date.now());
  }

  async getSecret(id) {
    const account = this.requireUnlocked().accounts.find((entry) => entry.id === id);
    if (!account) throw new VaultError("找不到该验证码。", "ACCOUNT_NOT_FOUND");
    return { secret: account.secret, secretType: account.secretType };
  }

  async getOtpUri(id) {
    const account = this.requireUnlocked().accounts.find((entry) => entry.id === id);
    if (!account) throw new VaultError("找不到该验证码。", "ACCOUNT_NOT_FOUND");
    return { uri: buildOtpUri(account) };
  }

  async createGroup({ name, color }) {
    return this.mutate((vault) => {
      const trimmed = clampString(name, 60).trim();
      if (!trimmed) throw new VaultError("请输入分组名称。", "INVALID_GROUP");
      if (
        vault.groups.some(
          (group) => group.name.toLowerCase() === trimmed.toLowerCase()
        )
      ) {
        throw new VaultError("已经存在同名分组。", "DUPLICATE_GROUP");
      }
      const group = {
        id: crypto.randomUUID(),
        name: trimmed,
        color: /^#[0-9a-f]{6}$/i.test(color || "")
          ? color
          : GROUP_COLORS[vault.groups.length % GROUP_COLORS.length],
        order: vault.groups.length,
        createdAt: new Date().toISOString(),
      };
      vault.groups.push(group);
      return { ...group };
    });
  }

  async updateGroup(id, { name, color }) {
    return this.mutate((vault) => {
      const group = vault.groups.find((item) => item.id === id);
      if (!group) throw new VaultError("找不到该分组。", "GROUP_NOT_FOUND");
      if (name !== undefined) {
        const trimmed = clampString(name, 60).trim();
        if (!trimmed) throw new VaultError("请输入分组名称。", "INVALID_GROUP");
        if (
          vault.groups.some(
            (item) =>
              item.id !== id && item.name.toLowerCase() === trimmed.toLowerCase()
          )
        ) {
          throw new VaultError("已经存在同名分组。", "DUPLICATE_GROUP");
        }
        group.name = trimmed;
      }
      if (color !== undefined && /^#[0-9a-f]{6}$/i.test(color)) group.color = color;
      return { ...group };
    });
  }

  async deleteGroup(id) {
    return this.mutate((vault) => {
      const index = vault.groups.findIndex((group) => group.id === id);
      if (index === -1) throw new VaultError("找不到该分组。", "GROUP_NOT_FOUND");
      vault.groups.splice(index, 1);
      vault.groups.forEach((group, order) => {
        group.order = order;
      });
      vault.accounts.forEach((account) => {
        if (account.groupId === id) account.groupId = null;
      });
      return { deleted: true };
    });
  }

  async updateSettings(patch) {
    if (!patch || typeof patch !== "object") {
      throw new VaultError("设置内容无效。", "INVALID_SETTINGS");
    }
    return this.mutate((vault) => {
      const next = { ...vault.settings };
      for (const [key, value] of Object.entries(patch)) {
        if (!SETTING_KEYS.has(key)) continue;
        next[key] = value;
      }
      vault.settings = sanitizeSettings(next);
      return { ...vault.settings };
    });
  }

  async changePassword(currentPassword, newPassword) {
    this.requireUnlocked();
    if (this.envelope?.mode !== "password") {
      throw new VaultError("当前保险库没有主密码。", "NO_PASSWORD");
    }
    this.validateNewPassword(newPassword);
    if (typeof currentPassword !== "string" || !currentPassword) {
      throw new VaultError("请输入当前主密码。", "PASSWORD_REQUIRED");
    }
    return this.enqueue(async () => {
      const oldSalt = Buffer.from(this.envelope.kdf.salt, "base64");
      const oldParams = parseKdf(this.envelope);
      const oldKey = await deriveKey(currentPassword, oldSalt, oldParams);
      let plaintext;
      try {
        plaintext = decryptWithKey(this.envelope, oldKey);
      } catch {
        throw new VaultError("当前主密码不正确。", "WRONG_PASSWORD");
      }
      const parsed = JSON.parse(plaintext);
      const newSalt = crypto.randomBytes(16);
      const params = kdfParams();
      const newKey = await deriveKey(newPassword, newSalt, params);
      const previous = {
        vault: this.vault,
        envelope: this.envelope,
        key: this.key,
        salt: this.salt,
        kdf: this.kdf,
      };
      this.vault = sanitizeVault(parsed);
      this.key = newKey;
      this.salt = newSalt;
      this.kdf = params;
      try {
        await this.persist();
      } catch (error) {
        this.vault = previous.vault;
        this.envelope = previous.envelope;
        this.key = previous.key;
        this.salt = previous.salt;
        this.kdf = previous.kdf;
        throw error;
      }
      return { changed: true };
    });
  }

  async protectWithPassword(newPassword) {
    this.requireUnlocked();
    if (this.envelope?.mode !== "device") {
      throw new VaultError("当前保险库已经使用主密码。", "ALREADY_PASSWORD");
    }
    this.validateNewPassword(newPassword);
    return this.enqueue(async () => {
      const newSalt = crypto.randomBytes(16);
      const params = kdfParams();
      this.key = await deriveKey(newPassword, newSalt, params);
      this.salt = newSalt;
      this.kdf = params;
      this.envelope = {
        format: VAULT_FORMAT,
        version: VAULT_VERSION,
        mode: "password",
      };
      await this.persist();
      return { changed: true, mode: "password" };
    });
  }

  async removePassword(currentPassword) {
    this.requireUnlocked();
    if (this.envelope?.mode !== "password") {
      throw new VaultError("当前保险库没有主密码。", "NO_PASSWORD");
    }
    if (!deviceProtectionAvailable()) {
      throw new VaultError("Windows 数据保护不可用。", "DEVICE_PROTECTION_UNAVAILABLE");
    }
    const oldSalt = Buffer.from(this.envelope.kdf.salt, "base64");
    const oldParams = parseKdf(this.envelope);
    const oldKey = await deriveKey(currentPassword, oldSalt, oldParams);
    try {
      decryptWithKey(this.envelope, oldKey);
    } catch {
      throw new VaultError("主密码不正确。", "WRONG_PASSWORD");
    }
    return this.enqueue(async () => {
      this.key = null;
      this.salt = null;
      this.kdf = null;
      this.envelope = {
        format: VAULT_FORMAT,
        version: VAULT_VERSION,
        mode: "device",
      };
      await this.persist();
      return { changed: true, mode: "device" };
    });
  }

  async exportPayload() {
    const vault = this.requireUnlocked();
    return {
      app: "Authenticator Desktop",
      version: this.appVersion,
      exportedAt: new Date().toISOString(),
      accounts: vault.accounts.map((account) => ({ ...account })),
      groups: vault.groups.map((group) => ({ ...group })),
    };
  }

  async reset() {
    this.lock();
    this.envelope = null;
    for (const target of [this.vaultPath, this.backupPath, `${this.vaultPath}.tmp`]) {
      try {
        await fs.promises.unlink(target);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    this.warning = null;
    return { reset: true };
  }
}

module.exports = {
  SETTING_KEYS,
  VaultError,
  VaultStore,
  decryptWithKey,
  deriveKey,
  encryptWithKey,
  kdfParams,
  secureCompare,
  defaultSettings,
  defaultVault,
};
