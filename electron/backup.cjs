"use strict";

const crypto = require("node:crypto");
const { TextDecoder } = require("node:util");
const {
  buildOtpUri,
  normalizeAccount,
  parseOtpText,
} = require("./otp.cjs");
const {
  decryptWithKey,
  deriveKey,
  encryptWithKey,
  kdfParams,
} = require("./vault-store.cjs");

const APP_BACKUP_FORMAT = "authenticator-desktop-backup";
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

class BackupError extends Error {
  constructor(message, code = "INVALID_BACKUP") {
    super(message);
    this.name = "BackupError";
    this.code = code;
  }
}

function evpBytesToKey(passphrase, salt, keyLength = 32, ivLength = 16) {
  const password = Buffer.from(String(passphrase), "utf8");
  let derived = Buffer.alloc(0);
  let block = Buffer.alloc(0);
  while (derived.length < keyLength + ivLength) {
    block = crypto
      .createHash("md5")
      .update(Buffer.concat([block, password, salt]))
      .digest();
    derived = Buffer.concat([derived, block]);
  }
  return {
    key: derived.subarray(0, keyLength),
    iv: derived.subarray(keyLength, keyLength + ivLength),
  };
}

function decryptCryptoJs(cipherText, passphrase) {
  if (typeof cipherText !== "string" || !cipherText.trim()) {
    throw new BackupError("加密数据为空。", "DECRYPT_FAILED");
  }
  let payload;
  try {
    payload = Buffer.from(cipherText.trim(), "base64");
  } catch {
    throw new BackupError("无法解码加密数据。", "DECRYPT_FAILED");
  }
  if (payload.length < 32 || payload.subarray(0, 8).toString("ascii") !== "Salted__") {
    throw new BackupError("加密数据格式不受支持。", "DECRYPT_FAILED");
  }
  const salt = payload.subarray(8, 16);
  const ciphertext = payload.subarray(16);
  const { key, iv } = evpBytesToKey(passphrase, salt);
  try {
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return utf8Decoder.decode(plaintext);
  } catch {
    throw new BackupError("密码不正确，或备份已损坏。", "WRONG_PASSWORD");
  }
}

function isCryptoJsCipher(value) {
  return typeof value === "string" && value.startsWith("U2FsdGVkX1");
}

function normalizeAlgorithmValue(value) {
  if (value === null || value === undefined || value === "") return "SHA1";
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 3) {
    return { 1: "SHA1", 2: "SHA256", 3: "SHA512" }[numeric];
  }
  return String(value).toUpperCase().replace(/-/g, "");
}

function normalizeTypeValue(value) {
  if (value === null || value === undefined || value === "") return "totp";
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 6) {
    return { 1: "totp", 2: "hotp", 3: "battle", 4: "steam", 5: "hex", 6: "hhex" }[
      numeric
    ];
  }
  return String(value).toLowerCase();
}

function looksLikeBase32(secret) {
  return /^[a-z2-7]+=*$/i.test(String(secret || "").replace(/\s/g, ""));
}

function entryFromExtensionStorage(hash, storage) {
  if (!storage || typeof storage !== "object") return null;
  let typeRaw = normalizeTypeValue(storage.type);
  let originalType = typeRaw;
  let rawSecret = String(storage.secret || "").replace(/\s/g, "");
  if (!rawSecret) return null;
  if (/^stm-/i.test(rawSecret)) {
    rawSecret = rawSecret.replace(/^stm-/i, "");
    typeRaw = "steam";
    originalType = "steam";
  } else if (/^(blz-|bliz-)/i.test(rawSecret)) {
    rawSecret = rawSecret.replace(/^(blz-|bliz-)/i, "");
    typeRaw = "totp";
    originalType = "battle";
  }
  let secretType = "base32";
  if (typeRaw === "hex" || typeRaw === "hhex") {
    secretType = "hex";
    typeRaw = typeRaw === "hex" ? "totp" : "hotp";
  }
  if (typeRaw === "battle") typeRaw = "totp";
  if (!looksLikeBase32(rawSecret) && /^[0-9a-f]+$/i.test(rawSecret)) {
    secretType = "hex";
  }
  const digits =
    originalType === "steam"
      ? 5
      : originalType === "battle"
        ? 8
        : Number(storage.digits) || 6;
  return normalizeAccount({
    type: typeRaw,
    issuer: storage.issuer || "",
    account: storage.account || "",
    secret: rawSecret,
    secretType,
    algorithm: normalizeAlgorithmValue(storage.algorithm),
    digits,
    period: storage.period || 30,
    counter: storage.counter || 0,
    pinned: Boolean(storage.pinned),
    notes: storage.notes || "",
  });
}

function isKeyObject(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      value.dataType === "Key" &&
      typeof value.id === "string" &&
      (typeof value.salt === "string" || typeof value.salt === "object") &&
      typeof value.hash === "string"
  );
}

async function deriveExtensionKey(password, key) {
  const { argon2id, argon2Verify } = await import("hash-wasm");
  const saltCandidates = [];
  if (typeof key.salt === "string") {
    saltCandidates.push(Buffer.from(key.salt, "utf8"));
    try {
      const decoded = Buffer.from(key.salt, "base64");
      if (decoded.length) saltCandidates.push(decoded);
    } catch {
      // Ignore malformed base64 candidates.
    }
  } else if (key.salt && key.salt.type === "Buffer" && Array.isArray(key.salt.data)) {
    saltCandidates.push(Buffer.from(key.salt.data));
  }
  if (!saltCandidates.length) throw new BackupError("密钥缺少盐值。", "INVALID_BACKUP");

  for (const salt of saltCandidates) {
    try {
      const encoded = await argon2id({
        password,
        salt: new Uint8Array(salt),
        parallelism: 1,
        iterations: 2,
        memorySize: 19456,
        hashLength: 32,
        outputType: "encoded",
      });
      const possibleHash = encoded.split("$")[5];
      if (!possibleHash) continue;
      if (key.hash) {
        const valid = await argon2Verify({ password: possibleHash, hash: key.hash });
        if (!valid) continue;
      }
      return possibleHash;
    } catch {
      // Try the next salt interpretation.
    }
  }
  return null;
}

async function decryptExtensionBackup(data, password) {
  const values = Object.values(data).filter((value) => value && typeof value === "object");
  const keys = values.filter(isKeyObject);
  const encryptedEntries = values.filter(
    (value) => value.dataType === "EncOTPStorage" && typeof value.data === "string"
  );
  const legacyEncrypted = values.filter(
    (value) => value.encrypted === true && isCryptoJsCipher(value.secret)
  );
  const v2Key = data.key && typeof data.key === "object" && data.key.enc ? data.key : null;
  const encrypted =
    encryptedEntries.length > 0 || legacyEncrypted.length > 0 || Boolean(v2Key);

  if (!encrypted) {
    return { data, warnings: [] };
  }
  if (!password) {
    return {
      needsPassword: true,
      source:
        encryptedEntries.length > 0
          ? "Authenticator 浏览器插件（v3 加密备份）"
          : v2Key
            ? "Authenticator 浏览器插件（v2 加密备份）"
            : "Authenticator 浏览器插件（v1 加密备份）",
    };
  }

  const decrypted = {};
  const warnings = [];
  let decryptionKey = null;

  if (keys.length && encryptedEntries.length) {
    for (const key of keys) {
      const derived = await deriveExtensionKey(password, key);
      if (derived) {
        decryptionKey = derived;
        break;
      }
    }
    if (!decryptionKey) {
      throw new BackupError("备份密码不正确。", "WRONG_PASSWORD");
    }
  } else if (v2Key) {
    decryptionKey = decryptCryptoJs(v2Key.enc, password);
  } else if (legacyEncrypted.length) {
    decryptionKey = password;
  }

  for (const [hash, value] of Object.entries(data)) {
    if (!value || typeof value !== "object" || value.dataType === "Key") continue;
    if (value.dataType === "EncOTPStorage") {
      try {
        if (!decryptionKey) throw new Error("missing key");
        const plaintext = decryptCryptoJs(value.data, decryptionKey);
        const storage = JSON.parse(plaintext);
        storage.encrypted = false;
        decrypted[hash] = storage;
      } catch {
        warnings.push("跳过了一条无法解密的记录。");
      }
    } else if (value.encrypted === true && isCryptoJsCipher(value.secret)) {
      try {
        const secret = decryptCryptoJs(value.secret, password);
        decrypted[hash] = { ...value, secret, encrypted: false };
      } catch {
        warnings.push("跳过了一条无法解密的记录。");
      }
    } else {
      decrypted[hash] = value;
    }
  }
  if (!Object.keys(decrypted).length) {
    throw new BackupError("备份密码不正确，或备份中没有可导入的数据。", "WRONG_PASSWORD");
  }
  return { data: decrypted, warnings };
}

function extensionEntriesToAccounts(data, warnings) {
  const accounts = [];
  for (const [hash, storage] of Object.entries(data)) {
    if (!storage || typeof storage !== "object") continue;
    if (storage.dataType === "Key" || storage.dataType === "EncOTPStorage") continue;
    if (!storage.secret) continue;
    try {
      const account = entryFromExtensionStorage(hash, storage);
      if (account) accounts.push(account);
    } catch (error) {
      warnings.push(`跳过 ${storage.issuer || storage.account || "一条记录"}：${error.message}`);
    }
  }
  return accounts;
}

async function decryptAppBackup(backup, password) {
  if (!password) {
    return { needsPassword: true, source: "Authenticator Desktop 加密备份" };
  }
  try {
    const kdf = backup.kdf || {};
    const salt = Buffer.from(kdf.salt || "", "base64");
    const params = {
      N: Number(kdf.N) || 32768,
      r: Number(kdf.r) || 8,
      p: Number(kdf.p) || 1,
    };
    if (!salt.length) throw new Error("missing salt");
    const key = await deriveKey(password, salt, params);
    const payload = backup.cipher || backup;
    const plaintext = decryptWithKey(
      {
        iv: payload.iv,
        tag: payload.tag,
        ciphertext: payload.ciphertext || payload.data,
      },
      key
    );
    const parsed = JSON.parse(plaintext);
    return { data: parsed, warnings: [] };
  } catch {
    throw new BackupError("备份密码不正确，或备份文件已损坏。", "WRONG_PASSWORD");
  }
}

function appBackupToAccounts(payload, warnings) {
  if (!Array.isArray(payload.accounts)) {
    throw new BackupError("备份中缺少账户列表。", "INVALID_BACKUP");
  }
  const accounts = [];
  for (const raw of payload.accounts) {
    try {
      const account = normalizeAccount(raw);
      accounts.push({ ...account, groupName: null });
    } catch (error) {
      warnings.push(`跳过 ${raw.issuer || raw.account || "一条记录"}：${error.message}`);
    }
  }
  return accounts;
}

function isLikelyJson(text) {
  const trimmed = String(text || "").trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

async function inspectImport({ text, password = null }) {
  if (typeof text !== "string" || !text.trim()) {
    throw new BackupError("备份内容为空。", "INVALID_BACKUP");
  }
  text = text.replace(/^\uFEFF/, "");
  if (text.length > 20 * 1024 * 1024) {
    throw new BackupError("备份文件过大。", "INVALID_BACKUP");
  }
  const warnings = [];
  let parsed;
  if (isLikelyJson(text)) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new BackupError("JSON 文件格式不正确。", "INVALID_BACKUP");
    }
  } else {
    const result = parseOtpText(text);
    return {
      status: "ok",
      accounts: result.accounts,
      warnings: result.warnings,
      source: "otpauth 链接",
      groups: [],
    };
  }

  if (Array.isArray(parsed)) {
    const accounts = [];
    for (const item of parsed) {
      if (typeof item === "string") {
        try {
          const result = parseOtpText(item);
          accounts.push(...result.accounts);
        } catch (error) {
          warnings.push(error.message);
        }
      } else if (item && typeof item === "object" && item.secret) {
        try {
          accounts.push(normalizeAccount(item));
        } catch (error) {
          warnings.push(error.message);
        }
      }
    }
    if (!accounts.length) throw new BackupError("文件中没有可导入的验证码。", "INVALID_BACKUP");
    return { status: "ok", accounts, warnings, source: "JSON 账户列表", groups: [] };
  }

  if (!parsed || typeof parsed !== "object") {
    throw new BackupError("备份格式不受支持。", "INVALID_BACKUP");
  }

  if (parsed.format === APP_BACKUP_FORMAT) {
    let payload = parsed;
    let source = "Authenticator Desktop 明文备份";
    if (parsed.encrypted === true) {
      const decrypted = await decryptAppBackup(parsed, password);
      if (decrypted.needsPassword) {
        return { status: "password_required", source: decrypted.source };
      }
      payload = decrypted.data;
      warnings.push(...decrypted.warnings);
      source = "Authenticator Desktop 加密备份";
    }
    const accounts = appBackupToAccounts(payload, warnings);
    if (!accounts.length) throw new BackupError("备份中没有可导入的验证码。", "INVALID_BACKUP");
    return {
      status: "ok",
      accounts,
      warnings,
      source,
      groups: Array.isArray(payload.groups) ? payload.groups : [],
      exportedAt: payload.exportedAt || parsed.exportedAt || null,
    };
  }

  if (parsed.format === "authenticator-desktop-vault") {
    throw new BackupError(
      "这是应用内部的保险库文件，不能直接导入。请使用“导出备份”。",
      "INVALID_BACKUP"
    );
  }

  const looksLikeExtension =
    Object.values(parsed).some(
      (value) =>
        value &&
        typeof value === "object" &&
        (value.dataType === "OTPStorage" ||
          value.dataType === "EncOTPStorage" ||
          value.dataType === "Key" ||
          typeof value.secret === "string")
    ) || Boolean(parsed.key);

  if (looksLikeExtension) {
    const decrypted = await decryptExtensionBackup(parsed, password);
    if (decrypted.needsPassword) {
      return { status: "password_required", source: decrypted.source };
    }
    warnings.push(...(decrypted.warnings || []));
    const accounts = extensionEntriesToAccounts(decrypted.data, warnings);
    if (!accounts.length) {
      throw new BackupError("备份中没有可导入的验证码。", "INVALID_BACKUP");
    }
    return {
      status: "ok",
      accounts,
      warnings,
      source: "Authenticator 浏览器插件备份",
      groups: [],
    };
  }

  if (parsed.accounts && Array.isArray(parsed.accounts)) {
    const accounts = appBackupToAccounts(parsed, warnings);
    if (!accounts.length) throw new BackupError("备份中没有可导入的验证码。", "INVALID_BACKUP");
    return { status: "ok", accounts, warnings, source: "通用 JSON 备份", groups: [] };
  }

  throw new BackupError(
    "无法识别此备份格式。支持 Authenticator Desktop、Authenticator 浏览器插件、otpauth 链接及通用 JSON。",
    "INVALID_BACKUP"
  );
}

function createPlainBackup(payload) {
  return JSON.stringify(
    {
      format: APP_BACKUP_FORMAT,
      version: 1,
      encrypted: false,
      exportedAt: new Date().toISOString(),
      appVersion: payload.version,
      accounts: payload.accounts,
      groups: payload.groups,
    },
    null,
    2
  );
}

async function createEncryptedBackup(payload, password) {
  if (typeof password !== "string" || password.length < 8) {
    throw new BackupError("备份密码至少需要 8 个字符。", "WEAK_PASSWORD");
  }
  const salt = crypto.randomBytes(16);
  const params = kdfParams();
  const key = await deriveKey(password, salt, params);
  const plaintext = JSON.stringify({
    format: APP_BACKUP_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    appVersion: payload.version,
    accounts: payload.accounts,
    groups: payload.groups,
  });
  const encrypted = encryptWithKey(plaintext, key);
  return JSON.stringify(
    {
      format: APP_BACKUP_FORMAT,
      version: 1,
      encrypted: true,
      exportedAt: new Date().toISOString(),
      kdf: { name: "scrypt", salt: salt.toString("base64"), ...params },
      cipher: {
        name: "aes-256-gcm",
        iv: encrypted.iv,
        tag: encrypted.tag,
        ciphertext: encrypted.ciphertext,
      },
    },
    null,
    2
  );
}

function createExtensionBackup(payload) {
  const data = {};
  payload.accounts.forEach((account, index) => {
    const hash = crypto.randomUUID();
    const type =
      account.type === "steam"
        ? "steam"
        : account.secretType === "hex"
          ? account.type === "hotp"
            ? "hhex"
            : "hex"
          : account.type;
    const entry = {
      dataType: "OTPStorage",
      encrypted: false,
      hash,
      index,
      account: account.account || "",
      issuer: account.issuer || "",
      secret:
        account.type === "steam" ? `stm-${account.secret}` : account.secret,
      type,
    };
    if (account.type === "hotp") entry.counter = account.counter || 0;
    if (account.type === "totp" && Number(account.period) !== 30) entry.period = account.period;
    if (Number(account.digits) !== 6) entry.digits = account.digits;
    if (account.algorithm !== "SHA1") entry.algorithm = account.algorithm;
    if (account.pinned) entry.pinned = true;
    data[hash] = entry;
  });
  return JSON.stringify(data, null, 2);
}

function createOtpAuthText(payload) {
  return payload.accounts
    .filter((account) => account.type !== "steam")
    .map((account) => buildOtpUri(account))
    .join("\r\n");
}

module.exports = {
  APP_BACKUP_FORMAT,
  BackupError,
  createEncryptedBackup,
  createExtensionBackup,
  createOtpAuthText,
  createPlainBackup,
  decryptCryptoJs,
  inspectImport,
};
