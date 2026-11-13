import React, { useCallback, useEffect, useRef, useState } from "react";
import { Icon, LogoMark } from "./icons.jsx";
import WindowControls from "./components/WindowControls.jsx";
import Shell from "./components/Shell.jsx";
import AccountModal from "./components/modals/AccountModal.jsx";
import ScannerModal from "./components/modals/ScannerModal.jsx";
import SettingsModal from "./components/modals/SettingsModal.jsx";
import ImportModal from "./components/modals/ImportModal.jsx";
import ExportModal from "./components/modals/ExportModal.jsx";
import GroupModal from "./components/modals/GroupModal.jsx";
import { ConfirmDialog, ToastStack } from "./components/UI.jsx";
import { LockScreen, SetupScreen } from "./screens/AuthScreens.jsx";
import { isTypingTarget } from "./utils.js";

function BootScreen({ error }) {
  if (error) {
    return (
      <div className="boot-screen">
        <div className="boot-auth-controls">
          <WindowControls />
        </div>
        <div className="fatal-card">
          <div className="fatal-mark">!</div>
          <h1>无法打开保险库</h1>
          <p>{error}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            重试
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="boot-screen">
      <div className="boot-auth-controls">
        <WindowControls />
      </div>
      <div className="boot-orbit" aria-hidden="true">
        <span className="boot-ring boot-ring-one" />
        <span className="boot-ring boot-ring-two" />
        <LogoMark size={68} />
      </div>
      <div className="boot-title">Authenticator Desktop</div>
      <div className="boot-status">
        <span className="boot-spinner" />
        正在打开本地保险库
      </div>
    </div>
  );
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState("");
  const [appState, setAppState] = useState(null);
  const [vault, setVault] = useState(null);
  const [codes, setCodes] = useState({});
  const [lockReason, setLockReason] = useState("");
  const [modal, setModal] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [hideCodes, setHideCodes] = useState(false);
  const searchRef = useRef(null);
  const toastCounter = useRef(0);

  const toast = useCallback((message, type = "success", duration = 3800) => {
    if (!message) return;
    const id = ++toastCounter.current;
    setToasts((current) => [...current.slice(-3), { id, message, type }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, duration);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  useEffect(() => {
    let active = true;
    async function boot() {
      try {
        const state = await window.authenticator.getState();
        if (!active) return;
        setAppState(state);
        if (state.initialized && state.locked && state.mode === "device") {
          try {
            const result = await window.authenticator.unlock();
            if (!active) return;
            setAppState(result.state);
            setVault(result.vault);
          } catch (unlockError) {
            if (active) setBootError(unlockError.message || "无法使用 Windows 数据保护解锁。");
          }
        } else if (state.initialized && !state.locked) {
          try {
            const loaded = await window.authenticator.getVault();
            if (active) setVault(loaded);
          } catch (vaultError) {
            if (active) setBootError(vaultError.message || "无法读取保险库。");
          }
        }
      } catch (error) {
        if (active) setBootError(error.message || "应用初始化失败。");
      } finally {
        if (active) setBooting(false);
      }
    }
    boot();
    return () => {
      active = false;
    };
  }, []);

  const unlocked = Boolean(vault);

  useEffect(() => {
    const themeMode =
      vault?.settings?.theme ||
      window.localStorage.getItem("authdesk-theme") ||
      "system";
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = themeMode === "system" ? (media?.matches ? "dark" : "light") : themeMode;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };
    apply();
    if (vault) window.localStorage.setItem("authdesk-theme", themeMode);
    const onChange = () => {
      if (themeMode === "system") apply();
    };
    media?.addEventListener?.("change", onChange);
    return () => media?.removeEventListener?.("change", onChange);
  }, [vault?.settings?.theme, Boolean(vault)]);

  useEffect(() => {
    const unsubscribe = window.authenticator.onLocked(({ reason } = {}) => {
      setVault(null);
      setCodes({});
      setModal(null);
      setHideCodes(false);
      setLockReason(reason || "manual");
      setAppState((current) => (current ? { ...current, locked: true } : current));
      if (reason === "timeout") toast("因长时间无操作，保险库已自动锁定", "info");
    });
    return unsubscribe;
  }, [toast]);

  useEffect(() => {
    if (!unlocked) {
      setCodes({});
      return undefined;
    }
    let active = true;
    let timer = null;
    async function poll() {
      try {
        const result = await window.authenticator.getCodes();
        if (active) setCodes(result.codes || {});
      } catch {
        // A lock event from the main process will update the UI.
      }
    }
    poll();
    timer = window.setInterval(poll, 1000);
    return () => {
      active = false;
      if (timer) window.clearInterval(timer);
    };
  }, [unlocked]);

  useEffect(() => {
    if (!unlocked) return undefined;
    let lastSent = 0;
    const activity = () => {
      const now = Date.now();
      if (now - lastSent < 15000) return;
      lastSent = now;
      window.authenticator.activity().catch(() => {});
    };
    window.addEventListener("pointerdown", activity, true);
    window.addEventListener("keydown", activity, true);
    window.addEventListener("focus", activity, true);
    return () => {
      window.removeEventListener("pointerdown", activity, true);
      window.removeEventListener("keydown", activity, true);
      window.removeEventListener("focus", activity, true);
    };
  }, [unlocked]);

  const focusSearch = useCallback(() => {
    if (!unlocked) return;
    setModal(null);
    window.setTimeout(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    }, 30);
  }, [unlocked]);

  useEffect(() => {
    const unsubscribe = window.authenticator.onFocusSearch(focusSearch);
    return unsubscribe;
  }, [focusSearch]);

  useEffect(() => {
    function onKeyDown(event) {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!modal) focusSearch();
        return;
      }
      if (modifier && event.key === ",") {
        event.preventDefault();
        if (unlocked) setModal({ type: "settings", tab: "security" });
        return;
      }
      if (modifier && event.key.toLowerCase() === "n") {
        event.preventDefault();
        if (unlocked && !modal) setModal({ type: "account", account: null, draft: null });
        return;
      }
      if (modifier && event.key.toLowerCase() === "l") {
        event.preventDefault();
        if (unlocked && vault?.meta.securityMode === "password") {
          window.authenticator.lock().catch((error) => toast(error.message, "error"));
        }
        return;
      }
      if (
        event.key === "/" &&
        unlocked &&
        !modal &&
        !modifier &&
        !event.altKey &&
        !isTypingTarget(event.target)
      ) {
        event.preventDefault();
        focusSearch();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusSearch, modal, unlocked, vault?.meta.securityMode, toast]);

  function handleSetup(result) {
    setAppState(result.state);
    setVault(result.vault);
    setBootError("");
    setLockReason("");
    setHideCodes(false);
    toast("本地保险库已创建。现在可以添加第一个验证码了。", "success", 5000);
  }

  function handleUnlock(result) {
    setAppState(result.state);
    setVault(result.vault);
    setBootError("");
    setLockReason("");
    setHideCodes(false);
  }

  async function handleLock() {
    try {
      await window.authenticator.lock();
    } catch (error) {
      toast(error.message || "无法锁定保险库。", "error");
    }
  }

  function openAccount(account = null, draft = null) {
    setModal({ type: "account", account, draft });
  }

  function handleAccountSaved(nextVault, action) {
    setVault(nextVault);
    setModal(null);
    toast(action === "update" ? "验证码已更新" : "验证码已添加", "success");
  }

  async function handlePin(account) {
    try {
      const result = await window.authenticator.setPinned(account.id, !account.pinned);
      setVault(result.vault);
      toast(account.pinned ? "已取消固定" : "已固定到顶部", "info", 2200);
    } catch (error) {
      toast(error.message || "无法更新固定状态。", "error");
    }
  }

  async function handleIncrement(account) {
    try {
      const result = await window.authenticator.incrementCounter(account.id);
      setVault(result.vault);
      setCodes((current) => ({
        ...current,
        [account.id]: {
          ok: true,
          code: result.code,
          counter: result.counter,
          remaining: result.remaining,
          period: result.period,
          progress: result.progress,
        },
      }));
      toast(`已生成下一个验证码，计数器为 ${result.counter}`, "success", 2600);
    } catch (error) {
      toast(error.message || "无法更新计数器。", "error");
    }
  }

  function handleScannerDetected(account, warnings) {
    if (warnings?.length) toast(warnings[0], "info", 4500);
    setModal({ type: "account", account: null, draft: account });
  }

  function handleBatchImported(nextVault) {
    setVault(nextVault);
    setModal(null);
  }

  function handleGroupSaved(nextVault) {
    setVault(nextVault);
    setModal(null);
  }

  function handleSecurityChanged(result) {
    if (result.state) {
      setAppState((current) => ({ ...(current || {}), ...result.state }));
    }
    if (result.vault) setVault(result.vault);
  }

  async function handleReset() {
    const state = await window.authenticator.resetApp("删除全部数据");
    setAppState(state);
    setVault(null);
    setCodes({});
    setModal(null);
    setLockReason("");
    setBootError("");
    setHideCodes(false);
    toast("应用已重置，可以重新创建保险库", "success", 4500);
  }

  async function confirmDeleteAccount() {
    if (modal?.type !== "confirm-delete-account") return;
    const result = await window.authenticator.deleteAccount(modal.account.id);
    setVault(result.vault);
    setModal(null);
    toast("验证码已删除", "success");
  }

  async function confirmDeleteGroup() {
    if (modal?.type !== "confirm-delete-group") return;
    const result = await window.authenticator.deleteGroup(modal.group.id);
    setVault(result.vault);
    setModal(null);
    toast("分组已删除，其中的验证码已移到未分组", "info");
  }

  if (booting) return <BootScreen />;
  if (bootError && (!appState || (!appState.locked && !vault))) {
    return <BootScreen error={bootError} />;
  }

  const isLocked = Boolean(appState?.initialized && !vault);

  return (
    <>
      {!appState?.initialized ? (
        <SetupScreen state={appState} onComplete={handleSetup} />
      ) : isLocked ? (
        <LockScreen
          state={appState}
          reason={lockReason}
          error={bootError || ""}
          onComplete={handleUnlock}
          onRequestReset={() => setModal({ type: "reset" })}
        />
      ) : vault ? (
        <Shell
          vault={vault}
          codes={codes}
          state={appState}
          hideCodes={hideCodes}
          onToggleHideCodes={() => setHideCodes((value) => !value)}
          searchRef={searchRef}
          onAddAccount={() => openAccount()}
          onOpenScanner={() => setModal({ type: "scanner" })}
          onEditAccount={(account) => openAccount(account)}
          onPinAccount={handlePin}
          onIncrementCounter={handleIncrement}
          onOpenSettings={(tab = "security") => setModal({ type: "settings", tab })}
          onOpenImport={() => setModal({ type: "import" })}
          onOpenExport={() => setModal({ type: "export" })}
          onAddGroup={() => setModal({ type: "group", group: null })}
          onEditGroup={(group) => setModal({ type: "group", group })}
          onLock={handleLock}
          onVaultUpdated={setVault}
          toast={toast}
        />
      ) : null}

      {vault && modal?.type === "account" ? (
        <AccountModal
          key={modal.account?.id || "new-account"}
          open
          account={modal.account}
          draft={modal.draft}
          groups={vault.groups}
          onClose={() => setModal(null)}
          onSaved={handleAccountSaved}
          onRequestDelete={(account) =>
            setModal({ type: "confirm-delete-account", account })
          }
          toast={toast}
        />
      ) : null}

      {vault && modal?.type === "scanner" ? (
        <ScannerModal
          open
          groups={vault.groups}
          onClose={() => setModal(null)}
          onDetected={handleScannerDetected}
          onImported={handleBatchImported}
          toast={toast}
        />
      ) : null}

      {vault && modal?.type === "settings" ? (
        <SettingsModal
          open
          initialTab={modal.tab || "security"}
          vault={vault}
          state={appState}
          onClose={() => setModal(null)}
          onVaultUpdated={setVault}
          onSecurityChanged={handleSecurityChanged}
          onOpenExport={() => setModal({ type: "export" })}
          onOpenImport={() => setModal({ type: "import" })}
          onRequestReset={() => setModal({ type: "reset" })}
          onLock={handleLock}
          toast={toast}
        />
      ) : null}

      {vault && modal?.type === "import" ? (
        <ImportModal
          open
          vault={vault}
          onClose={() => setModal(null)}
          onImported={(nextVault) => {
            setVault(nextVault);
            setModal(null);
          }}
          toast={toast}
        />
      ) : null}

      {vault && modal?.type === "export" ? (
        <ExportModal
          open
          vault={vault}
          onClose={() => setModal(null)}
          onVaultUpdated={setVault}
          toast={toast}
        />
      ) : null}

      {vault && modal?.type === "group" ? (
        <GroupModal
          open
          group={modal.group}
          vault={vault}
          onClose={() => setModal(null)}
          onVaultUpdated={handleGroupSaved}
          onRequestDelete={(group) => setModal({ type: "confirm-delete-group", group })}
          toast={toast}
        />
      ) : null}

      <ConfirmDialog
        open={modal?.type === "confirm-delete-account"}
        onClose={() => setModal(null)}
        onConfirm={confirmDeleteAccount}
        title="删除这个验证码？"
        message={
          modal?.account
            ? `“${modal.account.issuer || modal.account.account || "未命名验证码"}”将被永久删除。如果尚未备份，密钥将无法找回。`
            : ""
        }
        confirmLabel="删除验证码"
        tone="danger"
        icon="trash"
      />

      <ConfirmDialog
        open={modal?.type === "confirm-delete-group"}
        onClose={() => setModal(null)}
        onConfirm={confirmDeleteGroup}
        title="删除这个分组？"
        message={
          modal?.group
            ? `“${modal.group.name}”将被删除。其中的验证码不会被删除，而是移动到“未分组”。`
            : ""
        }
        confirmLabel="删除分组"
        tone="danger"
        icon="trash"
      />

      <ConfirmDialog
        open={modal?.type === "reset"}
        onClose={() => setModal(null)}
        onConfirm={handleReset}
        title="重置应用并删除全部数据？"
        message={
          <div className="reset-warning">
            <p>
              这会永久删除此电脑上的保险库、全部验证码、分组和设置。主密码、Windows
              设备保护数据也会一并清除。
            </p>
            <strong>如果忘记主密码且没有备份，验证码将无法恢复。</strong>
          </div>
        }
        confirmLabel="永久删除全部数据"
        tone="danger"
        icon="warning"
        requireText="删除全部数据"
      />

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
