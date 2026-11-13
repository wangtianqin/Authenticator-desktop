import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

process.env.AUTHENTICATOR_FAST_KDF = "1";
const require = createRequire(import.meta.url);
const otp = require("../electron/otp.cjs");
const { VaultStore } = require("../electron/vault-store.cjs");
const backup = require("../electron/backup.cjs");

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(error);
  }
}

function varint(value) {
  const bytes = [];
  let current = Number(value);
  while (current > 0x7f) {
    bytes.push((current & 0x7f) | 0x80);
    current = Math.floor(current / 128);
  }
  bytes.push(current);
  return Buffer.from(bytes);
}

function fieldVarint(field, value) {
  return Buffer.concat([varint((field << 3) | 0), varint(value)]);
}

function fieldBytes(field, value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([varint((field << 3) | 2), varint(buffer.length), buffer]);
}

function migrationUri(entries) {
  const payloads = entries.map((entry) => {
    const chunks = [
      fieldBytes(1, Buffer.from(entry.secret, "utf8")),
      fieldBytes(2, Buffer.from(entry.name, "utf8")),
      fieldBytes(3, Buffer.from(entry.issuer, "utf8")),
      fieldVarint(4, entry.algorithm ?? 1),
      fieldVarint(5, entry.digits === 8 ? 2 : 1),
      fieldVarint(6, entry.type === "hotp" ? 1 : 2),
    ];
    if (entry.counter !== undefined) chunks.push(fieldVarint(7, entry.counter));
    return fieldBytes(1, Buffer.concat(chunks));
  });
  return `otpauth-migration://offline?data=${Buffer.concat(payloads).toString("base64url")}`;
}

function evpBytesToKey(passphrase, salt, keyLength = 32, ivLength = 16) {
  const password = Buffer.from(passphrase, "utf8");
  let derived = Buffer.alloc(0);
  let block = Buffer.alloc(0);
  while (derived.length < keyLength + ivLength) {
    block = crypto.createHash("md5").update(Buffer.concat([block, password, salt])).digest();
    derived = Buffer.concat([derived, block]);
  }
  return {
    key: derived.subarray(0, keyLength),
    iv: derived.subarray(keyLength, keyLength + ivLength),
  };
}

function encryptCryptoJs(plaintext, passphrase) {
  const salt = crypto.randomBytes(8);
  const { key, iv } = evpBytesToKey(passphrase, salt);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from("Salted__", "ascii"), salt, encrypted]).toString("base64");
}

const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // 12345678901234567890

console.log("\nOTP engine");

await test("HOTP RFC 4226 vectors", () => {
  const expected = [
    "755224", "287082", "359152", "969429", "338314",
    "254676", "287922", "162583", "399871", "520489",
  ];
  for (let counter = 0; counter < expected.length; counter += 1) {
    const code = otp.generateRaw(
      {
        type: "hotp",
        secret: SECRET,
        secretType: "base32",
        algorithm: "SHA1",
        digits: 6,
      },
      counter
    );
    assert.equal(code, expected[counter], `counter ${counter}`);
  }
});

await test("TOTP RFC 6238 SHA-1 vectors", () => {
  const vectors = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];
  const account = {
    type: "totp",
    secret: SECRET,
    secretType: "base32",
    algorithm: "SHA1",
    digits: 8,
    period: 30,
  };
  for (const [epoch, expected] of vectors) {
    assert.equal(otp.generateCode(account, epoch * 1000).code, expected, `epoch ${epoch}`);
  }
});

await test("TOTP SHA-256 and SHA-512", () => {
  const sha256Secret = otp.base32Encode(Buffer.from("12345678901234567890123456789012"));
  const sha512Secret = otp.base32Encode(
    Buffer.from("1234567890123456789012345678901234567890123456789012345678901234")
  );
  assert.equal(
    otp.generateCode(
      { type: "totp", secret: sha256Secret, secretType: "base32", algorithm: "SHA256", digits: 8, period: 30 },
      59 * 1000
    ).code,
    "46119246"
  );
  assert.equal(
    otp.generateCode(
      { type: "totp", secret: sha512Secret, secretType: "base32", algorithm: "SHA512", digits: 8, period: 30 },
      59 * 1000
    ).code,
    "90693936"
  );
});

await test("Steam code is five characters from the Steam alphabet", () => {
  const result = otp.generateCode(
    { type: "steam", secret: SECRET, secretType: "base32", algorithm: "SHA1", digits: 5, period: 30 },
    1700000000000
  );
  assert.match(result.code, /^[23456789BCDFGHJKMNPQRTVWXY]{5}$/);
});

await test("Base32 round-trip", () => {
  const bytes = crypto.randomBytes(32);
  assert.deepEqual(otp.base32Decode(otp.base32Encode(bytes)), bytes);
});

await test("otpauth URI parsing and export", () => {
  const parsed = otp.parseOtpUri(
    "otpauth://totp/ACME%20Co%3Aalice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME%20Co&algorithm=SHA256&digits=8&period=60"
  );
  assert.equal(parsed.issuer, "ACME Co");
  assert.equal(parsed.account, "alice@example.com");
  assert.equal(parsed.type, "totp");
  assert.equal(parsed.algorithm, "SHA256");
  assert.equal(parsed.digits, 8);
  assert.equal(parsed.period, 60);
  const exported = otp.buildOtpUri({ ...parsed, secret: "JBSWY3DPEHPK3PXP" });
  const reparsed = otp.parseOtpUri(exported);
  assert.equal(reparsed.issuer, parsed.issuer);
  assert.equal(reparsed.account, parsed.account);
  assert.equal(reparsed.algorithm, "SHA256");
});

await test("HOTP URI preserves counter", () => {
  const parsed = otp.parseOtpUri(
    "otpauth://hotp/Example:bob?secret=JBSWY3DPEHPK3PXP&counter=42"
  );
  assert.equal(parsed.type, "hotp");
  assert.equal(parsed.counter, 42);
});

await test("Google migration payload", () => {
  const uri = migrationUri([
    { secret: "12345678901234567890", name: "alice@example.com", issuer: "ACME" },
    { secret: "09876543210987654321", name: "bob@example.com", issuer: "Example", type: "hotp", counter: 7, digits: 8 },
  ]);
  const result = otp.parseMigration(uri);
  assert.equal(result.accounts.length, 2);
  assert.equal(result.accounts[0].issuer, "ACME");
  assert.equal(result.accounts[0].account, "alice@example.com");
  assert.equal(result.accounts[1].type, "hotp");
  assert.equal(result.accounts[1].counter, 7);
  assert.equal(result.accounts[1].digits, 8);
});

console.log("\nVault");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "authdesk-test-"));
const store = new VaultStore(tempDir, { appVersion: "test" });
await store.init();

await test("initialize and persist an encrypted vault", async () => {
  assert.equal(store.getState().initialized, false);
  await store.initialize({ mode: "password", password: "correct horse battery" });
  assert.equal(store.getState().initialized, true);
  assert.equal(store.getState().locked, false);
  const account = await store.addAccount({
    type: "totp",
    issuer: "GitHub",
    account: "alice",
    secret: "JBSWY3DPEHPK3PXP",
  });
  assert.equal(account.issuer, "GitHub");
  const publicVault = store.getRendererVault();
  assert.equal(publicVault.accounts.length, 1);
  assert.equal("secret" in publicVault.accounts[0], false);
  const disk = fs.readFileSync(path.join(tempDir, "vault.json"), "utf8");
  assert.equal(disk.includes("JBSWY3DPEHPK3PXP"), false);
  assert.equal(disk.includes("GitHub"), false);
});

await test("lock, reject wrong password, unlock", async () => {
  store.lock();
  assert.equal(store.getState().locked, true);
  await assert.rejects(() => store.unlock("wrong password"), (error) => error.code === "WRONG_PASSWORD");
  const vault = await store.unlock("correct horse battery");
  assert.equal(vault.accounts.length, 1);
  assert.equal(vault.accounts[0].issuer, "GitHub");
});

await test("add groups and reassign accounts", async () => {
  const { group } = { group: await store.createGroup({ name: "工作", color: "#14b8a6" }) };
  const account = store.getRendererVault().accounts[0];
  await store.updateAccount(account.id, { ...account, groupId: group.id });
  assert.equal(store.getRendererVault().accounts[0].groupId, group.id);
  await store.deleteGroup(group.id);
  assert.equal(store.getRendererVault().accounts[0].groupId, null);
});

await test("change master password", async () => {
  await store.changePassword("correct horse battery", "new master password");
  store.lock();
  await assert.rejects(() => store.unlock("correct horse battery"), (error) => error.code === "WRONG_PASSWORD");
  await store.unlock("new master password");
});

await test("backup export and import round-trip", async () => {
  const payload = await store.exportPayload();
  const encrypted = await backup.createEncryptedBackup(payload, "backup-password");
  const needsPassword = await backup.inspectImport({ text: encrypted });
  assert.equal(needsPassword.status, "password_required");
  await assert.rejects(
    () => backup.inspectImport({ text: encrypted, password: "bad password" }),
    (error) => error.code === "WRONG_PASSWORD"
  );
  const result = await backup.inspectImport({ text: encrypted, password: "backup-password" });
  assert.equal(result.status, "ok");
  assert.equal(result.accounts[0].issuer, "GitHub");
  assert.equal(result.accounts[0].secret, "JBSWY3DPEHPK3PXP");
});

await test("plain and extension-compatible backup import", async () => {
  const payload = await store.exportPayload();
  const plain = backup.createPlainBackup(payload);
  const plainResult = await backup.inspectImport({ text: plain });
  assert.equal(plainResult.accounts.length, 1);

  const extensionJson = backup.createExtensionBackup(payload);
  const extensionResult = await backup.inspectImport({ text: extensionJson });
  assert.equal(extensionResult.accounts.length, 1);
  assert.equal(extensionResult.accounts[0].issuer, "GitHub");
  assert.equal(extensionResult.accounts[0].secret, "JBSWY3DPEHPK3PXP");
});

await test("Authenticator extension v3 encrypted backup import", async () => {
  const { argon2id } = await import("hash-wasm");
  const password = "plugin-password";
  const salt = Buffer.from(crypto.randomBytes(16).toString("hex"), "utf8");
  const possibleHash = await argon2id({
    password,
    salt: new Uint8Array(salt),
    parallelism: 1,
    iterations: 2,
    memorySize: 19456,
    hashLength: 32,
    outputType: "encoded",
  });
  const saltString = possibleHash.split("$")[4];
  const saltedHash = possibleHash.split("$")[5];
  const keyHash = await argon2id({
    password: saltedHash,
    salt: new Uint8Array(crypto.randomBytes(16)),
    parallelism: 1,
    iterations: 2,
    memorySize: 19456,
    hashLength: 32,
    outputType: "encoded",
  });
  const binarySalt = Buffer.from(saltString, "base64").toString("latin1");
  const storage = {
    dataType: "OTPStorage",
    encrypted: false,
    hash: "11111111-1111-4111-8111-111111111111",
    index: 0,
    issuer: "Plugin",
    account: "alice",
    secret: "JBSWY3DPEHPK3PXP",
    type: "totp",
  };
  const extensionBackup = {
    "key-id": {
      dataType: "Key",
      id: "key-id",
      salt: binarySalt,
      hash: keyHash,
      version: 3,
    },
    "11111111-1111-4111-8111-111111111111": {
      dataType: "EncOTPStorage",
      keyId: "key-id",
      index: 0,
      data: encryptCryptoJs(JSON.stringify(storage), saltedHash),
    },
  };
  const needs = await backup.inspectImport({ text: JSON.stringify(extensionBackup) });
  assert.equal(needs.status, "password_required");
  const result = await backup.inspectImport({
    text: JSON.stringify(extensionBackup),
    password,
  });
  assert.equal(result.status, "ok");
  assert.equal(result.accounts[0].issuer, "Plugin");
  assert.equal(result.accounts[0].secret, "JBSWY3DPEHPK3PXP");
});

await test("Authenticator extension v1 encrypted backup import", async () => {
  const password = "old-password";
  const extensionBackup = {
    "22222222-2222-4222-8222-222222222222": {
      dataType: "OTPStorage",
      encrypted: true,
      index: 0,
      issuer: "Legacy",
      account: "bob",
      secret: encryptCryptoJs("JBSWY3DPEHPK3PXP", password),
      type: "totp",
    },
  };
  const result = await backup.inspectImport({
    text: JSON.stringify(extensionBackup),
    password,
  });
  assert.equal(result.status, "ok");
  assert.equal(result.accounts[0].secret, "JBSWY3DPEHPK3PXP");
});

await test("Authenticator extension v2 encrypted backup import", async () => {
  const password = "v2-password";
  const key = "v2-derived-encryption-key";
  const storage = {
    dataType: "OTPStorage",
    encrypted: false,
    hash: "33333333-3333-4333-8333-333333333333",
    index: 0,
    issuer: "V2 Plugin",
    account: "carol",
    secret: "JBSWY3DPEHPK3PXP",
    type: "totp",
  };
  const extensionBackup = {
    key: {
      enc: encryptCryptoJs(key, password),
      hash: "not-verified-by-desktop",
    },
    "33333333-3333-4333-8333-333333333333": {
      dataType: "EncOTPStorage",
      keyId: "legacy",
      index: 0,
      data: encryptCryptoJs(JSON.stringify(storage), key),
    },
  };
  const result = await backup.inspectImport({
    text: JSON.stringify(extensionBackup),
    password,
  });
  assert.equal(result.status, "ok");
  assert.equal(result.accounts[0].issuer, "V2 Plugin");
  assert.equal(result.accounts[0].secret, "JBSWY3DPEHPK3PXP");
});

await test("Steam prefix in extension backups", async () => {
  const storage = {
    dataType: "OTPStorage",
    encrypted: false,
    hash: "44444444-4444-4444-8444-444444444444",
    index: 0,
    issuer: "Steam",
    account: "gamer",
    secret: "stm-JBSWY3DPEHPK3PXP",
    type: "totp",
  };
  const result = await backup.inspectImport({
    text: JSON.stringify({ "44444444-4444-4444-8444-444444444444": storage }),
  });
  assert.equal(result.accounts[0].type, "steam");
  assert.equal(result.accounts[0].secret, "JBSWY3DPEHPK3PXP");
});

await test("App backup restores groups and memberships", async () => {
  const sourceGroup = { id: "source-group", name: "恢复分组", color: "#0ea5e9", order: 0 };
  const payload = await store.exportPayload();
  payload.groups = [...payload.groups.filter((group) => group.name !== "恢复分组"), sourceGroup];
  payload.accounts = payload.accounts.filter((account) => account.issuer !== "Restore Test");
  payload.accounts.push({
    id: "restore-account",
    type: "totp",
    issuer: "Restore Test",
    account: "dave",
    secret: "JBSWY3DPEHPK3PXP",
    secretType: "base32",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    counter: 0,
    pinned: false,
    groupId: "source-group",
    notes: "",
    order: payload.accounts.length,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const result = await backup.inspectImport({ text: backup.createPlainBackup(payload) });
  assert.ok(result.groups.some((group) => group.name === "恢复分组"));
  const imported = await store.importAccounts(result.accounts, {
    groups: result.groups,
    skipDuplicates: true,
  });
  assert.ok(imported.added.some((account) => account.issuer === "Restore Test"));
  const restored = store.getRendererVault().accounts.find((account) => account.issuer === "Restore Test");
  assert.ok(restored.groupId);
  const group = store.getRendererVault().groups.find((item) => item.id === restored.groupId);
  assert.equal(group.name, "恢复分组");
});

await test("Steam account survives extension-compatible export/import", async () => {
  const steamPayload = {
    version: "test",
    accounts: [
      {
        type: "steam",
        issuer: "Steam",
        account: "steam-user",
        secret: "JBSWY3DPEHPK3PXP",
        secretType: "base32",
        algorithm: "SHA1",
        digits: 5,
        period: 30,
        counter: 0,
        pinned: false,
        groupId: null,
        notes: "",
      },
    ],
    groups: [],
  };
  const extensionText = backup.createExtensionBackup(steamPayload);
  assert.ok(extensionText.includes("stm-JBSWY3DPEHPK3PXP"));
  const result = await backup.inspectImport({ text: extensionText });
  assert.equal(result.accounts[0].type, "steam");
  assert.equal(result.accounts[0].secret, "JBSWY3DPEHPK3PXP");
});

await test("random UUID integrity and duplicate flagging", async () => {
  const input = {
    type: "totp",
    issuer: "Dup",
    account: "test",
    secret: "JBSWY3DPEHPK3PXP",
  };
  const first = await store.importAccounts([input]);
  const second = await store.importAccounts([input]);
  assert.equal(first.added.length, 1);
  assert.equal(second.added.length, 0);
  assert.equal(second.skipped[0].reason, "duplicate");
});

await test("vault resets cleanly", async () => {
  await store.reset();
  assert.equal(store.getState().initialized, false);
  assert.equal(fs.existsSync(path.join(tempDir, "vault.json")), false);
});

fs.rmSync(tempDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
