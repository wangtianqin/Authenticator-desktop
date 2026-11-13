import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const appDir = path.resolve(import.meta.dirname, "..");
const isWindows = process.platform === "win32";
const electronExe = path.join(
  appDir,
  "node_modules",
  "electron",
  "dist",
  isWindows ? "electron.exe" : "electron"
);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "authdesk-smoke-"));
const port = 9231;
const stdoutPath = path.join(dataDir, "smoke-stdout.log");
const stderrPath = path.join(dataDir, "smoke-stderr.log");
const PASSWORD = "SmokeTest!2026";

if (!fs.existsSync(electronExe)) {
  console.error("Electron executable not found. Run pnpm install first.");
  process.exit(1);
}

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;
Object.assign(childEnv, {
  AUTHENTICATOR_SMOKE: "1",
  AUTHENTICATOR_DEBUG_PORT: String(port),
  AUTHENTICATOR_DATA_DIR: dataDir,
  AUTHENTICATOR_FAST_KDF: "1",
  AUTHENTICATOR_DISABLE_GPU: "1",
});

const stdoutFd = fs.openSync(stdoutPath, "a");
const stderrFd = fs.openSync(stderrPath, "a");
const child = spawn(electronExe, ["."], {
  cwd: appDir,
  env: childEnv,
  stdio: ["ignore", stdoutFd, stderrFd],
  windowsHide: true,
});

let ws;
let sequence = 0;
const pending = new Map();
let exited = false;

function cleanup() {
  try {
    ws?.close();
  } catch {
    // ignore
  }
  if (!exited && child.pid) {
    if (isWindows) {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      child.kill("SIGKILL");
    }
  }
  setTimeout(() => {
    try {
      fs.closeSync(stdoutFd);
      fs.closeSync(stderrFd);
    } catch {
      // ignore
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }, 800);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForEndpoint() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Electron exited early with code ${child.exitCode}`);
    }
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
        response.json()
      );
      const page = pages.find((entry) => entry.type === "page");
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Not ready yet.
    }
    await sleep(250);
  }
  throw new Error("Timed out waiting for Electron DevTools endpoint");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.onopen = () => resolve(socket);
    socket.onerror = () => reject(new Error("Could not connect to DevTools"));
  });
}

function send(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression, awaitPromise = false) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      `${result.exceptionDetails.text}: ${result.result?.description || ""}`
    );
  }
  return result.result?.value;
}

async function waitFor(expression, timeoutMs = 8000, label = expression) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

async function main() {
  const page = await waitForEndpoint();
  ws = await connect(page.webSocketDebuggerUrl);
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  };
  await send("Runtime.enable");
  await waitFor(`!!document.querySelector('[data-testid="setup-password"]')`, 10000, "setup screen");
  console.log("  ok  setup screen rendered");

  await evaluate(`(() => {
    const set = (selector, value) => {
      const input = document.querySelector(selector);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set('[data-testid="setup-password"]', ${JSON.stringify(PASSWORD)});
    set('[data-testid="setup-confirm"]', ${JSON.stringify(PASSWORD)});
    document.querySelector('[data-testid="setup-submit"]').click();
    return true;
  })()`);
  await waitFor(`!!document.querySelector('.app-shell')`, 15000, "main shell after setup");
  console.log("  ok  password vault created");

  const code = await evaluate(
    `(async () => {
      await window.authenticator.addAccount({
        type: "hotp",
        issuer: "RFC 4226",
        account: "counter-zero",
        secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
        digits: 6,
        counter: 0
      });
      await window.authenticator.addAccount({
        type: "totp",
        issuer: "TOTP",
        account: "smoke",
        secret: "JBSWY3DPEHPK3PXP"
      });
      return true;
    })()`,
    true
  );
  if (!code) throw new Error("Could not add smoke accounts");
  await evaluate("location.reload(); true");
  await waitFor(`document.querySelectorAll('.account-card').length === 2`, 12000, "account cards");
  await sleep(800);
  const text = await evaluate(`document.querySelector('.account-grid')?.innerText || ""`);
  if (!text.includes("755 224")) {
    throw new Error("HOTP RFC 4226 counter-zero code did not render as 755 224");
  }
  console.log("  ok  HOTP known vector rendered (755 224)");

  await evaluate(`window.authenticator.lock()`, true);
  await waitFor(`!!document.querySelector('[data-testid="unlock-password"]')`, 5000, "lock screen");
  console.log("  ok  vault locks");

  await evaluate(`(() => {
    const input = document.querySelector('[data-testid="unlock-password"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, ${JSON.stringify(PASSWORD)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector('[data-testid="unlock-submit"]').click();
    return true;
  })()`);
  await waitFor(`!!document.querySelector('.app-shell')`, 12000, "unlocked shell");
  console.log("  ok  unlock with master password works");

  console.log("\nSmoke test passed.\n");
}

main()
  .catch((error) => {
    console.error("\nSmoke test failed:", error.message);
    try {
      const stderr = fs.readFileSync(stderrPath, "utf8").trim();
      if (stderr) console.error("\nElectron stderr:\n" + stderr.slice(-4000));
      const appLog = path.join(dataDir, "app.log");
      if (fs.existsSync(appLog)) {
        console.error("\nApplication log:\n" + fs.readFileSync(appLog, "utf8").slice(-4000));
      }
    } catch {
      // ignore log read errors
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await sleep(100);
    cleanup();
  });
