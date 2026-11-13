import React, { useMemo, useState } from "react";
import { Icon } from "../icons.jsx";
import WindowControls from "../components/WindowControls.jsx";
import {
  BrandBlock,
  Button,
  Field,
  InlineNotice,
  PasswordInput,
  PasswordStrength,
} from "../components/UI.jsx";
import { validatePassword } from "../utils.js";

function AuthTitlebar() {
  return (
    <div className="auth-titlebar">
      <div className="auth-titlebar-drag">
        <span>Authenticator Desktop</span>
      </div>
      <WindowControls />
    </div>
  );
}

const FEATURES = [
  { icon: "shieldCheck", text: "AES-256-GCM 本地加密" },
  { icon: "globe", text: "完全离线，无需账号" },
  { icon: "download", text: "随时导入与导出备份" },
];

function AuthBackdrop({ mode = "setup" }) {
  return (
    <div className={`auth-backdrop auth-backdrop-${mode}`} aria-hidden="true">
      <span className="auth-glow auth-glow-one" />
      <span className="auth-glow auth-glow-two" />
      <span className="auth-grid" />
    </div>
  );
}

function CodeOrbit() {
  return (
    <div className="code-orbit" aria-hidden="true">
      <span className="orbit-ring orbit-ring-outer" />
      <span className="orbit-ring orbit-ring-inner" />
      <span className="orbit-dot orbit-dot-one" />
      <span className="orbit-dot orbit-dot-two" />
      <div className="orbit-card">
        <div className="orbit-card-top">
          <span className="orbit-brand-dot" />
          <span>GitHub</span>
          <span className="orbit-pill">TOTP</span>
        </div>
        <div className="orbit-code">
          824<span>193</span>
        </div>
        <div className="orbit-progress">
          <span />
        </div>
        <div className="orbit-meta">
          <span className="orbit-shield">
            <Icon name="shieldCheck" size={13} />
          </span>
          本地加密 · 22 秒后刷新
        </div>
      </div>
      <div className="orbit-float orbit-float-key">
        <Icon name="key" size={18} />
      </div>
      <div className="orbit-float orbit-float-check">
        <Icon name="check" size={17} />
      </div>
    </div>
  );
}

export function SetupScreen({ state, onComplete }) {
  const [mode, setMode] = useState("password");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const deviceAvailable = Boolean(state?.deviceProtectionAvailable);

  const strength = useMemo(() => password.length, [password]);
  const mismatch = Boolean(confirmation) && password !== confirmation;
  const canSubmit =
    !busy &&
    (mode === "device" || (validatePassword(password) === "" && password === confirmation));

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (mode === "password") {
      const validation = validatePassword(password);
      if (validation) {
        setError(validation);
        return;
      }
      if (password !== confirmation) {
        setError("两次输入的主密码不一致。");
        return;
      }
    }
    setBusy(true);
    try {
      const result = await window.authenticator.setup({
        mode,
        password: mode === "password" ? password : "",
      });
      onComplete?.(result);
    } catch (setupError) {
      setError(setupError.message || "无法创建保险库，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <AuthBackdrop mode="setup" />
      <AuthTitlebar />
      <aside className="auth-story">
        <BrandBlock />
        <div className="auth-story-main">
          <CodeOrbit />
          <div className="auth-story-copy">
            <span className="auth-kicker">
              <span className="pulse-dot" />
              你的验证码，只属于这台电脑
            </span>
            <h1>
              把二次验证，
              <br />
              放回自己手里。
            </h1>
            <p>
              一个独立、离线的 Windows 验证器。没有云端账户，没有同步邀请，只有被加密保存在本机的验证码。
            </p>
            <div className="auth-features">
              {FEATURES.map((feature) => (
                <div className="auth-feature" key={feature.text}>
                  <span>
                    <Icon name={feature.icon} size={15} />
                  </span>
                  {feature.text}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="auth-story-footer">
          <span>WINDOWS 10 / 11</span>
          <span className="footer-separator" />
          <span>v{state?.version || "1.0.0"}</span>
          <span className="footer-spacer" />
          <span>兼容 Authenticator 插件备份</span>
        </div>
      </aside>

      <main className="auth-panel">
        <div className="auth-panel-inner">
          <div className="auth-mobile-brand">
            <BrandBlock />
          </div>
          <div className="auth-step">
            <span className="step-index">01</span>
            <span className="step-line" />
            <span className="step-label">建立保险库</span>
          </div>
          <h2 className="auth-title">开始使用</h2>
          <p className="auth-subtitle">
            选择一种方式保护本机上的验证码。之后可以随时在设置中更改。
          </p>

          {state?.warning ? (
            <InlineNotice tone="warning" icon="warning" title="保险库恢复提示">
              {state.warning}
            </InlineNotice>
          ) : null}

          <form onSubmit={submit} className="auth-form">
            <div className="mode-options" role="radiogroup" aria-label="安全模式">
              <button
                type="button"
                role="radio"
                aria-checked={mode === "password"}
                className={`mode-option ${mode === "password" ? "is-selected" : ""}`}
                onClick={() => {
                  setMode("password");
                  setError("");
                }}
              >
                <span className="mode-icon">
                  <Icon name="lock" size={19} />
                </span>
                <span className="mode-copy">
                  <span className="mode-title">
                    主密码
                    <span className="recommend-badge">推荐</span>
                  </span>
                  <span className="mode-description">
                    启动、解锁与自动锁定时需要输入。忘记后无法恢复。
                  </span>
                </span>
                <span className="mode-radio" />
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === "device"}
                className={`mode-option ${mode === "device" ? "is-selected" : ""} ${
                  !deviceAvailable ? "is-disabled" : ""
                }`}
                onClick={() => {
                  if (!deviceAvailable) return;
                  setMode("device");
                  setError("");
                }}
                disabled={!deviceAvailable}
                title={
                  deviceAvailable
                    ? "使用 Windows DPAPI 绑定当前用户"
                    : "当前环境不支持 Windows 数据保护"
                }
              >
                <span className="mode-icon">
                  <Icon name="shield" size={19} />
                </span>
                <span className="mode-copy">
                  <span className="mode-title">Windows 设备保护</span>
                  <span className="mode-description">
                    无需密码，由 Windows 加密。同一 Windows 账户可直接打开。
                  </span>
                </span>
                <span className="mode-radio" />
              </button>
            </div>

            {mode === "password" ? (
              <div className="auth-fields">
                <Field
                  label="主密码"
                  hint={strength ? `${strength}/256` : undefined}
                  htmlFor="setup-password"
                >
                  <PasswordInput
                    id="setup-password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setError("");
                    }}
                    placeholder="至少 8 个字符"
                    autoComplete="new-password"
                    maxLength={256}
                    data-autofocus
                    data-testid="setup-password"
                  />
                  <PasswordStrength password={password} />
                </Field>
                <Field
                  label="再次输入"
                  error={mismatch ? "两次输入不一致" : ""}
                  htmlFor="setup-confirm"
                >
                  <PasswordInput
                    id="setup-confirm"
                    value={confirmation}
                    onChange={(event) => {
                      setConfirmation(event.target.value);
                      setError("");
                    }}
                    placeholder="确认主密码"
                    autoComplete="new-password"
                    maxLength={256}
                    data-testid="setup-confirm"
                  />
                </Field>
                <div className="recovery-warning">
                  <Icon name="warning" size={15} />
                  <span>
                    主密码不会上传到任何地方，也没有找回渠道。请使用密码管理器妥善保存。
                  </span>
                </div>
              </div>
            ) : (
              <div className="device-explainer">
                <div className="device-explainer-icon">
                  <Icon name="shieldCheck" size={22} />
                </div>
                <div>
                  <strong>由 Windows 数据保护加密</strong>
                  <p>
                    保险库会绑定当前 Windows 用户。任何能登录此 Windows 账户的人都能打开验证器；适合个人专用、且系统账户本身有登录保护的电脑。
                  </p>
                </div>
              </div>
            )}

            {error ? (
              <div className="form-error form-error-block" role="alert">
                <Icon name="warning" size={15} />
                {error}
              </div>
            ) : null}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              block
              loading={busy}
              disabled={!canSubmit}
              icon={<Icon name="shieldCheck" size={17} />}
              data-testid="setup-submit"
            >
              创建本地保险库
            </Button>
            <p className="auth-fineprint">
              <Icon name="lock" size={12} />
              保险库文件仅保存在此电脑的用户数据目录中
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}

export function LockScreen({ state, reason, error: initialError, onComplete, onRequestReset }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError || "");
  const [busy, setBusy] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const isDeviceMode = state?.mode === "device";

  const reasonText =
    reason === "timeout"
      ? "因长时间无操作，保险库已自动锁定。"
      : reason === "screen-lock"
        ? "Windows 已锁定屏幕，保险库随之锁定。"
        : reason === "suspend"
          ? "电脑从休眠恢复，保险库已锁定。"
          : reason === "minimize"
            ? "窗口最小化，保险库已锁定。"
            : "";

  async function unlock(event) {
    event?.preventDefault();
    if (busy) return;
    if (!isDeviceMode && !password) {
      setError("请输入主密码。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await window.authenticator.unlock(isDeviceMode ? undefined : password);
      setPassword("");
      onComplete?.(result);
    } catch (unlockError) {
      setError(unlockError.message || "解锁失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen auth-screen-lock">
      <AuthBackdrop mode="lock" />
      <AuthTitlebar />
      <aside className="auth-story auth-story-lock">
        <BrandBlock />
        <div className="lock-story-visual" aria-hidden="true">
          <div className="lock-orb">
            <span className="lock-orb-ring" />
            <span className="lock-orb-ring lock-orb-ring-two" />
            <span className="lock-orb-icon">
              <Icon name="lock" size={34} />
            </span>
            <span className="lock-orb-code">••• •••</span>
          </div>
          <div className="lock-story-lines">
            <span />
            <span />
            <span />
          </div>
        </div>
        <div className="auth-story-copy lock-story-copy">
          <span className="auth-kicker">
            <span className="pulse-dot" />
            本地保险库已加密
          </span>
          <h1>验证码在等待，<br />但不会轻易出现。</h1>
          <p>
            保险库使用 AES-256-GCM 加密，主密码只在解锁时用于派生密钥。你的验证码不会离开这台电脑。
          </p>
        </div>
        <div className="auth-story-footer">
          <span>本地优先</span>
          <span className="footer-separator" />
          <span>离线运行</span>
          <span className="footer-spacer" />
          <span>v{state?.version || "1.0.0"}</span>
        </div>
      </aside>

      <main className="auth-panel">
        <div className="auth-panel-inner lock-panel-inner">
          <div className="auth-mobile-brand">
            <BrandBlock />
          </div>
          <div className="auth-step">
            <span className="step-index">02</span>
            <span className="step-line" />
            <span className="step-label">解锁保险库</span>
          </div>
          <div className="lock-heading">
            <span className="lock-badge-icon">
              <Icon name="lock" size={18} />
            </span>
            <h2 className="auth-title">欢迎回来</h2>
          </div>
          <p className="auth-subtitle">
            {isDeviceMode
              ? "此保险库由 Windows 设备保护加密。"
              : "输入主密码以查看并复制你的验证码。"}
          </p>

          {reasonText ? (
            <InlineNotice tone="neutral" icon="clock">
              {reasonText}
            </InlineNotice>
          ) : null}

          <form onSubmit={unlock} className="auth-form lock-form">
            {!isDeviceMode ? (
              <Field label="主密码" htmlFor="unlock-password">
                <PasswordInput
                  id="unlock-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setError("");
                  }}
                  placeholder="输入主密码"
                  autoComplete="current-password"
                  maxLength={256}
                  data-autofocus
                  data-testid="unlock-password"
                />
              </Field>
            ) : (
              <div className="device-unlock-icon">
                <Icon name="shieldCheck" size={28} />
                <span>Windows 数据保护</span>
              </div>
            )}

            {error ? (
              <div className="form-error form-error-block" role="alert">
                <Icon name="warning" size={15} />
                {error}
              </div>
            ) : null}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              block
              loading={busy}
              icon={<Icon name="unlock" size={17} />}
              data-testid="unlock-submit"
            >
              {isDeviceMode ? "使用 Windows 保护解锁" : "解锁保险库"}
            </Button>
          </form>

          <div className="lock-help">
            <button
              type="button"
              className="text-link"
              onClick={() => setShowRecovery((value) => !value)}
            >
              忘记主密码？
            </button>
          </div>

          {showRecovery ? (
            <InlineNotice
              tone="danger"
              icon="warning"
              title="主密码无法找回"
              actions={
                <Button variant="danger" size="sm" onClick={onRequestReset}>
                  重置应用
                </Button>
              }
            >
              重置会永久删除此电脑上的全部验证码和分组。如果留有备份，可以在重置后重新导入。
            </InlineNotice>
          ) : null}

          <div className="lock-footnote">
            <Icon name="shieldCheck" size={14} />
            <span>保险库文件已加密；主密码从不写入磁盘</span>
          </div>
        </div>
        <div className="auth-version">Authenticator Desktop {state?.version || "1.0.0"}</div>
      </main>
    </div>
  );
}
