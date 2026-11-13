"use strict";

const crypto = require("node:crypto");

const ALGORITHMS = new Set(["SHA1", "SHA256", "SHA512"]);
const TYPES = new Set(["totp", "hotp", "steam"]);
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEAM_ALPHABET = "23456789BCDFGHJKMNPQRTVWXY";

class OtpError extends Error {
  constructor(message, code = "INVALID_OTP") {
    super(message);
    this.name = "OtpError";
    this.code = code;
  }
}

function toSafeString(value, max = 512) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\u0000/g, "").slice(0, max);
}

function normalizeAlgorithm(value) {
  const algorithm = toSafeString(value, 16).toUpperCase().replace(/-/g, "");
  if (!algorithm) return "SHA1";
  if (algorithm === "SHA1" || algorithm === "SHA256" || algorithm === "SHA512") {
    return algorithm;
  }
  throw new OtpError("仅支持 SHA-1、SHA-256 和 SHA-512 算法。", "INVALID_ALGORITHM");
}

function normalizeType(value) {
  const type = toSafeString(value, 16).toLowerCase();
  if (TYPES.has(type)) return type;
  if (type === "battle") return "totp";
  if (type === "hex") return "totp";
  if (type === "hhex") return "hotp";
  throw new OtpError("验证码类型不受支持。", "INVALID_TYPE");
}

function stripSecret(secret) {
  return toSafeString(secret, 2048).replace(/[\s_-]+/g, "").replace(/=+$/g, "");
}

function decodeBase32(secret) {
  const normalized = stripSecret(secret).toUpperCase();
  if (!normalized) throw new OtpError("请输入密钥。", "SECRET_REQUIRED");
  if (!/^[A-Z2-7]+$/.test(normalized)) {
    throw new OtpError("密钥不是有效的 Base32 格式，只能包含 A-Z 和 2-7。", "INVALID_SECRET");
  }
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of normalized) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (bytes.length < 4) {
    throw new OtpError("密钥太短，请检查后重试。", "SECRET_TOO_SHORT");
  }
  return Buffer.from(bytes);
}

function encodeBase32(bytes) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function normalizeSecret(secret, secretType) {
  const raw = stripSecret(secret);
  if (secretType === "hex") {
    if (!/^[0-9a-fA-F]+$/.test(raw) || raw.length % 2 !== 0) {
      throw new OtpError("十六进制密钥格式不正确。", "INVALID_SECRET");
    }
    const key = Buffer.from(raw, "hex");
    if (key.length < 4) {
      throw new OtpError("密钥太短，请检查后重试。", "SECRET_TOO_SHORT");
    }
    return { secret: raw.toLowerCase(), secretType: "hex" };
  }
  decodeBase32(raw);
  return { secret: raw.toUpperCase(), secretType: "base32" };
}

function secretToBuffer(account) {
  if (account.secretType === "hex") {
    const buffer = Buffer.from(account.secret, "hex");
    if (!buffer.length) throw new OtpError("密钥为空。", "SECRET_REQUIRED");
    return buffer;
  }
  return decodeBase32(account.secret);
}

function counterBuffer(counter) {
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new OtpError("计数器必须是非负整数。", "INVALID_COUNTER");
  }
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  return buffer;
}

function hmac(algorithm, key, message) {
  const nodeAlgorithm = {
    SHA1: "sha1",
    SHA256: "sha256",
    SHA512: "sha512",
  }[algorithm];
  if (!nodeAlgorithm) throw new OtpError("不支持的哈希算法。", "INVALID_ALGORITHM");
  return crypto.createHmac(nodeAlgorithm, key).update(message).digest();
}

function truncate(digest) {
  const offset = digest[digest.length - 1] & 0x0f;
  return (
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  );
}

function steamCode(value) {
  let output = "";
  let number = value;
  for (let i = 0; i < 5; i += 1) {
    output += STEAM_ALPHABET[number % STEAM_ALPHABET.length];
    number = Math.floor(number / STEAM_ALPHABET.length);
  }
  return output;
}

function generateRaw(account, counter) {
  const key = secretToBuffer(account);
  const digest = hmac(account.algorithm || "SHA1", key, counterBuffer(counter));
  const binary = truncate(digest);
  if (account.type === "steam") return steamCode(binary);
  const digits = Number(account.digits) || 6;
  const modulo = 10 ** digits;
  return String(binary % modulo).padStart(digits, "0");
}

function currentCounter(account, at = Date.now()) {
  if (account.type === "hotp") return Number(account.counter) || 0;
  const period = Number(account.period) || 30;
  return Math.floor(at / 1000 / period);
}

function generateCode(account, at = Date.now()) {
  const period = account.type === "hotp" ? null : Number(account.period) || 30;
  const counter = currentCounter(account, at);
  const code = generateRaw(account, counter);
  let remaining = null;
  let progress = null;
  if (period) {
    const epoch = Math.floor(at / 1000);
    remaining = period - (epoch % period);
    progress = remaining / period;
  }
  return { code, counter, remaining, period, progress };
}

function validateCounter(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new OtpError("计数器必须是非负整数。", "INVALID_COUNTER");
  }
  return number;
}

function validatePeriod(value, type) {
  if (type === "steam") return 30;
  if (type === "hotp") return 30;
  const number = Number(value || 30);
  if (!Number.isFinite(number) || number < 5 || number > 86400) {
    throw new OtpError("刷新周期应在 5 到 86400 秒之间。", "INVALID_PERIOD");
  }
  return Math.round(number);
}

function validateDigits(value, type) {
  if (type === "steam") return 5;
  const number = Number(value || 6);
  if (!Number.isInteger(number) || number < 1 || number > 10) {
    throw new OtpError("验证码位数应在 1 到 10 之间。", "INVALID_DIGITS");
  }
  return number;
}

function normalizeAccount(input = {}, { partial = false } = {}) {
  const type = normalizeType(input.type || "totp");
  let secret = toSafeString(input.secret, 2048).trim();
  let secretType = input.secretType === "hex" ? "hex" : "base32";
  if (type === "steam") secretType = "base32";

  if (!secret && !partial) {
    throw new OtpError("请输入密钥。", "SECRET_REQUIRED");
  }

  let normalizedSecret = secret;
  if (secret) {
    const normalized = normalizeSecret(secret, secretType);
    normalizedSecret = normalized.secret;
    secretType = normalized.secretType;
  }

  let issuer = toSafeString(input.issuer, 200).trim().replace(/\s+/g, " ");
  let accountName = toSafeString(input.account, 200).trim();
  if (!issuer && !accountName) {
    throw new OtpError("请填写发行方或账户名称。", "LABEL_REQUIRED");
  }
  if (!issuer) issuer = "";

  const algorithm = type === "steam" ? "SHA1" : normalizeAlgorithm(input.algorithm);
  const digits = validateDigits(input.digits, type);
  const period = validatePeriod(input.period, type);
  const counter = type === "hotp" ? validateCounter(input.counter || 0) : 0;

  const result = {
    type,
    issuer,
    account: accountName,
    secret: normalizedSecret,
    secretType,
    algorithm,
    digits,
    period,
    counter,
    pinned: Boolean(input.pinned),
    groupId: input.groupId ? toSafeString(input.groupId, 80) : null,
    notes: toSafeString(input.notes, 1000),
  };

  if (secret) {
    const preview = generateCode(result, Date.now());
    if (!preview.code) throw new OtpError("无法使用此密钥生成验证码。", "INVALID_SECRET");
  }

  return result;
}

function makeAccount(input, existing = null) {
  const now = new Date().toISOString();
  const base = existing || {
    id: crypto.randomUUID(),
    createdAt: now,
    order: 0,
  };
  const normalized = normalizeAccount(
    {
      ...base,
      ...input,
      secret: input.secret ? input.secret : existing ? existing.secret : "",
      secretType: input.secretType || (existing ? existing.secretType : "base32"),
    },
    { partial: Boolean(existing) }
  );
  return {
    ...base,
    ...normalized,
    updatedAt: now,
  };
}

function displayLabel(account) {
  return [account.issuer, account.account].filter(Boolean).join(" · ") || "未命名验证码";
}

function buildOtpUri(account, { includeSecret = true } = {}) {
  const type = account.type === "steam" ? "steam" : account.type;
  let label = "";
  if (account.issuer && account.account) {
    label = `${encodeURIComponent(account.issuer)}:${encodeURIComponent(account.account)}`;
  } else if (account.issuer || account.account) {
    label = encodeURIComponent(account.issuer || account.account);
  }
  const params = new URLSearchParams();
  if (includeSecret) {
    if (account.secretType === "hex") {
      params.set("secret", encodeBase32(Buffer.from(account.secret, "hex")));
    } else {
      params.set("secret", account.secret);
    }
  }
  if (account.issuer) params.set("issuer", account.issuer);
  if (account.type !== "steam") {
    if (account.algorithm !== "SHA1") params.set("algorithm", account.algorithm);
    if (Number(account.digits) !== 6) params.set("digits", String(account.digits));
    if (account.type === "totp" && Number(account.period) !== 30) {
      params.set("period", String(account.period));
    }
    if (account.type === "hotp") params.set("counter", String(account.counter || 0));
  }
  return `otpauth://${type}/${label}?${params.toString()}`;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseOtpUri(uri) {
  if (typeof uri !== "string" || !uri.trim().toLowerCase().startsWith("otpauth://")) {
    throw new OtpError("不是有效的 otpauth 链接。", "INVALID_URI");
  }
  let parsed;
  try {
    parsed = new URL(uri.trim());
  } catch {
    throw new OtpError("otpauth 链接格式不正确。", "INVALID_URI");
  }
  let type = parsed.hostname.toLowerCase();
  const originalType = type;
  if (type === "battle") type = "totp";
  if (type === "hex") type = "totp";
  if (type === "hhex") type = "hotp";
  if (!TYPES.has(type)) {
    throw new OtpError(`不支持的验证码类型：${type}`, "INVALID_TYPE");
  }

  const rawLabel = safeDecode(parsed.pathname.replace(/^\/+/, ""));
  let issuer = parsed.searchParams.get("issuer") || "";
  let account = rawLabel;
  if (rawLabel.includes(":")) {
    const separator = rawLabel.indexOf(":");
    const prefix = rawLabel.slice(0, separator).trim();
    const rest = rawLabel.slice(separator + 1).trim();
    if (!issuer) issuer = prefix;
    account = rest;
  }
  if (issuer && account.toLowerCase().startsWith(`${issuer.toLowerCase()}:`)) {
    account = account.slice(issuer.length + 1).trim();
  }
  if (!issuer && account.includes(":")) {
    const [maybeIssuer, ...rest] = account.split(":");
    if (rest.join(":").trim()) {
      issuer = maybeIssuer.trim();
      account = rest.join(":").trim();
    }
  }

  const secretType =
    parsed.searchParams.get("secretType") === "hex" ||
    parsed.hostname.toLowerCase() === "hex" ||
    parsed.hostname.toLowerCase() === "hhex"
      ? "hex"
      : "base32";

  let digits = parsed.searchParams.get("digits")
    ? Number(parsed.searchParams.get("digits"))
    : 6;
  if (type === "steam") digits = 5;
  if (originalType === "battle") digits = 8;

  return normalizeAccount({
    type,
    issuer: toSafeString(issuer, 200).trim(),
    account: toSafeString(account, 200).trim(),
    secret: parsed.searchParams.get("secret") || "",
    secretType,
    algorithm: parsed.searchParams.get("algorithm") || "SHA1",
    digits,
    period: parsed.searchParams.get("period") || 30,
    counter: parsed.searchParams.get("counter") || 0,
  });
}

function readVarint(buffer, state) {
  let value = 0;
  let shift = 0;
  while (state.offset < buffer.length) {
    const byte = buffer[state.offset++];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return value;
    shift += 7;
    if (shift > 53) throw new OtpError("迁移数据损坏。", "INVALID_MIGRATION");
  }
  throw new OtpError("迁移数据不完整。", "INVALID_MIGRATION");
}

function readLengthDelimited(buffer, state) {
  const length = readVarint(buffer, state);
  if (!Number.isSafeInteger(length) || length < 0 || state.offset + length > buffer.length) {
    throw new OtpError("迁移数据损坏。", "INVALID_MIGRATION");
  }
  const data = buffer.subarray(state.offset, state.offset + length);
  state.offset += length;
  return data;
}

function parseProtoFields(buffer) {
  const fields = [];
  const state = { offset: 0 };
  while (state.offset < buffer.length) {
    const tag = readVarint(buffer, state);
    const field = tag >>> 3;
    const wire = tag & 7;
    if (!field) throw new OtpError("迁移数据损坏。", "INVALID_MIGRATION");
    if (wire === 0) {
      fields.push({ field, wire, value: readVarint(buffer, state) });
    } else if (wire === 2) {
      fields.push({ field, wire, value: readLengthDelimited(buffer, state) });
    } else if (wire === 1) {
      if (state.offset + 8 > buffer.length) throw new OtpError("迁移数据损坏。", "INVALID_MIGRATION");
      fields.push({ field, wire, value: buffer.subarray(state.offset, state.offset + 8) });
      state.offset += 8;
    } else if (wire === 5) {
      if (state.offset + 4 > buffer.length) throw new OtpError("迁移数据损坏。", "INVALID_MIGRATION");
      fields.push({ field, wire, value: buffer.subarray(state.offset, state.offset + 4) });
      state.offset += 4;
    } else {
      throw new OtpError("迁移数据使用了不支持的编码。", "INVALID_MIGRATION");
    }
  }
  return fields;
}

function parseMigration(uri) {
  const prefix = "otpauth-migration://offline?data=";
  if (!String(uri).toLowerCase().startsWith("otpauth-migration://")) {
    throw new OtpError("不是 Google Authenticator 迁移二维码。", "INVALID_MIGRATION");
  }
  let data = "";
  try {
    const parsed = new URL(uri);
    data = parsed.searchParams.get("data") || "";
  } catch {
    throw new OtpError("迁移二维码格式不正确。", "INVALID_MIGRATION");
  }
  if (!data) throw new OtpError("迁移二维码缺少数据。", "INVALID_MIGRATION");
  if (data.length > 256 * 1024) throw new OtpError("迁移数据过大。", "INVALID_MIGRATION");
  let buffer;
  try {
    buffer = Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  } catch {
    throw new OtpError("无法解码迁移数据。", "INVALID_MIGRATION");
  }
  const top = parseProtoFields(buffer);
  const accounts = [];
  const warnings = [];
  for (const item of top) {
    if (item.field !== 1 || item.wire !== 2) continue;
    const params = parseProtoFields(item.value);
    let secret = Buffer.alloc(0);
    let name = "";
    let issuer = "";
    let algorithm = 1;
    let digitCount = 1;
    let otpType = 2;
    let counter = 0;
    for (const property of params) {
      if (property.field === 1 && property.wire === 2) secret = property.value;
      if (property.field === 2 && property.wire === 2) name = property.value.toString("utf8");
      if (property.field === 3 && property.wire === 2) issuer = property.value.toString("utf8");
      if (property.field === 4 && property.wire === 0) algorithm = property.value;
      if (property.field === 5 && property.wire === 0) digitCount = property.value;
      if (property.field === 6 && property.wire === 0) otpType = property.value;
      if (property.field === 7 && property.wire === 0) counter = property.value;
    }
    if (!secret.length) {
      warnings.push("跳过了一条缺少密钥的迁移记录。");
      continue;
    }
    if (algorithm === 4) {
      warnings.push(`跳过“${name || issuer}”：不支持 MD5 算法。`);
      continue;
    }
    const algorithmName = { 1: "SHA1", 2: "SHA256", 3: "SHA512" }[algorithm] || "SHA1";
    let accountName = name;
    if (name.includes(":")) {
      const [prefix, ...rest] = name.split(":");
      if (!issuer) issuer = prefix.trim();
      accountName = rest.join(":").trim();
    }
    try {
      accounts.push(
        normalizeAccount({
          type: otpType === 1 ? "hotp" : "totp",
          issuer,
          account: accountName,
          secret: encodeBase32(secret),
          secretType: "base32",
          algorithm: algorithmName,
          digits: digitCount === 2 ? 8 : 6,
          counter: otpType === 1 ? counter : 0,
          period: 30,
        })
      );
    } catch (error) {
      warnings.push(`跳过一条迁移记录：${error.message}`);
    }
  }
  if (!accounts.length) {
    throw new OtpError(warnings[0] || "迁移二维码中没有可导入的验证码。", "EMPTY_MIGRATION");
  }
  return { accounts, warnings, kind: "google-migration" };
}

function parseOtpText(text) {
  const accounts = [];
  const warnings = [];
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) throw new OtpError("没有找到验证码数据。", "EMPTY_DATA");
  for (const line of lines) {
    try {
      if (line.toLowerCase().startsWith("otpauth-migration:")) {
        const migration = parseMigration(line);
        accounts.push(...migration.accounts);
        warnings.push(...migration.warnings);
      } else if (line.toLowerCase().startsWith("otpauth://")) {
        accounts.push(parseOtpUri(line));
      } else {
        warnings.push("已跳过一行无法识别的文本。");
      }
    } catch (error) {
      warnings.push(error.message);
    }
  }
  if (!accounts.length) {
    throw new OtpError(warnings[0] || "没有找到可导入的验证码。", "EMPTY_DATA");
  }
  return { accounts, warnings, kind: "otpauth" };
}

module.exports = {
  ALGORITHMS,
  TYPES,
  OtpError,
  base32Decode: decodeBase32,
  base32Encode: encodeBase32,
  buildOtpUri,
  displayLabel,
  generateCode,
  generateRaw,
  makeAccount,
  normalizeAccount,
  parseMigration,
  parseOtpText,
  parseOtpUri,
  secretToBuffer,
};
